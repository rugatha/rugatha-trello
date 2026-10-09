// Read-only full child-collection comparison. Private snapshots stay in ignored backups.
const fs = require('node:fs');
const path = require('node:path');
const {isDeepStrictEqual} = require('node:util');
const {createHash} = require('node:crypto');
const collections = ['checklist', 'comments', 'attachments'];
const decode = v => v.stringValue ?? v.booleanValue ?? (v.integerValue !== undefined ? Number(v.integerValue) : v.doubleValue) ?? v.timestampValue ?? (v.arrayValue ? (v.arrayValue.values || []).map(decode) : v.mapValue ? fields(v.mapValue.fields || {}) : null);
const fields = f => Object.fromEntries(Object.entries(f).map(([k,v])=>[k,decode(v)]));
function compare(source, live) {
  const counts = Object.fromEntries(collections.map(k=>[k,{source:0,live:0,matched:0}]));
  const differences = [], additions = [], missingCards = [];
  const liveBoards = new Map(live.boards.map(b=>[b.id,b]));
  for (const board of source.boards) {
    const targetBoard=liveBoards.get(board.id);
    const cards=new Map((targetBoard?.cards || []).map(c=>[c.id,c]));
    for (const card of board.cards) {
      const target=cards.get(card.id), base=`${board.id}/${card.id}`;
      if (!target) missingCards.push(base);
      for (const kind of collections) {
        const originals=card[kind] || [], current=target?.[kind] || [];
        counts[kind].source+=originals.length;
        const byId=new Map(current.map(x=>[x.id,x]));
        for (const item of originals) {
          const found=byId.get(item.id), resource=`${base}/${kind}/${item.id}`;
          if (!found) { differences.push({path:resource,field:null,reason:'missing'}); continue; }
          let same=true;
          for (const [key,value] of Object.entries(item)) {
            // Migrated files retain the source URL; MIME/size/external are verified
            // against the migration backup by verify-trello-attachments.cjs.
            if (kind==='attachments' && found.migrationStatus==='firebase_storage' && ['type','size','external'].includes(key)) continue;
            const actual=kind==='attachments' && key==='url' ? (found.sourceUrl || found.url) : found[key];
            if (!isDeepStrictEqual(value,actual)) {same=false;differences.push({path:resource,field:key,reason:'changed'});}
          }
          if (same) counts[kind].matched++;
        }
      }
    }
  }
  const expected=new Set(source.boards.flatMap(b=>b.cards.flatMap(c=>collections.flatMap(k=>(c[k]||[]).map(x=>`${b.id}/${c.id}/${k}/${x.id}`)))));
  const countErrors=[];
  for (const b of live.boards) for (const c of b.cards) for (const k of collections) {
    counts[k].live+=c[k].length;
    for (const x of c[k]) {
      const resource=`${b.id}/${c.id}/${k}/${x.id}`;
      if (!expected.has(resource)) additions.push({path:resource,kind:k});
    }
    const field={checklist:'checklistCount',comments:'commentCount',attachments:'attachmentCount'}[k];
    const actual=k==='attachments'?c[k].filter(x=>!x.archived).length:c[k].length;
    if (c[field] !== undefined && c[field]!==actual) countErrors.push({path:`${b.id}/${c.id}`,field,stored:c[field],actual});
  }
  return {counts,missingCards,differences,additions,countErrors};
}
async function main() {
  if (process.argv.length>2) throw Error('This audit accepts no arguments and never writes cloud data.');
  const dir=path.resolve(__dirname,'../attachments_export/stage-one-audit');
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const sourcePath=path.join(dir,'source.json');
  if (!fs.existsSync(sourcePath)) throw Error('Private migration source missing: restore attachments_export/stage-one-audit/source.json from the private backup.');
  const sourceBytes=fs.readFileSync(sourcePath);
  const source=JSON.parse(sourceBytes);
  if (!Array.isArray(source.boards)) throw Error('Invalid private migration source: boards must be an array.');
  const sourceSha256=createHash('sha256').update(sourceBytes).digest('hex');
  const auth=require('firebase-tools/lib/auth'), account=auth.getProjectDefaultAccount(process.cwd());
  if (!account) throw Error('Firebase CLI login required.');
  const token=account.tokens.expires_at>Date.now()+60000?account.tokens:await auth.getAccessToken(account.tokens.refresh_token,account.tokens.scopes||['https://www.googleapis.com/auth/cloud-platform']);
  async function list(resource) {
    const rows=[];let page;
    do {
      const query=new URLSearchParams({pageSize:'1000'});if(page)query.set('pageToken',page);
      const r=await fetch('https://firestore.googleapis.com/v1/projects/rugatha-trello/databases/(default)/documents/'+resource+'?'+query,{headers:{Authorization:'Bearer '+token.access_token}});
      if(!r.ok)throw Error('Firestore read HTTP '+r.status);
      const data=await r.json();rows.push(...(data.documents||[]).map(d=>({...fields(d.fields||{}),id:d.name.split('/').at(-1),updateTime:d.updateTime})));page=data.nextPageToken;
    }while(page);return rows;
  }
  const boards=await list('workspaces/main/boards');
  for(const b of boards){
    const base=`workspaces/main/boards/${b.id}/cards`;b.cards=await list(base);
    for(let i=0;i<b.cards.length;i+=6)await Promise.all(b.cards.slice(i,i+6).map(async c=>{
      for(const k of collections)c[k]=await list(`${base}/${c.id}/${k}`);
    }));
  }
  const snapshot={at:new Date().toISOString(),boards};
  fs.writeFileSync(path.join(dir,'firestore.json'),JSON.stringify(snapshot),{mode:0o600});
  const {localEntries}=require('./migrate-trello-attachments.cjs');
  const entries=new Map(localEntries().filter(e=>e.board.name!=='Socials').map(e=>[`trello-${e.board.id}/${e.card.id}/attachments/${e.attachment.id}`,e]));
  const migrationErrors=[];
  for(const b of boards)for(const c of b.cards)for(const a of c.attachments){
    if(a.migrationStatus!=='firebase_storage')continue;
    const key=`${b.id}/${c.id}/attachments/${a.id}`,e=entries.get(key);
    if(!e || a.size!==e.size || a.type!==(e.attachment.mimeType||'application/octet-stream') || a.external!==false || a.sourceUrl!==e.attachment.url || a.storageBucket!=='rugatha-trello.firebasestorage.app' || a.storagePath!==`workspaces/main/boards/${b.id}/cards/${c.id}/attachments/${a.id}/${path.basename(e.file)}`) migrationErrors.push({path:key,reason:'migration-backup-mismatch'});
  }
  const report={at:snapshot.at,sourceFile:'source.json',sourceSha256,...compare(source,snapshot),migrationErrors};
  report.unexplainedAdditions=report.additions.filter(x=>!entries.has(x.path));
  fs.writeFileSync(path.join(dir,'comparison.json'),JSON.stringify(report,null,2),{mode:0o600});
  console.log(JSON.stringify(report,null,2));
  if(report.missingCards.length||report.differences.length||report.countErrors.length||report.migrationErrors.length||report.unexplainedAdditions.length)process.exitCode=1;
}
module.exports={compare};
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
