// Explicitly requested removal of one login lookup; historical member data is preserved.
'use strict';
const fs=require('node:fs'),{isDeepStrictEqual}=require('node:util');const {PROJECT,cloudClient}=require('./cloud-client.cjs');
(async()=>{
 if(!process.argv.includes('--apply'))throw Error('Pass --apply only after explicit authorization for the configured email');
 const email=process.env.TEST_ACCOUNT_EMAIL?.trim().toLowerCase(),request=await cloudClient();
 if(!email || !/^[^@]+@[^@]+\.[^@]+$/.test(email))throw Error('TEST_ACCOUNT_EMAIL is required');
 const name=`projects/${PROJECT}/databases/(default)/documents/workspaces/main/memberLookup/${email}`;
 const lookup=await request('https://firestore.googleapis.com/v1/'+name);
 const member=await request(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/workspaces/main/members/${lookup.fields.memberId.stringValue}`);
 if(member.fields.role?.stringValue==='owner')throw Error('Refusing to remove an Owner login without a separate access review');
 const folder='attachments_export/maintenance/unlisted-'+Date.now();fs.mkdirSync(folder,{recursive:true,mode:0o700});
 fs.writeFileSync(folder+'/before.json',JSON.stringify({lookup,member},null,2),{mode:0o600,flag:'wx'});
 await request(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:commit`,{method:'POST',body:{writes:[{delete:name,currentDocument:{updateTime:lookup.updateTime}}]}});
 let missing=false;try{await request('https://firestore.googleapis.com/v1/'+name);}catch(e){if(e.message.includes('HTTP 404'))missing=true;else throw e;}
 if(!missing)throw Error('Lookup removal not confirmed');
 const after=await request('https://firestore.googleapis.com/v1/'+member.name);
 if(!isDeepStrictEqual(after.fields,member.fields))throw Error('Historical member fields changed');
 console.log(JSON.stringify({lookupAbsent:true,historicalMemberUnchanged:true,backup:folder+'/before.json'}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
