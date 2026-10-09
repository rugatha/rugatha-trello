// Read-only by default. Mutations are explicit and retain private pre-change backups.
'use strict';
const fs=require('node:fs'),path=require('node:path');
const auth=require('firebase-tools/lib/auth');
const {localEntries}=require('./migrate-trello-attachments.cjs');
const project='rugatha-trello',bucket=project+'.firebasestorage.app';
const directory=path.resolve(__dirname,'../attachments_export/migration/storage-auth-cutover');
const firestore=`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
const storage=`https://storage.googleapis.com/storage/v1/b/${bucket}`;
const origins=['https://rugatha.github.io','http://localhost:8765','http://127.0.0.1:8765'];
const cors=[{origin:origins,method:['GET','HEAD'],responseHeader:['Content-Type','Content-Length','Content-Disposition','ETag'],maxAgeSeconds:3600}];
async function main(){
 const account=auth.getProjectDefaultAccount(process.cwd());if(!account)throw Error('Firebase CLI login required');
 let token=account.tokens;
 async function request(url,options={}){
  if(token.expires_at<Date.now()+60000)token=await auth.getAccessToken(account.tokens.refresh_token,account.tokens.scopes);
  const response=await fetch(url,{...options,headers:{Authorization:'Bearer '+token.access_token,'Content-Type':'application/json',...options.headers}});
  const data=await response.json();if(!response.ok)throw Error(`HTTP ${response.status}: ${data.error?.message||'request failed'}`);return data;
 }
 fs.mkdirSync(directory,{recursive:true,mode:0o700});
 const save=(name,data)=>fs.writeFileSync(path.join(directory,name),JSON.stringify(data,null,2),{mode:0o600});
 const meta=await request(storage);save('bucket-'+Date.now()+'.json',meta);
 if(process.argv.includes('--apply-cors'))await request(storage+'?ifMetagenerationMatch='+meta.metageneration,{method:'PATCH',body:JSON.stringify({cors})});
 const summary={at:new Date().toISOString(),files:0,tokensPresent:0,oldLinksDenied:0,metadataVerified:0,corsApplied:process.argv.includes('--apply-cors'),errors:[]};
 for(const entry of localEntries().filter(e=>e.board.name!=='Socials'&&e.status==='downloaded')){
  const document=`workspaces/main/boards/trello-${entry.board.id}/cards/${entry.card.id}/attachments/${entry.attachment.id}`;
  const doc=await request(firestore+'/'+document),f=doc.fields,object=f.storagePath?.stringValue;
  if(!object?.startsWith(document+'/')||f.storageBucket?.stringValue!==bucket)throw Error('Unexpected migrated storage linkage');
  const objectURL=storage+'/o/'+encodeURIComponent(object),before=await request(objectURL);
  if(before.md5Hash!==entry.md5||Number(before.size)!==entry.size)throw Error('Migrated object checksum mismatch');
  // Never overwrite the original token backup on an interrupted/repeated run.
  const backup=path.join(directory,entry.attachment.id+'.json');
  if(!fs.existsSync(backup))fs.writeFileSync(backup,JSON.stringify({document:doc,object:before},null,2),{mode:0o600,flag:'wx'});
  let after=before;
  if(process.argv.includes('--apply-tokens')){
   after=await request(objectURL+'?ifGenerationMatch='+before.generation+'&ifMetagenerationMatch='+before.metageneration,{method:'PATCH',body:JSON.stringify({cacheControl:'private, no-store',metadata:{firebaseStorageDownloadTokens:null}})});
   if(f.url?.stringValue?.startsWith('https://firebasestorage.googleapis.com/')){
    await request(firestore+':commit',{method:'POST',body:JSON.stringify({writes:[{update:{name:doc.name,fields:{}},updateMask:{fieldPaths:['url']},currentDocument:{updateTime:doc.updateTime}}]})});
   }
  }
  summary.files++;summary.metadataVerified++;
  if(after.metadata?.firebaseStorageDownloadTokens)summary.tokensPresent++;
  if(process.argv.includes('--verify-denied')||process.argv.includes('--apply-tokens')){
   const original=JSON.parse(fs.readFileSync(backup)),url=original.document.fields.url?.stringValue;
   if(url){const response=await fetch(url,{headers:{Range:'bytes=0-0'},signal:AbortSignal.timeout(30000)});await response.body?.cancel();if([401,403,404].includes(response.status))summary.oldLinksDenied++;else summary.errors.push({attachmentId:entry.attachment.id,status:response.status});}
  }
 }
 const current=await request(storage);summary.cors=current.cors||[];
 save('result-'+Date.now()+'.json',summary);console.log(JSON.stringify(summary,null,2));
 if(summary.errors.length)process.exitCode=1;
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={cors};
