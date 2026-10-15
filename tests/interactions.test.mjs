import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function setup(){
 const elements=new Map(),calls=[],writes=[],busy=[],completed=[];let fail=false,snapshot,stopped=0;
 const element=()=>({value:'',textContent:'',hidden:true,isConnected:true,children:[],attributes:{},append(...children){this.children.push(...children);},replaceChildren(){this.children=[];},setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];},focus(){},setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b;},close(){this.open=false;},showModal(){this.open=true;}});
 const $=s=>{if(!elements.has(s))elements.set(s,element());return elements.get(s);};
 const context=vm.createContext({console,structuredClone,crypto:{randomUUID:()=> 'operation-id'},Date,document:{querySelector:$,createElement:element}});
 const deps={auth:{app:{}},firestore:{},getFunctions:()=>({}),httpsCallable:(_,name)=>async data=>{
  calls.push({name,data:structuredClone(data)});
  if(name==='listMentionMembers')return {data:{members:[{id:'one',name:'小 明'},{id:'two',name:'小 王'}]}};
  if(fail)throw fail instanceof Error?fail:new Error('offline');return {data:{commentId:'comment'}};
 },collection:(_,path)=>path,doc:(_,path)=>path,query:(path)=>path,orderBy:()=>{},limit:()=>{},onSnapshot:(_,next)=>{snapshot=next;return()=>stopped++;},updateDoc:async(path,patch)=>writes.push({path,patch}),writeBatch:()=>({update:(path,patch)=>writes.push({path,patch}),commit:async()=>{}})};
 const dep=new vm.SyntheticModule(Object.keys(deps),function(){for(const [key,value] of Object.entries(deps))this.setExport(key,value);},{context});
 const mentions=new vm.SourceTextModule(await readFile(new URL('../src/mentions.js',import.meta.url),'utf8'),{context});
 const module=new vm.SourceTextModule(await readFile(new URL('../src/interactions.js',import.meta.url),'utf8'),{context});
 await module.link(spec=>spec==='./mentions.js'?mentions:dep);await module.evaluate();
 return {api:module.namespace,$,calls,writes,busy,completed,setFail:value=>fail=value,emit:items=>snapshot({docs:items.map(item=>({id:item.id,data:()=>item}))}),getStopped:()=>stopped};
}
test('composer selects member with spaces by keyboard and retries the same comment exactly once',async()=>{
 const s=await setup();let editable=true;
 s.api.bindCommentComposer({boardId:'b',cardId:'c',canEdit:()=>editable,isCurrent:()=>true,busy:value=>s.busy.push(value),complete:async id=>s.completed.push(id)});
 const input=s.$('#commentText'),list=s.$('#mentionList');
 input.value='Hi @小';input.selectionStart=5;input.oninput();await tick();
 assert.equal(list.hidden,false);assert.equal(list.children.length,2);
 input.onkeydown({key:'ArrowDown',preventDefault(){}});
 input.onkeydown({key:'Enter',preventDefault(){}});
 assert.equal(input.value,'Hi @小 王 ');assert.equal(list.hidden,true);
 s.setFail(true);await s.$('#commentForm').onsubmit({preventDefault(){}});
 assert.match(s.$('#commentStatus').textContent,/offline/);assert.equal(s.busy.at(-1),false);
 const first=s.calls.find(call=>call.name==='postComment');
 assert.equal(first.data.mentions[0].memberId,'two');assert.equal(first.data.mentions[0].start,3);
 s.setFail(false);await s.$('#commentForm').onsubmit({preventDefault(){}});
 const posts=s.calls.filter(call=>call.name==='postComment');assert.deepEqual(posts[0].data,posts[1].data);
 assert.deepEqual(s.completed,['comment']);assert.equal(input.value,'');
 editable=false;input.value='blocked';await s.$('#commentForm').onsubmit({preventDefault(){}});
 assert.equal(s.calls.filter(call=>call.name==='postComment').length,2);
});
test('notifications show unread counts, suppress initial toasts, mark opened items, and clean up on logout',async()=>{
 const s=await setup(),toasts=[],opened=[];
 const options={open:async item=>opened.push(item.id),toast:label=>toasts.push(label)};
 s.api.connectNotifications({memberId:'me'},options);
 const one={id:'1',type:'mention',actorName:'小明',cardTitle:'任務',createdAt:'2026-10-16T00:00:00Z',read:false};
 s.emit([one]);assert.equal(toasts.length,0);assert.equal(s.$('#notificationsBtn').textContent,'通知 (1)');
 s.emit([{...one,id:'2'},one]);assert.equal(toasts.length,1);
 await s.$('#notificationList').children[0].onclick();assert.deepEqual(opened,['2']);
 assert.equal(s.writes[0].patch.read,true);assert.match(s.writes[0].path,/members\/me\/notifications\/2$/);
 s.api.connectNotifications(null,options);assert.equal(s.getStopped(),1);assert.equal(s.$('#notificationsBtn').disabled,true);assert.equal(s.$('#notificationList').children.length,0);
});

