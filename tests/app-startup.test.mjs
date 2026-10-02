import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
test('main page starts empty and loads Firebase only after membership is available',async()=>{
 const elements=new Map(),listeners=new Map();let loads=0,liveChange,stopped=0;
 const element=selector=>{if(!elements.has(selector))elements.set(selector,{value:selector==='#dueFilter'?'all':'',classList:{add(){},remove(){},toggle(){}},style:{},replaceChildren(){this.innerHTML='';},close(){this.open=false;},showModal(){this.open=true;}});return elements.get(selector);};
 const context=vm.createContext({console,structuredClone,setTimeout,clearTimeout,crypto:{},Intl,Date,
 document:{querySelector:element,querySelectorAll:selector=>/^#[a-zA-Z]+$/.test(selector)?[element(selector)]:[],addEventListener(){}},
 window:{addEventListener:(name,fn)=>listeners.set(name,fn)}});
 const source=await fs.readFile(new URL('../app.js',import.meta.url),'utf8');
 const app=new vm.SourceTextModule(source,{context});
 const dep=new vm.SyntheticModule(['loadWorkspace','subscribeWorkspace','persistWorkspace','restoreCard','restoreAttachment'],function(){
 this.setExport('loadWorkspace',async()=>{loads++;return {users:[],boards:[{id:'b',name:'Firebase board',columns:[{id:'col',name:'Todo'}],archivedCards:[{id:'old',title:'Archived card'}],cards:[{id:'c',title:'Current card',columnId:'col',description:'',assignees:[],labels:[],checklist:[],comments:[],attachments:[],archivedAttachments:[{id:'file',name:'Archived file'}]}]}]};});this.setExport('persistWorkspace',async()=>{});
 this.setExport('subscribeWorkspace',(_,onChange)=>{liveChange=onChange;return()=>stopped++});
 this.setExport('restoreCard',async()=>{});this.setExport('restoreAttachment',async()=>{});
 },{context});await app.link(()=>dep);await app.evaluate();
 assert.equal(loads,0);assert.match(element('#boardTitle').textContent,/登入/);assert.equal(element('#quickCreate').disabled,true);
 await listeners.get('boardly-auth-changed')({detail:{memberId:'m',workspaceRole:'viewer',accessboard:['b']}});
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(loads,1);assert.equal(element('#boardTitle').textContent,'Firebase board');assert.equal(element('#quickCreate').disabled,true);
 element('#archiveBtn').onclick();
 assert.match(element('#archivedCards').innerHTML,/Archived card/);
 assert.match(element('#archivedAttachments').innerHTML,/Archived file/);
 assert.equal(element('#archiveDialog').open,true);
 element('#archiveDialog').close();
 liveChange();await new Promise(resolve=>setTimeout(resolve,300));
 assert.equal(loads,2);
 element('#editor').open=true;liveChange();await new Promise(resolve=>setTimeout(resolve,300));
 assert.equal(loads,2);
 element('#editor').close();element('#editor').onclose();await new Promise(resolve=>setTimeout(resolve,300));
 assert.equal(loads,3);
 await listeners.get('boardly-auth-changed')({detail:null});await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(stopped,1);
 assert.match(element('#boardTitle').textContent,/登入/);assert.equal(element('#columns').innerHTML,'');
});
