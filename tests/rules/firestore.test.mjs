import {before, after, test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {initializeTestEnvironment, assertFails, assertSucceeds} from '@firebase/rules-unit-testing';
import {doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, writeBatch} from 'firebase/firestore';

const projectId='demo-rugatha-trello';
const root='workspaces/main';
const board=root+'/boards/allowed';
const card=board+'/cards/card';
const roles=['admin','owner','editor','viewer','member'];
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
      [card]:{title:'Card',createdBy:'admin',updatedBy:'admin'},
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
    const db=dbFor(role), editable=['admin','owner','editor'].includes(role);
    const write=editable?assertSucceeds:assertFails;
    for(const path of [board,card,card+'/comments/admin',card+'/checklist/item',card+'/attachments/file']){
      await assertSucceeds(getDoc(doc(db,path)));
    }
    await assertSucceeds(getDocs(collection(db,board+'/cards')));
    await write(updateDoc(doc(db,board),{name:'Allowed '+role}));
    await write(setDoc(doc(db,board+'/columns/'+role),{name:'Stage'}));
    await write(setDoc(doc(db,board+'/cards/'+role),{title:'New',createdBy:role}));
    await write(updateDoc(doc(db,card),{title:'Edited '+role,updatedBy:role}));
    await write(setDoc(doc(db,card+'/comments/new-'+role),{memberId:role,text:'New'}));
    await write(setDoc(doc(db,card+'/checklist/'+role),{text:'New',done:false}));
    await write(updateDoc(doc(db,card+'/attachments/file'),{archived:role==='admin'}));
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
    for(const path of [board,board+'/columns/column',card,card+'/comments/admin',card+'/checklist/item',card+'/attachments/file']){
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
  for(const patch of [{role:'admin'},{accessboard:['allowed','forbidden']},{status:'active',emails:['other@example.com']},{name:''},{name:'x'.repeat(41)}]){
    await assertFails(updateDoc(ref,patch));
  }
  await assertFails(updateDoc(doc(db,root+'/members/editor'),{name:'Impersonate'}));
  await assertSucceeds(getDoc(doc(db,root+'/memberLookup/viewer@example.com')));
  await assertFails(getDoc(doc(db,root+'/memberLookup/editor@example.com')));
  await assertFails(getDocs(collection(db,root+'/memberLookup')));
  await assertFails(setDoc(doc(db,root+'/memberLookup/viewer@example.com'),{memberId:'admin'}));
});
test('only admin/owner can delete columns',async()=>{
  for(const role of roles){
    const ref=doc(dbFor(role),board+'/columns/delete-'+role);
    await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),ref.path),{name:'Empty'}));
    await (['admin','owner'].includes(role)?assertSucceeds:assertFails)(deleteDoc(ref));
  }
});
test('comment updates require valid text and preserve author',async()=>{
  const db=dbFor('editor'),ref=doc(db,card+'/comments/editor');
  await assertSucceeds(updateDoc(ref,{text:'Edited'}));
  for(const patch of [{text:''},{text:'x'.repeat(5001)},{memberId:'admin'}])await assertFails(updateDoc(ref,patch));
  await assertFails(setDoc(doc(db,card+'/comments/forged'),{memberId:'admin',text:'Forged'}));
});
test('only an editor comment author can delete their comment',async()=>{
  const ref=doc(dbFor('editor'),card+'/comments/editor');
  for(const role of ['admin','owner','viewer'])await assertFails(deleteDoc(doc(dbFor(role),ref.path)));
  await assertSucceeds(deleteDoc(ref));
});
test('card writes cannot impersonate authors or replace original creator',async()=>{
  const db=dbFor('editor');
  await assertFails(setDoc(doc(db,board+'/cards/forged'),{title:'Forged',createdBy:'admin'}));
  await assertFails(updateDoc(doc(db,card),{createdBy:'editor',updatedBy:'editor'}));
  await assertFails(updateDoc(doc(db,card),{title:'Forged',updatedBy:'admin'}));
});