test('unavailable callable displays a useful service message instead of raw internal',async()=>{
 const s=await setup();
 s.api.bindCommentComposer({boardId:'b',cardId:'c',canEdit:()=>true,isCurrent:()=>true,busy:()=>{},complete:async()=>{}});
 const error=new Error('internal');error.code='functions/internal';s.setFail(error);
 s.$('#commentText').value='hello';
 await s.$('#commentForm').onsubmit({preventDefault(){}});
 assert.match(s.$('#commentStatus').textContent,/服務尚未就緒或暫時無法連線/);
 assert.doesNotMatch(s.$('#commentStatus').textContent,/internal/);
 assert.equal(s.$('#commentText').value,'hello');
});

test('editing preserves mentions, cancel restores a draft, and save uses original content for conflicts',async()=>{
 const s=await setup();
 const composer=s.api.bindCommentComposer({boardId:'b',cardId:'c',canEdit:()=>true,isCurrent:()=>true,busy:()=>{},complete:async(id,draft)=>s.completed.push({id,draft})});
 s.$('#commentText').value='unfinished draft';s.$('#commentText').oninput();
 const comment={id:'original',text:'Hi @小 明',mentions:[{memberId:'one',label:'小 明',start:3,end:7}]};
 composer.edit(comment);assert.equal(s.$('#commentText').value,comment.text);assert.equal(s.$('#cancelCommentEdit').hidden,false);
 s.$('#cancelCommentEdit').onclick();assert.equal(s.$('#commentText').value,'unfinished draft');
 composer.edit(comment);s.$('#commentText').value+='!';s.$('#commentText').oninput();
 await s.$('#commentForm').onsubmit({preventDefault(){}});
 const request=s.calls.find(call=>call.name==='manageComment');
 assert.equal(request.data.action,'edit');assert.equal(request.data.commentId,'original');assert.equal(request.data.expected.text,comment.text);
 assert.deepEqual(request.data.mentions,comment.mentions);assert.equal(request.data.text,'Hi @小 明!');
 assert.equal(s.completed[0].draft.text,'unfinished draft');assert.equal(s.$('#cancelCommentEdit').hidden,true);
});
test('deletion retries reuse the request and expected content and preserve the draft',async()=>{
 const s=await setup();
 const composer=s.api.bindCommentComposer({boardId:'b',cardId:'c',canEdit:()=>true,isCurrent:()=>true,busy:value=>s.busy.push(value),complete:async(id,draft)=>s.completed.push(draft)});
 s.$('#commentText').value='draft';s.$('#commentText').oninput();
 const comment={id:'original',text:'old',mentions:[]};
 s.setFail(true);await composer.remove(comment);assert.equal(s.busy.at(-1),false);assert.match(s.$('#commentStatus').textContent,/offline/);
 s.setFail(false);await composer.remove(comment);
 const requests=s.calls.filter(call=>call.name==='manageComment');assert.deepEqual(requests[0].data,requests[1].data);
 assert.equal(requests[0].data.action,'delete');assert.equal(s.completed[0].text,'draft');
});
