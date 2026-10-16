import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import * as dates from '../src/gantt-data.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function setup() {
 const elements=new Map(),events={},pending=[],subscriptions=[],writes=[];
 const element=selector=>{
  if(!elements.has(selector))elements.set(selector,{value:'',innerHTML:'',textContent:'',addEventListener(type,fn){this[type]=fn;},close(){this.open=false;},showModal(){this.open=true;}});
  return elements.get(selector);
 };
 const window={addEventListener:(type,fn)=>events[type]=fn};
 const context=vm.createContext({window,document:{querySelector:element,querySelectorAll:()=>[]},Date:class extends Date {constructor(...args){super(...(args.length?args:['2026-10-16T00:00:00Z']));}},Intl,Set,Map,Math,String,Number,Promise,clearTimeout,setTimeout});
 const deps={...dates,updateCardDeadline:(...args)=>new Promise((resolve,reject)=>writes.push({args,resolve,reject})),loadWorkspace:(account,options)=>new Promise(resolve=>pending.push({account,options,resolve})),subscribeWorkspace:(actor,next,error)=>{const s={actor,next,error};subscriptions.push(s);return()=>s.stopped=true;}};
 const mod=new vm.SourceTextModule(await fs.readFile(new URL('../src/gantt.js',import.meta.url),'utf8'),{context});
 await mod.link(async()=>new vm.SyntheticModule(Object.keys(deps),function(){for(const [key,value]of Object.entries(deps))this.setExport(key,value);},{context}));
 await mod.evaluate();
 return {$:element,pending,subscriptions,writes,auth:account=>events['boardly-auth-changed']({detail:account})};
}
const account={uid:'u',memberId:'m',workspaceRole:'viewer',accessboard:['b'],roster:[]};
const data={boards:[{id:'b',name:'Visible',cards:[{id:'c',title:'<script>unsafe</script>',createdAt:'2026-10-01',due:'2026-10-31',assignees:['m'],checklist:[{id:'t',text:'10/20 工作',done:false}]}]},{id:'secret',name:'Private',cards:[{id:'private',title:'Private'}]}]};
test('gantt renders escaped hierarchy and requests only timeline content',async()=>{
 const s=await setup();s.auth(account);s.pending[0].resolve(data);await tick();
 assert.equal(s.pending[0].options.content,'gantt');
 assert.equal(s.$('#dateFrom').value,'2026-10-11');
 assert.equal(s.$('#assigneeFilter').value,'__me');
 assert.ok(s.$('#ganttChart').innerHTML.includes('&lt;script&gt;'));
 const expand = key => s.$('#ganttChart').onclick({target:{closest:selector=>selector==='[data-collapse]'?({dataset:{collapse:key}}):null}});
 assert.ok(s.$('#ganttChart').innerHTML.includes('index.html?board=b&amp;card=c'));
 assert.ok(!s.$('#ganttChart').innerHTML.includes('10/20 工作'));
 expand('card/b/c');
 const html=s.$('#ganttChart').innerHTML;
 assert.ok(html.includes('Visible'));assert.ok(html.includes('&lt;script&gt;unsafe&lt;/script&gt;'));assert.ok(html.includes('2026-10-20'));assert.ok(!html.includes('Private'));
 assert.ok(s.$('#ganttStatus').textContent.includes('1 張牌卡'));
});
test('logout clears chart and a late request cannot restore private data',async()=>{
 const s=await setup();s.auth(account);s.auth(null);
 s.pending[0].resolve(data);await tick();
 assert.ok(!s.$('#ganttChart').innerHTML.includes('Visible'));
 assert.equal(s.subscriptions.length,0);
 assert.equal(s.$('#boardFilter').innerHTML,'<option value="">所有看板</option>');
});
test('revocation stops subscription, clears hierarchy, and ignores prior account responses',async()=>{
 const s=await setup();s.auth(account);s.pending[0].resolve(data);await tick();
 const old=s.subscriptions[0];s.auth({...account,accessboard:[]});
 old.error(Error('old permission error'));
 assert.equal(s.$('#ganttStatus').textContent,'正在讀取專案時程…');
 s.pending[1].resolve(data);await tick();
 assert.ok(old.stopped);assert.ok(!s.$('#ganttChart').innerHTML.includes('Visible'));
 s.subscriptions[1].error(Error('permission-denied'));assert.ok(s.subscriptions[1].stopped);
 assert.ok(!s.$('#ganttChart').innerHTML.includes('Visible'));
 assert.ok(s.$('#ganttStatus').textContent.includes('已清除內容'));
});