test('multiple verified emails mapped to one member share name-edit permissions',async()=>{
  const db=dbFor('alternate'),ref=doc(db,root+'/members/viewer');
  await assertSucceeds(getDoc(doc(db,board)));
  await assertSucceeds(updateDoc(ref,{name:'Shared member name'}));
  await assertFails(updateDoc(doc(db,root+'/members/editor'),{name:'Other member'}));
  await assertFails(updateDoc(ref,{role:'editor'}));
  await assertFails(updateDoc(doc(db,card),{title:'Viewer cannot edit',updatedBy:'viewer'}));
});

for(const role of ['admin','owner','editor'])test(role+': client cannot assign members, including on new cards',async()=>{
  const db=dbFor(role),path=board+'/cards/assignment-'+role,ref=doc(db,path);
  await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),path),{title:'Assigned',createdBy:'admin',assigneeIds:['viewer']}));
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
    await setDoc(doc(c.firestore(),path),{title:'Archive fixture',createdBy:'admin',assigneeIds:['viewer'],archived:false});
    await setDoc(doc(c.firestore(),file.path),{name:'Attachment',archived:false});
  });
  const allowed=['admin','owner','editor'].includes(role)?assertSucceeds:assertFails;
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
 const allowed=['admin','owner','editor'].includes(role)?assertSucceeds:assertFails;
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
  await assertFails(getDoc(doc(db,root+'/members/'+(role==='admin'?'viewer':'admin'))));
  await assertFails(getDocs(collection(db,root+'/members')));
  await assertFails(getDocs(collection(db,root+'/managementRequests')));
 }
});

test('personal themes are self-only preset preferences without identity or privilege writes',async()=>{
 for(const role of roles){
  const ref=doc(dbFor(role),root+'/members/'+role);
  for(const theme of ['dark','light'])await assertSucceeds(updateDoc(ref,{theme}));
  for(const theme of ['system','#fff',null,1,{},['dark']])await assertFails(updateDoc(ref,{theme}));
  await assertFails(updateDoc(ref,{theme:'dark',role:'admin',emails:['forged@example.com']}));
 }
 await assertSucceeds(updateDoc(doc(dbFor('alternate'),root+'/members/viewer'),{theme:'dark'}));
 await assertFails(updateDoc(doc(dbFor('admin'),root+'/members/viewer'),{theme:'light'}));
 for(const id of ['disabled','pending','unapproved'])await assertFails(updateDoc(doc(dbFor(id),root+'/members/'+id),{theme:'dark'}));
 await assertFails(updateDoc(doc(env.unauthenticatedContext().firestore(),root+'/members/viewer'),{theme:'dark'}));
});

test('client cannot forge deletion locks; locked cards and boards reject all writes',async()=>{
 const admin=dbFor('admin');
 for(const patch of [{deleting:true},{deleting:false}]){
  await assertFails(updateDoc(doc(admin,board),patch));
  await assertFails(updateDoc(doc(admin,card),{...patch,updatedBy:'admin'}));
 }
 await assertFails(setDoc(doc(admin,board+'/cards/forged-lock'),{title:'Locked',createdBy:'admin',deleting:false}));
 await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),card),{deleting:true}));
 for(const role of ['admin','owner','editor']){
  const db=dbFor(role);
  await assertFails(updateDoc(doc(db,card),{title:'Changed',updatedBy:role}));
  await assertFails(setDoc(doc(db,card+'/checklist/late'),{text:'Late'}));
  await assertFails(setDoc(doc(db,card+'/comments/late'),{text:'Late',memberId:role}));
  await assertFails(updateDoc(doc(db,card+'/attachments/file'),{archived:false}));
 }
 await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),card),{deleting:false}));
 await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),board),{deleting:true}));
 await assertFails(updateDoc(doc(admin,board),{name:'Changed'}));
 await assertFails(setDoc(doc(admin,board+'/cards/late'),{title:'Late',createdBy:'admin'}));
 await assertFails(updateDoc(doc(admin,card),{title:'Changed',updatedBy:'admin'}));
 await assertFails(setDoc(doc(admin,board+'/columns/late'),{name:'Late'}));
 await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),board),{deleting:false}));
});

