import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
async function setup(){
 const elements=new Map(),writes=[],restores=[];
 const element=s=>{if(!elements.has(s))elements.set(s,{value:s==='#dueFilter'?'all':'',classList:{add(){},remove(){},toggle(){}},style:{},replaceChildren(){this.innerHTML='';},close(){this.open=false;},showModal(){this.open=true;}});return elements.get(s);};
 const context=vm.createContext({console,structuredClone,setTimeout:()=>0,clearTimeout,Intl,Date,
 document:{querySelector:element,querySelectorAll:s=>/^#[a-zA-Z]+$/.test(s)?[element(s)]:[],addEventListener(){}},window:{addEventListener(){}}});
 const data=()=>({users:[],boards:[{id:'b',name:'Board',columns:[],cards:[]}]});
 const deps={loadWorkspace:async()=>data(),subscribeWorkspace:()=>()=>{},persistWorkspace:()=>{const d=deferred();writes.push(d);return d.promise;},restoreCard:()=>{const d=deferred();restores.push(d);return d.promise;},restoreAttachment:async()=>{},assignMovedOrderKey:()=>{}};
 const source=await fs.readFile(new URL('../app.js',import.meta.url),'utf8');
 const mod=new vm.SourceTextModule(source+'\nexport {applyGoogleAccount,save,restoreArchived,canEdit};',{context});
 await mod.link(()=>new vm.SyntheticModule(Object.keys(deps),function(){for(const [k,v] of Object.entries(deps))this.setExport(k,v);},{context}));await mod.evaluate();
 return {api:mod.namespace,writes,restores,element};
}
const account=id=>({memberId:id,workspaceRole:'editor',accessboard:['b']});
test('old save completion cannot unlock a new account write',async()=>{
 const {api,writes,element}=await setup();await api.applyGoogleAccount(account('old'));
 const old=api.save();await api.applyGoogleAccount(account('new'));
 assert.equal(api.canEdit(),true);
 const current=api.save();writes[0].resolve([]);await old;
 assert.equal(api.canEdit(),false);assert.equal(element('#quickCreate').disabled,true);
 writes[1].resolve([]);await current;assert.equal(api.canEdit(),true);assert.equal(element('#quickCreate').disabled,false);
});
for(const fails of [false,true])test(`old restore ${fails?'failure':'success'} cannot affect a new account`,async()=>{
 const {api,restores,writes,element}=await setup();await api.applyGoogleAccount(account('old'));
 const old=api.restoreArchived('card','c');await api.applyGoogleAccount(account('new'));
 const current=api.save();element('#archiveDialog').showModal();
 if(fails)restores[0].reject(Error('old error'));else restores[0].resolve();await old;
 assert.equal(element('#archiveDialog').open,true);assert.equal(api.canEdit(),false);
 assert.equal(element('#syncStatus').textContent,'正在儲存至 Firebase…');
 writes[0].resolve([]);await current;assert.equal(api.canEdit(),true);
});
test('successful restoration reloads and unlocks editing',async()=>{
 const {api,restores,element}=await setup();await api.applyGoogleAccount(account('m'));
 const pending=api.restoreArchived('card','c');assert.equal(api.canEdit(),false);
 restores[0].resolve();await pending;assert.equal(api.canEdit(),true);assert.equal(element('#quickCreate').disabled,false);
});
