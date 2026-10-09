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

const invite=(patch={})=>({requestId:randomUUID(),name:'Invited member',email:randomUUID()+'@example.com',role:'viewer',status:'pending',accessboard:['allowed'],...patch});
async function change(memberId,patch={},who='owner') {
 const data=(await db.doc(`${root}/members/${memberId}`).get()).data();
 return call('saveManagedMembership',{requestId:randomUUID(),memberId,expected:{role:data.role,status:data.status,accessboard:data.accessboard},role:data.role,status:data.status,accessboard:data.accessboard,...patch},who);
}
for(const who of ['anonymous','unverified','unapproved','disabled','editor','viewer','member'])test(`${who} cannot read private directory or modify membership`,async()=>{
 for(const [name,data] of [['listMembershipDirectory',{}],['saveManagedMembership',invite()]])assert.ok(['UNAUTHENTICATED','PERMISSION_DENIED'].includes((await call(name,data,who)).error));
});
test('display directory exposes only ID/name to active members',async()=>{
 const result=await call('listDisplayMembers',{},'viewer');
 assert.ok(result.members.length>0);
 for(const member of result.members)assert.deepEqual(Object.keys(member).sort(),['id','name']);
 for(const who of ['anonymous','unapproved','unverified','disabled'])assert.ok((await call('listDisplayMembers',{},who)).error);
});
test('invite is pending, normalized, atomic, idempotent and uniquely reserves email',async()=>{
 const payload=invite({email:' New.Member@Example.com '}),result=await call('saveManagedMembership',payload);
 assert.ok(result.memberId,JSON.stringify(result));
 assert.deepEqual(await call('saveManagedMembership',payload),result);
 const member=(await db.doc(`${root}/members/${result.memberId}`).get()).data();
 assert.equal(member.status,'pending');assert.deepEqual(member.emails,['new.member@example.com']);
 assert.equal((await db.doc(`${root}/memberLookup/new.member@example.com`).get()).data().memberId,result.memberId);
 assert.equal((await call('saveManagedMembership',{...payload,requestId:randomUUID()})).error,'ALREADY_EXISTS');
 assert.equal((await call('saveManagedMembership',{...payload,name:'Changed'})).error,'ALREADY_EXISTS');
 assert.ok(!(await change(result.memberId,{status:'active'})).error);
 assert.ok(!(await change(result.memberId,{status:'disabled'})).error);
 assert.equal((await db.doc(`${root}/members/${result.memberId}`).get()).data().status,'disabled');
 assert.ok(!(await change(result.memberId,{status:'active',role:'editor',accessboard:[]})).error);
});
test('admin cannot elevate or edit managers and cannot grant inaccessible boards',async()=>{
 await db.doc(`${root}/members/admin`).update({accessboard:['allowed']});
 for(const role of ['owner','admin'])assert.equal((await call('saveManagedMembership',invite({role}),'admin')).error,'PERMISSION_DENIED');
 assert.equal((await change('owner',{status:'disabled'},'admin')).error,'PERMISSION_DENIED');
 assert.equal((await change('admin',{role:'owner'},'admin')).error,'PERMISSION_DENIED');
 assert.equal((await call('saveManagedMembership',invite({accessboard:['forbidden']}),'admin')).error,'PERMISSION_DENIED');
 const invited=await call('saveManagedMembership',invite(),'admin');assert.ok(invited.memberId);
 assert.ok(!(await change(invited.memberId,{status:'active'},'admin')).error);
});
test('last active owner cannot be disabled or demoted, even concurrently',async()=>{
 // Earlier fixtures deliberately include an owner with no board access.
 await db.doc(`${root}/members/outsider`).update({role:'viewer'});
 await db.doc(`${root}/members/unverified`).update({role:'viewer'});
 assert.equal((await change('owner',{status:'disabled'})).error,'FAILED_PRECONDITION');
 assert.equal((await change('owner',{role:'viewer'})).error,'FAILED_PRECONDITION');
 await db.doc(`${root}/members/second-owner`).set({name:'Second owner',role:'owner',status:'active',accessboard:[]});
 const results=await Promise.all([change('owner',{role:'viewer'}),change('second-owner',{role:'viewer'})]);
 assert.equal(results.filter(r=>!r.error).length,1);
 const owners=await db.collection(`${root}/members`).where('role','==','owner').get();
 assert.equal(owners.docs.filter(d=>d.data().status==='active').length,1);
 await db.doc(`${root}/members/owner`).update({role:'owner'});
});
test('stale membership edits fail without overwriting changes; malformed requests write nothing',async()=>{
 const created=await call('saveManagedMembership',invite()),memberId=created.memberId;
 const payload={requestId:randomUUID(),memberId,expected:{role:'viewer',status:'pending',accessboard:['allowed']},role:'editor',status:'active',accessboard:['allowed']};
 assert.ok(!(await call('saveManagedMembership',payload)).error);
 assert.deepEqual(await call('saveManagedMembership',payload),{memberId});
 assert.equal((await call('saveManagedMembership',{...payload,requestId:randomUUID(),role:'member'})).error,'ABORTED');
 for(const patch of [{email:'../invalid'},{role:'superuser'},{status:'active'},{accessboard:['missing']},{accessboard:['allowed','allowed']},{name:''},{extra:true}])assert.ok((await call('saveManagedMembership',invite(patch))).error);
});
test('revoked manager cannot replay a previously authorized membership operation',async()=>{
 const payload=invite(),result=await call('saveManagedMembership',payload,'admin');assert.ok(result.memberId);
 await db.doc(`${root}/members/admin`).update({status:'disabled'});
 assert.equal((await call('saveManagedMembership',payload,'admin')).error,'PERMISSION_DENIED');
 await db.doc(`${root}/members/admin`).update({status:'active'});
});
test('private directory has explicit fields and limits admin board choices',async()=>{
 const result=await call('listMembershipDirectory',{},'admin');
 assert.deepEqual(result.boards.map(b=>b.id),['allowed']);
 for(const m of result.members)assert.deepEqual(Object.keys(m).sort(),['accessboard','emails','id','name','role','status']);
});
test('concurrent invitations cannot create two members for one email',async()=>{
 const payload=invite();
 const results=await Promise.all([call('saveManagedMembership',payload),call('saveManagedMembership',{...payload,requestId:randomUUID()})]);
 assert.equal(results.filter(r=>!r.error).length,1);
 assert.equal(results.filter(r=>r.error==='ALREADY_EXISTS').length,1);
});
