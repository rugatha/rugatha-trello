import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
async function setup({archiveLoad=async()=>[],deferredArchives=false}={}){
 const elements=new Map(),writes=[],restores=[];
 const element=s=>{if(!elements.has(s))elements.set(s,{value:s==='#dueFilter'?'all':'',classList:{add(){},remove(){},toggle(){}},style:{},replaceChildren(){this.innerHTML='';},close(){this.open=false;},showModal(){this.open=true;}});return elements.get(s);};
 const context=vm.createContext({console,structuredClone,setTimeout:()=>0,clearTimeout,Intl,Date,crypto:{randomUUID:()=>'copy-id'},
 document:{querySelector:element,querySelectorAll:s=>/^#[a-zA-Z]+$/.test(s)?[element(s)]:[],addEventListener(){}},window:{addEventListener(){}}});
 const data=()=>({users:[],boards:[{id:'b',name:'Board',columns:[{id:'col',name:'Todo'}],cards:[{id:'c',title:'Assigned',columnId:'col',createdAt:'2026-10-01T00:00:00Z',description:'',assignees:['viewer'],labels:[],checklist:[],comments:[],attachments:[],attachmentArchiveLoaded:!deferredArchives}]}]});
 const deps={loadDeferredAttachmentArchives:archiveLoad,loadWorkspace:async()=>data(),subscribeWorkspace:()=>()=>{},persistWorkspace:(before,after,member)=>{const d=deferred();Object.assign(d,{before,after,member});writes.push(d);return d.promise;},restoreCard:()=>{const d=deferred();restores.push(d);return d.promise;},restoreAttachment:async()=>{},assignMovedOrderKey:()=>{}};
 const source=await fs.readFile(new URL('../app.js',import.meta.url),'utf8');
 const mod=new vm.SourceTextModule(source+'\nexport {applyGoogleAccount,save,restoreArchived,canEdit,openCard,refreshWorkspace,showArchive};',{context});
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

test('copying an assigned card creates an unassigned copy without changing the source',async()=>{
 const {api,writes,element}=await setup();await api.applyGoogleAccount(account('editor'));
 api.openCard('c');element('#copyCard').onclick();
 assert.equal(writes.length,1);
 const cards=writes[0].after.boards[0].cards;
 assert.deepEqual(Array.from(cards.find(c=>c.id==='c').assignees),['viewer']);
 assert.deepEqual(Array.from(cards.find(c=>c.id==='copy-id').assignees),[]);
 writes[0].resolve([]);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(api.canEdit(),true);
});

for(const fails of [false,true])test(`shared board color ${fails?'rolls back on failure':'persists through the workspace save'}`,async()=>{
 const {api,writes,element}=await setup();await api.applyGoogleAccount(account('editor'));
 element('#editBoard').onclick();
 assert.match(element('#simpleDialog').innerHTML,/共用看板配色/);
 element('#boardNameInput').value='Board';element('#boardDescInput').value='';element('#boardColorInput').value='#c8b58f';
 element('#simpleForm').onsubmit({preventDefault(){}});
 assert.equal(writes[0].after.boards[0].color,'#c8b58f');
 assert.match(element('.main').style.cssText,/#c8b58f/);
 if(fails)writes[0].reject(Error('offline'));else writes[0].resolve([]);
 await new Promise(resolve=>setImmediate(resolve));
 assert.match(element('.main').style.cssText,fails?/#455f56/:/#c8b58f/);
 await api.applyGoogleAccount(null);assert.match(element('.main').style.cssText,/#455f56/);
});
test('viewer cannot open board color editing',async()=>{
 const {api,element,writes}=await setup();await api.applyGoogleAccount({...account('viewer'),workspaceRole:'viewer'});
 element('#editBoard').onclick();assert.notEqual(element('#simpleDialog').open,true);assert.equal(writes.length,0);
});

for(const recovery of ['refresh','save','account'])test(`conflict remains visible after live sync until ${recovery}`,async()=>{
 const {api,writes,element}=await setup();await api.applyGoogleAccount(account('editor'));
 const pending=api.save();writes[0].reject(Error('其他成員已修改此資料'));await pending;
 await api.refreshWorkspace(['b']);
 assert.match(element('#syncStatus').textContent,/上次儲存失敗，變更未寫入：其他成員/);
 assert.match(element('#syncStatus').textContent,/已從 Firebase 載入/);
 if(recovery==='refresh')await element('#refreshWorkspace').onclick();
 if(recovery==='account')await api.applyGoogleAccount(account('new'));
 if(recovery==='save'){
  const retry=api.save();writes[1].resolve([]);await retry;
 }
 assert.doesNotMatch(element('#syncStatus').textContent,/失敗|其他成員/);
});
test('old account save failure cannot publish an error for the new account',async()=>{
 const {api,writes,element}=await setup();await api.applyGoogleAccount(account('old'));
 const pending=api.save();await api.applyGoogleAccount(account('new'));
 writes[0].reject(Error('old conflict'));await pending;
 await api.refreshWorkspace(['b']);
 assert.equal(element('#syncStatus').textContent,'已從 Firebase 載入');
});


test('archive hydration is cached until board reload and preserves viewer read-only controls',async()=>{
 let loads=0;
 const {api,element,writes}=await setup({deferredArchives:true,archiveLoad:async()=>{loads++;return [{cardId:'c',files:[{id:'f',name:'Deferred file'}]}]}});
 await api.applyGoogleAccount({...account('viewer'),workspaceRole:'viewer'});
 await api.showArchive();
 assert.match(element('#archivedAttachments').innerHTML,/Deferred file/);
 assert.equal(api.canEdit(),false);assert.equal(writes.length,0);
 element('#archiveDialog').close();await api.showArchive();assert.equal(loads,1);
 element('#archiveDialog').close();await api.refreshWorkspace(['b']);await api.showArchive();assert.equal(loads,2);
});
for(const action of ['account','close','refresh'])test('late archive load cannot affect '+action,async()=>{
 const pending=deferred();
 const {api,element}=await setup({deferredArchives:true,archiveLoad:()=>pending.promise});
 await api.applyGoogleAccount(account('old'));const load=api.showArchive();
 if(action==='account')await api.applyGoogleAccount(account('new'));
 if(action==='close'){element('#archiveDialog').close();element('#archiveDialog').onclose();}
 if(action==='refresh')await api.refreshWorkspace();
 element('#archivedAttachments').innerHTML='Current UI';
 pending.resolve([{cardId:'c',files:[{id:'secret',name:'Old file'}]}]);await load;
 assert.equal(element('#archivedAttachments').innerHTML,'Current UI');
});
test('failed archive loading shows failure instead of empty and can be retried',async()=>{
 let tries=0;
 const {api,element}=await setup({deferredArchives:true,archiveLoad:async()=>{if(++tries===1)throw Error('offline');return [{cardId:'c',files:[{id:'f',name:'Recovered'}]}]}});
 await api.applyGoogleAccount(account('m'));await api.showArchive();
 assert.match(element('#archiveStatus').textContent,/offline/);
 assert.equal(element('#archivedAttachments').textContent,'無法載入封存附件。');
 element('#archiveDialog').close();await api.showArchive();
 assert.match(element('#archivedAttachments').innerHTML,/Recovered/);assert.equal(tries,2);
});
