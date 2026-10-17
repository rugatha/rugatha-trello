// Apply a reviewed before-snapshot once; preserve member IDs, grants and assignability.
'use strict';
const fs=require('node:fs');
const {cloudClient,PROJECT}=require('./cloud-client.cjs');
async function main(){
 const [mode,file]=process.argv.slice(2);
 if(mode!=='--apply'||!file)throw Error('Usage: --apply private-before-snapshot.json');
 const plan=JSON.parse(fs.readFileSync(file,'utf8'));
 const prefix=`projects/${PROJECT}/databases/(default)/documents/workspaces/main/members/`;
 if(!Array.isArray(plan.members)||plan.members.some(m=>!m.name.startsWith(prefix)))throw Error('Invalid project or member snapshot');
 const changes=plan.members.filter(m=>['owner','admin'].includes(m.fields.role?.stringValue));
 if(!changes.some(m=>m.fields.role.stringValue==='owner'&&m.fields.status?.stringValue==='active'))throw Error('Must retain an active administrator');
 const request=await cloudClient(),writes=plan.members.map(m=>{
  if(!changes.includes(m))return {verify:m.name,currentDocument:{updateTime:m.updateTime}};
  const role=m.fields.role.stringValue==='owner'?'admin':'owner';
  return {update:{name:m.name,fields:{role:{stringValue:role}}},updateMask:{fieldPaths:['role']},currentDocument:{updateTime:m.updateTime}};
 });
 if(writes.length>500)throw Error('Plan exceeds single atomic commit limit');
 await request(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:commit`,{method:'POST',body:{writes}});
 for(const before of changes){
  const after=await request('https://firestore.googleapis.com/v1/'+before.name);
  if(after.fields.role.stringValue!==(before.fields.role.stringValue==='owner'?'admin':'owner'))throw Error('Role verification failed');
  for(const [key,value] of Object.entries(before.fields))if(key!=='role'&&JSON.stringify(value)!==JSON.stringify(after.fields[key]))throw Error('Unexpected member field change');
 }
 fs.writeFileSync(file+'.result.json',JSON.stringify({completedAt:new Date().toISOString(),membersChanged:changes.length}),{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({verified:changes.length,otherFieldsPreserved:true}));
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
