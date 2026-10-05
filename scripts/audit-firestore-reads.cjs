// Read-only measurement using an existing Firebase CLI admin login.
// node --experimental-vm-modules scripts/audit-firestore-reads.cjs [baseline-ref]
// Counts returned documents and empty results, not authoritative billing usage.
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const auth=require('firebase-tools/lib/auth');
const project='rugatha-trello';
const baselineRef=process.argv[2]||'88eab0574749f210a394b6effadf36b2ad70cc36';
const base=`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/`;
const decode=v=>v.stringValue??v.booleanValue??(v.integerValue!==undefined?Number(v.integerValue):v.doubleValue)??v.timestampValue??(v.arrayValue?(v.arrayValue.values||[]).map(decode):v.mapValue?fields(v.mapValue.fields||{}):null);
const fields=data=>Object.fromEntries(Object.entries(data).map(([k,v])=>[k,decode(v)]));
(async()=>{
 const account=auth.getProjectDefaultAccount(process.cwd());
 if(!account)throw Error('Sign in with Firebase CLI first.');
 const token=await auth.getAccessToken(account.tokens.refresh_token,account.tokens.scopes||['https://www.googleapis.com/auth/cloud-platform']);
 async function get(resource){
  const response=await fetch(base+resource,{headers:{Authorization:'Bearer '+token.access_token}});
  const data=await response.json();if(!response.ok)throw Error(response.status+' '+data.error?.message);return data;
 }
 const lookup=await get('workspaces/main/memberLookup/'+encodeURIComponent(account.user.email));
 const member=fields((await get('workspaces/main/members/'+lookup.fields.memberId.stringValue)).fields);
 const {documents,changes}=await import('../workspace-data.js');
 const {compareOrderKey}=await import('../order-key.js');
 const results=[];
 for(const mode of ['baseline','optimized']){
  const stats={};
  function record(resource,count){const type=resource.split('/').filter(Boolean).at(-1);const group=['cards','columns','attachments','comments','checklist'].includes(type)?type:'board';const s=stats[group]??={requests:0,documents:0,emptyResults:0};s.requests++;s.documents+=count;if(!count)s.emptyResults++;}
  const deps={firestore:{},documents,changes,compareOrderKey,collection:(_,p)=>p,doc:(_,p)=>p,
   getDocFromServer:async p=>{const d=await get(p);record(p,1);return {exists:()=>true,data:()=>fields(d.fields||{})};},
   getDocsFromServer:async p=>{const docs=[];let page;do{const q=new URLSearchParams({pageSize:'1000'});if(page)q.set('pageToken',page);const d=await get(p+'?'+q);docs.push(...(d.documents||[]));page=d.nextPageToken;}while(page);record(p,docs.length);return {docs:docs.map(d=>({id:d.name.split('/').at(-1),data:()=>fields(d.fields||{})}))};},
   onSnapshot:()=>{throw Error('Audit does not open listeners');},runTransaction:()=>{throw Error('Audit never writes');}
  };
  const context=vm.createContext({console});
  const source=mode==='baseline'?execFileSync('git',['show',baselineRef+':storage.js'],{encoding:'utf8'}):fs.readFileSync(path.join(__dirname,'../storage.js'),'utf8');
  const mod=new vm.SourceTextModule(source,{context});
  await mod.link(()=>new vm.SyntheticModule(Object.keys(deps),function(){for(const [k,v]of Object.entries(deps))this.setExport(k,v)},{context}));await mod.evaluate();
  const start=Date.now();const state=await mod.namespace.loadWorkspace({accessboard:member.accessboard,roster:[]});
  const totals=()=>Object.values(stats).reduce((a,s)=>({requests:a.requests+s.requests,documents:a.documents+s.documents,emptyResults:a.emptyResults+s.emptyResults}),{requests:0,documents:0,emptyResults:0});
  const result={mode,elapsedMs:Date.now()-start,boards:state.boards.length,cards:state.boards.reduce((n,b)=>n+b.cards.length,0),stats:structuredClone(stats),totals:totals()};
  if(mode==='optimized'){
   result.deferredByBoard=state.boards.map(b=>({name:b.name,cards:b.cards.filter(c=>c.attachmentArchiveLoaded===false).length}));
   const selected=state.boards.find(b=>b.name==='3D');
   if(selected){const before=totals();const archived=await mod.namespace.loadDeferredAttachmentArchives(selected);const after=totals();result.open3DArchive={requests:after.requests-before.requests,documents:after.documents-before.documents,emptyResults:after.emptyResults-before.emptyResults,archivedAttachments:archived.reduce((n,c)=>n+c.files.length,0)};}
  }
  results.push(result);console.error(mode+' complete: '+JSON.stringify(result.totals));
 }
 console.log(JSON.stringify({at:new Date().toISOString(),project,baselineRef,notes:'Admin REST server reads; excludes member lookup (2 reads), subscriptions, security-rule dependent reads, retries and billing reconciliation. Baseline is the specified git ref; sequential runs may observe concurrent changes.',results},null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1});
