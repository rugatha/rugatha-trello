import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import * as cardOptions from '../src/card-options.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
async function setup({search='',archiveLoad=async()=>[],deferredArchives=false,workspaceLoad,managementLoad=async()=>({members:[],assigneeIds:[]}),managedCreate=async()=>({boardId:'new'}),managedAssign=async()=>({}),managedLifecycle=async()=>({}),checklist=[],checklistGroups,checklistControls={}}={}){
 const elements=new Map(),writes=[],restores=[],subscriptions=[],commentTargets=[],labelWrites=[];
 const element=s=>{if(!elements.has(s))elements.set(s,{value:s==='#dueFilter'?'all':'',classList:{add(){},remove(){},toggle(){}},style:{},replaceChildren(){this.innerHTML='';},close(){this.open=false;},showModal(){this.open=true;}});return elements.get(s);};
 const context=vm.createContext({console,structuredClone,setTimeout:()=>0,clearTimeout,Intl,Date,URLSearchParams,crypto:{randomUUID:()=>'copy-id'},
 document:{querySelector:element,querySelectorAll:s=>checklistControls[s]|| (s==='[data-comment-id]'?commentTargets:/^#[a-zA-Z]+$/.test(s)?[element(s)]:[]),addEventListener(){}},window:{location:{search},addEventListener(){}}});
 const data=()=>({users:[],boards:[{id:'b',name:'Board',columns:[{id:'col',name:'Todo'}],cards:[{id:'c',title:'Assigned',columnId:'col',createdAt:'2026-10-01T00:00:00Z',description:'',assignees:['viewer'],labels:[],checklist:structuredClone(checklist),...(checklistGroups?{checklistGroups:structuredClone(checklistGroups)}:{}),comments:[],attachments:[],attachmentArchiveLoaded:!deferredArchives}]}]});
 const deps={...cardOptions,saveBoardLabel:(...args)=>{const d=deferred();Object.assign(d,{args});labelWrites.push(d);return d.promise;},bindCommentComposer:()=>{},connectNotifications:()=>{},renderMentionText:()=>{},clearAttachmentUI:()=>{},hydrateAttachmentImages:()=>{},downloadAttachment:()=>{},bindAttachmentUpload:()=>{},listManagementMembers:managementLoad,createManagedBoard:managedCreate,setManagedAssignees:managedAssign,manageContentLifecycle:managedLifecycle,loadDeferredAttachmentArchives:archiveLoad,loadWorkspace:async(account,options)=>workspaceLoad?workspaceLoad(account,options,data):data(),subscribeWorkspace:(account,next,error)=>{const sub={account,next,error,stopped:false};subscriptions.push(sub);return ()=>sub.stopped=true;},persistWorkspace:(before,after,member)=>{const d=deferred();Object.assign(d,{before,after,member});writes.push(d);return d.promise;},restoreCard:()=>{const d=deferred();restores.push(d);return d.promise;},restoreAttachment:async()=>{},assignMovedOrderKey:()=>{}};
 const source=await fs.readFile(new URL('../src/app.js',import.meta.url),'utf8');
 const mod=new vm.SourceTextModule(source+'\nexport {selectBoard,applyGoogleAccount,save,restoreArchived,canEdit,openCard,refreshWorkspace,showArchive,canManage,openManagedBoard,openManagedAssignees,runManagedWrite,openLifecycle,canAdmin,openNotification,openLinkedCard};',{context});
 await mod.link(()=>new vm.SyntheticModule(Object.keys(deps),function(){for(const [k,v] of Object.entries(deps))this.setExport(k,v);},{context}));await mod.evaluate();
 // These race tests exercise board actions after the member selects a board.
 const api={...mod.namespace,applyGoogleAccount:async account=>{
  await mod.namespace.applyGoogleAccount(account);mod.namespace.selectBoard('b');
 }};
 return {api,writes,restores,element,subscriptions,commentTargets,window:context.window,labelWrites};
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

test('copying an assigned card resets checklist completion and owners without changing the source',async()=>{
 const checklist=[{id:'t',text:'Task',done:true,assigneeId:'viewer',due:'2026-11-01T10:00:00+08:00'},{id:'u',text:'Other',done:false}];
 const {api,writes,element}=await setup({checklist});await api.applyGoogleAccount(account('editor'));
 api.openCard('c');element('#copyCard').onclick();element('#simpleForm').onsubmit({preventDefault(){}});
 assert.equal(writes.length,1);
 const cards=writes[0].after.boards[0].cards;
 assert.deepEqual(Array.from(cards.find(c=>c.id==='c').assignees),['viewer']);
 assert.deepEqual(Array.from(cards.find(c=>c.id==='copy-id').assignees),[]);
 assert.deepEqual(JSON.parse(JSON.stringify(cards.find(c=>c.id==='c').checklist)),checklist);
 const copied=cards.find(c=>c.id==='copy-id').checklist;
 assert.ok(copied.every(item=>!item.done&&item.assigneeId===''));
 assert.equal(copied[0].due,checklist[0].due);
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

const admin=id=>({...account(id),workspaceRole:'admin'});
test('only admin/owner can open management, including when no boards exist',async()=>{
 const {api,element}=await setup({workspaceLoad:async()=>({users:[],boards:[]})});
 for(const role of ['editor','viewer','member']){
  await api.applyGoogleAccount({...account(role),workspaceRole:role});
  assert.equal(api.canManage(),false);assert.equal(element('#addBoard').disabled,true);
  await api.openManagedBoard();assert.notEqual(element('#simpleDialog').open,true);
 }
 for(const role of ['admin','owner']){
  await api.applyGoogleAccount({...account(role),workspaceRole:role});
  assert.equal(element('#addBoard').disabled,false);
  await api.openManagedBoard();assert.equal(element('#simpleDialog').open,true);
 }
});
test('failed member fetch cannot submit a partial grant list',async()=>{
 let calls=0;
 const {api,element}=await setup({managementLoad:async()=>{throw Error('offline');},managedCreate:async()=>{calls++;}});
 await api.applyGoogleAccount(admin('admin'));await api.openManagedBoard();
 element('#managedBoardName').value='Board';element('#simpleForm').onsubmit({preventDefault(){}});
 assert.equal(calls,0);assert.equal(element('#managementSubmit').disabled,true);
 assert.equal(element('#managementError').textContent,'offline');
});
test('late management member fetch cannot reopen a closed or switched account dialog',async()=>{
 const load=deferred();const {api,element}=await setup({managementLoad:()=>load.promise});
 await api.applyGoogleAccount(admin('admin'));const pending=api.openManagedBoard();
 await api.applyGoogleAccount(account('other'));element('#managedMembers').innerHTML='new account';
 load.resolve({members:[{id:'secret',name:'Hidden',eligible:true}],assigneeIds:[]});await pending;
 assert.equal(element('#managedMembers').innerHTML,'new account');assert.equal(element('#simpleDialog').open,false);
});
test('assignment conflicts preserve the management form and do not call normal card persistence',async()=>{
 const {api,element,writes}=await setup();await api.applyGoogleAccount(admin('admin'));
 await api.openManagedAssignees('c');
 await api.runManagedWrite(async()=>{throw Error('conflict');},()=>assert.fail('must not reload'));
 assert.equal(element('#simpleDialog').open,true);assert.equal(element('#managementError').textContent,'conflict');
 assert.equal(api.canManage(),true);assert.equal(writes.length,0);
});
test('uncertain board creation retries reuse their operation ID',async()=>{
 const payloads=[];const {api,element}=await setup({managedCreate:async payload=>{payloads.push(payload);throw Error('timeout');}});
 await api.applyGoogleAccount(admin('admin'));await api.openManagedBoard();
 element('#managedBoardName').value='New';element('#managedBoardDescription').value='';element('#managedBoardColor').value='#455f56';
 for(let i=0;i<2;i++){element('#simpleForm').onsubmit({preventDefault(){}});await new Promise(resolve=>setImmediate(resolve));}
 assert.equal(payloads.length,2);assert.equal(payloads[0].requestId,payloads[1].requestId);
 assert.equal(element('#simpleDialog').open,true);
});
for(const rejects of [false,true])test(`old management ${rejects?'failure':'completion'} cannot affect new account`,async()=>{
 const operation=deferred();const {api,element}=await setup();await api.applyGoogleAccount(admin('admin'));
 await api.openManagedBoard();const pending=api.runManagedWrite(()=>operation.promise,()=>assert.fail('stale reload'));
 await api.applyGoogleAccount(account('other'));element('#syncStatus').textContent='new status';
 if(rejects)operation.reject(Error('old failure'));else operation.resolve({boardId:'new'});
 await pending;assert.equal(element('#syncStatus').textContent,'new status');assert.equal(api.canEdit(),true);
});

test('board creation completion survives its own membership refresh and selects the new board',async()=>{
 const {api,element,window}=await setup({workspaceLoad:async(a,o,data)=>{const result=data();result.boards.push({...structuredClone(result.boards[0]),id:'new',name:'New board'});return result;}});
 const actor={...admin('admin'),uid:'google-owner'};
 await api.applyGoogleAccount(actor);
 window.boardlyGoogleAuth={refreshMembership:async()=>{await api.applyGoogleAccount({...actor});}};
 const operation=deferred();let reloaded=false;
 const pending=api.runManagedWrite(()=>operation.promise,async result=>{reloaded=true;await window.boardlyGoogleAuth.refreshMembership();await api.refreshWorkspace(null,result.boardId);},true);
 await api.applyGoogleAccount({...actor,accessboard:['b','new']});
 operation.resolve({boardId:'new'});await pending;
 assert.equal(reloaded,true);assert.equal(element('#boardTitle').textContent,'New board');
});

test('board completion after switching Google accounts for the same member cannot reload',async()=>{
 const {api}=await setup();await api.applyGoogleAccount({...admin('admin'),uid:'first'});
 const operation=deferred();const pending=api.runManagedWrite(()=>operation.promise,()=>assert.fail('stale account reload'),true);
 await api.applyGoogleAccount({...admin('admin'),uid:'second'});
 operation.resolve({boardId:'new'});await pending;
});

for(const role of ['owner','editor','viewer'])test(`${role} cannot open the Admin lifecycle dialog`,async()=>{
 const {api,element}=await setup();await api.applyGoogleAccount({...account(role),workspaceRole:role});
 api.openLifecycle('archive');assert.equal(element('#simpleDialog').open,false);assert.equal(api.canAdmin(),false);
});
test('Admin deletion requires an archived target and matching typed name',async()=>{
 const calls=[];
 const {api,element}=await setup({managedLifecycle:async data=>{calls.push(data);return {};},workspaceLoad:async(_,__,data)=>{const state=data();state.boards[0].archivedCards=[{id:'old',title:'Archived card'}];return state;}});
 await api.applyGoogleAccount({...account('admin'),workspaceRole:'admin',uid:'admin'});
 api.openLifecycle('delete','c');assert.equal(calls.length,0);assert.match(element('#toast').textContent,/先封存/);
 api.openLifecycle('delete','old');element('#lifecycleConfirm').value='Wrong';element('#simpleForm').onsubmit({preventDefault(){}});
 assert.equal(calls.length,0);assert.match(element('#managementError').textContent,/名稱不一致/);
 element('#lifecycleConfirm').value='Archived card';element('#simpleForm').onsubmit({preventDefault(){}});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,1);
 assert.equal(calls[0].action,'delete');assert.equal(calls[0].cardId,'old');assert.equal(calls[0].expectedArchived,true);
});
test('Admin can open archive, restore and retry deletion for an archived board',async()=>{
 const {api,element}=await setup({workspaceLoad:async(_,__,data)=>{const state=data();state.boards[0].archived=true;state.boards[0].deleting=true;return state;}});
 await api.applyGoogleAccount({...account('admin'),workspaceRole:'admin'});
 assert.equal(element('#editBoard').disabled,false);assert.equal(element('#quickCreate').disabled,true);
 api.openLifecycle('delete');assert.equal(element('#simpleDialog').open,true);assert.equal(element('#managementSubmit').disabled,false);
});


test('notification opens its card across boards and refuses revoked access or failed refresh',async()=>{
 const {api,element}=await setup();
 await api.applyGoogleAccount(account('reader'));
 await api.openNotification({boardId:'b',cardId:'c'});
 assert.equal(element('#editor').open,true);
 await assert.rejects(api.openNotification({boardId:'forbidden',cardId:'c'}),/存取權限/);
 let fail=false;
 const other=await setup({workspaceLoad:async(_,__,data)=>{if(fail)throw Error('offline');return data();}});
 await other.api.applyGoogleAccount(account('reader'));fail=true;
 await assert.rejects(other.api.openNotification({boardId:'b',cardId:'c'}),/連線已變更/);
 assert.equal(other.element('#editor').open,false);
});

test('mention notification scrolls, highlights and focuses the exact comment',async()=>{
 const {api,element,commentTargets}=await setup({workspaceLoad:async(_,__,data)=>{
  const result=data();result.boards[0].cards[0].comments=[{id:'target',userId:'reader',text:'Hi',at:'2026-10-16T00:00:00Z'}];return result;
 }});
 let highlighted=false,scrolled=false,focused=false;
 commentTargets.push({dataset:{commentId:'target'},classList:{add:name=>highlighted=name==='comment-target'},scrollIntoView:()=>scrolled=true,focus:()=>focused=true});
 await api.applyGoogleAccount(account('reader'));
 await api.openNotification({boardId:'b',cardId:'c',commentId:'target'});
 assert.match(element('#comments').innerHTML,/data-comment-id="target"/);
 assert.ok(highlighted && scrolled && focused);
});

test('comment actions are shown only beside the signed-in author’s own comments',async()=>{
 const {api,element}=await setup({workspaceLoad:async(_,__,data)=>{
  const result=data();result.boards[0].cards[0].comments=[
   {id:'mine',userId:'reader',text:'Mine',at:'2026-10-16T00:00:00Z',editedAt:'2026-10-16T01:00:00Z'},
   {id:'other',userId:'someone',text:'Other',at:'2026-10-16T00:00:00Z'}
  ];return result;
 }});
 await api.applyGoogleAccount(account('reader'));api.openCard('c');
 const html=element('#comments').innerHTML;
 assert.match(html,/data-edit-comment="mine"/);assert.match(html,/data-delete-comment="mine"/);assert.match(html,/已編輯/);
 assert.doesNotMatch(html,/data-(?:edit|delete)-comment="other"/);
});


test('board header filters membership before taking the first five avatars and updates on board switches',async()=>{
 const {api,element}=await setup({workspaceLoad:async(_,__,data)=>{
  const result=data();
  result.users=[
   ...Array.from({length:5},(_,i)=>({id:'other'+i,name:'Other '+i,boardIds:['second']})),
   {id:'eligible',name:'Eligible member',boardIds:['b']},
   {id:'shared',name:'Shared member',boardIds:['b','second']},
   {id:'disabled',name:'Disabled member',boardIds:[]},
   {id:'historical',name:'Historical member'}
  ];
  result.boards.push({...structuredClone(result.boards[0]),id:'second',name:'Second board'});
  return result;
 }});
 await api.applyGoogleAccount(account('reader'));
 let html=element('#headerMembers').innerHTML;
 assert.match(html,/Eligible member/);assert.match(html,/Shared member/);
 assert.doesNotMatch(html,/Other|Disabled|Historical/);
 api.selectBoard('second');html=element('#headerMembers').innerHTML;
 assert.match(html,/Other 0/);assert.doesNotMatch(html,/Eligible member/);
 element('#workspaceNav').onclick();assert.equal(element('#headerMembers').innerHTML,'');
});

test('completing a card persists its completion time and reopening clears it',async()=>{
 const {api,writes,element}=await setup();await api.applyGoogleAccount(account('editor'));api.openCard('c');
 const before=Date.now();element('#cardDone').onchange({target:{checked:true}});
 const complete=writes[0].after.boards[0].cards[0];
 assert.equal(complete.done,true);assert.ok(Date.parse(complete.completedAt)>=before);
 writes[0].resolve([]);await new Promise(resolve=>setImmediate(resolve));
 api.openCard('c');element('#cardDone').onchange({target:{checked:false}});
 const reopened=writes[1].after.boards[0].cards[0];
 assert.equal(reopened.done,false);assert.equal(reopened.completedAt,'');
 writes[1].resolve([]);await new Promise(resolve=>setImmediate(resolve));
});

test('completed card copies record a completion belonging to the new card',async()=>{
 const {api,writes,element}=await setup({workspaceLoad:async(_,__,data)=>{
  const state=data();Object.assign(state.boards[0].cards[0],{done:true,completedAt:'2026-10-02T00:00:00Z'});return state;
 }});
 await api.applyGoogleAccount(account('editor'));api.openCard('c');element('#copyCard').onclick();element('#simpleForm').onsubmit({preventDefault(){}});
 const copy=writes[0].after.boards[0].cards.find(c=>c.id==='copy-id');
 assert.equal(copy.completedAt,copy.createdAt);assert.notEqual(copy.completedAt,'2026-10-02T00:00:00Z');
 writes[0].resolve([]);await new Promise(resolve=>setImmediate(resolve));
});

test('gantt card links select and open the authorized card and reject inaccessible or archived cards',async()=>{
 const {api,element}=await setup();await api.applyGoogleAccount(account('viewer'));
 api.openLinkedCard('?board=b&card=c');assert.equal(element('#editor').open,true);
 element('#editor').close();
 api.openLinkedCard('?board=private&card=c');assert.equal(element('#editor').open,false);
 assert.match(element('#toast').textContent,/無法存取/);
 api.openLinkedCard('?board=b&card=archived');assert.equal(element('#editor').open,false);
});

test('gantt deep link waits for membership and the initial workspace load before opening its card',async()=>{
 const load=deferred();
 const {api,element}=await setup({search:'?board=b&card=c',workspaceLoad:async(_,__,data)=>{await load.promise;return data();}});
 assert.equal(element('#editor').open,false);
 const signingIn=api.applyGoogleAccount(account('reader'));
 assert.equal(element('#editor').open,false);
 load.resolve();await signingIn;
 assert.equal(element('#editor').open,true);assert.match(element('#editor').innerHTML,/Assigned/);
});

test('card labels show selected tags and use a disclosure for editor selection',async()=>{
 const {api,element}=await setup({workspaceLoad:async(_,__,data)=>{const state=data();state.boards[0].labelDefinitions={chosen:{name:'Selected',color:'#123456'},other:{name:'Other',color:'#ffeedd'},legacy:{name:'設計',color:'purple'}};state.boards[0].cards[0].labels=['chosen'];return state;}});
 await api.applyGoogleAccount(account('editor'));api.openCard('c');
 assert.match(element('#selectedLabels').innerHTML,/Selected/);assert.doesNotMatch(element('#selectedLabels').innerHTML,/Other|設計/);
 assert.match(element('#labelOptions').innerHTML,/Other/);assert.match(element('#labelOptions').innerHTML,/data-label="chosen" checked/);
 assert.match(element('#editor').innerHTML,/<details id="labelPicker"/);
});
test('completion circle and checkbox persist the same completion and reopening timestamp',async()=>{
 const {api,element,writes}=await setup();await api.applyGoogleAccount(account('editor'));api.openCard('c');
 assert.match(element('#editor').innerHTML,/id="cardCompletion".*aria-pressed="false"/);
 element('#cardCompletion').onclick();assert.equal(writes[0].after.boards[0].cards[0].done,true);assert.equal(element('#cardCompletion').textContent,'✓');
 writes[0].resolve([]);await new Promise(resolve=>setImmediate(resolve));
 element('#cardCompletion').onclick();assert.equal(writes[1].after.boards[0].cards[0].done,false);assert.equal(writes[1].after.boards[0].cards[0].completedAt,'');
 writes[1].resolve([]);await new Promise(resolve=>setImmediate(resolve));
});
test('stage picker waits for position confirmation and writes only the moving card',async()=>{
 const {api,element,writes}=await setup({workspaceLoad:async(_,__,data)=>{const state=data(),b=state.boards[0];b.columns.push({id:'target',name:'Target'});b.cards[0].orderKey='1';b.cards.push({...structuredClone(b.cards[0]),id:'d',title:'Other',columnId:'target',orderKey:'2'});return state;}});
 await api.applyGoogleAccount(account('editor'));api.openCard('c');
 element('#cardStage').value='target';element('#cardStage').onchange();assert.equal(writes.length,0);
 element('#cardPosition').value='1';element('#moveCard').onclick();
 assert.deepEqual(Array.from(writes[0].after.boards[0].cards.filter(c=>c.columnId==='target'),c=>c.id),['c','d']);
 assert.equal(writes[0].after.boards[0].cards.find(c=>c.id==='d').orderKey,'2');
 writes[0].resolve([]);await new Promise(resolve=>setImmediate(resolve));
});
test('readers can manage label definitions but cannot select card labels or toggle completion',async()=>{
 const {api,element,labelWrites,writes}=await setup();await api.applyGoogleAccount({...account('reader'),workspaceRole:'viewer'});api.openCard('c');
 assert.equal(element('#manageLabels').disabled,false);assert.equal(element('#labelPicker').hidden,true);
 element('#cardCompletion').onclick();assert.equal(writes.length,0);
 element('#manageLabels').onclick();element('#labelName').value='Release';element('#labelColor').value='#123456';
 const saving=element('#labelForm').onsubmit({preventDefault(){}});
 assert.equal(labelWrites.length,1);labelWrites[0].resolve({'copy-id':{name:'Release',color:'#123456'}});await saving;
 assert.match(element('#labelStatus').textContent,/已儲存/);assert.equal(api.canEdit(),false);
});
test('copy placement honors a selected target stage and first position',async()=>{
 const {api,element,writes}=await setup({workspaceLoad:async(_,__,data)=>{const state=data(),b=state.boards[0];b.columns.push({id:'target',name:'Target'});b.cards[0].orderKey='1';b.cards.push({...structuredClone(b.cards[0]),id:'existing',columnId:'target',orderKey:'2'});return state;}});
 await api.applyGoogleAccount(account('editor'));api.openCard('c');element('#copyCard').onclick();
 assert.equal(writes.length,0);element('#copyStage').value='target';element('#copyStage').onchange();element('#copyPosition').value='1';
 element('#simpleForm').onsubmit({preventDefault(){}});
 const target=writes[0].after.boards[0].cards.filter(c=>c.columnId==='target');
 assert.deepEqual(Array.from(target,c=>c.id),['copy-id','existing']);assert.deepEqual(Array.from(target[0].assignees),[]);
 writes[0].resolve([]);await new Promise(resolve=>setImmediate(resolve));
});

test('strict Viewer cannot manage labels or change card content',async()=>{
 const {api,element,writes,labelWrites}=await setup();
 await api.applyGoogleAccount({...account('reader'),workspaceRole:'viewer',readOnly:true});api.openCard('c');
 assert.equal(element('#manageLabels').disabled,true);
 assert.equal(api.canEdit(),false);
 element('#manageLabels').onclick();
 assert.ok(!element('#labelsDialog').open);
 element('#cardCompletion').onclick();
 await api.save();
 assert.equal(writes.length,0);assert.equal(labelWrites.length,0);
});

test('editor can open and submit assignee removal without board management access',async()=>{
 const requests=[];
 const {api,element,writes}=await setup({managementLoad:async()=>({members:[{id:'viewer',name:'Viewer',eligible:true}],assigneeIds:['viewer']}),managedAssign:async data=>{requests.push(data);return {};}});
 await api.applyGoogleAccount(account('editor'));api.openCard('c');
 assert.equal(element('#manageAssignees').disabled,false);
 assert.equal(api.canManage(),false);
 await api.openManagedAssignees('c');
 assert.equal(element('#simpleDialog').open,true);
 assert.equal(element('#managementSubmit').disabled,false);
 element('#simpleForm').onsubmit({preventDefault(){}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(requests.length,1);
 assert.deepEqual(Array.from(requests[0].assigneeIds),[]);
 assert.deepEqual(Array.from(requests[0].expectedAssigneeIds),['viewer']);
 assert.equal(writes.length,0);
});
for(const role of ['viewer','member'])test(`${role} cannot open assignee management`,async()=>{
 let loads=0;
 const {api,element}=await setup({managementLoad:async()=>{loads++;return {members:[],assigneeIds:[]};}});
 await api.applyGoogleAccount({...account(role),workspaceRole:role});api.openCard('c');
 assert.equal(element('#manageAssignees').disabled,true);
 await api.openManagedAssignees('c');
 assert.equal(loads,0);assert.notEqual(element('#simpleDialog').open,true);
});

test('checklist settings offer only parent card assignees and preserve Taipei deadlines',async()=>{
 const {api,element}=await setup({checklist:[{id:'t',text:'Task',done:false,due:'2026-10-31T09:30:00Z',assigneeId:'viewer'}]});
 await api.applyGoogleAccount({...account('editor'),roster:[{id:'viewer',name:'Allowed'},{id:'outsider',name:'Other'}]});api.openCard('c');
 const html=element('#checklist').innerHTML;
 assert.match(html,/data-check-due="t" value="2026-10-31T17:30"/);
 assert.match(html,/<option value="viewer" selected>/);
 assert.doesNotMatch(html,/<option value="outsider"/);
});

test('checklist inputs save deadlines and eligible assignees and reject outsiders',async()=>{
 const due={dataset:{checkDue:'t'},value:'2026-11-03T17:30',validity:{valid:true}};
 const owner={dataset:{checkAssignee:'t'},value:'viewer'};
 const {api,element,writes}=await setup({checklist:[{id:'t',text:'Task',done:false}],checklistControls:{'[data-check-due]':[due],'[data-check-assignee]':[owner]}});
 await api.applyGoogleAccount(account('editor'));api.openCard('c');due.onchange();
 assert.equal(writes[0].after.boards[0].cards[0].checklist[0].due,'2026-11-03T17:30:00+08:00');
 writes[0].resolve([]);await new Promise(resolve=>setImmediate(resolve));
 owner.onchange();assert.equal(writes[1].after.boards[0].cards[0].checklist[0].assigneeId,'viewer');
 writes[1].resolve([]);await new Promise(resolve=>setImmediate(resolve));
 owner.value='outsider';owner.onchange();assert.equal(writes.length,2);
 assert.equal(element('#toast').textContent,'只能選擇此牌卡的負責人');
 due.value='';due.onchange();assert.equal(writes[2].after.boards[0].cards[0].checklist[0].due,'');
 writes[2].resolve([]);await new Promise(resolve=>setImmediate(resolve));
 await api.applyGoogleAccount({...account('viewer'),workspaceRole:'viewer'});api.openCard('c');owner.onchange();due.onchange();assert.equal(writes.length,3);
});

test('checklist categories render as separate named lists with collapsed item settings',async()=>{
 const checklist=[{id:'a',text:'排程',group:'發文',done:true},{id:'b',text:'確認連結',group:'檢查',done:false},{id:'c',text:'Threads排程',group:'發文',done:false},{id:'d',text:'其他工作',done:false}];
 const {api,element}=await setup({checklist});await api.applyGoogleAccount(account('editor'));api.openCard('c');
 const html=element('#checklist').innerHTML;
 assert.equal((html.match(/class="checklist-group"/g)||[]).length,3);
 assert.match(html,/<h4 id="checklistGroup0">發文<\/h4><span class="muted small">1\/2/);
 assert.match(html,/<h4 id="checklistGroup1">檢查<\/h4>/);
 assert.match(html,/<h4 id="checklistGroup2">待辦事項<\/h4>/);
 assert.ok(html.indexOf('Threads排程')<html.indexOf('checklistGroup1'));
 assert.doesNotMatch(html,/<small class="muted">發文|發文 ·|檢查 ·/);
 assert.equal((html.match(/class="checklist-toggle"/g)||[]).length,4);
 assert.equal((html.match(/aria-expanded="false"/g)||[]).length,4);
 assert.equal((html.match(/data-check-details="[^"]+" hidden/g)||[]).length,4);
 assert.equal(element('#checkCount').textContent,'1/4');
});
test('expanded checklist settings remain open after an edit and new items keep their group',async()=>{
 const input={value:'新增檢查'},form={dataset:{checkAdd:'1'},querySelector:()=>input};
 const due={dataset:{checkDue:'a'},value:'2026-11-03T17:30',validity:{valid:true}};
 const {api,element,writes}=await setup({checklist:[{id:'a',text:'排程',group:'發文',groupId:'posts',done:false},{id:'b',text:'確認',group:'檢查',groupId:'checks',done:false}],checklistControls:{'[data-check-due]':[due],'#checklist [data-check-details]:not([hidden])':[{dataset:{checkDetails:'a'}}],'[data-check-add]':[form]}});
 await api.applyGoogleAccount(account('editor'));api.openCard('c');due.onchange();
 assert.doesNotMatch(element('#checklist').innerHTML.match(/<div[^>]*data-check-details="a"[^>]*>/)[0],/hidden/);
 assert.match(element('#checklist').innerHTML,/data-check-toggle="a"[^>]*aria-expanded="true"/);
 writes[0].resolve([]);await new Promise(resolve=>setImmediate(resolve));
 form.onsubmit({preventDefault(){}});
 const item=writes[1].after.boards[0].cards[0].checklist.at(-1);
 assert.equal(item.text,'新增檢查');assert.equal(item.group,'檢查');assert.equal(item.groupId,'checks');
 writes[1].resolve([]);await new Promise(resolve=>setImmediate(resolve));
});

for(const role of ['admin','owner'])test(`${role} creates a persistent empty checklist and rejects duplicate names`,async()=>{
 const {api,element,writes}=await setup({checklist:[{id:'a',text:'排程',group:'發文',done:false}]});
 await api.applyGoogleAccount({...account(role),workspaceRole:role});api.openCard('c');
 assert.match(element('#checklist').innerHTML,/新增待辦清單/);
 element('#newChecklistName').value=' 發文 ';element('#createChecklistForm').onsubmit({preventDefault(){}});
 assert.equal(writes.length,0);assert.equal(element('#checklistCreateError').textContent,'已有同名待辦清單');
 element('#newChecklistName').value='檢查';element('#createChecklistForm').onsubmit({preventDefault(){}});
 assert.equal(writes.length,1);
 assert.deepEqual(Array.from(writes[0].after.boards[0].cards[0].checklistGroups),['發文','檢查']);
 assert.match(element('#checklist').innerHTML,/>檢查<\/h4><span class="muted small">0\/0/);
 assert.match(element('#checklist').innerHTML,/createChecklistForm/);
 writes[0].resolve([]);await new Promise(resolve=>setImmediate(resolve));
});
for(const role of ['editor','viewer','member'])test(`${role} cannot open checklist creation`,async()=>{
 const {api,element}=await setup();await api.applyGoogleAccount({...account(role),workspaceRole:role});api.openCard('c');
 assert.doesNotMatch(element('#checklist').innerHTML,/createChecklistForm|新增待辦清單/);
});
test('empty checklist definitions reload and accept items with their list name',async()=>{
 const input={value:'確認連結'},form={dataset:{checkAdd:'0'},querySelector:()=>input};
 const {api,element,writes}=await setup({checklistGroups:['檢查'],checklistControls:{'[data-check-add]':[form]}});
 await api.applyGoogleAccount(account('editor'));api.openCard('c');
 assert.match(element('#checklist').innerHTML,/>檢查<\/h4><span class="muted small">0\/0/);
 form.onsubmit({preventDefault(){}});assert.equal(writes[0].after.boards[0].cards[0].checklist[0].group,'檢查');
 writes[0].resolve([]);await new Promise(resolve=>setImmediate(resolve));
});
test('item triangle expands and collapses settings independently of completion',async()=>{
 const panel={dataset:{checkDetails:'a'},hidden:true};
 const toggle={dataset:{checkToggle:'a'},setAttribute(key,value){this[key]=value;}};
 const {api,writes,element}=await setup({checklist:[{id:'a',text:'排程',group:'發文',done:true}],checklistControls:{'[data-check-toggle]':[toggle],'[data-check-details]':[panel]}});
 await api.applyGoogleAccount({...account('viewer'),workspaceRole:'viewer'});api.openCard('c');
 assert.match(element('#checklist').innerHTML,/<div class="check-item checked"><button[^>]*data-check-toggle="a"[^>]*>▸<\/button><input/);
 assert.doesNotMatch(element('#checklist').innerHTML,/<summary[^>]*>日期與負責人/);
 toggle.onclick();assert.equal(panel.hidden,false);assert.equal(toggle['aria-expanded'],'true');assert.equal(toggle.textContent,'▾');
 toggle.onclick();assert.equal(panel.hidden,true);assert.equal(toggle['aria-expanded'],'false');assert.equal(writes.length,0);
});
