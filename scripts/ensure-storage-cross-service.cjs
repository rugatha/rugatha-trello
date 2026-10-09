// Read-only by default. --apply changes only the documented Storage service-agent grant.
'use strict';
const fs=require('node:fs'),auth=require('firebase-tools/lib/auth');
(async()=>{
 const account=auth.getProjectDefaultAccount(process.cwd());if(!account)throw Error('Firebase CLI login required');
 const token=account.tokens.expires_at>Date.now()+60000?account.tokens:await auth.getAccessToken(account.tokens.refresh_token,account.tokens.scopes);
 const base='https://cloudresourcemanager.googleapis.com/v1/projects/rugatha-trello';
 const role='roles/firebaserules.firestoreServiceAgent',member='serviceAccount:service-913221850736@gcp-sa-firebasestorage.iam.gserviceaccount.com';
 async function call(method,body){const r=await fetch(base+':'+method,{method:'POST',headers:{Authorization:'Bearer '+token.access_token,'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error?.message);return d;}
 const policy=await call('getIamPolicy',{options:{requestedPolicyVersion:3}});
 const present=policy.bindings?.some(b=>b.role===role&&!b.condition&&b.members.includes(member));
 if(!present&&process.argv.includes('--apply')){
  const directory='attachments_export/migration/storage-auth-cutover';fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(directory+'/iam-before-'+Date.now()+'.json',JSON.stringify(policy,null,2),{mode:0o600});
  let binding=policy.bindings.find(b=>b.role===role&&!b.condition);if(!binding){binding={role,members:[]};policy.bindings.push(binding);}binding.members.push(member);
  await call('setIamPolicy',{policy});
 }
 const check=await call('getIamPolicy',{options:{requestedPolicyVersion:3}});
 console.log(JSON.stringify({role,enabled:check.bindings.some(b=>b.role===role&&!b.condition&&b.members.includes(member))}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
