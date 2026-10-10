// Read-only infrastructure inventory; private responses are stored only in ignored backups.
'use strict';
const fs=require('node:fs');const {PROJECT,BUCKET,cloudClient}=require('./cloud-client.cjs');
(async()=>{
 const request=await cloudClient(),folder='attachments_export/maintenance/operations-'+Date.now();fs.mkdirSync(folder,{recursive:true,mode:0o700});
 const queries={database:`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)`,bucket:`https://storage.googleapis.com/storage/v1/b/${BUCKET}`,functions:`https://cloudfunctions.googleapis.com/v2/projects/${PROJECT}/locations/asia-east1/functions`,backups:`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/backupSchedules`,appcheck:`https://firebaseappcheck.googleapis.com/v1/projects/${PROJECT}/services`,billing:`https://cloudbilling.googleapis.com/v1/projects/${PROJECT}/billingInfo`};
 const report={at:new Date().toISOString()};
 for(const [key,url] of Object.entries(queries))try{
  const data=await request(url);fs.writeFileSync(folder+'/'+key+'.json',JSON.stringify(data,null,2),{mode:0o600});
  if(key==='database')report.database={location:data.locationId,pitr:data.pointInTimeRecoveryEnablement};
  if(key==='bucket')report.bucket={versioning:!!data.versioning?.enabled,softDeleteSeconds:data.softDeletePolicy?.retentionDurationSeconds||'0'};
  if(key==='functions')report.functions=data.functions?.map(f=>({name:f.name.split('/').at(-1),state:f.state,updated:f.updateTime}));
  if(key==='backups')report.backupSchedules=data.backupSchedules?.length||0;
  if(key==='appcheck')report.appcheck=data.services?.map(s=>({name:s.name.split('/').at(-1),mode:s.enforcementMode}));
  if(key==='billing')report.billingEnabled=data.billingEnabled;
 }catch(e){report[key]={unavailable:e.message};}
 fs.writeFileSync(folder+'/summary.json',JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
