import {attachmentBlobURL,releaseAttachmentURL,uploadAttachment,clearAttachmentAccess} from './attachment-client.js';
const previews=new Map();
let observer;
function releasePreview(img,entry){
 observer?.unobserve(img);if(entry.url)releaseAttachmentURL(entry.url);delete img.dataset.loading;previews.delete(img);
}
export function clearAttachmentUI(){for(const [img,entry] of previews){releasePreview(img,entry);img.removeAttribute('src');}observer?.disconnect();clearAttachmentAccess();}
function loadPreview(img,entry){
 observer?.unobserve(img);
 if(!img.isConnected){releasePreview(img,entry);return;}
 if(entry.loading)return;entry.loading=true;
 attachmentBlobURL({storagePath:img.dataset.storagePath},{preview:true}).then(url=>{
  if(previews.get(img)!==entry||!img.isConnected){releaseAttachmentURL(url);return;}
  entry.url=url;img.src=url;
 }).catch(()=>{if(previews.get(img)===entry&&img.isConnected){img.alt+='（預覽無法載入，請重新開啟重試）';img.removeAttribute('src');}});
}
export function hydrateAttachmentImages(root=document){
 for(const [img,entry] of previews)if(!img.isConnected)releasePreview(img,entry);
 if(!observer&&typeof IntersectionObserver!=='undefined')observer=new IntersectionObserver(entries=>{
  for(const {target:img,isIntersecting} of entries){const entry=previews.get(img);if(isIntersecting&&entry)loadPreview(img,entry);}
 },{rootMargin:'160px'});
 root.querySelectorAll('img[data-storage-path]').forEach(img=>{
  if(previews.has(img))return;img.dataset.loading='true';
  const entry={url:null,loading:false};previews.set(img,entry);
  if(observer)observer.observe(img);else loadPreview(img,entry);
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
