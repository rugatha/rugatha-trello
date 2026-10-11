import {attachmentBlobURL,releaseAttachmentURL,uploadAttachment,clearAttachmentAccess} from './attachment-client.js';
const previews=new Map();
export function clearAttachmentUI(){for(const url of previews.values())releaseAttachmentURL(url);previews.clear();clearAttachmentAccess();}
export function hydrateAttachmentImages(root=document){
 for(const [img,url] of previews)if(!img.isConnected){releaseAttachmentURL(url);previews.delete(img);}
 root.querySelectorAll('img[data-storage-path]').forEach(img=>{
  if(img.dataset.loading)return;img.dataset.loading='true';
  attachmentBlobURL({storagePath:img.dataset.storagePath}).then(url=>{
   if(!img.isConnected){releaseAttachmentURL(url);return;}previews.set(img,url);img.src=url;
  }).catch(()=>{if(img.isConnected){img.alt+='（預覽無法載入，請重新開啟重試）';img.removeAttribute('src');}});
 });
}
export async function downloadAttachment(attachment){
 const url=await attachmentBlobURL(attachment),link=document.createElement('a');
 link.href=url;link.download=attachment.name;link.click();setTimeout(()=>releaseAttachmentURL(url),1000);
}
export function bindAttachmentUpload({input,status,retry,boardId,cardId,canEdit,isCurrent=()=>true,busy,complete}){
 let pending=[],running=false;
 const run=async()=>{
  if(running||!isCurrent()||!canEdit())return;running=true;retry.hidden=true;busy(true);
  try{
   while(pending.length){if(!isCurrent())throw Error('存取權限已變更，已停止上傳');const item=pending[0];status.textContent=`正在上傳 ${item.file.name}…`;
    await uploadAttachment(item.file,boardId,cardId,item.id,percent=>{if(status.isConnected)status.textContent=`${item.file.name} · ${percent}%`;});
    if(!isCurrent())throw Error('存取權限已變更，已停止上傳');pending.shift();
   }
   status.textContent='附件已儲存';busy(false);await complete();
  }catch(error){if(status.isConnected){status.textContent='附件未確認完成：'+error.message;retry.hidden=false;}}
  finally{running=false;busy(false);}
 };
 input.onchange=()=>{if(running)return;pending=Array.from(input.files).map(file=>({file,id:crypto.randomUUID()}));input.value='';run();};
 retry.onclick=run;
}
