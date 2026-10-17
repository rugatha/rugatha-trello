import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
const require=createRequire(new URL('../../functions/index.cjs',import.meta.url));
const {initializeApp,deleteApp}=require('firebase-admin/app');
const {getFirestore,FieldValue}=require('firebase-admin/firestore');
const {getStorage}=require('firebase-admin/storage');
const {createContentLifecycle}=require('./content-lifecycle.cjs');
const {createAttachments}=require('./attachments.cjs');
let app,db,bucket,service;
const root='workspaces/main';
const auth=role=>({uid:role,token:{email:role+'@example.com',email_verified:true}});
const payload=(b,action,cardId,archived=false)=>({requestId:randomUUID(),boardId:b,action,...(cardId?{cardId}:{}),confirmName:cardId?'Card':'Board',expectedArchived:archived});
async function fixture() {
 const b='b-'+randomUUID(),board=db.doc(root+'/boards/'+b),card=board.collection('cards').doc('card');
 await board.set({name:'Board',archived:false});await card.set({title:'Card',archived:false,attachmentCount:0});
 await board.collection('columns').doc('todo').set({name:'Todo'});
 for(const role of ['admin','owner','editor','viewer','member'])await db.doc(root+'/members/'+role).update({accessboard:FieldValue.arrayUnion(b)});
 return {b,board,card};
}
before(async()=>{
 if(!process.env.FIRESTORE_EMULATOR_HOST || !process.env.STORAGE_EMULATOR_HOST || process.env.GCLOUD_PROJECT!=='demo-rugatha-trello')throw Error('Use demo emulators');
 app=initializeApp({projectId:'demo-rugatha-trello',storageBucket:'demo-rugatha-trello.firebasestorage.app'});db=getFirestore(app);bucket=getStorage(app).bucket();service=createContentLifecycle(db,bucket);
 for(const role of ['admin','owner','editor','viewer','member']){
  await db.doc(root+'/memberLookup/'+role+'@example.com').set({memberId:role});
  await db.doc(root+'/members/'+role).set({name:role,role,status:'active',accessboard:[]});
 }
});
after(async()=>{await db?.terminate();if(app)await deleteApp(app);});

test('only verified active Admin with board access can operate; malformed requests cannot write',async()=>{
 const {b,board}=await fixture();
 for(const role of ['owner','editor','viewer','member'])for(const action of ['archive','restore','delete'])await assert.rejects(service.manage(auth(role),payload(b,action)),{code:'permission-denied'});
 await assert.rejects(service.manage(null,payload(b,'archive')),{code:'unauthenticated'});
 await assert.rejects(service.manage({...auth('admin'),token:{email:'admin@example.com',email_verified:false}},payload(b,'archive')),{code:'unauthenticated'});
 for(const patch of [{boardId:'../escape'},{cardId:'../escape'},{action:'purge'},{requestId:'x'},{expectedArchived:null},{extra:true}])await assert.rejects(service.manage(auth('admin'),{...payload(b,'archive'),...patch}),{code:'invalid-argument'});
 await db.doc(root+'/members/admin').update({accessboard:FieldValue.arrayRemove(b)});
 await assert.rejects(service.manage(auth('admin'),payload(b,'archive')),{code:'permission-denied'});
 assert.equal((await board.get()).data().archived,false);
});

test('archive and restore retain children, reject stale names/states and replay idempotently',async()=>{
 const {b,card}=await fixture();await card.collection('comments').doc('keep').set({text:'Keep'});
 const archive=payload(b,'archive','card');await service.manage(auth('admin'),archive);
 assert.deepEqual(await service.manage(auth('admin'),archive),{boardId:b,cardId:'card',action:'archive'});
 await assert.rejects(service.manage(auth('admin'),{...archive,action:'restore'}),{code:'already-exists'});
 await assert.rejects(service.manage(auth('admin'),payload(b,'restore','card')),{code:'aborted'});
 await assert.rejects(service.manage(auth('admin'),{...payload(b,'restore','card',true),confirmName:'Stale'}),{code:'aborted'});
 await service.manage(auth('admin'),payload(b,'restore','card',true));
 assert.equal((await card.get()).data().archived,false);assert.equal((await card.collection('comments').get()).size,1);
 await assert.rejects(service.manage(auth('admin'),payload(b,'delete','card')),{code:'failed-precondition'});
});

