// Read-only plan by default. Creates new Socials documents without replacing existing data.
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {PROJECT,BUCKET,cloudClient}=require('./cloud-client.cjs');
const directory=path.resolve('attachments_export/socials-import');
const root=`projects/${PROJECT}/databases/(default)/documents`;
const api='https://firestore.googleapis.com/v1/';
const decode=v=>v.stringValue??v.booleanValue??(v.integerValue!==undefined?Number(v.integerValue):v.doubleValue)??v.timestampValue??(v.arrayValue?(v.arrayValue.values||[]).map(decode):v.mapValue?decodeFields(v.mapValue.fields||{}):null);
const decodeFields=f=>Object.fromEntries(Object.entries(f).map(([k,v])=>[k,decode(v)]));
const encode=v=>v===null?{nullValue:null}:Array.isArray(v)?{arrayValue:{values:v.map(encode)}}:typeof v==='object'?{mapValue:{fields:encodeFields(v)}}:typeof v==='boolean'?{booleanValue:v}:typeof v==='number'?{integerValue:String(v)}:{stringValue:v};
const encodeFields=f=>Object.fromEntries(Object.entries(f).map(([k,v])=>[k,encode(v)]));
const md5=b=>crypto.createHash('md5').update(b).digest('base64');
// Confirmed through matching Trello action IDs to existing Firestore comment authors.
const memberMap={'611b82610765664c5e11790f':'member-01','67ed1c98f431627f5ee9a805':'owner'};
const rank=i=>String(i).padStart(8,'0');
const sorted=a=>[...a].sort((x,y)=>x.pos-y.pos||x.id.localeCompare(y.id));
const canonical=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
function plan(){
 const sourceBytes=fs.readFileSync('import/socials-trello.json'),source=JSON.parse(sourceBytes);
 if(source.name!=='Socials'||source.id!=='67f015af195310d43826dd8c')throw Error('Unexpected source board');
 const boardId='trello-'+source.id,boardPath='workspaces/main/boards/'+boardId;
 const manifest=JSON.parse(fs.readFileSync('attachments_export/trello-backup/manifest.json')).attachments;
 const entries=new Map();for(const e of manifest.filter(e=>e.board.id===source.id)){const k=e.card.id+'/'+e.attachment.id;if(entries.has(k))throw Error('Duplicate manifest ID');entries.set(k,e);}
 const docs=[],files=[],missing=[],commentGaps=[];
 const put=(p,d)=>docs.push({name:root+'/'+p,fields:encodeFields(d)});
 const colors={yellow:'orange',red:'pink',sky:'blue',lime:'green',black:'purple'};
 const labelDefinitions=Object.fromEntries(source.labels.map(l=>{const color=(l.color||'purple').split('_')[0];return [l.id,{name:l.name||l.color||'標籤',color:colors[color]||color,trelloColor:l.color}];}));
 const lists=sorted(source.lists);lists.forEach((l,i)=>put(boardPath+'/columns/'+l.id,{id:l.id,name:l.name,archived:l.closed,trelloName:l.name,orderKey:rank(i)}));
 const cards=sorted(source.cards);
 cards.forEach((c,i)=>{
  if(!lists.some(l=>l.id===c.idList)||c.idMembers.length)throw Error('Unresolved list or assignee');
  const cardPath=boardPath+'/cards/'+c.id;
  const groups=sorted(source.checklists.filter(g=>g.idCard===c.id));
  if(groups.length!==c.idChecklists.length)throw Error('Missing checklist');
  const items=groups.flatMap(g=>sorted(g.checkItems).map(item=>({...item,group:g})));
  if(items.length!==c.badges.checkItems)throw Error('Checklist count mismatch');
  items.forEach((item,j)=>put(cardPath+'/checklist/'+item.id,{id:item.id,text:item.name,done:item.state==='complete',group:item.group.name,groupId:item.group.id,due:item.due,trelloMemberId:item.idMember,orderKey:rank(j)}));
  const comments=source.actions.filter(a=>['commentCard','copyCommentCard'].includes(a.type)&&a.data.card.id===c.id).sort((a,b)=>a.date.localeCompare(b.date));
  comments.forEach((a,j)=>{const author=a.data.idOriginalCommenter||a.idMemberCreator;const authorName=source.actions.find(x=>x.idMemberCreator===author&&x.memberCreator)?.memberCreator.fullName||'';put(cardPath+'/comments/'+a.id,{id:a.id,text:a.data.text,at:a.date,memberId:memberMap[author]||null,trelloMemberId:author,trelloAuthorName:authorName,orderKey:rank(j)});});
  if(comments.length!==c.badges.comments)commentGaps.push({cardId:c.id,title:c.name,expected:c.badges.comments,available:comments.length});
  sorted(c.attachments).forEach((a,j)=>{
   const e=entries.get(c.id+'/'+a.id);
   const d={id:a.id,name:a.name,type:a.mimeType||'application/octet-stream',size:a.bytes||0,archived:false,isUpload:a.isUpload,external:!a.isUpload,trelloDate:a.date,sourceUrl:a.url,orderKey:rank(j)};
   if(a.isUpload){
    let file;
    if(e?.status==='downloaded'){try{file=fs.realpathSync(path.resolve('attachments_export',e.localPath));}catch{}}
    if(file&&!file.startsWith(path.resolve('attachments_export/trello-backup')+path.sep))throw Error('Attachment path outside backup');
    if(file&&fs.statSync(file).size===a.bytes){
     const storagePath=cardPath+'/attachments/'+a.id+'/'+path.basename(file),data=fs.readFileSync(file);
     Object.assign(d,{storagePath,storageBucket:BUCKET,migrationStatus:'firebase_storage'});
     files.push({file,storagePath,size:data.length,md5:md5(data),type:d.type,attachmentId:a.id,cardId:c.id});
    }else{Object.assign(d,{url:a.url,migrationStatus:'missing_local_file'});missing.push({card:c.name,cardId:c.id,cardUrl:c.shortUrl,name:a.name,attachmentId:a.id,bytes:a.bytes,reason:e?'backup file missing or size mismatch':'not in backup manifest'});}
   }else Object.assign(d,{url:a.url,migrationStatus:'external_link_saved'});
   put(cardPath+'/attachments/'+a.id,d);
  });
  put(cardPath,{id:c.id,trelloId:c.id,title:c.name,columnId:c.idList,originalColumnId:c.idList,description:c.desc,labels:c.idLabels,assigneeIds:[],due:c.due||'',done:c.dueComplete,archived:c.closed,coverId:c.idAttachmentCover||null,createdAt:new Date(parseInt(c.id.slice(0,8),16)*1000).toISOString(),trelloUrl:c.url,trelloStart:c.start,trelloLastActivity:c.dateLastActivity,orderKey:rank(i),checklistCount:items.length,commentCount:comments.length,attachmentCount:c.attachments.length});
 });
 const board={name:root+'/'+boardPath,fields:encodeFields({id:boardId,trelloId:source.id,name:source.name,description:source.desc,color:'#455f56',archived:source.closed,starred:source.starred,orderKey:'z-socials',sourceFile:'socials-trello.json',trelloUrl:source.url,labelDefinitions,cardCount:cards.length})};
 const all=[board,...docs];if(new Set(all.map(d=>d.name)).size!==all.length)throw Error('Duplicate document ID');
 return {board,docs,files,missing,commentGaps,sourceSha256:crypto.createHash('sha256').update(sourceBytes).digest('hex'),summary:{cards:cards.length,columns:lists.length,checklist:source.checklists.reduce((n,c)=>n+c.checkItems.length,0),comments:docs.filter(d=>d.name.includes('/comments/')).length,attachments:files.length+missing.length,files:files.length,missing:missing.length,documents:all.length}};
}
async function main(){
 const p=plan();fs.mkdirSync(directory,{recursive:true,mode:0o700});
 fs.writeFileSync(directory+'/plan.json',JSON.stringify(p,null,2),{mode:0o600});
 fs.writeFileSync(directory+'/missing-attachments.md','# Socials 待補附件\n\n'+p.missing.map(m=>`- 牌卡：${m.card}\n  - 檔名：${m.name}\n  - 附件 ID：${m.attachmentId}\n  - 大小：${m.bytes} bytes\n  - 牌卡：${m.cardUrl}\n`).join('\n'),{mode:0o600});
 console.log(JSON.stringify({...p.summary,sourceCommentsExpected:p.commentGaps.reduce((n,c)=>n+c.expected-c.available,0)+p.summary.comments}));
 if(process.argv.includes('--local-only'))return;
 const rawRequest=await cloudClient();
 const request=async(...args)=>{for(let attempt=0;;attempt++){try{return await rawRequest(...args);}catch(e){if(attempt>=3||args[1]?.method&&args[1].method!=='GET')throw e;await new Promise(r=>setTimeout(r,1000*(attempt+1)));}}};
 async function list(parent){let pageToken,docs=[];do{const q=new URLSearchParams({pageSize:'1000'});if(pageToken)q.set('pageToken',pageToken);const r=await request(api+root+'/'+parent+'?'+q);docs.push(...(r.documents||[]));pageToken=r.nextPageToken;}while(pageToken);return docs;}
 async function current(){const found=[];const boardPath=p.board.name.slice(root.length+1);const boards=await list('workspaces/main/boards');const board=boards.find(b=>b.name===p.board.name);if(board)found.push(board);else if(boards.some(b=>decodeFields(b.fields).name==='Socials'))throw Error('Socials exists with different ID');
  const cards=await list(boardPath+'/cards');found.push(...await list(boardPath+'/columns'),...cards);
  for(let i=0;i<cards.length;i+=8)await Promise.all(cards.slice(i,i+8).map(async c=>{for(const k of ['checklist','comments','attachments'])found.push(...await list(c.name.slice(root.length+1)+'/'+k));}));return found;
 }
 let existing=await current();
 const expected=new Map([p.board,...p.docs].map(d=>[d.name,d]));
 const upgrades=new Map();
 function check(rows){for(const d of rows){const e=expected.get(d.name);if(e&&canonical(decodeFields(d.fields))===canonical(decodeFields(e.fields)))continue;
  const omit=f=>Object.fromEntries(Object.entries(f).filter(([k])=>!['url','migrationStatus','storagePath','storageBucket'].includes(k)));
  if(process.argv.includes('--complete-missing')&&e&&d.name.includes('/attachments/')&&d.fields.migrationStatus?.stringValue==='missing_local_file'&&e.fields.migrationStatus?.stringValue==='firebase_storage'&&canonical(decodeFields(omit(d.fields)))===canonical(decodeFields(omit(e.fields)))){upgrades.set(d.name,{update:e,currentDocument:{updateTime:d.updateTime}});continue;}
  throw Error('Existing document differs; refusing overwrite: '+d.name.split('/').at(-1));}}
 check(existing);
 const members=await list('workspaces/main/members');for(const d of p.docs.filter(d=>d.name.includes('/comments/')))if(!d.fields.memberId?.stringValue||!members.some(m=>m.name.split('/').at(-1)===d.fields.memberId.stringValue))throw Error('Unresolved comment author');const owners=members.filter(m=>m.fields.role?.stringValue==='owner'&&m.fields.status?.stringValue==='active');if(!owners.length)throw Error('Active owner missing');
 fs.writeFileSync(directory+'/before.json',JSON.stringify({existing,members:owners},null,2),{mode:0o600});
 if(!process.argv.includes('--apply')&&!process.argv.includes('--verify'))return;
 const objects=await request(`https://storage.googleapis.com/storage/v1/b/${BUCKET}/o?prefix=${encodeURIComponent(p.board.name.slice(root.length+1)+'/')}&maxResults=1000`);
 const objectMap=new Map((objects.items||[]).map(o=>[o.name,o]));
 let completed=0;
 for(let i=0;i<p.files.length;i+=4){await Promise.all(p.files.slice(i,i+4).map(async f=>{
  let object=objectMap.get(f.storagePath);
  if(!object){
   if(process.argv.includes('--verify'))throw Error('Storage object missing');
   const account=require('firebase-tools/lib/auth').getProjectDefaultAccount(process.cwd());
   const auth=require('firebase-tools/lib/auth');const token=await auth.getAccessToken(account.tokens.refresh_token,account.tokens.scopes);
   const boundary='socials_'+crypto.randomUUID(),metadata={name:f.storagePath,contentType:f.type,md5Hash:f.md5,cacheControl:'private, no-store',metadata:{trelloBoardId:'67f015af195310d43826dd8c',trelloCardId:f.cardId,trelloAttachmentId:f.attachmentId}};
   const body=Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${f.type}\r\n\r\n`),fs.readFileSync(f.file),Buffer.from(`\r\n--${boundary}--\r\n`)]);
   const r=await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${BUCKET}/o?uploadType=multipart&ifGenerationMatch=0`,{method:'POST',headers:{Authorization:'Bearer '+token.access_token,'Content-Type':'multipart/related; boundary='+boundary},body});if(!r.ok)throw Error('Storage upload HTTP '+r.status);object=await r.json();
  }
  if(object.md5Hash!==f.md5||Number(object.size)!==f.size||object.metadata?.firebaseStorageDownloadTokens)throw Error('Storage integrity or privacy mismatch');
  const bytes=await request(`https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encodeURIComponent(f.storagePath)}?alt=media&generation=${object.generation}`,{binary:true});if(md5(bytes)!==f.md5)throw Error('Download checksum mismatch');completed++;
 }));if(completed%20===0||completed===p.files.length)console.log(JSON.stringify({verifiedFiles:completed,total:p.files.length}));}
 console.log(JSON.stringify({verifiedFiles:completed}));
 if(process.argv.includes('--apply')){
  const names=new Set(existing.map(d=>d.name)),missing=p.docs.filter(d=>!names.has(d.name));
  const pending=[...missing.map(update=>({update,currentDocument:{exists:false}})),...upgrades.values()];
  for(let i=0;i<pending.length;i+=350)await request(api+root+':commit',{method:'POST',body:{writes:pending.slice(i,i+350)}});
  const writes=names.has(p.board.name)?[]:[{update:p.board,currentDocument:{exists:false}}];
  for(const m of owners){const access=decode(m.fields.accessboard)||[];const id=p.board.name.split('/').at(-1);if(!access.includes(id))writes.push({update:{name:m.name,fields:encodeFields({accessboard:[...access,id]})},updateMask:{fieldPaths:['accessboard']},currentDocument:{updateTime:m.updateTime}});}
  if(writes.length)await request(api+root+':commit',{method:'POST',body:{writes}});
 }
 existing=await current();check(existing);if(existing.some(d=>d.fields.migrationStatus?.stringValue==='missing_local_file'&&expected.get(d.name)?.fields.migrationStatus?.stringValue==='firebase_storage'))throw Error('Missing-file upgrade incomplete');if(existing.length!==expected.size)throw Error('Document count mismatch');
 const verifiedOwners=await list('workspaces/main/members');for(const m of owners)if(!decode(verifiedOwners.find(o=>o.name===m.name).fields.accessboard).includes(p.board.name.split('/').at(-1)))throw Error('Owner access missing');
 const result={...p.summary,verifiedFiles:completed,verifiedDocuments:existing.length,missing:p.missing,commentGaps:p.commentGaps,completedAt:new Date().toISOString(),sourceSha256:p.sourceSha256};fs.writeFileSync(directory+'/result.json',JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify({verifiedDocuments:existing.length,ownerAccess:true,missing:p.missing.length}));
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={plan};
