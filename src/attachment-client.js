import {auth} from './auth.js';
import {getStorage,ref,uploadBytesResumable,getBlob} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-storage.js';
import {getFunctions,httpsCallable} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js';
const storage=getStorage(auth.app),functions=getFunctions(auth.app,'asia-east1');
const call=async(name,data)=>(await httpsCallable(functions,name,{timeout:120000})(data)).data;
const jobs=new Set(),urls=new Set();let epoch=0;
// Published objects are immutable. Keep a bounded, memory-only preview cache for
// this access epoch; downloads still perform a fresh authorized Storage read.
const previewBlobs=new Map(),previewReads=new Map();let previewBytes=0;
const MAX_PREVIEW_BYTES=32*1024*1024,MAX_PREVIEWS=48;
export function clearAttachmentAccess(){epoch++;previewBlobs.clear();previewReads.clear();previewBytes=0;for(const job of jobs)job.cancel();jobs.clear();for(const url of urls)URL.revokeObjectURL(url);urls.clear();}
export function releaseAttachmentURL(url){URL.revokeObjectURL(url);urls.delete(url);}
function previewBlob(path,version){
 if(previewBlobs.has(path)){
  const blob=previewBlobs.get(path);previewBlobs.delete(path);previewBlobs.set(path,blob);return Promise.resolve(blob);
 }
 if(previewReads.has(path))return previewReads.get(path);
 const read=getBlob(ref(storage,path)).then(blob=>{
  if(version===epoch&&blob.size<=MAX_PREVIEW_BYTES){
   previewBlobs.set(path,blob);previewBytes+=blob.size;
   while(previewBytes>MAX_PREVIEW_BYTES||previewBlobs.size>MAX_PREVIEWS){
    const oldest=previewBlobs.keys().next().value;previewBytes-=previewBlobs.get(oldest).size;previewBlobs.delete(oldest);
   }
  }
  return blob;
 }).finally(()=>{if(previewReads.get(path)===read)previewReads.delete(path);});
 previewReads.set(path,read);return read;
}
export async function attachmentBlobURL(attachment,{preview=false}={}){
 const version=epoch;
 const blob=await (preview?previewBlob(attachment.storagePath,version):getBlob(ref(storage,attachment.storagePath)));
 if(version!==epoch)throw Error('存取權限已變更');
 const url=URL.createObjectURL(blob);urls.add(url);return url;
}
export async function uploadAttachment(file,boardId,cardId,requestId,onProgress=()=>{}){
 const version=epoch;
 const type=file.type||'application/octet-stream';
 if(!Number.isSafeInteger(file.size)||file.size<=0)throw Error('無法上傳空白或大小不正確的檔案');
 if(file.size>20*1024*1024)throw Error('檔案超過 20 MiB 上限');
 const session=await call('beginAttachmentUpload',{requestId,boardId,cardId,name:file.name,size:file.size,type});
 const check=()=>{if(version!==epoch)throw Error('存取權限已變更，已停止上傳');};check();
 if(session.status!=='complete'){
  const target=ref(storage,session.stagingPath);
  // Immutable upload retries may be denied after the first upload succeeded.
  // Trusted completion checks the existing bytes and current authorization.
  const job=uploadBytesResumable(target,file,{contentType:type,customMetadata:{uploadedBy:session.memberId,boardId,cardId,attachmentId:session.attachmentId}});
  jobs.add(job);
  try{await new Promise((resolve,reject)=>job.on('state_changed',s=>onProgress(Math.round(s.bytesTransferred/s.totalBytes*100)),reject,resolve));}
  catch(error){check();if(!['storage/unauthorized','storage/retry-limit-exceeded','storage/unknown'].includes(error.code))throw error;}
  finally{jobs.delete(job);}
  check();
 }
 const result=await call('finishAttachmentUpload',{requestId});check();return result;
}
