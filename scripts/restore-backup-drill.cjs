// Restore into local demo emulators only. Never imports into production or clears any database.
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {digest}=require('./backup-workspace.cjs');
const DEMO='demo-rugatha-trello';
async function restore(){
 if(process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT!==DEMO)throw Error('Demo project required');
 if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'||process.env.FIREBASE_STORAGE_EMULATOR_HOST!=='127.0.0.1:9199')throw Error('Both fixed loopback emulator endpoints are required');
 const folder=path.resolve(process.argv[2]||'');const privateRoot=path.resolve('attachments_export/maintenance')+path.sep;
 if(!folder.startsWith(privateRoot))throw Error('Only private maintenance backup folders are accepted');
 const bytes=fs.readFileSync(folder+'/snapshot.json'),summary=JSON.parse(fs.readFileSync(folder+'/summary.json')),data=JSON.parse(bytes);
 assert.equal(digest(bytes),summary.snapshotSha256);assert.equal(data.project,'rugatha-trello');
 const localRoot=`projects/${DEMO}/databases/(default)/documents`;
 async function request(resource,body){const r=await fetch('http://127.0.0.1:8080/v1/'+resource,{method:body?'POST':'GET',headers:{Authorization:'Bearer owner','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});if(!r.ok)throw Error('Local restore HTTP '+r.status);return r.json();}
 const initial=await request(localRoot+'/workspaces');if(initial.documents?.length)throw Error('Fresh emulator required; existing data will not be overwritten');
 const originals=new Map();
 for(let i=0;i<data.documents.length;i+=200){
  const writes=data.documents.slice(i,i+200).map(doc=>{
   const name=localRoot+'/'+doc.name.split('/documents/')[1];originals.set(name,doc.fields||{});
   return {update:{name,fields:doc.fields||{}},currentDocument:{exists:false}};
  });await request(localRoot+':commit',{writes});
 }
 for(const [name,fields] of originals){const actual=await request(name);assert.deepEqual(actual.fields||{},fields);}
 const requireFunctions=require('node:module').createRequire(path.resolve('functions/package.json'));
 const {initializeApp}=requireFunctions('firebase-admin/app'),{getStorage}=requireFunctions('firebase-admin/storage');
 const app=initializeApp({projectId:DEMO,storageBucket:DEMO+'.appspot.com'},'restore-drill'),bucket=getStorage(app).bucket();
 for(let i=0;i<data.objects.length;i+=6)await Promise.all(data.objects.slice(i,i+6).map(async object=>{
  const objectPath=path.resolve(folder,object.backupFile);if(!objectPath.startsWith(folder+'/objects/'))throw Error('Invalid backup object path');
  const stored=fs.readFileSync(objectPath);assert.equal(digest(stored),object.sha256);assert.equal(stored.length,Number(object.size));
  const file=bucket.file(object.name);await file.save(stored,{resumable:false,validation:false,metadata:{contentType:object.contentType,metadata:object.metadata||{},cacheControl:object.cacheControl}});
  const [download]=await file.download();assert.equal(digest(download),object.sha256);
 }));
 const report={at:new Date().toISOString(),project:DEMO,documentsVerified:originals.size,objectsVerified:data.objects.length,objectBytes:data.objects.reduce((n,o)=>n+Number(o.size),0),productionWrites:0};
 fs.writeFileSync(folder+'/restore-drill.json',JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report));
}
restore().catch(e=>{console.error(e.message);process.exitCode=1;});
