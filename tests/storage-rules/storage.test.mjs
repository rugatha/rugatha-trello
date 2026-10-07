import {before, after, test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {initializeTestEnvironment, assertFails, assertSucceeds} from '@firebase/rules-unit-testing';
import {doc, setDoc, updateDoc} from 'firebase/firestore';
import {ref, uploadBytes, getBytes, getMetadata, updateMetadata, deleteObject, listAll} from 'firebase/storage';

let env;
const projectId='demo-rugatha-trello';
const root='workspaces/main';
const path=(id='existing',board='allowed')=>`${root}/boards/${board}/cards/card/attachments/${id}/file.png`;
const metadata=(id,author='editor',extra={})=>({contentType:'image/png',customMetadata:{uploadedBy:author,boardId:'allowed',cardId:'card',attachmentId:id},...extra});
const context=(id,verified=true)=>env.authenticatedContext(id,{email:id+'@example.com',email_verified:verified});
const storage=(id,verified=true)=>context(id,verified).storage();
const roles=['owner','admin','editor','viewer','member'];
before(async()=>{
  if(!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST) throw Error('Run npm run test:storage-rules.');
  env=await initializeTestEnvironment({projectId,
    firestore:{rules:await readFile(new URL('../../firestore.rules',import.meta.url),'utf8')},
    storage:{rules:await readFile(new URL('../../storage.rules',import.meta.url),'utf8')}});
  await env.clearFirestore();await env.clearStorage();
  await env.withSecurityRulesDisabled(async ctx=>{
    for(const id of [...roles,'disabled','outsider','revoked']){
      await setDoc(doc(ctx.firestore(),root+'/memberLookup/'+id+'@example.com'),{memberId:id});
      await setDoc(doc(ctx.firestore(),root+'/members/'+id),{name:id,status:id==='disabled'?'disabled':'active',role:roles.includes(id)?id:'editor',accessboard:id==='outsider'?[]:['allowed']});
    }
    await setDoc(doc(ctx.firestore(),root+'/memberLookup/alternate@example.com'),{memberId:'editor'});
    await setDoc(doc(ctx.firestore(),root+'/boards/allowed/cards/card'),{title:'Card',archived:false});
    await uploadBytes(ref(ctx.storage(),path()),new Uint8Array([1,2,3]),metadata('existing'));
    await uploadBytes(ref(ctx.storage(),path('existing','forbidden')),new Uint8Array([1]),{contentType:'image/png'});
  });
});
after(async()=>{await env?.cleanup();});

for(const role of roles)test(role+': board reads and immutable role-based uploads',async()=>{
  const client=storage(role);
  assert.equal((await assertSucceeds(getBytes(ref(client,path())))).byteLength,3);
  const write=['owner','admin','editor'].includes(role)?assertSucceeds:assertFails;
  await write(uploadBytes(ref(client,path(role)),new Uint8Array([1]),metadata(role,role)));
  await assertFails(getMetadata(ref(client,path('existing','forbidden'))));
  const forbidden=metadata(role,role);forbidden.customMetadata.boardId='forbidden';
  await assertFails(uploadBytes(ref(client,path(role,'forbidden')),new Uint8Array([1]),forbidden));
  await assertFails(uploadBytes(ref(client,path()),new Uint8Array([9]),metadata('existing',role)));
  await assertFails(updateMetadata(ref(client,path()),{customMetadata:{uploadedBy:role}}));
  await assertFails(deleteObject(ref(client,path())));
  await assertFails(listAll(ref(client,`${root}/boards/allowed/cards/card/attachments`)));
});
for(const id of ['anonymous','unapproved','disabled','outsider','unverified'])test(id+': storage read and upload denied',async()=>{
  const client=id==='anonymous'?env.unauthenticatedContext().storage():storage(id==='unverified'?'editor':id,id!=='unverified');
  await assertFails(getBytes(ref(client,path())));
  await assertFails(uploadBytes(ref(client,path(id)),new Uint8Array([1]),metadata(id,id)));
});
test('multi-email membership and email case resolve to the same member',async()=>{
  const ctx=env.authenticatedContext('other-uid',{email:'ALTERNATE@EXAMPLE.COM',email_verified:true});
  await assertSucceeds(getMetadata(ref(ctx.storage(),path())));
  await assertSucceeds(uploadBytes(ref(ctx.storage(),path('alias')),new Uint8Array([1]),metadata('alias','editor')));
});
test('invalid type, empty file, forged linkage and extra metadata are rejected',async()=>{
  const client=storage('editor');
  for(const type of ['text/html','image/svg+xml','application/javascript','application/octet-stream']){
    await assertFails(uploadBytes(ref(client,path('badtype')),new Uint8Array([1]),metadata('badtype','editor',{contentType:type})));
  }
  await assertFails(uploadBytes(ref(client,path('empty')),new Uint8Array(),metadata('empty')));
  for(const patch of [{uploadedBy:'owner'},{boardId:'forbidden'},{cardId:'other'},{attachmentId:'other'},{unexpected:'x'}]){
    const meta=metadata('forged');Object.assign(meta.customMetadata,patch);
    await assertFails(uploadBytes(ref(client,path('forged')),new Uint8Array([1]),meta));
  }
  await assertFails(uploadBytes(ref(client,'outside/file.png'),new Uint8Array([1]),metadata('outside')));
});
test('20 MiB boundary is accepted; larger uploads are rejected',async()=>{
  const client=storage('editor');
  await assertSucceeds(uploadBytes(ref(client,path('limit')),new Uint8Array(20*1024*1024),metadata('limit')));
  await assertFails(uploadBytes(ref(client,path('large')),new Uint8Array(20*1024*1024+1),metadata('large')));
});
test('supported document, image and model MIME types can be uploaded with matching linkage',async()=>{
  const client=storage('editor');
  const types=['image/jpeg','image/gif','image/webp','image/avif','application/pdf','text/plain','application/zip','model/gltf-binary','model/stl'];
  for(const [index,contentType] of types.entries()){
    const id='type-'+index;
    await assertSucceeds(uploadBytes(ref(client,path(id)),new Uint8Array([1]),metadata(id,'editor',{contentType})));
  }
});
test('revocation applies to an already authenticated storage client',async()=>{
  const client=storage('revoked');await assertSucceeds(getBytes(ref(client,path())));
  await env.withSecurityRulesDisabled(ctx=>updateDoc(doc(ctx.firestore(),root+'/members/revoked'),{accessboard:[]}));
  await assertFails(getBytes(ref(client,path())));
  await assertFails(uploadBytes(ref(client,path('revoked')),new Uint8Array([1]),metadata('revoked','revoked')));
});
test('archiving preserves authorized file reads and never allows client deletion',async()=>{
  await env.withSecurityRulesDisabled(async ctx=>{
    await updateDoc(doc(ctx.firestore(),root+'/boards/allowed/cards/card'),{archived:true});
    await setDoc(doc(ctx.firestore(),root+'/boards/allowed/cards/card/attachments/existing'),{archived:true});
  });
  const client=storage('viewer');await assertSucceeds(getBytes(ref(client,path())));
  await assertFails(deleteObject(ref(storage('owner'),path())));
});
