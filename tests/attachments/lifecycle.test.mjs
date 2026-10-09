import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../functions/index.cjs',import.meta.url));
const {initializeApp,deleteApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const {getStorage}=require('firebase-admin/storage');
const {createAttachments}=require('./attachments.cjs');
let app,db,bucket,service,clock=Date.now();
const root='workspaces/main',cardPath=root+'/boards/allowed/cards/card';
const auth=who=>({uid:who,token:{email:who+'@example.com',email_verified:true}});
const bytes=Buffer.from('Hello attachment');
const payload=requestId=>({requestId,boardId:'allowed',cardId:'card',name:'note.txt',type:'text/plain',size:bytes.length});
async function stage(requestId,who='editor',body=bytes){
 const s=await service.begin(auth(who),payload(requestId));
 await bucket.file(s.stagingPath).save(body,{resumable:false,metadata:{contentType:s.type,metadata:{uploadedBy:s.memberId,boardId:s.boardId,cardId:s.cardId,attachmentId:s.attachmentId}}});
 return s;
}
before(async()=>{
 if(!process.env.FIRESTORE_EMULATOR_HOST||!process.env.STORAGE_EMULATOR_HOST||process.env.GCLOUD_PROJECT!=='demo-rugatha-trello')throw Error('demo emulators required');
 app=initializeApp({projectId:'demo-rugatha-trello',storageBucket:'demo-rugatha-trello.firebasestorage.app'});db=getFirestore(app);bucket=getStorage(app).bucket();service=createAttachments(db,bucket,{now:()=>clock});
 for(const role of ['owner','admin','editor','viewer','member']){
  await db.doc(root+'/memberLookup/'+role+'@example.com').set({memberId:role});
  await db.doc(root+'/members/'+role).set({status:'active',role,accessboard:['allowed']});
 }
 await db.doc(root+'/boards/allowed').set({name:'Allowed'});
 await db.doc(cardPath).set({title:'Card',attachmentCount:0});
});
after(async()=>{await db?.terminate();if(app)await deleteApp(app);});
test('viewer, member and anonymous cannot begin; malformed requests rejected',async()=>{
 for(const who of ['viewer','member'])await assert.rejects(service.begin(auth(who),payload(who)),{code:'permission-denied'});
 await assert.rejects(service.begin(null,payload('anon')),{code:'unauthenticated'});
 await assert.rejects(service.begin(auth('editor'),{...payload('large'),size:20971521}),{code:'invalid-argument'});
});
test('completion is atomic and concurrent/repeated completions count exactly once; no token',async()=>{
 const s=await stage('good');assert.equal((await service.begin(auth('editor'),payload('good'))).attachmentId,s.attachmentId);await Promise.all([service.finish(auth('editor'),{requestId:'good'}),service.finish(auth('editor'),{requestId:'good'})]);
 assert.equal((await db.doc(cardPath).get()).data().attachmentCount,1);
 const file=(await db.doc(cardPath+'/attachments/'+s.attachmentId).get()).data();assert.equal(file.storagePath,s.storagePath);assert.equal(file.url,undefined);
 const [meta]=await bucket.file(s.storagePath).getMetadata();assert.ok(!meta.metadata?.firebaseStorageDownloadTokens);
 assert.deepEqual(await service.finish(auth('editor'),{requestId:'good'}),{attachmentId:s.attachmentId});
 await assert.rejects(service.begin(auth('editor'),{...payload('good'),name:'changed'}),{code:'already-exists'});
});
test('format mismatch never creates a record or changes count',async()=>{
 const s=await stage('bad','editor',Buffer.alloc(bytes.length,255));
 await assert.rejects(service.finish(auth('editor'),{requestId:'bad'}),{code:'invalid-argument'});
 assert.equal((await db.doc(cardPath+'/attachments/'+s.attachmentId).get()).exists,false);
 assert.equal((await db.doc(cardPath).get()).data().attachmentCount,1);
});
test('revocation during upload blocks completion; restoring permission allows retry',async()=>{
 await stage('revoke');await db.doc(root+'/members/editor').update({accessboard:[]});
 await assert.rejects(service.finish(auth('editor'),{requestId:'revoke'}),{code:'permission-denied'});
 await db.doc(root+'/members/editor').update({accessboard:['allowed']});await service.finish(auth('editor'),{requestId:'revoke'});
 assert.equal((await db.doc(cardPath).get()).data().attachmentCount,2);
});
test('archived or deleted card rejects completion and uploaded bytes remain unlinked',async()=>{
 const s=await stage('archived');await db.doc(cardPath).update({archived:true});
 await assert.rejects(service.finish(auth('editor'),{requestId:'archived'}),{code:'failed-precondition'});
 await db.doc(cardPath).delete();await assert.rejects(service.finish(auth('editor'),{requestId:'archived'}),{code:'failed-precondition'});
 await db.doc(cardPath).set({title:'Card',attachmentCount:2,archived:false});
 assert.equal((await db.doc(cardPath+'/attachments/'+s.attachmentId).get()).exists,false);
});
test('late concurrent finish recognizes a commit after staging disappears',async()=>{
 const session=await stage('late');
 const concurrent=createAttachments(db,{name:bucket.name,file(path){
  const file=bucket.file(path);
  if(path===session.stagingPath){const metadata=file.getMetadata.bind(file);file.getMetadata=async()=>{await service.finish(auth('editor'),{requestId:'late'});return metadata();};}
  return file;
 }},{now:()=>clock});
 const before=(await db.doc(cardPath).get()).data().attachmentCount;
 assert.deepEqual(await concurrent.finish(auth('editor'),{requestId:'late'}),{attachmentId:session.attachmentId});
 assert.equal((await db.doc(cardPath).get()).data().attachmentCount,before+1);
});
test('unfinished staging returns a retryable precondition failure',async()=>{
 const session=await service.begin(auth('editor'),payload('not-uploaded'));
 await assert.rejects(service.finish(auth('editor'),{requestId:'not-uploaded'}),{code:'failed-precondition'});
 assert.equal((await db.doc(cardPath+'/attachments/'+session.attachmentId).get()).exists,false);
});
test('cleanup removes expired unlinked bytes, preserves committed/archived objects and rejects late retry',async()=>{
 const s=await stage('expired');
 await db.doc(cardPath).update({archived:true});clock+=86400001;
 const result=await service.cleanup();assert.ok(result.removed>=5);
 assert.equal((await bucket.file(s.stagingPath).exists())[0],false);
 const good=await service.begin(auth('owner'),{...payload('blocked'),cardId:'missing'}).catch(e=>e);assert.equal(good.code,'failed-precondition');
 const records=await db.doc(cardPath).collection('attachments').get();for(const d of records.docs)assert.equal((await bucket.file(d.data().storagePath).exists())[0],true);
 await db.doc(cardPath).update({archived:false});await assert.rejects(service.finish(auth('editor'),{requestId:'expired'}),{code:'failed-precondition'});
});