test('card deletion removes every child and owned object; preserves sibling cards and outside bytes',async()=>{
 const {b,board,card}=await fixture();
 await card.collection('comments').doc('c').set({text:'Comment'});await card.collection('checklist').doc('t').set({text:'Task'});
 // Untrusted attachment paths must never direct deletion outside the target prefix.
 await card.collection('attachments').doc('a').set({storagePath:'outside/keep.txt'});
 await board.collection('cards').doc('other').set({title:'Other'});
 const owned=card.path+'/attachments/a/note.txt',staging='uploads/editor/'+b+'/card/s/note.txt',outside='outside/'+b+'/keep.txt';
 for(const file of [owned,staging,outside])await bucket.file(file).save('bytes');
 const session=db.doc(root+'/attachmentUploads/'+randomUUID());await session.set({boardId:b,cardId:'card',status:'pending'});
 await service.manage(auth('admin'),payload(b,'archive','card'));
 const deletion=payload(b,'delete','card',true);await service.manage(auth('admin'),deletion);
 assert.equal((await card.get()).exists,false);for(const type of ['comments','checklist','attachments'])assert.equal((await card.collection(type).get()).size,0);
 for(const file of [owned,staging])assert.equal((await bucket.file(file).exists())[0],false);
 assert.equal((await bucket.file(outside).exists())[0],true);assert.equal((await board.collection('cards').doc('other').get()).exists,true);
 assert.equal((await session.get()).data().status,'expired');assert.deepEqual(await service.manage(auth('admin'),deletion),{boardId:b,cardId:'card',action:'delete'});
});

test('board deletion cleans orphan descendants and grants while preserving other boards and member roles',async()=>{
 const {b,board}=await fixture();const other=await fixture();
 await board.collection('cards').doc('missing-parent').collection('comments').doc('orphan').set({text:'Orphan'});
 await bucket.file(board.path+'/cards/card/attachments/a/f').save('owned');await bucket.file(other.board.path+'/cards/card/attachments/a/f').save('keep');
 await service.manage(auth('admin'),payload(b,'archive'));
 await service.manage(auth('admin'),payload(b,'delete',undefined,true));
 assert.equal((await board.get()).exists,false);assert.equal((await board.collection('columns').get()).size,0);
 assert.equal((await board.collection('cards').doc('missing-parent').collection('comments').get()).size,0);
 for(const role of ['admin','owner','editor','viewer','member']){
  const m=(await db.doc(root+'/members/'+role).get()).data();assert(!m.accessboard.includes(b));assert(m.accessboard.includes(other.b));assert.equal(m.role,role);
 }
 assert.equal((await other.board.get()).data().name,'Board');assert.equal((await bucket.file(other.board.path+'/cards/card/attachments/a/f').exists())[0],true);
});

test('partial cleanup remains locked, refuses restoration and resumes with a new request ID',async()=>{
 const {b,card}=await fixture();await service.manage(auth('admin'),payload(b,'archive','card'));
 const broken=createContentLifecycle(db,{deleteFiles:async()=>{throw Error('Storage unavailable');}});
 await assert.rejects(broken.manage(auth('admin'),payload(b,'delete','card',true)),/Storage unavailable/);
 assert.equal((await card.get()).data().deleting,true);
 await assert.rejects(service.manage(auth('admin'),payload(b,'restore','card',true)),{code:'failed-precondition'});
 await service.manage(auth('admin'),payload(b,'delete','card',true));assert.equal((await card.get()).exists,false);
});

test('revoked Admin cannot replay completed operations',async()=>{
 const {b}=await fixture(),p=payload(b,'archive');await service.manage(auth('admin'),p);
 await db.doc(root+'/members/admin').update({status:'disabled'});
 await assert.rejects(service.manage(auth('admin'),p),{code:'permission-denied'});
 await db.doc(root+'/members/admin').update({status:'active'});
});

test('attachment completion racing a deletion cannot leave a published blob or record',async()=>{
 const {b,card}=await fixture();
 const racingBucket={name:bucket.name,file(path){const f=bucket.file(path);if(path.startsWith(card.path+'/attachments/')){
  const save=f.save.bind(f);f.save=async(...args)=>{
   await service.manage(auth('admin'),payload(b,'archive','card'));
   await service.manage(auth('admin'),payload(b,'delete','card',true));
   return save(...args);
  };
 }return f;}};
 const uploads=createAttachments(db,racingBucket);
 const bytes=Buffer.from('Hello');
 const s=await uploads.begin(auth('editor'),{requestId:'race',boardId:b,cardId:'card',name:'note.txt',type:'text/plain',size:bytes.length});
 await bucket.file(s.stagingPath).save(bytes,{metadata:{contentType:s.type,metadata:{uploadedBy:s.memberId,boardId:b,cardId:'card',attachmentId:s.attachmentId}}});
 await assert.rejects(uploads.finish(auth('editor'),{requestId:'race'}),{code:'failed-precondition'});
 assert.equal((await bucket.file(s.storagePath).exists())[0],false);assert.equal((await card.collection('attachments').get()).size,0);
});
