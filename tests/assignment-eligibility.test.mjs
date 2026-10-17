import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
const {createManagement}=createRequire(import.meta.url)('../functions/management.cjs');
const root='workspaces/main';
function setup(assigned=[]) {
 const data=new Map([
  [root+'/memberLookup/owner@example.com',{memberId:'admin'}],
  [root+'/members/admin',{name:'Rugatha',role:'admin',status:'active',assignable:false,accessboard:['b']}],
  [root+'/members/worker',{name:'Worker',role:'viewer',status:'active',accessboard:['b']}],
  [root+'/boards/b',{name:'Board'}],
  [root+'/boards/b/cards/c',{title:'Card',assigneeIds:assigned}],
 ]),writes=[];
 const ref=path=>({path,id:path.split('/').at(-1),collection:name=>({doc:id=>ref(path+'/'+name+'/'+id)})});
 const snap=path=>({id:path.split('/').at(-1),exists:data.has(path),data:()=>data.get(path)});
 const db={doc:ref,collection:path=>({path,collection:true}),runTransaction:fn=>fn({
  get:async r=>r.collection===true?{docs:[...data.keys()].filter(p=>p.startsWith(r.path+'/')&&!p.slice(r.path.length+1).includes('/')).map(snap)}:snap(r.path),
  update:(r,d)=>writes.push({path:r.path,data:d}),create:(r,d)=>writes.push({path:r.path,data:d}),
 })};
 return {service:createManagement(db),writes};
}
const auth={uid:'owner',token:{email:'owner@example.com',email_verified:true}};
test('nonassignable admin is hidden only from assignment picker, including historical assignments',async()=>{
 const {service}=setup(['admin']);
 const picker=await service.listMembers(auth,{boardId:'b',cardId:'c'});
 assert.deepEqual(picker.members.map(m=>m.id),['worker']);
 assert.deepEqual(picker.assigneeIds,['admin']);
 assert.ok((await service.listMembers(auth,{})).members.some(m=>m.id==='admin'));
});
test('nonassignable admin retains management access but cannot be assigned through the API',async()=>{
 const {service,writes}=setup();
 await assert.rejects(service.setAssignees(auth,{requestId:randomUUID(),boardId:'b',cardId:'c',assigneeIds:['admin'],expectedAssigneeIds:[]}),e=>e.code==='failed-precondition');
 assert.equal(writes.length,0);
 await service.setAssignees(auth,{requestId:randomUUID(),boardId:'b',cardId:'c',assigneeIds:['worker'],expectedAssigneeIds:[]});
 assert.deepEqual(writes[0].data.assigneeIds,['worker']);
});
