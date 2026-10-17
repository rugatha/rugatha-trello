// Explicit maintenance request: set only empty deadlines, backed up and guarded by document versions.
'use strict';
const fs=require('node:fs');
const {cloudClient,PROJECT}=require('./cloud-client.cjs');
const base=`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const targets=[{name:'2027 長團',due:'2026-07-28'},{name:'Illustration',due:'2026-07-09'}];
const normalize=value=>String(value).replace(/\s/g,'');
const field=(doc,key)=>{const value=doc?.fields?.[key];return value?.stringValue??value?.booleanValue??(value?.arrayValue?(value.arrayValue.values||[]).map(v=>v.stringValue):null);};
async function list(request,path){const rows=[];let token;do{const q=new URLSearchParams({pageSize:'1000'});if(token)q.set('pageToken',token);const page=await request(`${base}/${path}?${q}`);rows.push(...(page.documents||[]));token=page.nextPageToken;}while(token);return rows;}
async function main(){
 const [mode,file]=process.argv.slice(2);if(!['--check','--apply'].includes(mode)||!file||process.argv.length!==4)throw Error('Usage: --check|--apply private-plan.json');
 const request=await cloudClient();
 if(mode==='--check'){
  const [members,boards]=await Promise.all([list(request,'workspaces/main/members'),list(request,'workspaces/main/boards')]);
  const auth=require('firebase-tools/lib/auth'),cli=auth.getProjectDefaultAccount(process.cwd());
  const email=cli?.user?.email?.toLowerCase();if(!email)throw Error('CLI account email unavailable');
  const lookup=await request(`${base}/workspaces/main/memberLookup/${encodeURIComponent(email)}`);
  const actor=members.find(m=>m.name.split('/').at(-1)===field(lookup,'memberId'));
  if(!actor||field(actor,'status')!=='active'||!['owner','admin'].includes(field(actor,'role')))throw Error('An active workspace manager is required');
  const groups=[];
  for(const target of targets){
   const matches=boards.filter(board=>normalize(field(board,'name'))===normalize(target.name));
   if(matches.length!==1)throw Error('Board name must resolve uniquely: '+target.name);
   const board=matches[0],boardId=board.name.split('/').at(-1);
   if(!(field(actor,'accessboard')||[]).includes(boardId)||field(board,'deleting'))throw Error('Board inaccessible or deleting: '+target.name);
   if(field(board,'archived')&&field(actor,'role')!=='admin')throw Error('Archived board maintenance requires Admin');
   const cards=await list(request,`workspaces/main/boards/${boardId}/cards`);
   const changes=cards.filter(card=>[null,''].includes(field(card,'due'))&&!field(card,'deleting'));
   groups.push({...target,board,changes,preserved:cards.filter(card=>![null,''].includes(field(card,'due'))),deleting:cards.filter(card=>field(card,'deleting')).length});
  }
  fs.writeFileSync(file,JSON.stringify({project:PROJECT,createdAt:new Date().toISOString(),actor,lookup,groups}),{mode:0o600,flag:'wx'});
  console.log(JSON.stringify(groups.map(g=>({board:field(g.board,'name'),due:g.due,toUpdate:g.changes.length,archivedCards:g.changes.filter(c=>field(c,'archived')).length,preserveExisting:g.preserved.length,deleting:g.deleting}))));return;
 }
 const plan=JSON.parse(fs.readFileSync(file,'utf8'));if(plan.project!==PROJECT||plan.groups.length!==targets.length)throw Error('Wrong project or targets');
 const actorId=plan.actor.name.split('/').at(-1),updatedAt=new Date().toISOString(),results=[];
 for(const group of plan.groups){
  const target=targets.find(t=>t.name===group.name&&t.due===group.due);if(!target)throw Error('Unexpected deadline target');
  let changed=0;
  for(let start=0;start<group.changes.length;start+=100){
   const cards=group.changes.slice(start,start+100);
   if(cards.some(c=>![null,''].includes(field(c,'due'))||!c.name.startsWith(group.board.name+'/cards/')))throw Error('Plan contains an existing deadline or invalid card');
   const writes=[plan.actor,plan.lookup,group.board].map(doc=>({verify:doc.name,currentDocument:{updateTime:doc.updateTime}}));
   writes.push(...cards.map(card=>({update:{name:card.name,fields:{due:{stringValue:target.due},updatedAt:{stringValue:updatedAt},updatedBy:{stringValue:actorId}}},updateMask:{fieldPaths:['due','updatedAt','updatedBy']},currentDocument:{updateTime:card.updateTime}})));
   await request(base+':commit',{method:'POST',body:{writes}});changed+=cards.length;
   fs.writeFileSync(file+'.progress.json',JSON.stringify({completed:results,currentBoard:group.name,changed}),{mode:0o600});
  }
  const after=await list(request,`workspaces/main/boards/${group.board.name.split('/').at(-1)}/cards`);
  let verified=0;
  for(const before of group.changes){
   const live=after.find(card=>card.name===before.name);if(field(live,'due')!==target.due)throw Error('Deadline verification failed');
   const strip=fields=>Object.fromEntries(Object.entries(fields||{}).filter(([key])=>!['due','updatedAt','updatedBy'].includes(key)).sort(([a],[b])=>a.localeCompare(b)));
   if(JSON.stringify(strip(live.fields))!==JSON.stringify(strip(before.fields)))throw Error('Other card fields changed during verification');verified++;
  }
  for(const before of group.preserved){if(JSON.stringify(after.find(c=>c.name===before.name)?.fields.due)!==JSON.stringify(before.fields.due))throw Error('An existing deadline changed concurrently');}
  results.push({board:field(group.board,'name'),due:target.due,changed,verified,preserved:group.preserved.length,remainingWithoutDeadline:after.filter(c=>[null,''].includes(field(c,'due'))&&!field(c,'deleting')).length});
 }
 fs.writeFileSync(file+'.result.json',JSON.stringify(results),{mode:0o600});console.log(JSON.stringify(results));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
