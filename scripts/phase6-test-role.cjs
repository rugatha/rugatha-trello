// Only run after explicit consent for this temporary real-account role test.
'use strict';
const fs=require('node:fs'),path=require('node:path'),{isDeepStrictEqual}=require('node:util');
const {PROJECT,cloudClient}=require('./cloud-client.cjs');
(async()=>{
 const role=process.argv[2];if(!['pending','member','viewer','editor','admin','disabled','revoked','first-member','restore'].includes(role))throw Error('Specify test phase');
 const folders=fs.readdirSync('attachments_export/maintenance').filter(x=>x.startsWith('unlisted-')).sort();const folder=path.join('attachments_export/maintenance',folders.at(-1));
 const before=JSON.parse(fs.readFileSync(path.join(folder,'before.json'),'utf8')),request=await cloudClient();
 if(before.member.fields.role.stringValue==='owner')throw Error('Refusing Owner test');
 const base='https://firestore.googleapis.com/v1/',current=await request(base+before.member.name);
 const boards=await request(base+`projects/${PROJECT}/databases/(default)/documents/workspaces/main/boards?pageSize=100`);
 const testBoard=boards.documents.find(d=>d.fields.name?.stringValue==='階段六驗證 20261010');if(!testBoard)throw Error('Isolated board required');
 const boardId=testBoard.name.split('/').at(-1),fields=structuredClone(current.fields);
 if(role==='restore'){
  // Leave the requested account outside the list; historical data returns exactly to its backup.
  let lookup;try{lookup=await request(base+before.lookup.name);}catch(e){if(!e.message.includes('HTTP 404'))throw e;}
  const writes=[{update:{name:before.member.name,fields:before.member.fields},currentDocument:{updateTime:current.updateTime}}];
  if(lookup)writes.push({delete:lookup.name,currentDocument:{updateTime:lookup.updateTime}});
  await request(base+`projects/${PROJECT}/databases/(default)/documents:commit`,{method:'POST',body:{writes}});
  const restored=await request(base+before.member.name);if(!isDeepStrictEqual(restored.fields,before.member.fields))throw Error('Restore mismatch');
  try{await request(base+before.lookup.name);throw Error('Lookup remains');}catch(e){if(!e.message.includes('HTTP 404'))throw e;}
  console.log(JSON.stringify({phase:role,lookupAbsent:true,historicalMemberUnchanged:true}));return;
 }
 fields.role={stringValue:['pending','disabled','revoked','first-member'].includes(role)?'viewer':role};fields.status={stringValue:role==='pending'?'pending':role==='disabled'?'disabled':'active'};
 fields.accessboard={arrayValue:{values:role==='revoked'?[]:[{stringValue:boardId}]}};
 let lookup;try{lookup=await request(base+before.lookup.name);}catch(e){if(!e.message.includes('HTTP 404'))throw e;}
 if(role==='first-member')fields.name={stringValue:''};
 const writes=[{update:{name:before.member.name,fields},updateMask:{fieldPaths:['role','status','accessboard',...(role==='first-member'?['name']:[])]},currentDocument:{updateTime:current.updateTime}}];
 if(!lookup)writes.push({update:{name:before.lookup.name,fields:before.lookup.fields},currentDocument:{exists:false}});
 await request(base+`projects/${PROJECT}/databases/(default)/documents:commit`,{method:'POST',body:{writes}});
 const after=await request(base+before.member.name);for(const key of ['role','status','accessboard'])if(!isDeepStrictEqual(after.fields[key],fields[key]))throw Error('Phase not confirmed');
 console.log(JSON.stringify({phase:role,isolatedBoardId:boardId,fieldsConfirmed:true}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
