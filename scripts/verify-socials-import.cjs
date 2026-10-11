// Verify that the Socials addition preserved every pre-existing document and object.
'use strict';
const fs=require('node:fs'),{PROJECT,BUCKET,cloudClient}=require('./cloud-client.cjs');
const canonical=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
async function main(){
 const file=process.argv[2];if(!file)throw Error('Provide pre-import snapshot.json');
 const before=JSON.parse(fs.readFileSync(file)),request=await cloudClient();
 const result=JSON.parse(fs.readFileSync('attachments_export/socials-import/result.json'));
 const boardId='trello-67f015af195310d43826dd8c',differences=[];
 for(let i=0;i<before.documents.length;i+=200){
  const docs=before.documents.slice(i,i+200);
  const rows=await request(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:batchGet`,{method:'POST',body:{documents:docs.map(d=>d.name)}});
  const remote=new Map(rows.filter(r=>r.found).map(r=>[r.found.name,r.found]));
  for(const d of docs){const expected=structuredClone(d.fields),found=remote.get(d.name);
   if(d.name.includes('/members/')&&expected.role?.stringValue==='owner'&&expected.status?.stringValue==='active'){
    expected.accessboard.arrayValue.values||=[];
    if(!expected.accessboard.arrayValue.values.some(v=>v.stringValue===boardId))expected.accessboard.arrayValue.values.push({stringValue:boardId});
   }
   if(!found||canonical(found.fields)!==canonical(expected))differences.push(d.name);
  }
 }
 const objects=[];let pageToken;do{const q=new URLSearchParams({maxResults:'1000'});if(pageToken)q.set('pageToken',pageToken);const r=await request(`https://storage.googleapis.com/storage/v1/b/${BUCKET}/o?${q}`);objects.push(...(r.items||[]));pageToken=r.nextPageToken;}while(pageToken);
 const map=new Map(objects.map(o=>[o.name,o]));for(const o of before.objects){const found=map.get(o.name);if(!found||o.generation!==found.generation||o.metageneration!==found.metageneration||o.md5Hash!==found.md5Hash)differences.push(o.name);}
 const audit={at:new Date().toISOString(),baseline:file,previousDocuments:before.documents.length,previousObjects:before.objects.length,newObjects:objects.length-before.objects.length,expectedNewObjects:result.files,differences};
 fs.writeFileSync('attachments_export/socials-import/preservation-audit.json',JSON.stringify(audit,null,2),{mode:0o600});
 console.log(JSON.stringify({...audit,differences:differences.length}));if(differences.length||audit.newObjects!==result.files)throw Error('Preservation audit failed');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