test('only Admin can archive and restore a board through direct client writes',async()=>{
 for(const role of ['owner','editor','viewer','member'])await assertFails(updateDoc(doc(dbFor(role),board),{archived:true}));
 await assertSucceeds(updateDoc(doc(dbFor('admin'),board),{archived:true}));
 for(const role of ['owner','editor'])await assertFails(updateDoc(doc(dbFor(role),board),{archived:false}));
 await assertSucceeds(updateDoc(doc(dbFor('admin'),board),{archived:false}));
});


test('copying a card can atomically create its checklist while orphan child writes remain blocked',async()=>{
 const db=dbFor('editor'),path=board+'/cards/copied-with-checklist';
 const batch=writeBatch(db);
 batch.set(doc(db,path),{title:'Copied card',createdBy:'editor',assigneeIds:[]});
 batch.set(doc(db,path+'/checklist/task'),{text:'Copied task',done:false});
 await assertSucceeds(batch.commit());
 await assertFails(setDoc(doc(db,board+'/cards/missing-parent/checklist/orphan'),{text:'Orphan'}));
});

test('personal board order and raster avatar are self-service without changing grants',async()=>{
  const ref=doc(dbFor('viewer'),root+'/members/viewer');
  await assertSucceeds(updateDoc(ref,{boardOrder:['allowed'],avatar:'data:image/jpeg;base64,YXZhdGFy'}));
  for(const patch of [{boardOrder:['forbidden']},{boardOrder:['allowed','allowed']},{boardOrder:'allowed'},
    {avatar:'https://example.com/avatar.jpg'},{avatar:'data:image/svg+xml;base64,PHN2Zz4='},
    {avatar:'data:image/jpeg;base64,'+'A'.repeat(50000)},{avatar:42},
    {boardOrder:['allowed'],role:'admin'}])await assertFails(updateDoc(ref,patch));
  await assertFails(updateDoc(doc(dbFor('editor'),root+'/members/viewer'),{avatar:''}));
  await assertSucceeds(updateDoc(ref,{avatar:'',boardOrder:[]}));
});
test('obsolete personal board IDs do not prevent changing a name or avatar',async()=>{
  await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),root+'/members/viewer'),{boardOrder:['revoked']}));
  const ref=doc(dbFor('viewer'),root+'/members/viewer');
  await assertSucceeds(updateDoc(ref,{name:'Viewer renamed',avatar:''}));
  await assertSucceeds(updateDoc(ref,{boardOrder:['allowed']}));
});

test('notifications are private, server-created and only read state is editable',async()=>{
 const path=root+'/members/viewer/notifications/test';
 await env.withSecurityRulesDisabled(async context=>setDoc(doc(context.firestore(),path),{type:'mention',read:false,boardId:'allowed',cardId:'card',createdAt:'2026-10-16T00:00:00Z'}));
 const viewer=dbFor('viewer');
 await assertSucceeds(getDocs(collection(viewer,root+'/members/viewer/notifications')));
 await assertSucceeds(updateDoc(doc(viewer,path),{read:true}));
 await assertFails(updateDoc(doc(viewer,path),{type:'assignment'}));
 await assertFails(setDoc(doc(viewer,root+'/members/viewer/notifications/forged'),{read:false}));
 await assertFails(getDoc(doc(dbFor('admin'),path)));
 await assertFails(getDoc(doc(dbFor('disabled'),path)));
 await assertFails(deleteDoc(doc(viewer,path)));
});
test('clients cannot forge mention identities or modify text behind stored mention offsets',async()=>{
 const path=card+'/comments/mentioned';
 const mentions=[{memberId:'viewer',start:0,end:7,label:'viewer'}];
 await assertFails(setDoc(doc(dbFor('editor'),path),{memberId:'editor',text:'@viewer',mentions}));
 await env.withSecurityRulesDisabled(async context=>setDoc(doc(context.firestore(),path),{memberId:'editor',text:'@viewer',mentions}));
 await assertFails(updateDoc(doc(dbFor('editor'),path),{text:'changed'}));
 await assertFails(updateDoc(doc(dbFor('editor'),path),{mentions:[]}));
});

