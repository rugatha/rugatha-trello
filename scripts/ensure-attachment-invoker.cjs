// Callable transport only. Firebase auth and workspace authorization remain mandatory in handlers.
// Read-only by default; --apply grants invocation to the two attachment callables only.
'use strict';
const fs=require('node:fs'),auth=require('firebase-tools/lib/auth');
(async()=>{
 const account=auth.getProjectDefaultAccount(process.cwd());if(!account)throw Error('Firebase CLI login required');
 const token=account.tokens.expires_at>Date.now()+60000?account.tokens:await auth.getAccessToken(account.tokens.refresh_token,account.tokens.scopes);
 const directory='attachments_export/migration/storage-auth-cutover';fs.mkdirSync(directory,{recursive:true,mode:0o700});
 for(const name of ['beginattachmentupload','finishattachmentupload']){
  const url=`https://run.googleapis.com/v2/projects/rugatha-trello/locations/asia-east1/services/${name}`;
  async function call(method,body){const r=await fetch(url+':'+method,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token.access_token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const d=await r.json();if(!r.ok)throw Error(d.error?.message);return d;}
  const policy=await call('getIamPolicy');
  const enabled=p=>p.bindings?.some(b=>b.role==='roles/run.invoker'&&!b.condition&&b.members.includes('allUsers'))||false;
  if(!enabled(policy)&&process.argv.includes('--apply')){
   fs.writeFileSync(`${directory}/${name}-iam-before-${Date.now()}.json`,JSON.stringify(policy,null,2),{mode:0o600});
   policy.bindings??=[];let binding=policy.bindings.find(b=>b.role==='roles/run.invoker'&&!b.condition);
   if(!binding){binding={role:'roles/run.invoker',members:[]};policy.bindings.push(binding);}binding.members.push('allUsers');
   await call('setIamPolicy',{policy});
  }
  console.log(JSON.stringify({service:name,callableInvocationEnabled:enabled(await call('getIamPolicy'))}));
 }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
