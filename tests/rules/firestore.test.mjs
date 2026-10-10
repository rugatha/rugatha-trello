import {before, after, test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {initializeTestEnvironment, assertFails, assertSucceeds} from '@firebase/rules-unit-testing';
import {doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot} from 'firebase/firestore';

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
      [root+'/memberLookup/alternate@example.com']:{memberId:'viewer'},
      [board]:{name:'Allowed'},
      [root+'/boards/forbidden']:{name:'Forbidden'},
      [board+'/columns/column']:{name:'Todo'},
      [card]:{title:'Card',createdBy:'owner',updatedBy:'owner'},
      [card+'/checklist/item']:{text:'Task',done:false},
      [card+'/attachments/file']:{name:'File',archived:false},
    };
    for(const id of [...roles,'disabled','pending','outsider']){
      data[root+'/memberLookup/'+id+'@example.com']={memberId:id};
      data[root+'/members/'+id]={id,name:id,role:roles.includes(id)?id:'editor',status:['disabled','pending'].includes(id)?id:'active',accessboard:id==='outsider'?[]:['allowed']};
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
for(const id of ['anonymous','unapproved','pending','disabled','outsider','unverified']){
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

test('multiple verified emails mapped to one member share name-edit permissions',async()=>{
  const db=dbFor('alternate'),ref=doc(db,root+'/members/viewer');
  await assertSucceeds(getDoc(doc(db,board)));
  await assertSucceeds(updateDoc(ref,{name:'Shared member name'}));
  await assertFails(updateDoc(doc(db,root+'/members/editor'),{name:'Other member'}));
  await assertFails(updateDoc(ref,{role:'editor'}));
  await assertFails(updateDoc(doc(db,card),{title:'Viewer cannot edit',updatedBy:'viewer'}));
});

for(const role of ['owner','admin','editor'])test(role+': client cannot assign members, including on new cards',async()=>{
  const db=dbFor(role),path=board+'/cards/assignment-'+role,ref=doc(db,path);
  await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),path),{title:'Assigned',createdBy:'owner',assigneeIds:['viewer']}));
  await assertSucceeds(updateDoc(ref,{title:'Safe edit',updatedBy:role}));
  for(const assigneeIds of [[],['editor'],['viewer','editor'],null,'viewer']){
    await assertFails(updateDoc(ref,{assigneeIds,updatedBy:role}));
  }
  await assertFails(setDoc(doc(db,path+'-forged'),{title:'New',createdBy:role,assigneeIds:['viewer']}));
  await assertSucceeds(setDoc(doc(db,path+'-empty'),{title:'New',createdBy:role,assigneeIds:[]}));
});
for(const role of roles)test(role+': archive and restore permissions',async()=>{
  const db=dbFor(role),path=board+'/cards/archive-'+role,ref=doc(db,path),file=doc(db,path+'/attachments/file');
  await env.withSecurityRulesDisabled(async c=>{
    await setDoc(doc(c.firestore(),path),{title:'Archive fixture',createdBy:'owner',assigneeIds:['viewer'],archived:false});
    await setDoc(doc(c.firestore(),file.path),{name:'Attachment',archived:false});
  });
  const allowed=['owner','admin','editor'].includes(role)?assertSucceeds:assertFails;
  for(const archived of [true,false]){
    await allowed(updateDoc(ref,{archived,updatedBy:role}));
    await allowed(updateDoc(file,{archived}));
  }
});
test('revoking board access blocks an already authenticated client',async()=>{
  const id='revoked',db=dbFor(id),member=root+'/members/'+id;
  await env.withSecurityRulesDisabled(async c=>{
    await setDoc(doc(c.firestore(),root+'/memberLookup/'+id+'@example.com'),{memberId:id});
    await setDoc(doc(c.firestore(),member),{name:'Revoked',role:'editor',status:'active',accessboard:['allowed']});
  });
  await assertSucceeds(getDoc(doc(db,card)));
  await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),member),{accessboard:[]}));
  await assertFails(getDoc(doc(db,card)));
  await assertFails(updateDoc(doc(db,card),{title:'Blocked',updatedBy:id}));
  await assertFails(setDoc(doc(db,card+'/comments/revoked'),{text:'Blocked',memberId:id}));
});

