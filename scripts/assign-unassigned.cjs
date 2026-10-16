// Explicit one-time assignment with a private before-snapshot and server-version preconditions.
'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
const {cloudClient,PROJECT}=require('./cloud-client.cjs');
const base=`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const decode=v=>'stringValue'in v?v.stringValue:'booleanValue'in v?v.booleanValue:'arrayValue'in v?(v.arrayValue.values||[]).map(decode):null;
const field=(doc,key)=>doc.fields?.[key]?decode(doc.fields[key]):null;
async function list(request,path){const result=[];let token;do{const q=new URLSearchParams({pageSize:'1000'});if(token)q.set('pageToken',token);const page=await request(`${base}/${path}?${q}`);result.push(...(page.documents||[]));token=page.nextPageToken;}while(token);return result;}
async function main(){
 const [mode,file,name]=process.argv.slice(2);
 if(!['--check','--apply'].includes(mode)||!file||mode==='--check'&&!name)throw Error('Usage: --check /private/tmp/plan.json member-name | --apply /private/tmp/plan.json');
 const request=await cloudClient();
 if(mode==='--check'){
  const [members,boards]=await Promise.all([list(request,'workspaces/main/members'),list(request,'workspaces/main/boards')]);
  const matches=members.filter(m=>field(m,'name')===name&&field(m,'status')==='active');
  if(matches.length!==1)throw Error('Target member name must identify exactly one active member');
  const target=matches[0],targetId=target.name.split('/').at(-1),access=field(target,'accessboard')||[];
  const firebaseAuth=require('firebase-tools/lib/auth'),cli=firebaseAuth.getProjectDefaultAccount(process.cwd());
  const email=cli?.user?.email?.toLowerCase();if(!email)throw Error('CLI account email unavailable');
  const lookup=await request(`${base}/workspaces/main/memberLookup/${encodeURIComponent(email)}`);
  const actor=members.find(m=>m.name.split('/').at(-1)===field(lookup,'memberId'));
  if(!actor||field(actor,'status')!=='active'||!['owner','admin'].includes(field(actor,'role')))throw Error('CLI account must map to an active workspace manager');
  const actorAccess=field(actor,'accessboard')||[],changes=[],skipped=[];
  for(const board of boards){
   const id=board.name.split('/').at(-1),cards=await list(request,`workspaces/main/boards/${id}/cards`);
   const empty=cards.filter(c=>(field(c,'assigneeIds')||[]).length===0);
   if(!empty.length)continue;
   const reason=field(board,'deleting')?'board-deleting':!access.includes(id)?'target-without-board-access':!actorAccess.includes(id)?'actor-without-board-access':null;
   for(const card of empty){
    const blocked=reason||(field(card,'deleting')?'card-deleting':null);
    if(blocked)skipped.push({boardId:id,boardName:field(board,'name'),cardId:card.name.split('/').at(-1),reason:blocked});
    else changes.push({board,card});
   }
  }
  const plan={project:PROJECT,runId:crypto.randomUUID(),createdAt:new Date().toISOString(),target,actor,lookup,changes,skipped};
  fs.writeFileSync(file,JSON.stringify(plan),{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({memberId:targetId,name,cards:changes.length,archivedCards:changes.filter(x=>field(x.card,'archived')).length,boards:[...new Set(changes.map(x=>field(x.board,'name')))],skipped:skipped.reduce((r,x)=>(r[x.reason]=(r[x.reason]||0)+1,r),{})}));return;
 }
 const plan=JSON.parse(fs.readFileSync(file,'utf8'));if(plan.project!==PROJECT)throw Error('Wrong project');
 const targetId=plan.target.name.split('/').at(-1),actorId=plan.actor.name.split('/').at(-1),now=new Date().toISOString();
 let changed=0;
 for(let i=0;i<plan.changes.length;i+=100){
  const batch=plan.changes.slice(i,i+100),boardDocs=[...new Map(batch.map(x=>[x.board.name,x.board])).values()];
  const writes=[...boardDocs,plan.actor,plan.target,plan.lookup].map(doc=>({verify:doc.name,currentDocument:{updateTime:doc.updateTime}}));
  for(const {card,board} of batch){
   const cardId=card.name.split('/').at(-1),boardId=board.name.split('/').at(-1);
   writes.push({update:{name:card.name,fields:{assigneeIds:{arrayValue:{values:[{stringValue:targetId}]}},updatedAt:{stringValue:now},updatedBy:{stringValue:actorId}}},updateMask:{fieldPaths:['assigneeIds','updatedAt','updatedBy']},currentDocument:{updateTime:card.updateTime}});
   const notificationId='assignment-'+crypto.createHash('sha256').update(plan.runId+card.name).digest('hex');
   writes.push({update:{name:plan.target.name+'/notifications/'+notificationId,fields:Object.fromEntries(Object.entries({type:'assignment',actorId,actorName:field(plan.actor,'name'),boardId,cardId,cardTitle:field(card,'title'),createdAt:now}).map(([key,value])=>[key,{stringValue:value}]).concat([['read',{booleanValue:false}]]))},currentDocument:{exists:false}});
  }
  await request(base+':commit',{method:'POST',body:{writes}});changed+=batch.length;
  fs.writeFileSync(file+'.progress.json',JSON.stringify({changed,total:plan.changes.length}),{mode:0o600});
 }
 let verified=0;
 for(const boardId of new Set(plan.changes.map(x=>x.board.name.split('/').at(-1)))){
  const after=await list(request,`workspaces/main/boards/${boardId}/cards`);
  for(const {card} of plan.changes.filter(x=>x.board.name.endsWith('/'+boardId))){
   const live=after.find(x=>x.name===card.name);if(JSON.stringify(field(live,'assigneeIds'))!==JSON.stringify([targetId]))throw Error('Assignment verification failed');
   for(const [key,value] of Object.entries(card.fields||{}))if(!['assigneeIds','updatedAt','updatedBy'].includes(key)&&JSON.stringify(value)!==JSON.stringify(live.fields[key]))throw Error('Unexpected content change during assignment verification');
   verified++;
  }
 }
 console.log(JSON.stringify({changed,verified,skipped:plan.skipped.length,member:field(plan.target,'name')}));
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
