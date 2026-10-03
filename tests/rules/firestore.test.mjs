import {before, after, test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {initializeTestEnvironment, assertFails, assertSucceeds} from '@firebase/rules-unit-testing';
import {doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc} from 'firebase/firestore';

const projectId='demo-rugatha-trello';
const root='workspaces/main';
const board=root+'/boards/allowed';
const card=board+'/cards/card';
const roles=['owner','admin','editor','viewer','member'];
let env;
const dbFor=(id,verified=true)=>env.authenticatedContext(id,{email:id+'@example.com',email_verified:verified}).firestore();

before(async()=>{
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw Error('Run npm run test:rules with the local emulator.');
  env=await initializeTestEnvironment({projectId,firestore:{rules:await readFile(new URL('../../firestore.rules',import.meta.url),'utf8')}});
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore();
    const data={
      [root]:{name:'Test'},
      [board]:{name:'Allowed'},
      [root+'/boards/forbidden']:{name:'Forbidden'},
      [board+'/columns/column']:{name:'Todo'},
      [card]:{title:'Card',createdBy:'owner',updatedBy:'owner'},
      [card+'/checklist/item']:{text:'Task',done:false},
      [card+'/attachments/file']:{name:'File',archived:false},
    };
    for(const id of [...roles,'disabled','outsider']){
      data[root+'/memberLookup/'+id+'@example.com']={memberId:id};
      data[root+'/members/'+id]={id,name:id,role:roles.includes(id)?id:'editor',status:id==='disabled'?'disabled':'active',accessboard:id==='outsider'?[]:['allowed']};
      data[card+'/comments/'+id]={memberId:id,text:'Comment'};
    }
    for(const [path,value] of Object.entries(data))await setDoc(doc(db,path),value);
  });
});
after(async()=>{await env?.cleanup();});

for(const role of roles){
  test(role+': authorized reads and role-based writes',async()=>{
    const db=dbFor(role), editable=['owner','admin','editor'].includes(role);
    const write=editable?assertSucceeds:assertFails;
    for(const path of [board,card,card+'/comments/owner',card+'/checklist/item',card+'/attachments/file']){
      await assertSucceeds(getDoc(doc(db,path)));
    }
    await assertSucceeds(getDocs(collection(db,board+'/cards')));
    await write(updateDoc(doc(db,board),{name:'Allowed '+role}));
    await write(setDoc(doc(db,board+'/columns/'+role),{name:'Stage'}));
    await write(setDoc(doc(db,board+'/cards/'+role),{title:'New',createdBy:role}));
    await write(updateDoc(doc(db,card),{title:'Edited '+role,updatedBy:role}));
    await write(setDoc(doc(db,card+'/comments/new-'+role),{memberId:role,text:'New'}));
    await write(setDoc(doc(db,card+'/checklist/'+role),{text:'New',done:false}));
    await write(updateDoc(doc(db,card+'/attachments/file'),{archived:role==='owner'}));
    await assertFails(getDoc(doc(db,root+'/boards/forbidden')));
    await assertFails(setDoc(doc(db,root+'/boards/new-'+role),{name:'Unauthorized new board'}));
    await assertFails(getDocs(collection(db,root+'/boards')));
    await assertFails(deleteDoc(doc(db,card)));
    await assertFails(deleteDoc(doc(db,card+'/attachments/file')));
  });
}
for(const id of ['anonymous','unapproved','disabled','outsider','unverified']){
  test(id+': cannot read or modify restricted board data',async()=>{
    const db=id==='anonymous'?env.unauthenticatedContext().firestore():dbFor(id==='unverified'?'editor':id,id!=='unverified');
    for(const path of [board,board+'/columns/column',card,card+'/comments/owner',card+'/checklist/item',card+'/attachments/file']){
      await assertFails(getDoc(doc(db,path)));
      await assertFails(updateDoc(doc(db,path),{name:'Blocked'}));
    }
    await assertFails(getDocs(collection(db,board+'/cards')));
    if(id!=='outsider')await assertFails(getDocs(collection(db,root+'/members')));
  });
}
test('member can change only their own valid name, not membership privileges or lookup',async()=>{
  const db=dbFor('viewer'),ref=doc(db,root+'/members/viewer');
  await assertSucceeds(updateDoc(ref,{name:'New name'}));
  for(const patch of [{role:'owner'},{accessboard:['allowed','forbidden']},{status:'active',emails:['other@example.com']},{name:''},{name:'x'.repeat(41)}]){
    await assertFails(updateDoc(ref,patch));
  }
  await assertFails(updateDoc(doc(db,root+'/members/editor'),{name:'Impersonate'}));
  await assertSucceeds(getDoc(doc(db,root+'/memberLookup/viewer@example.com')));
  await assertFails(getDoc(doc(db,root+'/memberLookup/editor@example.com')));
  await assertFails(getDocs(collection(db,root+'/memberLookup')));
  await assertFails(setDoc(doc(db,root+'/memberLookup/viewer@example.com'),{memberId:'owner'}));
});
test('only owner/admin can delete columns',async()=>{
  for(const role of roles){
    const ref=doc(dbFor(role),board+'/columns/delete-'+role);
    await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),ref.path),{name:'Empty'}));
    await (['owner','admin'].includes(role)?assertSucceeds:assertFails)(deleteDoc(ref));
  }
});
test('comment updates require valid text and preserve author',async()=>{
  const db=dbFor('editor'),ref=doc(db,card+'/comments/editor');
  await assertSucceeds(updateDoc(ref,{text:'Edited'}));
  for(const patch of [{text:''},{text:'x'.repeat(5001)},{memberId:'owner'}])await assertFails(updateDoc(ref,patch));
  await assertFails(setDoc(doc(db,card+'/comments/forged'),{memberId:'owner',text:'Forged'}));
});
test('only an editor comment author can delete their comment',async()=>{
  const ref=doc(dbFor('editor'),card+'/comments/editor');
  for(const role of ['owner','admin','viewer'])await assertFails(deleteDoc(doc(dbFor(role),ref.path)));
  await assertSucceeds(deleteDoc(ref));
});
test('card writes cannot impersonate authors or replace original creator',async()=>{
  const db=dbFor('editor');
  await assertFails(setDoc(doc(db,board+'/cards/forged'),{title:'Forged',createdBy:'owner'}));
  await assertFails(updateDoc(doc(db,card),{createdBy:'editor',updatedBy:'editor'}));
  await assertFails(updateDoc(doc(db,card),{title:'Forged',updatedBy:'owner'}));
});