for (const role of ['viewer','member']) test(role+': assignees can change only their active card deadline',async()=>{
 const path=board+'/cards/deadline-'+role,db=dbFor(role);
 await env.withSecurityRulesDisabled(async context=>setDoc(doc(context.firestore(),path),{title:'Deadline task',createdBy:'admin',assigneeIds:[role],due:'',archived:false}));
 const update={due:'2026-11-06T17:30:00+08:00',updatedAt:'2026-10-16T00:00:00Z',updatedBy:role};
 await assertSucceeds(updateDoc(doc(db,path),update));
 for (const extra of [{title:'Changed'},{done:true},{assigneeIds:[role,'outsider']},{archived:true},{updatedBy:'admin'}]) {
  await assertFails(updateDoc(doc(db,path),{...update,...extra}));
 }
 await assertFails(updateDoc(doc(db,path),{...update,due:42}));
 await assertFails(updateDoc(doc(db,path),{...update,due:'tomorrow'}));
 await assertFails(updateDoc(doc(db,path),{...update,updatedAt:42}));
 await assertFails(setDoc(doc(db,path+'/checklist/new'),{text:'Cannot change children'}));
 await assertSucceeds(updateDoc(doc(db,path),{...update,due:''}));
 const other=role==='viewer'?'member':'viewer';
 await assertFails(updateDoc(doc(dbFor(other),path),{...update,updatedBy:other}));
 if(role==='viewer')await assertSucceeds(updateDoc(doc(dbFor('alternate'),path),update));
});
test('deadline permission rejects removed assignments, revoked boards, disabled users and archived or deleting content',async()=>{
 const path=board+'/cards/deadline-guard';
 const seed=patch=>env.withSecurityRulesDisabled(async context=>setDoc(doc(context.firestore(),path),{title:'Task',createdBy:'admin',assigneeIds:['viewer','outsider','disabled'],due:'',...patch}));
 const patch={due:'2026-11-06T17:30:00+08:00',updatedAt:'2026-10-16T00:00:00Z',updatedBy:'viewer'};
 for(const state of [{archived:true},{deleting:true},{assigneeIds:[]}]) {await seed(state);await assertFails(updateDoc(doc(dbFor('viewer'),path),patch));}
 await seed({});
 for(const id of ['outsider','disabled'])await assertFails(updateDoc(doc(dbFor(id),path),{...patch,updatedBy:id}));
 await env.withSecurityRulesDisabled(async context=>updateDoc(doc(context.firestore(),board),{archived:true}));
 try{await assertFails(updateDoc(doc(dbFor('viewer'),path),patch));}
 finally{await env.withSecurityRulesDisabled(async context=>updateDoc(doc(context.firestore(),board),{archived:false}));}
 await env.withSecurityRulesDisabled(async context=>updateDoc(doc(context.firestore(),board),{deleting:true}));
 try{await assertFails(updateDoc(doc(dbFor('viewer'),path),patch));}
 finally{await env.withSecurityRulesDisabled(async context=>updateDoc(doc(context.firestore(),board),{deleting:false}));}
});

for(const role of ['viewer','member'])test(role+': board members can create or recolor one label without other write access',async()=>{
 const db=dbFor(role),ref=doc(db,board),key='custom-'+role;
 const boardData=(await getDoc(ref)).data();let definitions={...(boardData.labelDefinitions||{}),[key]:{name:'Label '+role,color:'#aabbcc'}};
 await assertSucceeds(updateDoc(ref,{labelDefinitions:definitions,labelEditId:key}));
 definitions={...definitions,[key]:{name:'Label '+role,color:'#112233'}};
 await assertSucceeds(updateDoc(ref,{labelDefinitions:definitions,labelEditId:key}));
 await assertFails(updateDoc(ref,{name:'Hijack',labelDefinitions:definitions,labelEditId:key}));
 await assertFails(updateDoc(ref,{labelEditId:key,labelDefinitions:{...definitions,[key]:{name:'Bad',color:'url(unsafe)'}}}));
 await assertFails(updateDoc(ref,{labelEditId:key,labelDefinitions:{...definitions,[key]:{name:'',color:'#112233'}}}));
 await assertFails(updateDoc(ref,{labelEditId:key,labelDefinitions:{...definitions,[key]:{name:'Bad',color:'#112233',extra:true}}}));
 await assertFails(updateDoc(ref,{labelEditId:key,labelDefinitions:{...definitions,[key]:{name:'Changed',color:'#ffffff'},second:{name:'Second',color:'#ffffff'}}}));
 await assertFails(updateDoc(doc(dbFor('outsider'),board),{labelDefinitions:definitions,labelEditId:key}));
});
test('label editing is blocked after board archival or deletion starts',async()=>{
 for(const state of [{archived:true},{deleting:true}]){
  await env.withSecurityRulesDisabled(async context=>updateDoc(doc(context.firestore(),board),state));
  try{const db=dbFor('viewer'),current=(await getDoc(doc(db,board))).data();await assertFails(updateDoc(doc(db,board),{labelEditId:'blocked',labelDefinitions:{...(current.labelDefinitions||{}),blocked:{name:'Blocked',color:'#ffffff'}}}));}
  finally{await env.withSecurityRulesDisabled(async context=>updateDoc(doc(context.firestore(),board),{archived:false,deleting:false}));}
 }
});

