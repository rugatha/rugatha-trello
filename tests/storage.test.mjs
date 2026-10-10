import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import {documents,changes} from '../workspace-data.js';
import {compareOrderKey} from '../order-key.js';
async function setup(remote,fail=false){
 const writes=[],listeners=[],reads=[],oldView=structuredClone(remote);
 const context=vm.createContext({console,Set,Map,Date,JSON,Promise,Error});
 const deps={firestore:{app:{}},getFirestore:()=>({}),documents,changes,compareOrderKey,collection:(_,path)=>path,doc:(_,path)=>path,
 getDoc:async path=>{reads.push(path);return {exists:()=>remote.has(path),data:()=>remote.get(path)}},
 getDocs:async path=>{reads.push(path);return {docs:[...remote].filter(([key])=>key.startsWith(path+'/')&&key.split('/').length===path.split('/').length+1).map(([key,value])=>({id:key.split('/').at(-1),data:()=>value}))}},
 onSnapshot:(path,next,error)=>{const listener={path,next,error,active:true};listeners.push(listener);return()=>{listener.active=false}},
 runTransaction:async(_,fn)=>{const pending=[];await fn({get:async path=>({exists:()=>remote.has(path),data:()=>remote.get(path)}),update:(...v)=>pending.push(['update',...v]),set:(...v)=>pending.push(['set',...v]),delete:(...v)=>pending.push(['delete',...v])});if(fail)throw Error('offline');writes.push(...pending);}};
 deps.getDocFromServer=deps.getDoc;deps.getDocsFromServer=async path=>({docs:[...oldView].filter(([key])=>key.startsWith(path+'/')&&key.split('/').length===path.split('/').length+1).map(([key,value])=>({id:key.split('/').at(-1),data:()=>value}))});
 const mod=new vm.SourceTextModule(await fs.readFile(new URL('../storage.js',import.meta.url),'utf8'),{context});
 await mod.link(async()=>new vm.SyntheticModule(Object.keys(deps),function(){for(const [k,v]of Object.entries(deps))this.setExport(k,v);},{context}));await mod.evaluate();
 return {api:mod.namespace,writes,listeners,reads};
}
const fixture=()=>({boards:[{id:'b',name:'Board',columns:[],cards:[{id:'c',title:'Card',assignees:[],checklist:[],comments:[],attachments:[]}]}]});
test('persists changed fields with author metadata',async()=>{
 const a=fixture(),b=fixture();b.boards[0].cards[0].title='New';const {api,writes}=await setup(documents(a));
 const committed=await api.persistWorkspace(a,b,'member-01');assert.equal(writes.length,1);assert.equal(writes[0][2].title,'New');assert.equal(writes[0][2].updatedBy,'member-01');assert.equal(writes[0][2].assigneeIds,undefined);
 assert.equal(committed[0].boardId,'b');assert.equal(committed[0].cardId,'c');assert.equal(committed[0].updatedAt,writes[0][2].updatedAt);
});
test('returned metadata supports a second edit without a false conflict',async()=>{
 const a=fixture(),b=fixture(),remote=documents(a);b.boards[0].cards[0].coverId='file';
 const first=await setup(remote);const [committed]=await first.api.persistWorkspace(a,b,'m');
 Object.assign(remote.get('workspaces/main/boards/b/cards/c'),first.writes[0][2]);
 Object.assign(b.boards[0].cards[0],{updatedBy:'m',updatedAt:committed.updatedAt});
 const c=structuredClone(b);c.boards[0].cards[0].title='Next edit';
 const second=await setup(remote);await second.api.persistWorkspace(b,c,'m');
 assert.equal(second.writes.length,1);
});
test('conflicting remote edit rejects without writes',async()=>{
 const a=fixture(),b=fixture(),remote=documents(a);b.boards[0].cards[0].title='New';remote.get('workspaces/main/boards/b/cards/c').title='Someone else';
 const {api,writes}=await setup(remote);await assert.rejects(api.persistWorkspace(a,b,'m'),/其他成員/);assert.equal(writes.length,0);
});
test('offline transaction rejects without reporting a successful write',async()=>{
 const a=fixture(),b=fixture();b.boards[0].cards[0].title='New';const {api,writes}=await setup(documents(a),true);
 await assert.rejects(api.persistWorkspace(a,b,'m'),/offline/);assert.equal(writes.length,0);
});
test('card removal is a soft archive',async()=>{
 const a=fixture(),b=fixture();b.boards[0].cards=[];const {api,writes}=await setup(documents(a));await api.persistWorkspace(a,b,'m');assert.equal(writes[0][0],'update');assert.equal(writes[0][2].archived,true);
});
test('attachment removal archives the file and updates the parent count',async()=>{
 const a=fixture(),b=fixture();a.boards[0].cards[0].attachments=[{id:'file',name:'Image'}];
 b.boards[0].cards[0].attachments=[{id:'file',name:'Image'}];b.boards[0].cards[0].attachments=[];
 const {api,writes}=await setup(documents(a));await api.persistWorkspace(a,b,'m');
 assert.equal(writes.length,2);
 assert.equal(writes.find(write=>write[1].endsWith('/attachments/file'))[2].archived,true);
 assert.equal(writes.find(write=>write[1].endsWith('/cards/c'))[2].attachmentCount,0);
});
test('child-only edit touches its parent card for realtime listeners',async()=>{
 const a=fixture(),b=fixture();a.boards[0].cards[0].checklist=[{id:'item',text:'Task',done:false}];
 b.boards[0].cards[0].checklist=[{id:'item',text:'Task',done:true}];
 const {api,writes}=await setup(documents(a));await api.persistWorkspace(a,b,'m');
 assert.equal(writes.length,2);
 assert.equal(writes.find(write=>write[1].endsWith('/cards/c'))[2].updatedBy,'m');
 assert.equal(writes.find(write=>write[1].endsWith('/checklist/item'))[2].done,true);
});
test('realtime subscription watches authorized boards and can be stopped',async()=>{
 const {api,listeners}=await setup(new Map());let changed=0;
 const stop=api.subscribeWorkspace({accessboard:['b','b']},()=>changed++,()=>{});
 assert.equal(listeners.length,3);
 for(const listener of listeners)listener.next({metadata:{hasPendingWrites:false}});
 assert.equal(changed,0);
 listeners[2].next({metadata:{hasPendingWrites:true}});
 assert.equal(changed,0);
 listeners[2].next({metadata:{hasPendingWrites:false}});
 assert.equal(changed,1);
 stop();assert.ok(listeners.every(listener=>!listener.active));
});
test('loads only authorized boards and all cards beyond 50',async()=>{
 const remote=new Map([['workspaces/main/boards/b',{name:'Board'}],['workspaces/main/boards/private',{name:'Private'}]]);
 for(let i=0;i<60;i++)remote.set(`workspaces/main/boards/b/cards/c${i}`,{title:'Card',orderKey:String(i).padStart(3,'0'),assigneeIds:['m']});
 remote.set('workspaces/main/boards/b/cards/archived',{title:'Archived',archived:true});
 remote.set('workspaces/main/boards/b/cards/c0/attachments/old',{name:'Old image',archived:true});
 const {api}=await setup(remote);const loaded=await api.loadWorkspace({accessboard:['b'],roster:[]});
 assert.equal(loaded.boards.length,1);assert.equal(loaded.boards[0].cards.length,60);assert.equal(loaded.boards[0].cards[0].assignees[0],'m');
 assert.equal(loaded.boards[0].archivedCards[0].id,'archived');
 assert.equal(loaded.boards[0].cards[0].archivedAttachments[0].id,'old');
 assert.equal(loaded.boards[0].cards[0].attachments.length,0);
});
test('scoped reload keeps other boards and skips known empty child collections',async()=>{
 const remote=new Map([
   ['workspaces/main/boards/a',{name:'A'}],['workspaces/main/boards/b',{name:'B'}],
   ['workspaces/main/boards/a/cards/c',{title:'Before',checklistCount:0,commentCount:0,attachmentCount:0}],
   ['workspaces/main/boards/b/cards/d',{title:'Other',checklistCount:0,commentCount:0,attachmentCount:0}]
 ]);
 const {api,reads}=await setup(remote),account={accessboard:['a','b'],roster:[]};
 const previous=await api.loadWorkspace(account);reads.length=0;
 remote.get('workspaces/main/boards/a/cards/c').title='After';
 const loaded=await api.loadWorkspace(account,{previous,boardIds:['a']});
 assert.equal(loaded.boards.find(board=>board.id==='a').cards[0].title,'After');
 assert.equal(loaded.boards.find(board=>board.id==='b').cards[0].title,'Other');
 assert.ok(reads.every(path=>path.startsWith('workspaces/main/boards/a')));
 assert.ok(reads.every(path=>!path.endsWith('/checklist')&&!path.endsWith('/comments')));
});
test('restores an archived card without touching its children',async()=>{
 const remote=new Map([['workspaces/main/boards/b/cards/c',{title:'Card',archived:true}]]);
 const {api,writes}=await setup(remote);await api.restoreCard('b','c','m');
 assert.equal(writes.length,1);assert.equal(writes[0][0],'update');assert.equal(writes[0][2].archived,false);
 assert.equal(writes[0][2].updatedBy,'m');
});
test('restores an attachment and its parent count in one transaction',async()=>{
 const remote=new Map([['workspaces/main/boards/b/cards/c',{title:'Card',attachmentCount:2}],
   ['workspaces/main/boards/b/cards/c/attachments/a',{name:'Image',archived:true}]]);
 const {api,writes}=await setup(remote);await api.restoreAttachment('b','c','a','m');
 assert.equal(writes.length,2);assert.deepEqual(writes.map(write=>write[1]),[
   'workspaces/main/boards/b/cards/c/attachments/a','workspaces/main/boards/b/cards/c']);
 assert.equal(writes[0][2].archived,false);assert.equal(writes[1][2].attachmentCount,3);
});
test('rejects restoration when the item was already changed',async()=>{
 const remote=new Map([['workspaces/main/boards/b/cards/c',{title:'Card',archived:false}]]);
 const {api,writes}=await setup(remote);await assert.rejects(api.restoreCard('b','c','m'),/已變更/);
 assert.equal(writes.length,0);
});

