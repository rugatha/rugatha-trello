// Read-only verification of migrated records, counts, and preserved external links.
const fs = require('node:fs');
const path = require('node:path');
const auth = require('firebase-tools/lib/auth');
const {localEntries} = require('./migrate-trello-attachments.cjs');
(async()=>{
  const entries=localEntries().filter(e=>e.board.name!=='Socials');
  const account=auth.getProjectDefaultAccount(process.cwd());
  const token=account.tokens.expires_at>Date.now()+60000?account.tokens:await auth.getAccessToken(account.tokens.refresh_token,account.tokens.scopes||['https://www.googleapis.com/auth/cloud-platform']);
  const base='https://firestore.googleapis.com/v1/projects/rugatha-trello/databases/(default)/documents/';
  async function get(resource){
    const r=await fetch(base+resource,{headers:{Authorization:'Bearer '+token.access_token}});
    const data=await r.json();if(!r.ok)throw Error(`${r.status}: ${data.error?.message}`);return data;
  }
  const groups=new Map();
  for(const e of entries){const p=`workspaces/main/boards/trello-${e.board.id}/cards/${e.card.id}`;if(!groups.has(p))groups.set(p,[]);groups.get(p).push(e);}
  const summary={at:new Date().toISOString(),cards:groups.size,files:0,externalLinks:0,boards:{},errors:[]};
  async function verify([p,items]){
    const [card,attachments]=await Promise.all([get(p),get(p+'/attachments?pageSize=1000')]);
    if(attachments.nextPageToken)throw Error('Pagination required');
    const docs=attachments.documents||[];
    const active=docs.filter(d=>d.fields.archived?.booleanValue!==true).length;
    if(Number(card.fields.attachmentCount?.integerValue)!==active)summary.errors.push({path:p,reason:'attachmentCount mismatch'});
    for(const e of items){
      const f=docs.find(d=>d.name.endsWith('/'+e.attachment.id))?.fields;
      if(!f){summary.errors.push({path:p,id:e.attachment.id,reason:'missing attachment'});continue;}
      if(e.status==='downloaded'){
        if(f.storageBucket?.stringValue!=='rugatha-trello.firebasestorage.app'||!f.storagePath?.stringValue?.startsWith(p+'/attachments/')||!f.url?.stringValue?.startsWith('https://firebasestorage.googleapis.com/')||Number(f.size?.integerValue)!==e.size||f.migrationStatus?.stringValue!=='firebase_storage')summary.errors.push({path:p,id:e.attachment.id,reason:'storage metadata mismatch'});
        summary.files++;
      }else{
        if(f.url?.stringValue!==e.attachment.url)summary.errors.push({path:p,id:e.attachment.id,reason:'external URL changed'});
        summary.externalLinks++;
      }
      summary.boards[e.board.name]=(summary.boards[e.board.name]||0)+1;
    }
  }
  const queue=[...groups];let next=0;
  await Promise.all(Array.from({length:8},async()=>{while(next<queue.length)await verify(queue[next++]);}));
  fs.writeFileSync(path.resolve(__dirname,'../attachments_export/migration/verification.json'),JSON.stringify(summary,null,2));
  console.log(JSON.stringify(summary,null,2));
  if(summary.errors.length)process.exitCode=1;
})().catch(e=>{console.error(e.message);process.exitCode=1;});