test('strict Viewer can read all granted boards but cannot edit labels or assigned deadlines',async()=>{
  await env.withSecurityRulesDisabled(async c=>{
    await setDoc(doc(c.firestore(),root+'/memberLookup/strict-viewer@example.com'),{memberId:'strict-viewer'});
    await setDoc(doc(c.firestore(),root+'/members/strict-viewer'),{name:'Viewer',status:'active',role:'viewer',readOnly:true,accessboard:['allowed','forbidden']});
    await setDoc(doc(c.firestore(),board+'/cards/strict-card'),{title:'Read only',assigneeIds:['strict-viewer'],due:''});
  });
  const db=dbFor('strict-viewer');
  for(const id of ['allowed','forbidden'])await assertSucceeds(getDoc(doc(db,root+'/boards/'+id)));
  await assertFails(updateDoc(doc(db,board),{labelDefinitions:{test:{name:'No',color:'#123456'}},labelEditId:'test'}));
  await assertFails(updateDoc(doc(db,board+'/cards/strict-card'),{due:'2026-10-21T12:00:00+08:00',updatedAt:new Date().toISOString(),updatedBy:'strict-viewer'}));
  await assertFails(updateDoc(doc(db,root+'/members/strict-viewer'),{readOnly:false}));
  await assertFails(updateDoc(doc(db,board+'/cards/strict-card'),{title:'No',updatedBy:'strict-viewer'}));
});

test('checklist deadlines and assignees are validated against the parent card',async()=>{
 const path=board+'/cards/checklist-schedule';
 await env.withSecurityRulesDisabled(async context=>{
  await setDoc(doc(context.firestore(),path),{title:'Schedule',createdBy:'admin',assigneeIds:['viewer']});
 });
 const db=dbFor('editor'),item=doc(db,path+'/checklist/item');
 await assertSucceeds(setDoc(item,{text:'Task',done:false,due:'2026-11-03T17:30:00+08:00',assigneeId:'viewer'}));
 await assertSucceeds(updateDoc(item,{due:'',assigneeId:''}));
 await assertSucceeds(updateDoc(item,{assigneeId:'viewer'}));
 for(const patch of [{assigneeId:'editor'},{assigneeId:['viewer']},{due:123},{due:'tomorrow'},{due:'2026-11-03T17:30'}])await assertFails(updateDoc(item,patch));
 await assertFails(updateDoc(doc(dbFor('viewer'),path+'/checklist/item'),{due:'2026-11-04T17:30:00+08:00'}));
 await assertFails(setDoc(doc(db,board+'/cards/missing-checklist-parent/checklist/item'),{text:'Orphan',assigneeId:'viewer'}));
 await env.withSecurityRulesDisabled(async context=>{
  await updateDoc(doc(context.firestore(),path),{assigneeIds:[]});
 });
 await assertFails(updateDoc(item,{done:true}));
 await assertSucceeds(updateDoc(item,{assigneeId:'',done:true}));
});
test('copied checklists cannot retain assignees on an unassigned new card',async()=>{
 const db=dbFor('editor'),path=board+'/cards/checklist-copy-invalid';
 const batch=writeBatch(db);
 batch.set(doc(db,path),{title:'Copy',createdBy:'editor',assigneeIds:[]});
 batch.set(doc(db,path+'/checklist/item'),{text:'Task',done:false,assigneeId:'viewer'});
 await assertFails(batch.commit());
});
