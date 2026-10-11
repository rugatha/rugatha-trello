import {auth} from './auth.js';
import {getStorage,ref,uploadBytesResumable,getBlob} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-storage.js';
import {getFunctions,httpsCallable} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js';
const storage=getStorage(auth.app),functions=getFunctions(auth.app,'asia-east1');
const call=async(name,data)=>(await httpsCallable(functions,name,{timeout:120000})(data)).data;
const types=['image/png','image/jpeg','image/gif','image/webp','image/avif','application/pdf','text/plain','application/zip','model/gltf-binary','model/stl'];
const jobs=new Set(),urls=new Set();let epoch=0;
export function clearAttachmentAccess(){epoch++;for(const job of jobs)job.cancel();jobs.clear();for(const url of urls)URL.revokeObjectURL(url);urls.clear();}
export function releaseAttachmentURL(url){URL.revokeObjectURL(url);urls.delete(url);}
export async function attachmentBlobURL(attachment){
 const version=epoch;
 const blob=await getBlob(ref(storage,attachment.storagePath));
 if(version!==epoch)throw Error('存取權限已變更');
 const url=URL.createObjectURL(blob);urls.add(url);return url;
}
export async function uploadAttachment(file,boardId,cardId,requestId,onProgress=()=>{}){
 const version=epoch;
 const type=types.includes(file.type)?file.type:({glb:'model/gltf-binary',stl:'model/stl'})[file.name.split('.').at(-1).toLowerCase()];
 if(!type||!file.size||file.size>20*1024*1024)throw Error('不支援此檔案格式或超過 20 MiB');
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
