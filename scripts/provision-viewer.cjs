// Provision the shared password-only Viewer. Supply the password through the environment.
'use strict';
const assert=require('node:assert/strict');
const {PROJECT,cloudClient}=require('./cloud-client.cjs');
const EMAIL='viewer@rugatha-trello.invalid',MEMBER='shared-viewer';
(async()=>{
  assert(['--check','--apply'].includes(process.argv[2]),'Use --check or --apply');
  const apply=process.argv[2]==='--apply',request=await cloudClient();
  const configUrl=`https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT}/config`;
  const base=`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
  const authBase=`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts`;
  const config=await request(configUrl);
  const boards=[];let page='';
  do {
    const result=await request(`${base}/workspaces/main/boards?pageSize=100${page?'&pageToken='+encodeURIComponent(page):''}`);
    boards.push(...(result.documents||[]));page=result.nextPageToken;
  }while(page);
  assert(boards.length && boards.length<=200,'Unexpected board count');
  const existing=await request(authBase+':lookup',{method:'POST',body:{email:[EMAIL]}});
  assert(!existing.users?.length,'Viewer auth account already exists; do not overwrite credentials');
  const memberName=`projects/${PROJECT}/databases/(default)/documents/workspaces/main/members/${MEMBER}`;
  const lookupName=`projects/${PROJECT}/databases/(default)/documents/workspaces/main/memberLookup/${EMAIL}`;
  // Batch-get distinguishes missing documents from permission/network failures.
  const docs=await request(base+':batchGet',{method:'POST',body:{documents:[memberName,lookupName]}});
  assert(Array.isArray(docs)&&docs.length===2&&docs.every(d=>d.missing),'Viewer membership already exists');
  console.log(JSON.stringify({apply,boards:boards.length,passwordProviderEnabled:config.signIn?.email?.enabled===true,memberId:MEMBER}));
  if(!apply)return;
  const password=process.env.VIEWER_INITIAL_PASSWORD;
  assert(typeof password==='string'&&password.length>=8,'VIEWER_INITIAL_PASSWORD is required');
  // Rules must already enforce readOnly before this account is activated.
  if(!config.signIn?.email?.enabled || !config.signIn?.email?.passwordRequired)
    await request(configUrl+'?updateMask=signIn.email.enabled,signIn.email.passwordRequired',{method:'PATCH',body:{name:`projects/${PROJECT}/config`,signIn:{email:{enabled:true,passwordRequired:true}}}});
  const user=await request(authBase,{method:'POST',body:{localId:MEMBER,email:EMAIL,emailVerified:true,password,displayName:'Viewer',disabled:true}});
  assert.equal(user.localId,MEMBER);
  const str=stringValue=>({stringValue});
  const fields={name:str('Viewer'),emails:{arrayValue:{values:[str(EMAIL)]}},role:str('viewer'),status:str('active'),readOnly:{booleanValue:true},allBoards:{booleanValue:true},assignable:{booleanValue:false},accessboard:{arrayValue:{values:boards.map(b=>str(b.name.split('/').at(-1)))}},createdAt:{timestampValue:new Date().toISOString()},createdBy:str('owner')};
  await request(base+':commit',{method:'POST',body:{writes:[
    {update:{name:memberName,fields},currentDocument:{exists:false}},
    {update:{name:lookupName,fields:{memberId:str(MEMBER)}},currentDocument:{exists:false}},
    ...boards.map(b=>({verify:b.name,currentDocument:{updateTime:b.updateTime}}))
  ]}});
  await request(authBase+':update',{method:'POST',body:{localId:MEMBER,disableUser:false}});
  const member=await request(`${base}/workspaces/main/members/${MEMBER}`);
  assert.deepEqual(member.fields,fields);
  console.log(JSON.stringify({created:true,memberId:MEMBER,role:'viewer',readOnly:true,boards:boards.length}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