for(const role of roles)test(role+': shared board colors require edit permission',async()=>{
 const db=dbFor(role),ref=doc(db,board);
 const allowed=['owner','admin','editor'].includes(role)?assertSucceeds:assertFails;
 for(const color of ['#455f56','#c8b58f','#8fa697','#bca582','#ad9790'])await allowed(updateDoc(ref,{color}));
 await assertFails(updateDoc(ref,{color:'url(https://example.com/image)'}));
 await assertFails(updateDoc(ref,{color:null}));
});

test('own membership listener receives revocation then fails closed on deactivation', {timeout:15000}, async t=>{
  const id='live-membership',path=root+'/members/'+id;
  await env.withSecurityRulesDisabled(async context=>{
    await setDoc(doc(context.firestore(),root+'/memberLookup/'+id+'@example.com'),{memberId:id});
    await setDoc(doc(context.firestore(),path),{name:'Live',status:'active',role:'viewer',accessboard:['allowed']});
  });
  const events=[],waiting=[];
  const push=value=>waiting.length?waiting.shift()(value):events.push(value);
  const next=()=>events.length?Promise.resolve(events.shift()):new Promise(resolve=>waiting.push(resolve));
  const stop=onSnapshot(doc(dbFor(id),path),snap=>push(snap.data()),error=>push(error));
  t.after(stop);
  assert.deepEqual((await next()).accessboard,['allowed']);
  await env.withSecurityRulesDisabled(context=>updateDoc(doc(context.firestore(),path),{accessboard:[]}));
  assert.deepEqual((await next()).accessboard,[]);
  await env.withSecurityRulesDisabled(context=>updateDoc(doc(context.firestore(),path),{status:'disabled'}));
  assert.equal((await next()).code,'permission-denied');
});

test('clients cannot forge management operation receipts or grant board access',async()=>{
  for(const role of roles){
    const db=dbFor(role);
    await assertFails(setDoc(doc(db,root+'/managementRequests/forged'),{kind:'createBoard',result:{boardId:'forbidden'}}));
    await assertFails(getDoc(doc(db,root+'/managementRequests/forged')));
    await assertFails(updateDoc(doc(db,root+'/members/'+role),{accessboard:['allowed','forbidden']}));
  }
});

test('private membership documents are self-only, including for managers',async()=>{
 for(const role of roles){
  const db=dbFor(role);
  await assertSucceeds(getDoc(doc(db,root+'/members/'+role)));
  await assertFails(getDoc(doc(db,root+'/members/'+(role==='owner'?'viewer':'owner'))));
  await assertFails(getDocs(collection(db,root+'/members')));
  await assertFails(getDocs(collection(db,root+'/managementRequests')));
 }
});

test('personal themes are self-only preset preferences without identity or privilege writes',async()=>{
 for(const role of roles){
  const ref=doc(dbFor(role),root+'/members/'+role);
  for(const theme of ['dark','light'])await assertSucceeds(updateDoc(ref,{theme}));
  for(const theme of ['system','#fff',null,1,{},['dark']])await assertFails(updateDoc(ref,{theme}));
  await assertFails(updateDoc(ref,{theme:'dark',role:'owner',emails:['forged@example.com']}));
 }
 await assertSucceeds(updateDoc(doc(dbFor('alternate'),root+'/members/viewer'),{theme:'dark'}));
 await assertFails(updateDoc(doc(dbFor('owner'),root+'/members/viewer'),{theme:'light'}));
 for(const id of ['disabled','pending','unapproved'])await assertFails(updateDoc(doc(dbFor(id),root+'/members/'+id),{theme:'dark'}));
 await assertFails(updateDoc(doc(env.unauthenticatedContext().firestore(),root+'/members/viewer'),{theme:'dark'}));
});
