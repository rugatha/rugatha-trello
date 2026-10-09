'use strict';
const {createHash}=require('node:crypto');
const {ManagementError}=require('./management.cjs');
const ROOT='workspaces/main', MAX=20*1024*1024;
const TYPES=['image/png','image/jpeg','image/gif','image/webp','image/avif','application/pdf','text/plain','application/zip','model/gltf-binary','model/stl'];
const fail=(code,message)=>{throw new ManagementError(code,message);};
const id=x=>{if(typeof x!=='string'||!/^[\w-]{1,128}$/.test(x))fail('invalid-argument','附件 ID 不正確');return x;};
function validContent(bytes,type) {
 const hex=bytes.subarray(0,16).toString('hex'),s=bytes.subarray(0,256).toString('ascii');
 switch(type){
 case 'image/png':return hex.startsWith('89504e470d0a1a0a');
 case 'image/jpeg':return hex.startsWith('ffd8ff');
 case 'image/gif':return /^GIF8[79]a/.test(s);
 case 'image/webp':return s.startsWith('RIFF')&&s.slice(8,12)==='WEBP';
 case 'image/avif':return s.slice(4,8)==='ftyp'&&/avif|avis/.test(s.slice(8,40));
 case 'application/pdf':return s.startsWith('%PDF-');
 case 'application/zip':return /^(504b0304|504b0506|504b0708)/.test(hex);
 case 'model/gltf-binary':return bytes.length>=12&&s.startsWith('glTF')&&bytes.readUInt32LE(4)===2&&bytes.readUInt32LE(8)===bytes.length;
 case 'model/stl':return bytes.length>=84&&84+bytes.readUInt32LE(80)*50===bytes.length || /^solid\s/.test(s)&&/endsolid\s*[^\r\n]*\s*$/.test(bytes.toString('utf8'));
 case 'text/plain':try{new TextDecoder('utf-8',{fatal:true}).decode(bytes);return !bytes.includes(0);}catch{return false;}
 default:return false;
 }
}
function createAttachments(db,bucket,{now=()=>Date.now()}={}) {
 async function actor(tx,auth,boardId) {
  const email=auth?.token?.email;
  if(!auth?.uid||auth.token.email_verified!==true||typeof email!=='string'||email.includes('/'))fail('unauthenticated','請登入已驗證帳號');
  const lookup=await tx.get(db.doc(`${ROOT}/memberLookup/${email.toLowerCase()}`));
  if(!lookup.exists)fail('permission-denied','沒有會員權限');
  const member=await tx.get(db.doc(`${ROOT}/members/${id(lookup.data().memberId)}`)),m=member.data();
  if(!m||m.status!=='active'||!['owner','admin','editor'].includes(m.role)||!m.accessboard?.includes(boardId))fail('permission-denied','沒有附件上傳權限');
  return member.id;
 }
 const requestRef=(auth,requestId)=>db.doc(`${ROOT}/attachmentUploads/${createHash('sha256').update(auth.uid+':'+requestId).digest('hex')}`);
 async function context(tx,auth,session){
  const memberId=await actor(tx,auth,session.boardId);
  const cardRef=db.doc(`${ROOT}/boards/${session.boardId}/cards/${session.cardId}`);
  const [board,card]=await Promise.all([tx.get(cardRef.parent.parent),tx.get(cardRef)]);
  if(!board.exists||board.data().archived||!card.exists||card.data().archived)fail('failed-precondition','牌卡或看板已封存或不存在');
  return {memberId,cardRef,card:card.data()};
 }
 async function getSession(auth,data){
  if(!auth?.uid)fail('unauthenticated','請先登入');
  const ref=requestRef(auth,id(data?.requestId));
  const snap=await ref.get();if(!snap.exists)fail('not-found','找不到上傳工作');
  return {ref,session:snap.data()};
 }
 async function remove(path){try{await bucket.file(path).delete({ignoreNotFound:true});}catch(e){if(e.code!==404)throw e;}}
 return {
  async begin(auth,data){
   if(!auth?.uid)fail('unauthenticated','請先登入');
   const requestId=id(data?.requestId),boardId=id(data.boardId),cardId=id(data.cardId);
   if(typeof data.name!=='string'||!data.name.trim()||data.name.length>180||!TYPES.includes(data.type)||!Number.isInteger(data.size)||data.size<=0||data.size>MAX)fail('invalid-argument','檔案格式或大小不符合限制（最多 20 MiB）');
   const ref=requestRef(auth,requestId),attachmentId='upload-'+ref.id;
   const name=data.name.trim(),filename=name.replace(/[\x00-\x1f\x7f/\\]/g,'_');
   const payload={boardId,cardId,name,type:data.type,size:data.size};
   return db.runTransaction(async tx=>{
    const {memberId}=await context(tx,auth,payload),existing=await tx.get(ref);
    if(existing.exists){const s=existing.data();if(Object.keys(payload).some(key=>s.payload[key]!==payload[key]))fail('already-exists','重試內容已變更');if(s.status==='expired')fail('failed-precondition','上傳已過期，請重新選檔');return s;}
    const session={...payload,payload,attachmentId,memberId,uid:auth.uid,status:'pending',createdAt:now(),
     stagingPath:`uploads/${memberId}/${boardId}/${cardId}/${ref.id}/${filename}`,
     storagePath:`${ROOT}/boards/${boardId}/cards/${cardId}/attachments/${attachmentId}/${filename}`};
    tx.create(ref,session);return session;
   });
  },
  async finish(auth,data){
   const {ref,session:s}=await getSession(auth,data);
   await db.runTransaction(async tx=>{await context(tx,auth,s);const snap=await tx.get(ref);if(snap.data().status==='expired')fail('failed-precondition','上傳已過期');});
   if(s.status==='complete')return {attachmentId:s.attachmentId};
   const source=bucket.file(s.stagingPath);
   let meta,bytes;
   try {
    [meta]=await source.getMetadata();
    [bytes]=await source.download({validation:'crc32c'});
   } catch(error) {
    // Another finish may commit and remove staging between our initial read
    // and download. Recheck both authorization and the durable result.
    if(error.code!==404)throw error;
    const complete=await db.runTransaction(async tx=>{await context(tx,auth,s);return (await tx.get(ref)).data().status==='complete';});
    if(complete)return {attachmentId:s.attachmentId};
    fail('failed-precondition','暫存檔案尚未上傳完成，請重試');
   }
   if(Number(meta.size)!==s.size||meta.contentType!==s.type||meta.metadata?.uploadedBy!==s.memberId||meta.metadata?.boardId!==s.boardId||meta.metadata?.cardId!==s.cardId||meta.metadata?.attachmentId!==s.attachmentId)fail('invalid-argument','上傳檔案資料不符');
   if(bytes.length!==s.size||!validContent(bytes,s.type))fail('invalid-argument','檔案內容與宣告格式不符，請重新選檔');
   const target=bucket.file(s.storagePath);
   try{await target.save(bytes,{resumable:false,preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:s.type,cacheControl:'private, no-store',metadata:{uploadedBy:s.memberId,boardId:s.boardId,cardId:s.cardId,attachmentId:s.attachmentId}}});}
   catch(error){if(error.code!==412)throw error;const [old]=await target.download();if(!old.equals(bytes))fail('already-exists','附件路徑已存在不同內容');}
   await db.runTransaction(async tx=>{
    const {memberId,cardRef}=await context(tx,auth,s),current=await tx.get(ref);
    if(current.data().status==='expired')fail('failed-precondition','上傳已過期');
    if(current.data().status==='complete')return;
    const attachmentRef=cardRef.collection('attachments').doc(s.attachmentId);
    const [existing,attachments]=await Promise.all([tx.get(attachmentRef),tx.get(cardRef.collection('attachments'))]);
    if(existing.exists)fail('already-exists','附件紀錄已存在');
    const at=new Date(now()).toISOString();
    tx.create(attachmentRef,{name:s.name,type:s.type,size:s.size,storageBucket:bucket.name,storagePath:s.storagePath,createdBy:memberId,createdAt:at,archived:false});
    tx.update(cardRef,{attachmentCount:attachments.docs.filter(d=>!d.data().archived).length+1,updatedBy:memberId,updatedAt:at});
    tx.update(ref,{status:'complete',completedAt:now()});
   });
   // A cleanup error must not turn an already committed upload into a failure.
   await remove(s.stagingPath).catch(()=>{});
   return {attachmentId:s.attachmentId};
  },
  async cleanup(){
   let removed=0;
   let cursor;
   do {
   let query=db.collection(`${ROOT}/attachmentUploads`).where('createdAt','<',now()-86400000).orderBy('createdAt').limit(200);
   if(cursor)query=query.startAfter(cursor);
   const snapshots=await query.get();
   if(snapshots.empty)break;
   cursor=snapshots.docs.at(-1);
   for(const doc of snapshots.docs){
    const s=await db.runTransaction(async tx=>{const snapshot=await tx.get(doc.ref),value=snapshot.data();if(value.status!=='complete')tx.update(doc.ref,{status:'expired'});return value;});
    await remove(s.stagingPath);
    if(s.status!=='complete')await remove(s.storagePath);
    // Retain tombstones: late retries can never revive expired requests.
    removed++;
   }
   } while(cursor);
   // Direct clients may leave unregistered temporary objects. This namespace
   // contains no published attachments; age-gated cleanup cannot delete originals.
   let pageToken;
   do {
    const [files,next]=await bucket.getFiles({prefix:'uploads/',autoPaginate:false,maxResults:200,pageToken});
    for(const file of files){const [meta]=await file.getMetadata();if(Date.parse(meta.timeCreated)<now()-86400000)await file.delete({ifGenerationMatch:meta.generation});}
    pageToken=next?.pageToken;
   } while(pageToken);
   return {removed};
  }
 };
}
module.exports={createAttachments,validContent,MAX,TYPES};
