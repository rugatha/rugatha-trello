import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import {documents,changes} from '../workspace-data.js';
async function setup(remote,fail=false){
 const writes=[];
 const context=vm.createContext({console,Set,Map,Date,JSON,Promise,Error});
 const deps={firestore:{},documents,changes,collection:(_,path)=>path,doc:(_,path)=>path,
 getDocFromServer:async path=>({exists:()=>remote.has(path),data:()=>remote.get(path)}),
 getDocsFromServer:async path=>({docs:[...remote].filter(([key])=>key.startsWith(path+'/')&&key.split('/').length===path.split('/').length+1).map(([key,value])=>({id:key.split('/').at(-1),data:()=>value}))}),
 runTransaction:async(_,fn)=>{const pending=[];await fn({get:async path=>({exists:()=>remote.has(path),data:()=>remote.get(path)}),update:(...v)=>pending.push(['update',...v]),set:(...v)=>pending.push(['set',...v]),delete:(...v)=>pending.push(['delete',...v])});if(fail)throw Error('offline');writes.push(...pending);}};
 const mod=new vm.SourceTextModule(await fs.readFile(new URL('../storage.js',import.meta.url),'utf8'),{context});
 await mod.link(async()=>new vm.SyntheticModule(Object.keys(deps),function(){for(const [k,v]of Object.entries(deps))this.setExport(k,v);},{context}));await mod.evaluate();
 return {api:mod.namespace,writes};
}
const fixture=()=>({boards:[{id:'b',name:'Board',columns:[],cards:[{id:'c',title:'Card',assignees:[],checklist:[],comments:[],attachments:[]}]}]});
test('persists changed fields with author metadata',async()=>{
 const a=fixture(),b=fixture();b.boards[0].cards[0].title='New';const {api,writes}=await setup(documents(a));
 await api.persistWorkspace(a,b,'member-01');assert.equal(writes.length,1);assert.equal(writes[0][2].title,'New');assert.equal(writes[0][2].updatedBy,'member-01');assert.equal(writes[0][2].assigneeIds,undefined);
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
