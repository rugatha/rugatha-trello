import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
const require=createRequire(new URL('../../functions/index.cjs',import.meta.url));
const {initializeApp,deleteApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const {getAuth}=require('firebase-admin/auth');
const projectId='demo-rugatha-trello',root='workspaces/main';
let app,db,auth;const tokens={};
async function call(name,data,who='owner') {
 const response=await fetch(`http://127.0.0.1:5001/${projectId}/asia-east1/${name}`,{method:'POST',headers:{'Content-Type':'application/json',...(tokens[who]?{Authorization:'Bearer '+tokens[who]}:{})},body:JSON.stringify({data})});
 const body=await response.json();
 return body.error?{error:body.error.status,message:body.error.message}:body.result;
}
const newBoard=()=>({requestId:randomUUID(),name:'New board',description:'Description',color:'#455f56',memberIds:['viewer']});
const assignment=(patch={})=>({requestId:randomUUID(),boardId:'allowed',cardId:'card',assigneeIds:['viewer'],expectedAssigneeIds:[],...patch});
before(async()=>{
 if(!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.GCLOUD_PROJECT!==projectId)throw Error('Only run through test:management against demo emulators.');
 app=initializeApp({projectId});db=getFirestore(app);auth=getAuth(app);
 const roles=['owner','admin','editor','viewer','member','disabled','outsider','unverified','unapproved'];
 for(const name of roles){
  const email=name+'@example.com';
  await auth.createUser({uid:name,email,password:'local-test-password',emailVerified:name!=='unverified'});
  const login=await fetch('http://'+process.env.FIREBASE_AUTH_EMULATOR_HOST+'/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'local-test-password',returnSecureToken:true})});
  tokens[name]=(await login.json()).idToken;
  if(name==='unapproved')continue;
  await db.doc(`${root}/memberLookup/${email}`).set({memberId:name});
  await db.doc(`${root}/members/${name}`).set({name,role:['disabled','outsider','unverified'].includes(name)?'owner':name,status:name==='disabled'?'pending':'active',accessboard:name==='outsider'?[]:['allowed']});
 }
 await db.doc(`${root}/boards/allowed`).set({name:'Allowed',archived:false});
 await db.doc(`${root}/boards/allowed/cards/card`).set({title:'Card',archived:false,assigneeIds:[],description:'Keep me',updatedBy:'owner'});
});
after(async()=>{await db?.terminate();if(app)await deleteApp(app);});
for(const who of ['anonymous','unverified','unapproved','disabled','editor','viewer','member'])test(`${who} cannot use management endpoints`,async()=>{
 for(const [name,data] of [['listManagementMembers',{}],['createManagedBoard',newBoard()],['setManagedAssignees',assignment()]]){
  const result=await call(name,data,who);
  assert.ok(['UNAUTHENTICATED','PERMISSION_DENIED'].includes(result.error),JSON.stringify(result));
 }
});
for(const who of ['owner','admin'])test(`${who} creates board, columns and grants atomically; retries do not duplicate`,async()=>{
 const payload=newBoard(),result=await call('createManagedBoard',payload,who);assert.ok(result.boardId,JSON.stringify(result));
 const board=db.doc(`${root}/boards/${result.boardId}`);
 assert.equal((await board.get()).data().createdBy,who);
 assert.equal((await board.collection('columns').get()).size,3);
 for(const member of [who,'viewer'])assert.ok((await db.doc(`${root}/members/${member}`).get()).data().accessboard.includes(result.boardId));
 assert.equal((await db.doc(`${root}/members/viewer`).get()).data().role,'viewer');
 assert.deepEqual(await call('createManagedBoard',payload,who),result);
 assert.equal((await call('createManagedBoard',{...payload,name:'Changed'},who)).error,'ALREADY_EXISTS');
});
test('invalid target creates neither board nor grant; concurrent grants are preserved',async()=>{
 for(const memberIds of [['missing'],['disabled'],['viewer','viewer']]){
  const payload={...newBoard(),memberIds},result=await call('createManagedBoard',payload);
  assert.ok(result.error);assert.equal((await db.doc(`${root}/boards/managed-${payload.requestId}`).get()).exists,false);
 }
 const [a,b]=await Promise.all([call('createManagedBoard',newBoard()),call('createManagedBoard',newBoard())]);
 const grants=(await db.doc(`${root}/members/viewer`).get()).data().accessboard;
 assert.ok(grants.includes(a.boardId));assert.ok(grants.includes(b.boardId));
});
test('member picker returns only display fields and flags historical assignments',async()=>{
 await db.doc(`${root}/boards/allowed/cards/card`).update({assigneeIds:['disabled']});
 const result=await call('listManagementMembers',{boardId:'allowed',cardId:'card'});
 assert.ok(result.members.some(m=>m.id==='viewer'&&m.eligible));
 assert.ok(result.members.some(m=>m.id==='disabled'&&!m.eligible));
 assert.ok(!result.members.some(m=>m.id==='outsider'));
 for(const m of result.members)assert.deepEqual(Object.keys(m).sort(),['eligible','id','name']);
 await db.doc(`${root}/boards/allowed/cards/card`).update({assigneeIds:[]});
});
test('assignment validates access, preserves card content, blocks conflicts and handles retries',async()=>{
 assert.equal((await call('setManagedAssignees',assignment(),'outsider')).error,'PERMISSION_DENIED');
 for(const assigneeIds of [['missing'],['disabled'],['outsider']])assert.equal((await call('setManagedAssignees',assignment({assigneeIds}))).error,'FAILED_PRECONDITION');
 const payload=assignment(),result=await call('setManagedAssignees',payload);assert.deepEqual(result.assigneeIds,['viewer']);
 assert.deepEqual(await call('setManagedAssignees',payload),result);
 assert.equal((await db.doc(`${root}/boards/allowed/cards/card`).get()).data().description,'Keep me');
 assert.equal((await call('setManagedAssignees',assignment({assigneeIds:['admin']}))).error,'ABORTED');
 assert.deepEqual((await call('setManagedAssignees',assignment({assigneeIds:[],expectedAssigneeIds:['viewer']}),'admin')).assigneeIds,[]);
});
test('revocation and archival are rechecked on the server',async()=>{
 await db.doc(`${root}/members/admin`).update({accessboard:[]});
 assert.equal((await call('setManagedAssignees',assignment(),'admin')).error,'PERMISSION_DENIED');
 assert.equal((await call('listManagementMembers',{boardId:'allowed',cardId:'card'},'admin')).error,'PERMISSION_DENIED');
 await db.doc(`${root}/boards/allowed/cards/card`).update({archived:true});
 assert.equal((await call('setManagedAssignees',assignment())).error,'FAILED_PRECONDITION');
 await db.doc(`${root}/boards/allowed/cards/card`).update({archived:false});
});
test('forged actor, unsafe IDs, oversized selections and invalid fields are rejected',async()=>{
 for(const patch of [{createdBy:'owner'},{memberIds:['../members']},{memberIds:Array.from({length:41},(_,i)=>'m'+i)},{name:' '},{description:'x'.repeat(5001)},{color:'red'},{requestId:'not-a-uuid'}])assert.equal((await call('createManagedBoard',{...newBoard(),...patch})).error,'INVALID_ARGUMENT');
 assert.equal((await call('setManagedAssignees',assignment({cardId:'../card'}))).error,'INVALID_ARGUMENT');
});

test('manager without existing boards can create their first board',async()=>{
 const result=await call('createManagedBoard',{...newBoard(),memberIds:[]},'outsider');
 assert.ok(result.boardId);assert.ok((await db.doc(`${root}/members/outsider`).get()).data().accessboard.includes(result.boardId));
});
test('simultaneous assignment edits commit one winner and reject the stale update',async()=>{
 const ref=db.doc(`${root}/boards/allowed/cards/card`);await ref.update({assigneeIds:[]});
 const results=await Promise.all([call('setManagedAssignees',assignment()),call('setManagedAssignees',assignment({assigneeIds:['editor']}))]);
 assert.equal(results.filter(x=>x.error==='ABORTED').length,1);
 const winner=results.find(x=>!x.error);assert.deepEqual((await ref.get()).data().assigneeIds,winner.assigneeIds);
});
