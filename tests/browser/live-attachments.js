// Explicit, manual production probes. No credentials or private URLs are logged.
import {auth,firestore} from '../../auth.js';
import {collection,query,where,limit,getDocs,getDoc,doc,setDoc,updateDoc} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import {getFunctions,httpsCallable} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js';
import {attachmentBlobURL,releaseAttachmentURL,uploadAttachment} from '../../attachment-client.js';
import {downloadAttachment} from '../../attachment-ui.js';
const $=id=>document.getElementById(id),root='workspaces/main';
let selected=null,lastRead=null;
const log=s=>{$('probeResults').textContent+=s+'\n';};
const call=async(name,data)=>(await httpsCallable(getFunctions(auth.app,'asia-east1'),name)(data)).data;
async function locate(){
 if(selected)return selected;
 const member=window.boardlyGoogleUser;if(!member?.memberId)throw Error('需已核准會員');
 for(const boardId of member.accessboard){
  if((await getDoc(doc(firestore,`${root}/boards/${boardId}`))).data()?.archived)continue;
  const cards=await getDocs(query(collection(firestore,`${root}/boards/${boardId}/cards`),where('attachmentCount','>',0),limit(8)));
  for(const card of cards.docs){
   if(card.data().archived)continue;
   const attachments=await getDocs(collection(card.ref,'attachments'));
   const image=attachments.docs.map(d=>({id:d.id,...d.data()})).find(a=>a.storagePath&&/^image\//.test(a.type));
   if(image){selected={...image,boardId,cardId:card.id};return selected;}
  }
 }
 throw Error('找不到授權圖片');
}
async function read(){
 const a=await locate(),url=await attachmentBlobURL(a);
 try{const image=$('probeImage');await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('圖片無法解碼'));image.src=url;});lastRead=a;log('PASS 授權圖片預覽 '+image.naturalWidth+'×'+image.naturalHeight);}
 finally{releaseAttachmentURL(url);}
}
function button(id,task){$(id).onclick=async()=>{try{await task();}catch(e){log('RESULT '+(e.code||'')+' '+e.message+(e.customData?.serverResponse?' '+e.customData.serverResponse:''));}};}
button('probeRead',read);
button('probeAccount',async()=>{$('currentUser').click();});
button('probeRevoked',async()=>{
 if(!lastRead)throw Error('請先成功預覽一個附件，再撤銷該看板權限');
 try{const url=await attachmentBlobURL(lastRead);releaseAttachmentURL(url);throw Error('FAIL 撤權後仍可讀取');}
 catch(e){if(e.code!=='storage/unauthorized')throw e;log('PASS 撤權後原附件直接讀取遭拒');}
});
button('probeDownload',async()=>{await downloadAttachment(await locate());log('PASS 已發出授權下載');});
button('probeDeniedUpload',async()=>{
 const a=await locate();
 try{await call('beginAttachmentUpload',{requestId:crypto.randomUUID(),boardId:a.boardId,cardId:a.cardId,name:'viewer-denied.txt',size:1,type:'text/plain'});throw Error('FAIL Viewer 不應能上傳');}
 catch(e){if(e.code==='functions/permission-denied')log('PASS Viewer 上傳遭拒');else throw e;}
});
button('probeOwner',async()=>{
 const member=window.boardlyGoogleUser;if(member?.workspaceRole!=='owner')throw Error('需 Owner');
 const source=await locate(),boardId=source.boardId;
 const columns=await getDocs(query(collection(firestore,`${root}/boards/${boardId}/columns`),limit(1)));
 const cardId='phase4-test-'+crypto.randomUUID(),cardRef=doc(firestore,`${root}/boards/${boardId}/cards/${cardId}`),at=new Date().toISOString();
 await setDoc(cardRef,{title:'階段四附件驗證（測試後封存）',columnId:columns.docs[0].id,description:'自動化附件驗證資料',createdBy:member.memberId,updatedBy:member.memberId,createdAt:at,updatedAt:at,assigneeIds:[],attachmentCount:0,orderKey:'z'+Date.now(),archived:false});
 const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8l8AAAAASUVORK5CYII='),c=>c.charCodeAt(0));
 const file=new File([bytes],'phase4-test.png',{type:'image/png'}),requestId=crypto.randomUUID();
 try{
  const result=await uploadAttachment(file,boardId,cardId,requestId);await uploadAttachment(file,boardId,cardId,requestId);
  if((await getDoc(cardRef)).data().attachmentCount!==1)throw Error('FAIL 重試計數');log('PASS 正式 Owner 上傳與重試計數 1');
  const attachment=(await getDoc(doc(cardRef,'attachments',result.attachmentId))).data();
  if(attachment.url)throw Error('FAIL 附件不應保存 token URL');
  const url=await attachmentBlobURL(attachment);
  try{const image=$('probeImage');image.src=url;await image.decode();if(image.naturalWidth!==1)throw Error('FAIL 新附件圖片解碼');await downloadAttachment(attachment);log('PASS 新附件授權預覽／下載');}
  finally{releaseAttachmentURL(url);}
  await updateDoc(cardRef,{archived:true,updatedBy:member.memberId,updatedAt:new Date().toISOString()});
  try{await call('beginAttachmentUpload',{requestId:crypto.randomUUID(),boardId,cardId,name:'archived.txt',size:1,type:'text/plain'});throw Error('FAIL 已封存牌卡仍可上傳');}
  catch(e){if(e.code!=='functions/failed-precondition')throw e;log('PASS 已封存牌卡拒絕新增附件');}
  const archived=await attachmentBlobURL(attachment);releaseAttachmentURL(archived);log('PASS 封存保留原檔讀取');
 }finally{await updateDoc(cardRef,{archived:true,updatedBy:member.memberId,updatedAt:new Date().toISOString()});log('測試牌卡已封存：'+cardId);}
});
window.addEventListener('boardly-auth-changed',event=>{selected=null;log('登入角色：'+(event.detail?.workspaceRole||'無權限'));$('probeImage').removeAttribute('src');});
