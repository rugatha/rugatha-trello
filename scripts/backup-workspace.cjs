// Read-only production snapshot. All document data and object bytes stay in gitignored private storage.
'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {PROJECT,BUCKET,cloudClient}=require('./cloud-client.cjs');
const digest=data=>createHash('sha256').update(data).digest('hex');
async function backup(){
 if(process.argv.length>2)throw Error('No arguments: this command never changes cloud data.');
 const request=await cloudClient(),folder=path.resolve('attachments_export/maintenance',new Date().toISOString().replace(/[:.]/g,'-'));
 fs.mkdirSync(folder+'/objects',{recursive:true,mode:0o700});
 const root=`projects/${PROJECT}/databases/(default)/documents`,documents=[],missingParents=[];
 async function collections(parent){let pageToken,ids=[];do{const result=await request(`https://firestore.googleapis.com/v1/${parent}:listCollectionIds`,{method:'POST',body:{pageSize:100,...(pageToken?{pageToken}:{})}});ids.push(...(result.collectionIds||[]));pageToken=result.nextPageToken;}while(pageToken);return ids;}
 async function walk(parent){
  for(const id of await collections(parent)){
   let pageToken;do{
    const q=new URLSearchParams({pageSize:'1000',showMissing:'true'});if(pageToken)q.set('pageToken',pageToken);
    const result=await request(`https://firestore.googleapis.com/v1/${parent}/${encodeURIComponent(id)}?${q}`);
    const rows=result.documents||[];
    for(const row of rows){if(row.createTime)documents.push(row);else missingParents.push(row.name);}
    for(let i=0;i<rows.length;i+=8)await Promise.all(rows.slice(i,i+8).map(row=>walk(row.name)));
    pageToken=result.nextPageToken;
   }while(pageToken);
  }
 }
 await walk(root+'/workspaces/main');
 const workspace=await request('https://firestore.googleapis.com/v1/'+root+'/workspaces/main');documents.push(workspace);
 const objects=[];let pageToken;
 do{const q=new URLSearchParams({maxResults:'1000'});if(pageToken)q.set('pageToken',pageToken);const result=await request(`https://storage.googleapis.com/storage/v1/b/${BUCKET}/o?${q}`);objects.push(...(result.items||[]));pageToken=result.nextPageToken;}while(pageToken);
 for(let i=0;i<objects.length;i+=6)await Promise.all(objects.slice(i,i+6).map(async object=>{
  const bytes=await request(`https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encodeURIComponent(object.name)}?alt=media&generation=${object.generation}`,{binary:true});
  if(bytes.length!==Number(object.size))throw Error('Storage size changed during snapshot');
  object.backupFile='objects/'+digest(object.name+'@'+object.generation)+'.bin';object.sha256=digest(bytes);fs.writeFileSync(path.join(folder,object.backupFile),bytes,{mode:0o600,flag:'wx'});
 }));
 documents.sort((a,b)=>a.name.localeCompare(b.name));
 const payload={schema:1,project:PROJECT,bucket:BUCKET,startedAt:path.basename(folder),completedAt:new Date().toISOString(),documents,missingParents,objects};
 const bytes=Buffer.from(JSON.stringify(payload));fs.writeFileSync(folder+'/snapshot.json',bytes,{mode:0o600,flag:'wx'});
 const summary={folder:folder.replace(process.cwd()+'/',''),documents:documents.length,objects:objects.length,objectBytes:objects.reduce((n,o)=>n+Number(o.size),0),snapshotSha256:digest(bytes),collections:Object.fromEntries([...new Set(documents.map(d=>d.name.split('/').at(-2)))].map(k=>[k,documents.filter(d=>d.name.split('/').at(-2)===k).length]))};
 fs.writeFileSync(folder+'/summary.json',JSON.stringify(summary,null,2),{mode:0o600,flag:'wx'});console.log(JSON.stringify(summary));
}
if(require.main===module)backup().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={digest};
