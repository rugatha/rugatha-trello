import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
async function setup({archiveLoad=async()=>[],deferredArchives=false,workspaceLoad,managementLoad=async()=>({members:[],assigneeIds:[]}),managedCreate=async()=>({boardId:'new'}),managedAssign=async()=>({})}={}){
 const elements=new Map(),writes=[],restores=[],subscriptions=[];
 const element=s=>{if(!elements.has(s))elements.set(s,{value:s==='#dueFilter'?'all':'',classList:{add(){},remove(){},toggle(){}},style:{},replaceChildren(){this.innerHTML='';},close(){this.open=false;},showModal(){this.open=true;}});return elements.get(s);};
 const context=vm.createContext({console,structuredClone,setTimeout:()=>0,clearTimeout,Intl,Date,crypto:{randomUUID:()=>'copy-id'},
 document:{querySelector:element,querySelectorAll:s=>/^#[a-zA-Z]+$/.test(s)?[element(s)]:[],addEventListener(){}},window:{addEventListener(){}}});
 const data=()=>({users:[],boards:[{id:'b',name:'Board',columns:[{id:'col',name:'Todo'}],cards:[{id:'c',title:'Assigned',columnId:'col',createdAt:'2026-10-01T00:00:00Z',description:'',assignees:['viewer'],labels:[],checklist:[],comments:[],attachments:[],attachmentArchiveLoaded:!deferredArchives}]}]});
 const deps={clearAttachmentUI:()=>{},hydrateAttachmentImages:()=>{},downloadAttachment:()=>{},bindAttachmentUpload:()=>{},listManagementMembers:managementLoad,createManagedBoard:managedCreate,setManagedAssignees:managedAssign,loadDeferredAttachmentArchives:archiveLoad,loadWorkspace:async(account,options)=>workspaceLoad?workspaceLoad(account,options,data):data(),subscribeWorkspace:(account,next,error)=>{const sub={account,next,error,stopped:false};subscriptions.push(sub);return ()=>sub.stopped=true;},persistWorkspace:(before,after,member)=>{const d=deferred();Object.assign(d,{before,after,member});writes.push(d);return d.promise;},restoreCard:()=>{const d=deferred();restores.push(d);return d.promise;},restoreAttachment:async()=>{},assignMovedOrderKey:()=>{}};
 const source=await fs.readFile(new URL('../app.js',import.meta.url),'utf8');
 const mod=new vm.SourceTextModule(source+'\nexport {applyGoogleAccount,save,restoreArchived,canEdit,openCard,refreshWorkspace,showArchive,canManage,openManagedBoard,openManagedAssignees,runManagedWrite};',{context});
 await mod.link(()=>new vm.SyntheticModule(Object.keys(deps),function(){for(const [k,v] of Object.entries(deps))this.setExport(k,v);},{context}));await mod.evaluate();
 return {api:mod.namespace,writes,restores,element,subscriptions,window:context.window};
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

test('revocation clears open content immediately and ignores an earlier save result',async()=>{
 const pending=deferred();let calls=0;
 const {api,element,writes}=await setup({workspaceLoad:async(account,options,data)=>++calls===1?data():pending.promise});
 await api.applyGoogleAccount(account('m'));api.openCard('c');
 const save=api.save();
 const reload=api.applyGoogleAccount({...account('m'),accessboard:[]});
 assert.equal(element('#editor').open,false);
 assert.equal(element('#editor').innerHTML,'');
 assert.equal(element('#columns').innerHTML,'');
 assert.equal(api.canEdit(),false);
 writes[0].resolve([]);await save;
 assert.equal(element('#columns').innerHTML,'');
 pending.resolve({boards:[],users:[]});await reload;
 assert.equal(element('#boardTitle').textContent,'沒有可存取的看板');
});
test('permission listener failure clears content and manual refresh renews membership',async()=>{
 const {api,element,subscriptions,window}=await setup();await api.applyGoogleAccount(account('m'));api.openCard('c');
 subscriptions[0].error(Object.assign(Error('denied'),{code:'permission-denied'}));
 assert.equal(subscriptions[0].stopped,true);
 assert.equal(element('#columns').innerHTML,'');assert.equal(element('#editor').innerHTML,'');
 assert.equal(api.canEdit(),false);
 assert.match(element('#syncStatus').textContent,/已清除內容/);
 let refreshed=0;window.boardlyGoogleAuth={refreshMembership:async()=>{refreshed++;}};
 await element('#refreshWorkspace').onclick();assert.equal(refreshed,1);
});
test('late subscription error from previous membership cannot clear renewed access',async()=>{
 const {api,element,subscriptions}=await setup();await api.applyGoogleAccount(account('m'));
 await api.applyGoogleAccount({...account('m'),workspaceRole:'viewer'});
 subscriptions[0].error(Object.assign(Error('old denied'),{code:'permission-denied'}));
 assert.equal(element('#boardTitle').textContent,'Board');
 assert.equal(subscriptions[1].stopped,false);
});
test('partial reload permission denial never restores cached board content',async()=>{
 let calls=0;const {api,element}=await setup({workspaceLoad:async(account,options,data)=>{
  if(++calls>1)throw Object.assign(Error('denied'),{code:'permission-denied'});return data();
 }});
 await api.applyGoogleAccount(account('m'));api.openCard('c');await api.refreshWorkspace(['b']);
 assert.equal(element('#columns').innerHTML,'');assert.equal(element('#editor').innerHTML,'');
 assert.equal(api.canEdit(),false);
});

const owner=id=>({...account(id),workspaceRole:'owner'});
test('only owner/admin can open management, including when no boards exist',async()=>{
 const {api,element}=await setup({workspaceLoad:async()=>({users:[],boards:[]})});
 for(const role of ['editor','viewer','member']){
  await api.applyGoogleAccount({...account(role),workspaceRole:role});
  assert.equal(api.canManage(),false);assert.equal(element('#addBoard').disabled,true);
  await api.openManagedBoard();assert.notEqual(element('#simpleDialog').open,true);
 }
 for(const role of ['owner','admin']){
  await api.applyGoogleAccount({...account(role),workspaceRole:role});
  assert.equal(element('#addBoard').disabled,false);
  await api.openManagedBoard();assert.equal(element('#simpleDialog').open,true);
 }
});
test('failed member fetch cannot submit a partial grant list',async()=>{
 let calls=0;
 const {api,element}=await setup({managementLoad:async()=>{throw Error('offline');},managedCreate:async()=>{calls++;}});
 await api.applyGoogleAccount(owner('owner'));await api.openManagedBoard();
 element('#managedBoardName').value='Board';element('#simpleForm').onsubmit({preventDefault(){}});
 assert.equal(calls,0);assert.equal(element('#managementSubmit').disabled,true);
 assert.equal(element('#managementError').textContent,'offline');
});
test('late management member fetch cannot reopen a closed or switched account dialog',async()=>{
 const load=deferred();const {api,element}=await setup({managementLoad:()=>load.promise});
 await api.applyGoogleAccount(owner('owner'));const pending=api.openManagedBoard();
 await api.applyGoogleAccount(account('other'));element('#managedMembers').innerHTML='new account';
 load.resolve({members:[{id:'secret',name:'Hidden',eligible:true}],assigneeIds:[]});await pending;
 assert.equal(element('#managedMembers').innerHTML,'new account');assert.equal(element('#simpleDialog').open,false);
});
test('assignment conflicts preserve the management form and do not call normal card persistence',async()=>{
 const {api,element,writes}=await setup();await api.applyGoogleAccount(owner('owner'));
 await api.openManagedAssignees('c');
 await api.runManagedWrite(async()=>{throw Error('conflict');},()=>assert.fail('must not reload'));
 assert.equal(element('#simpleDialog').open,true);assert.equal(element('#managementError').textContent,'conflict');
 assert.equal(api.canManage(),true);assert.equal(writes.length,0);
});
test('uncertain board creation retries reuse their operation ID',async()=>{
 const payloads=[];const {api,element}=await setup({managedCreate:async payload=>{payloads.push(payload);throw Error('timeout');}});
 await api.applyGoogleAccount(owner('owner'));await api.openManagedBoard();
 element('#managedBoardName').value='New';element('#managedBoardDescription').value='';element('#managedBoardColor').value='#455f56';
 for(let i=0;i<2;i++){element('#simpleForm').onsubmit({preventDefault(){}});await new Promise(resolve=>setImmediate(resolve));}
 assert.equal(payloads.length,2);assert.equal(payloads[0].requestId,payloads[1].requestId);
 assert.equal(element('#simpleDialog').open,true);
});
for(const rejects of [false,true])test(`old management ${rejects?'failure':'completion'} cannot affect new account`,async()=>{
 const operation=deferred();const {api,element}=await setup();await api.applyGoogleAccount(owner('owner'));
 await api.openManagedBoard();const pending=api.runManagedWrite(()=>operation.promise,()=>assert.fail('stale reload'));
 await api.applyGoogleAccount(account('other'));element('#syncStatus').textContent='new status';
 if(rejects)operation.reject(Error('old failure'));else operation.resolve({boardId:'new'});
 await pending;assert.equal(element('#syncStatus').textContent,'new status');assert.equal(api.canEdit(),true);
});

test('board creation completion survives its own membership refresh and selects the new board',async()=>{
 const {api,element,window}=await setup({workspaceLoad:async(a,o,data)=>{const result=data();result.boards.push({...structuredClone(result.boards[0]),id:'new',name:'New board'});return result;}});
 const actor={...owner('owner'),uid:'google-owner'};
 await api.applyGoogleAccount(actor);
 window.boardlyGoogleAuth={refreshMembership:async()=>{await api.applyGoogleAccount({...actor});}};
 const operation=deferred();let reloaded=false;
 const pending=api.runManagedWrite(()=>operation.promise,async result=>{reloaded=true;await window.boardlyGoogleAuth.refreshMembership();await api.refreshWorkspace(null,result.boardId);},true);
 await api.applyGoogleAccount({...actor,accessboard:['b','new']});
 operation.resolve({boardId:'new'});await pending;
 assert.equal(reloaded,true);assert.equal(element('#boardTitle').textContent,'New board');
});

test('board completion after switching Google accounts for the same member cannot reload',async()=>{
 const {api}=await setup();await api.applyGoogleAccount({...owner('owner'),uid:'first'});
 const operation=deferred();const pending=api.runManagedWrite(()=>operation.promise,()=>assert.fail('stale account reload'),true);
 await api.applyGoogleAccount({...owner('owner'),uid:'second'});
 operation.resolve({boardId:'new'});await pending;
});
