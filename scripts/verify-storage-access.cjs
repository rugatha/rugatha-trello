// Production Viewer probe preparation. Read-only unless --revoke or --restore is explicit.
'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),auth=require('firebase-tools/lib/auth');
const base='https://firestore.googleapis.com/v1/projects/rugatha-trello/databases/(default)/documents';
const folder='attachments_export/migration/storage-access-probe';
async function main(){
 const account=auth.getProjectDefaultAccount(process.cwd());if(!account)throw Error('Firebase CLI login required');
 const token=account.tokens.expires_at>Date.now()+60000?account.tokens:await auth.getAccessToken(account.tokens.refresh_token,account.tokens.scopes);
 async function request(url,body){const r=await fetch(url,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token.access_token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const d=await r.json();if(!r.ok)throw Error(d.error?.message||String(r.status));return d;}
 const reference=JSON.parse(fs.readFileSync('attachments_export/stage-one-audit/pending-member-before.json')).member;
 const member=await request('https://firestore.googleapis.com/v1/'+reference.name);
 if(member.fields.role.stringValue!=='viewer'||member.fields.status.stringValue!=='active')throw Error('Expected active test Viewer');
 fs.mkdirSync(folder,{recursive:true,mode:0o700});
 const backup=folder+'/before.json';
 if(process.argv.includes('--restore')){
  const saved=JSON.parse(fs.readFileSync(backup));assert.equal(member.name,saved.member.name);
  const expected=structuredClone(saved.member.fields);expected.accessboard.arrayValue.values=expected.accessboard.arrayValue.values.filter(v=>v.stringValue!==saved.boardId);
  assert.deepEqual(member.fields,expected,'Concurrent membership change: stop before restoring');
  await request(base+':commit',{writes:[{update:{name:member.name,fields:{accessboard:saved.member.fields.accessboard}},updateMask:{fieldPaths:['accessboard']},currentDocument:{updateTime:member.updateTime}}]});
  const restored=await request('https://firestore.googleapis.com/v1/'+member.name);assert.deepEqual(restored.fields,saved.member.fields);
  fs.writeFileSync(folder+'/restored.json',JSON.stringify({at:new Date().toISOString(),allFieldsMatch:true,member:restored},null,2),{mode:0o600});
  console.log(JSON.stringify({restored:true,allFieldsMatch:true}));return;
 }
 let selected;
 for(const value of member.fields.accessboard.arrayValue.values){
  const boardId=value.stringValue,board=await request(base+'/workspaces/main/boards/'+boardId);if(board.fields.archived?.booleanValue)continue;
  const cards=await request(base+'/workspaces/main/boards/'+boardId+':runQuery',{structuredQuery:{from:[{collectionId:'cards'}],where:{fieldFilter:{field:{fieldPath:'attachmentCount'},op:'GREATER_THAN',value:{integerValue:'0'}}},limit:8}});
  for(const row of cards){const card=row.document;if(!card||card.fields.archived?.booleanValue)continue;
   const attachments=await request('https://firestore.googleapis.com/v1/'+card.name+'/attachments?pageSize=1000');
   const image=attachments.documents?.find(a=>a.fields.storagePath?.stringValue&&/^image\//.test(a.fields.type?.stringValue));
   if(image){selected={boardId,boardName:board.fields.name?.stringValue||board.fields.title?.stringValue,storagePath:image.fields.storagePath.stringValue};break;}
  }
  if(selected)break;
 }
 if(!selected)throw Error('No authorized test image');
 if(process.argv.includes('--revoke')){
  fs.writeFileSync(backup,JSON.stringify({at:new Date().toISOString(),member,...selected},null,2),{mode:0o600,flag:'wx'});
  const accessboard=structuredClone(member.fields.accessboard);accessboard.arrayValue.values=accessboard.arrayValue.values.filter(v=>v.stringValue!==selected.boardId);
  await request(base+':commit',{writes:[{update:{name:member.name,fields:{accessboard}},updateMask:{fieldPaths:['accessboard']},currentDocument:{updateTime:member.updateTime}}]});
  const after=await request('https://firestore.googleapis.com/v1/'+member.name);assert.deepEqual(after.fields,{...member.fields,accessboard});
 }
 console.log(JSON.stringify({role:'viewer',...selected,revoked:process.argv.includes('--revoke')}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
