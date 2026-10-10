// Manual production checks: use real Google sessions; never display credentials or emails.
import {auth,firestore} from '../../auth.js';
import {doc,collection,getDocFromServer,getDocsFromServer,setDoc,updateDoc,deleteDoc,writeBatch,onSnapshot,disableNetwork,enableNetwork} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import {getFunctions,httpsCallable} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js';
import {loadWorkspace,loadDeferredAttachmentArchives,restoreAttachment,persistWorkspace} from '../../storage.js';
import {uploadAttachment} from '../../attachment-client.js';
const root='workspaces/main', $=id=>document.getElementById(id), call=async(name,data)=>(await httpsCallable(getFunctions(auth.app,'asia-east1'),name)(data)).data;
const results=[];const log=s=>{results.push(s);$('liveResults').textContent=results.slice(-22).join('\n');}, check=(condition,label)=>{if(!condition)throw Error('FAIL '+label);log('PASS '+label);};
const member=()=>window.boardlyGoogleUser;
let context=null,stopWatch=null;
async function denied(task,label,code='permission-denied'){try{await task();}catch(e){if(e.code===code||e.code==='functions/'+code){log('PASS '+label);return;}throw e;}throw Error('FAIL '+label+' 未拒絕');}
async function locate(){
 const m=member();if(!m?.workspaceRole)throw Error('需有效會員');
 for(const id of m.accessboard){const b=await getDocFromServer(doc(firestore,`${root}/boards/${id}`));if(b.data()?.name==='階段六驗證 20261010'){context={boardId:id,cardId:'phase6-card'};return context;}}
 throw Error('此帳號沒有隔離測試看板');
}
const ref=()=>doc(firestore,`${root}/boards/${context.boardId}/cards/${context.cardId}`);
function button(id,task){$(id).onclick=async()=>{const b=$(id);b.disabled=true;try{await task();log('DONE '+b.textContent);}catch(e){log('ERROR '+(e.code||'')+' '+e.message);}finally{b.disabled=false;}};}
button('liveRefresh',async()=>{await window.boardlyGoogleAuth.refreshMembership();log('目前角色：'+(member()?.workspaceRole||'名單外／未核准'));});
button('liveMatrix',async()=>{
 const m=member(),role=m?.workspaceRole;
 await denied(()=>getDocsFromServer(collection(firestore,`${root}/members`)),'會員集合禁止列出');
 if(!role){await denied(()=>getDocFromServer(doc(firestore,`${root}/boards/${$('liveBoardId').value.trim()}`)),'未核准／名單外直接讀取看板遭拒');await denied(()=>call('listDisplayMembers',{}),'未核准名冊遭拒');await denied(()=>call('createManagedBoard',{requestId:crypto.randomUUID(),name:'Denied',description:'',color:'#455f56',memberIds:[]}),'未核准管理遭拒');return;}
 await locate();await getDocFromServer(doc(firestore,`${root}/members/${m.memberId}`));log('PASS 本人私人文件可讀');
 const roster=await call('listDisplayMembers',{});check(roster.members.every(x=>Object.keys(x).every(k=>['id','name'].includes(k))),'顯示名冊只有 ID／名稱');
 const other=roster.members.find(x=>x.id!==m.memberId);await denied(()=>getDocFromServer(doc(firestore,`${root}/members/${other.id}`)),'他人私人文件遭拒');
 await denied(()=>updateDoc(doc(firestore,`${root}/members/${m.memberId}`),{role:'owner'}),'本人不可提升角色');
 if(!['owner','admin'].includes(role)){
  await denied(()=>call('listMembershipDirectory',{}),'管理私人名冊遭拒');
  await denied(()=>call('createManagedBoard',{requestId:crypto.randomUUID(),name:'Denied',description:'',color:'#455f56',memberIds:[]}),'建立看板管理端點遭拒');
  await denied(()=>call('setManagedAssignees',{requestId:crypto.randomUUID(),...context,assigneeIds:[],expectedAssigneeIds:[]}),'修改指派管理端點遭拒');
 }
 if(['member','viewer'].includes(role)){
  await denied(()=>updateDoc(ref(),{title:'Denied',updatedBy:m.memberId}),'牌卡直接寫入遭拒');
  await denied(()=>setDoc(doc(ref(),'comments','denied'),{text:'Denied',memberId:m.memberId}),'留言直接新增遭拒');
  await denied(()=>setDoc(doc(ref(),'checklist','denied'),{text:'Denied',done:false}),'待辦直接新增遭拒');
  await denied(()=>call('beginAttachmentUpload',{requestId:crypto.randomUUID(),...context,name:'denied.txt',size:1,type:'text/plain'}),'附件上傳遭拒');
 }
});
button('liveOwner',async()=>{
 await locate();const m=member();if(!['owner','admin'].includes(m.workspaceRole))throw Error('需 Owner／Admin');
 const columns=await getDocsFromServer(collection(firestore,`${root}/boards/${context.boardId}/columns`));check(columns.size===3,'新看板三個預設階段');
 if(!(await getDocFromServer(ref())).exists())await setDoc(ref(),{title:'階段六同步牌卡',columnId:columns.docs[0].id,description:'',createdBy:m.memberId,updatedBy:m.memberId,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),assigneeIds:[],attachmentCount:0,checklistCount:0,commentCount:0,orderKey:'000000000000',archived:false});
 let current=(await getDocFromServer(ref())).data().assigneeIds||[];
 const request={requestId:crypto.randomUUID(),...context,assigneeIds:[m.memberId],expectedAssigneeIds:current};
 await call('setManagedAssignees',request);await call('setManagedAssignees',request);check((await getDocFromServer(ref())).data().assigneeIds[0]===m.memberId,'指派與同請求重試');
 await denied(()=>call('setManagedAssignees',{...request,requestId:crypto.randomUUID(),assigneeIds:[],expectedAssigneeIds:current}),'過期指派衝突','aborted');
 await call('setManagedAssignees',{requestId:crypto.randomUUID(),...context,assigneeIds:[],expectedAssigneeIds:[m.memberId]});check((await getDocFromServer(ref())).data().assigneeIds.length===0,'取消指派');
 const invitation=await call('saveManagedMembership',{requestId:crypto.randomUUID(),name:'階段六測試邀請',email:'phase6-'+crypto.randomUUID()+'@example.invalid',role:'viewer',status:'pending',accessboard:[]});
 let expected={role:'viewer',status:'pending',accessboard:[]};
 for(const patch of [{role:'editor',status:'active',accessboard:[context.boardId]},{role:'viewer',status:'active',accessboard:[]},{role:'viewer',status:'disabled',accessboard:[]}]){await call('saveManagedMembership',{requestId:crypto.randomUUID(),memberId:invitation.memberId,...patch,expected});expected=patch;}
 log('PASS 邀請／核准／角色與看板調整／停用；虛構邀請已停用');
});
button('liveWatch',async()=>{await locate();stopWatch?.();let first=true;stopWatch=onSnapshot(ref(),s=>{const d=s.data();log((first?'SNAPSHOT ':'SYNC ')+JSON.stringify({title:d?.title,columnId:d?.columnId,archived:d?.archived,commentCount:d?.commentCount,checklistCount:d?.checklistCount,attachmentCount:d?.attachmentCount,assigneeIds:d?.assigneeIds}));first=false;},e=>log('WATCH '+e.code));});
button('liveData',async()=>{
 await locate();const m=member();if(!['owner','admin','editor'].includes(m.workspaceRole))throw Error('需編輯權限');
 const before=await loadWorkspace({...m,accessboard:[context.boardId]}),card=before.boards[0].cards.find(c=>c.id===context.cardId);if(!card)throw Error('先執行管理測試');
 const id='phase6-'+crypto.randomUUID(),after=structuredClone(before),next=after.boards[0].cards.find(c=>c.id===context.cardId);next.comments.push({id,text:'雙帳號留言新增',at:new Date().toISOString(),userId:m.memberId});next.checklist.push({id,text:'雙帳號待辦',done:false,orderKey:'0'});
 await persistWorkspace(before,after,m.memberId);log('PASS 新增本人留言／待辦與父牌卡通知');
 const loaded=await loadWorkspace({...m,accessboard:[context.boardId]}),changed=structuredClone(loaded),c=changed.boards[0].cards.find(c=>c.id===context.cardId);c.comments.find(x=>x.id===id).text='雙帳號留言更新';c.checklist.find(x=>x.id===id).done=true;c.columnId=changed.boards[0].columns.find(x=>x.id!==c.columnId).id;c.orderKey='000000000001';
 await persistWorkspace(loaded,changed,m.memberId);log('PASS 留言更新／待辦勾選／跨欄排序');
 await denied(()=>persistWorkspace(loaded,changed,m.memberId),'過期留言／待辦／排序衝突',undefined).catch(e=>{if(/其他成員|資料已變更/.test(e.message)){log('PASS 過期留言／待辦／排序衝突');}else throw e;});
 const latest=await loadWorkspace({...m,accessboard:[context.boardId]}),removed=structuredClone(latest),r=removed.boards[0].cards.find(c=>c.id===context.cardId);r.comments=r.comments.filter(x=>x.id!==id);r.checklist=r.checklist.filter(x=>x.id!==id);await persistWorkspace(latest,removed,m.memberId);log('PASS 刪除本人留言／待辦');
 await updateDoc(ref(),{archived:true,updatedBy:m.memberId,updatedAt:new Date().toISOString()});log('PASS 牌卡封存');
 await updateDoc(ref(),{archived:false,updatedBy:m.memberId,updatedAt:new Date().toISOString()});log('PASS 牌卡復原');
});
button('liveZero',async()=>{
 await locate();const m=member();if(!['owner','admin','editor'].includes(m.workspaceRole))throw Error('需編輯權限');
 const result=await uploadAttachment(new File(['stage6 archive restore'],'phase6.txt',{type:'text/plain'}),context.boardId,context.cardId,crypto.randomUUID());
 const attachment=doc(ref(),'attachments',result.attachmentId),batch=writeBatch(firestore);batch.update(attachment,{archived:true,updatedBy:m.memberId});batch.update(ref(),{attachmentCount:0,updatedBy:m.memberId,updatedAt:new Date().toISOString()});await batch.commit();
 const loaded=await loadWorkspace({...m,accessboard:[context.boardId]}),b=loaded.boards[0],c=b.cards.find(c=>c.id===context.cardId);check(c.attachments.length===0&&c.attachmentArchiveLoaded===false,'零附件牌卡初次省略附件集合');
 const archives=await loadDeferredAttachmentArchives(b);check(archives.some(x=>x.cardId===context.cardId&&x.files.some(f=>f.id===result.attachmentId)),'延遲查詢找到封存附件');
 await restoreAttachment(context.boardId,context.cardId,result.attachmentId,m.memberId);check((await getDocFromServer(ref())).data().attachmentCount===1,'零附件封存復原計數 1');
 const cleanup=writeBatch(firestore);cleanup.update(attachment,{archived:true,updatedBy:m.memberId});cleanup.update(ref(),{attachmentCount:0,updatedBy:m.memberId,updatedAt:new Date().toISOString()});await cleanup.commit();log('PASS 測試附件保留於封存清單');
});
button('liveOffline',async()=>{
 await locate();await disableNetwork(firestore);
 try{await getDocFromServer(ref());throw Error('FAIL 離線伺服器讀取成功');}catch(e){if(e.code!=='unavailable')throw e;log('PASS 離線伺服器讀取失敗');}finally{await enableNetwork(firestore);}
 check((await getDocFromServer(ref())).exists(),'恢復連線後重試成功');
});
button('liveHide',async()=>{$('livePanel').hidden=true;});
button('liveShow',async()=>{$('livePanel').hidden=false;});
window.addEventListener('boardly-auth-changed',e=>log('AUTH '+(e.detail?.workspaceRole||'無權限')));
