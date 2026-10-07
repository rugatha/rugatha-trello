// Defaults to a read-only plan. --apply uploads and patches existing attachment documents.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const auth = require('firebase-tools/lib/auth');
const project = 'rugatha-trello';
const bucket = `${project}.firebasestorage.app`;
const base = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
const backup = path.resolve(__dirname, '../attachments_export');
const reportDir = path.join(backup, 'migration');
const decode = v => v.stringValue ?? v.booleanValue ?? (v.integerValue !== undefined ? Number(v.integerValue) : v.doubleValue) ?? v.timestampValue ?? (v.arrayValue ? (v.arrayValue.values || []).map(decode) : v.mapValue ? fields(v.mapValue.fields || {}) : null);
const fields = data => Object.fromEntries(Object.entries(data).map(([k,v]) => [k,decode(v)]));
const encode = value => typeof value === 'boolean' ? {booleanValue:value} : typeof value === 'number' ? {integerValue:String(value)} : {stringValue:value};
function localEntries() {
  const entries = JSON.parse(fs.readFileSync(path.join(backup, 'trello-backup/manifest.json'))).attachments;
  const seen = new Set();
  return entries.map(entry => {
    const key = [entry.board.id,entry.card.id,entry.attachment.id].join('/');
    if (seen.has(key)) throw Error(`Duplicate manifest ID: ${key}`);
    seen.add(key);
    if (!['downloaded','external_link_saved'].includes(entry.status)) throw Error(`Incomplete backup: ${key}`);
    const file = fs.realpathSync(path.resolve(backup, entry.localPath));
    if (!file.startsWith(backup + path.sep)) throw Error(`Path outside backup: ${key}`);
    const data = fs.readFileSync(file);
    if (entry.status === 'downloaded' && data.length !== entry.attachment.bytes) throw Error(`Size mismatch: ${key}`);
    return {...entry,file,size:data.length,md5:crypto.createHash('md5').update(data).digest('base64')};
  });
}
async function main() {
  const allEntries = localEntries();
  const skipBoard = process.argv.find(a=>a.startsWith('--skip-board='))?.slice(13);
  const entries = allEntries.filter(e=>e.board.name!==skipBoard);
  const summary = {total:entries.length,files:entries.filter(e=>e.status==='downloaded').length,externalLinks:entries.filter(e=>e.status==='external_link_saved').length,bytes:entries.reduce((n,e)=>n+e.size,0)};
  console.log(JSON.stringify(summary));
  if (process.argv.includes('--local-only')) return;
  const account = auth.getProjectDefaultAccount(process.cwd());
  if (!account) throw Error('Run npx firebase login --reauth first.');
  let accessToken = account.tokens;
  async function request(url, options = {}, allow404 = false) {
    if (!accessToken || accessToken.expires_at < Date.now()+60000) accessToken = await auth.getAccessToken(account.tokens.refresh_token,account.tokens.scopes || ['https://www.googleapis.com/auth/cloud-platform']);
    const response = await fetch(url,{...options,headers:{Authorization:`Bearer ${accessToken.access_token}`,...options.headers}});
    if (response.status === 404 && allow404) return null;
    const data = await response.json();
    if (!response.ok) throw Error(`${response.status}: ${data.error?.message || 'API request failed'}`);
    return data;
  }
  async function list(resource) {
    const docs = []; let page;
    do {
      const q = new URLSearchParams({pageSize:'1000'});
      if (page) q.set('pageToken',page);
      const result = await request(`${base}/${resource}?${q}`);
      docs.push(...(result.documents || [])); page = result.nextPageToken;
    } while (page);
    return docs.map(doc=>({...doc,id:doc.name.split('/').at(-1),data:fields(doc.fields||{})}));
  }
  // Match stable IDs only; never attach a file based on a potentially duplicate title.
  function match(docs, id) {
    const found = docs.filter(d=>d.id===id || d.id===`trello_${id}` || d.id===`trello-${id}` || d.data.trelloId===id || d.data.sourceId===id || d.data.trello?.id===id);
    if (found.length>1) throw Error(`Ambiguous source ID: ${id}`);
    return found[0];
  }
  const boards = await list('workspaces/main/boards');
  const plans = [], unmatched = [], cache = new Map();
  for (const entry of entries) {
    const board = match(boards,entry.board.id);
    if (!board) {unmatched.push({board:entry.board.name,card:entry.card.id,attachment:entry.attachment.id,reason:'board missing'});continue;}
    const boardPath = `workspaces/main/boards/${board.id}`;
    if (!cache.has(boardPath)) cache.set(boardPath,await list(`${boardPath}/cards`));
    const card = match(cache.get(boardPath),entry.card.id);
    if (!card) {unmatched.push({board:entry.board.name,card:entry.card.id,attachment:entry.attachment.id,reason:'card missing'});continue;}
    const cardPath = `${boardPath}/cards/${card.id}`;
    if (!cache.has(cardPath)) cache.set(cardPath,await list(`${cardPath}/attachments`));
    const attachment = match(cache.get(cardPath),entry.attachment.id) || {id:entry.attachment.id,name:`projects/${project}/databases/(default)/documents/${cardPath}/attachments/${entry.attachment.id}`,data:{},isNew:true};
    plans.push({entry,card,attachment,cardPath});
  }
  fs.mkdirSync(reportDir,{recursive:true});
  const report = {...summary,at:new Date().toISOString(),matched:plans.length,unmatched,boards:boards.map(b=>({id:b.id,name:b.data.name})),applied:0};
  fs.writeFileSync(path.join(reportDir,'plan.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({...report,unmatched:unmatched.length,newAttachments:plans.filter(p=>p.attachment.isNew).length}));
  if (!process.argv.includes('--apply')) return;
  if (unmatched.length) throw Error('Resolve unmatched IDs before applying. See attachments_export/migration/plan.json.');
  await request(`https://storage.googleapis.com/storage/v1/b/${bucket}`);
  async function migrate({entry,card,attachment,cardPath}) {
    if (entry.status === 'external_link_saved') return; // Preserve actual external URLs.
    const storagePath = `${cardPath}/attachments/${entry.attachment.id}/${path.basename(entry.file)}`;
    const objectURL = `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(storagePath)}`;
    let object = await request(objectURL,{},true);
    if (!object) {
      const boundary = `migration_${crypto.randomUUID()}`;
      const metadata = {name:storagePath,contentType:entry.attachment.mimeType || 'application/octet-stream',md5Hash:entry.md5,metadata:{firebaseStorageDownloadTokens:crypto.randomUUID(),trelloBoardId:entry.board.id,trelloCardId:entry.card.id,trelloAttachmentId:entry.attachment.id}};
      const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${metadata.contentType}\r\n\r\n`),fs.readFileSync(entry.file),Buffer.from(`\r\n--${boundary}--\r\n`)]);
      object = await request(`https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=multipart&ifGenerationMatch=0`,{method:'POST',headers:{'Content-Type':`multipart/related; boundary=${boundary}`},body});
    }
    if (object.md5Hash!==entry.md5 || Number(object.size)!==entry.size) throw Error(`Remote checksum mismatch: ${storagePath}`);
    const downloadToken = object.metadata?.firebaseStorageDownloadTokens?.split(',')[0];
    if (!downloadToken) throw Error(`Missing download token: ${storagePath}`);
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`;
    // Verify the same unauthenticated URL the card UI uses, before updating Firestore.
    const download = await fetch(url);
    if (!download.ok || crypto.createHash('md5').update(Buffer.from(await download.arrayBuffer())).digest('base64')!==entry.md5) throw Error(`Download verification failed: ${storagePath}`);
    if (attachment.data.url===url && attachment.data.storagePath===storagePath) return;
    const patch = {url,storagePath,storageBucket:bucket,sourceUrl:attachment.data.sourceUrl||attachment.data.url||entry.attachment.url,type:object.contentType,size:entry.size,migrationStatus:'firebase_storage',external:false};
    if (attachment.isNew) Object.assign(patch,{id:entry.attachment.id,name:entry.attachment.name,archived:false,isUpload:true,trelloDate:entry.attachment.date});
    // Save the exact prior records locally; never log token-bearing URLs.
    const beforeFile = path.join(reportDir,`${entry.attachment.id}.before.json`);
    if (!fs.existsSync(beforeFile)) fs.writeFileSync(beforeFile,JSON.stringify({attachment,card},null,2),{flag:'wx',mode:0o600});
    await request(`${base}:commit`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({writes:[{update:{name:attachment.name,fields:Object.fromEntries(Object.entries(patch).map(([k,v])=>[k,encode(v)]))},updateMask:{fieldPaths:Object.keys(patch)},currentDocument:attachment.isNew?{exists:false}:{updateTime:attachment.updateTime}},{update:{name:card.name,fields:{updatedAt:{stringValue:new Date().toISOString()}}},updateMask:{fieldPaths:['updatedAt']},...(attachment.isNew?{updateTransforms:[{fieldPath:'attachmentCount',increment:{integerValue:'1'}}]}:{}),currentDocument:{exists:true}}]})});
    const verified = await request(`${base}/${cardPath}/attachments/${attachment.id}`);
    if (fields(verified.fields).url!==url) throw Error('Firestore verification failed');
    report.applied++;
    fs.writeFileSync(path.join(reportDir,'result.json'),JSON.stringify(report,null,2));
    console.log(`Verified ${report.applied}: ${entry.board.name} / ${entry.attachment.id}`);
  }
  let next = 0, failure;
  const workers = await Promise.allSettled(Array.from({length:4},async()=>{
    while(next<plans.length && !failure) {
      const item = plans[next++];
      try {await migrate(item);} catch(error) {failure=error;throw error;}
    }
  }));
  if (failure) throw failure;
  console.log(`Completed: ${report.applied} attachment links updated.`);
}
if (require.main===module) main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports = {localEntries};