test('changing assignee shows other members, completion toggle includes closed work and reset restores defaults',async()=>{
 const s=await setup();s.auth(account);
 const more=structuredClone(data);more.boards[0].cards.push({id:'other',title:'Other work',createdAt:'2026-10-01',due:'2026-10-31',assignees:['other'],checklist:[]},{id:'done',title:'Closed work',done:true,createdAt:'2026-10-01',due:'2026-10-31',assignees:['m'],checklist:[]});
 s.pending[0].resolve(more);await tick();
 assert.match(s.$('#ganttStatus').textContent,/1 張牌卡/);
 s.$('#assigneeFilter').value='';s.$('#assigneeFilter').change();assert.match(s.$('#ganttStatus').textContent,/2 張牌卡/);
 s.$('#showCompleted').checked=true;s.$('#showCompleted').change();assert.match(s.$('#ganttStatus').textContent,/3 張牌卡/);
 s.$('#dateFrom').value='2026-11-01';s.$('#dateFrom').change();assert.match(s.$('#ganttStatus').textContent,/0 張牌卡/);
 s.$('#resetGantt').onclick();assert.equal(s.$('#assigneeFilter').value,'__me');assert.equal(s.$('#dateFrom').value,'2026-10-11');assert.equal(s.$('#showCompleted').checked,false);assert.match(s.$('#ganttStatus').textContent,/1 張牌卡/);
});

test('gantt entry versions its filter dependency and has no scale selector',async()=>{
 const page=await fs.readFile(new URL('../gantt.html',import.meta.url),'utf8');
 const source=await fs.readFile(new URL('../src/gantt.js',import.meta.url),'utf8');
 assert.match(page,/src\/gantt\.js\?v=20261016-deadline/);
 assert.match(source,/gantt-data\.js\?v=20261016-deadline/);
 assert.doesNotMatch(page,/scaleFilter|時間刻度/);
 assert.doesNotMatch(source,/scaleFilter/);
});

const editDeadline=s=>s.$('#ganttChart').onclick({target:{closest:selector=>selector==='[data-deadline-card]'?{dataset:{deadlineBoard:'b',deadlineCard:'c'}}:null}});
test('assigned viewers edit only the deadline, with save failures retaining the original chart',async()=>{
 const s=await setup();s.auth(account);s.pending[0].resolve(structuredClone(data));await tick();
 assert.match(s.$('#ganttChart').innerHTML,/data-deadline-card="c"/);editDeadline(s);
 assert.equal(s.$('#deadlineValue').value,'2026-10-31T00:00');
 s.$('#deadlineValue').value='2026-11-06T17:30';
 const save=s.$('#deadlineForm').submit({preventDefault(){}});
 assert.deepEqual(s.writes[0].args.slice(1),['b','c','2026-11-06T17:30:00+08:00','2026-10-31']);
 assert.equal(s.$('#saveDeadline').disabled,true);
 s.writes[0].reject(Error('offline'));await save;
 assert.equal(s.$('#deadlineDialog').open,true);assert.match(s.$('#deadlineStatus').textContent,/offline/);
 assert.ok(!s.$('#ganttChart').innerHTML.includes('2026-11-06 · 截止日'));
 const retry=s.$('#deadlineForm').submit({preventDefault(){}});
 s.writes[1].resolve({due:'2026-11-06T17:30:00+08:00',updatedAt:'now'});await retry;
 assert.equal(s.$('#deadlineDialog').open,false);assert.match(s.$('#ganttChart').innerHTML,/2026-11-06 · 截止日/);
});
test('switching accounts closes the deadline editor and stale write completion cannot reveal prior data',async()=>{
 const s=await setup();s.auth(account);s.pending[0].resolve(structuredClone(data));await tick();editDeadline(s);
 s.$('#deadlineValue').value='2026-11-06T17:30';const save=s.$('#deadlineForm').submit({preventDefault(){}});
 s.auth(null);assert.equal(s.$('#deadlineDialog').open,false);
 s.writes[0].resolve({due:'2026-11-06T17:30:00+08:00'});await save;
 assert.ok(!s.$('#ganttChart').innerHTML.includes('&lt;script&gt;'));
});
test('live reloads preserve explicit board collapse and defer while deadline editing',async()=>{
 const s=await setup();s.auth(account);s.pending[0].resolve(structuredClone(data));await tick();
 editDeadline(s);s.subscriptions[0].next();await tick();assert.equal(s.pending.length,1);
 s.$('#closeDeadline').onclick();assert.equal(s.pending.length,2);
 s.pending[1].resolve(structuredClone(data));await tick();assert.match(s.$('#ganttChart').innerHTML,/index.html\?board=b/);
 s.$('#ganttChart').onclick({target:{closest:selector=>selector==='[data-collapse]'?{dataset:{collapse:'board/b'}}:null}});
 assert.ok(!s.$('#ganttChart').innerHTML.includes('index.html?board=b'));
});