test('independent concurrent fields merge without overwriting another member edit',async()=>{
 const a=fixture(),b=fixture(),remote=documents(a);
 b.boards[0].cards[0].title='My title';
 remote.get('workspaces/main/boards/b/cards/c').description='Other member description';
 const {api,writes}=await setup(remote);
 await api.persistWorkspace(a,b,'m');
 assert.equal(writes.length,1);
 assert.equal(writes[0][2].title,'My title');
 assert.equal(Object.hasOwn(writes[0][2],'description'),false);
});
test('concurrent checklist toggle rejects without touching parent counts',async()=>{
 const a=fixture(),b=fixture();
 a.boards[0].cards[0].checklist=[{id:'item',text:'Task',done:false}];
 b.boards[0].cards[0].checklist=[{id:'item',text:'Task',done:true}];
 const remote=documents(a);
 remote.get('workspaces/main/boards/b/cards/c/checklist/item').done=true;
 const {api,writes}=await setup(remote);
 await assert.rejects(api.persistWorkspace(a,b,'m'),/其他成員/);
 assert.equal(writes.length,0);
});


test('zero-count attachments are deferred but their archives remain discoverable',async()=>{
 const root='workspaces/main/boards/b',remote=new Map([
  [root,{name:'Board'}],
  [root+'/cards/empty',{title:'Empty',attachmentCount:0,checklistCount:0,commentCount:0}],
  [root+'/cards/empty/attachments/old',{name:'Archived image',archived:true}],
  [root+'/cards/active',{title:'Active',attachmentCount:1,checklistCount:0,commentCount:0}],
  [root+'/cards/active/attachments/image',{name:'Cover',archived:false}],
  [root+'/cards/legacy',{title:'Legacy',checklistCount:0,commentCount:0}],
  [root+'/cards/legacy/attachments/file',{name:'Legacy file'}]
 ]);
 const {api,reads,writes}=await setup(remote);
 const loaded=await api.loadWorkspace({accessboard:['b']});
 assert.equal(reads.filter(path=>path.endsWith('/attachments')).length,2);
 assert.ok(!reads.includes(root+'/cards/empty/attachments'));
 assert.equal(loaded.boards[0].cards.find(c=>c.id==='active').attachments[0].id,'image');
 assert.equal(loaded.boards[0].cards.find(c=>c.id==='legacy').attachments[0].id,'file');
 const before=structuredClone(loaded);reads.length=0;
 const results=await api.loadDeferredAttachmentArchives(loaded.boards[0]);
 assert.deepEqual(Array.from(reads),[root+'/cards/empty/attachments']);
 assert.equal(results[0].files[0].id,'old');
 assert.deepEqual(structuredClone(loaded),before);
 // UI-only hydration must never produce writes or archive active attachments.
 const card=loaded.boards[0].cards.find(c=>c.id==='empty');
 card.archivedAttachments=results[0].files;card.attachmentArchiveLoaded=true;
 await api.persistWorkspace(before,loaded,'m');assert.equal(writes.length,0);
});
test('600 zero-attachment cards require no attachment queries during initial load',async()=>{
 const root='workspaces/main/boards/b',remote=new Map([[root,{name:'Board'}]]);
 for(let i=0;i<600;i++)remote.set(root+'/cards/'+i,{title:'Card',attachmentCount:0,checklistCount:0,commentCount:0});
 const {api,reads}=await setup(remote);await api.loadWorkspace({accessboard:['b']});
 assert.equal(reads.length,3);assert.ok(!reads.some(path=>path.endsWith('/attachments')));
});

test('first child reload uses current server counts even when the live query view still has zero',async()=>{
 const root='workspaces/main/boards/b',remote=new Map([[root,{name:'Board'}],[root+'/cards/c',{title:'Card',commentCount:0,checklistCount:0,attachmentCount:0}]]);
 const {api,writes}=await setup(remote),account={accessboard:['b']};
 const before=await api.loadWorkspace(account),after=structuredClone(before);
 after.boards[0].cards[0].comments.push({id:'comment',text:'First',userId:'m'});
 after.boards[0].cards[0].checklist.push({id:'task',text:'First',done:false});
 await api.persistWorkspace(before,after,'m');
 for(const [kind,path,payload] of writes){if(kind==='set')remote.set(path,payload);else if(kind==='update')Object.assign(remote.get(path),payload);}
 const loaded=await api.loadWorkspace(account),card=loaded.boards[0].cards[0];
 assert.equal(card.commentCount,1);assert.equal(card.checklistCount,1);
 assert.equal(card.comments[0].text,'First');assert.equal(card.checklist[0].text,'First');
});
