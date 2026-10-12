// Apply an explicitly approved roster to existing members; private inputs stay outside Git.
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PROJECT,cloudClient}=require('./cloud-client.cjs');
function csv(text){
  // Some spreadsheet exports contain literal CRLF separators.
  text=text.replace(/^\uFEFF/,'');
  if(!text.includes('\n') && text.includes('\\r\\n'))text=text.replaceAll('\\r\\n','\r\n');
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='"'){if(quoted && text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
    else if(!quoted && c===','){row.push(cell);cell='';}
    else if(!quoted && (c==='\n'||c==='\r')){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell='';}
    else cell+=c;
  }
  assert(!quoted,'Unclosed CSV quote');
  if(cell||row.length){row.push(cell);rows.push(row);}
  return rows;
}
const ids=d=>(d.fields.accessboard?.arrayValue?.values||[]).map(v=>v.stringValue).sort();
const emails=d=>(d.fields.emails?.arrayValue?.values||[]).map(v=>v.stringValue).sort();
(async()=>{
  const [input,baselineFile,mode]=process.argv.slice(2);
  assert(input&&baselineFile&&['--check','--apply'].includes(mode),'Usage: input.csv baseline.json --check|--apply');
  const baseline=JSON.parse(fs.readFileSync(baselineFile,'utf8'));
  assert.equal(baseline.project,PROJECT);
  const [header,...rows]=csv(fs.readFileSync(input,'utf8'));
  assert.deepEqual(header.slice(0,5),['member_id','姓名','電子郵件','角色','狀態']);
  const boardIds=header.slice(5).map(h=>{const m=h.match(/\[(trello-[a-f0-9]+)\]$/);assert(m,'Invalid board header');return m[1];});
  assert.equal(new Set(boardIds).size,boardIds.length);
  assert.deepEqual([...boardIds].sort(),baseline.boards.map(b=>b.id).sort());
  assert.equal(rows.length,baseline.members.length);
  assert.equal(new Set(rows.map(r=>r[0])).size,rows.length,'Duplicate member');
  const request=await cloudClient(),base=`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
  async function list(collection){const docs=[];let page='';do{const r=await request(`${base}/workspaces/main/${collection}?pageSize=100${page?'&pageToken='+encodeURIComponent(page):''}`);docs.push(...(r.documents||[]));page=r.nextPageToken;}while(page);return docs;}
  const [members,boards,lookups]=await Promise.all(['members','boards','memberLookup'].map(list));
  assert.deepEqual(members.map(d=>d.name).sort(),baseline.members.map(d=>d.name).sort(),'Member list changed');
  for(const old of baseline.members){const live=members.find(d=>d.name===old.name);assert.equal(live.updateTime,old.updateTime,'Member version changed: '+old.name.split('/').at(-1));assert.deepEqual(live.fields,old.fields);}
  for(const b of baseline.boards){const live=boards.find(d=>d.name.split('/').at(-1)===b.id);assert(live&&!live.fields.deleting?.booleanValue,'Board missing or deleting');assert.equal(live.updateTime,b.updateTime,'Board version changed');}
  const changes=[],desired=new Map();
  for(const row of rows){
    assert.equal(row.length,header.length);
    const [id,name,email,role,status,...flags]=row;
    const live=members.find(d=>d.name.split('/').at(-1)===id);assert(live,'Unknown member');
    assert.equal(name,live.fields.name.stringValue,'Name change requires separate identity review');
    assert.deepEqual(email?email.split(';').sort():[],emails(live),'Email change requires separate identity review');
    assert(['owner','admin','editor','viewer','member'].includes(role),'Invalid role');
    assert(['active','pending','disabled','unlinked'].includes(status),'Invalid status');
    assert(flags.every(v=>v==='0'||v==='1'),'Access flags must be 0 or 1');
    if(status==='unlinked')assert.equal(emails(live).length,0);
    if(status==='active')assert(emails(live).length,'Active member requires linked email');
    const accessboard=boardIds.filter((_,i)=>flags[i]==='1').sort();
    desired.set(live.name,{role,status,accessboard});
    if(role!==live.fields.role.stringValue || status!==live.fields.status.stringValue || JSON.stringify(accessboard)!==JSON.stringify(ids(live)))changes.push({id,live,role,status,accessboard});
  }
  assert([...desired.values()].some(d=>d.role==='owner'&&d.status==='active'),'Must retain active Owner');
  const summary={members:members.length,boards:boardIds.length,changedMembers:changes.length,roleChanges:changes.filter(c=>c.role!==c.live.fields.role.stringValue).map(c=>c.id),grants:[...desired.values()].reduce((n,d)=>n+d.accessboard.length,0),changes:changes.map(c=>({id:c.id,role:c.role,status:c.status,added:c.accessboard.filter(b=>!ids(c.live).includes(b)),removed:ids(c.live).filter(b=>!c.accessboard.includes(b))}))};
  if(mode==='--check'){console.log(JSON.stringify(summary,null,2));return;}
  const folder=path.join('attachments_export/maintenance','member-permissions-'+new Date().toISOString().replaceAll(':','-'));
  fs.mkdirSync(folder,{recursive:true,mode:0o700});
  const save=(name,value)=>fs.writeFileSync(path.join(folder,name),JSON.stringify(value,null,2)+'\n',{mode:0o600});
  save('before.json',{members,boards,lookups});save('plan.json',summary);
  const now=new Date().toISOString();
  const changedNames=new Set(changes.map(c=>c.live.name));
  const writes=changes.map(c=>({update:{name:c.live.name,fields:{role:{stringValue:c.role},status:{stringValue:c.status},accessboard:{arrayValue:{values:c.accessboard.map(stringValue=>({stringValue}))}},updatedBy:{stringValue:'owner'},updatedAt:{timestampValue:now}}},updateMask:{fieldPaths:['role','status','accessboard','updatedBy','updatedAt']},currentDocument:{updateTime:c.live.updateTime}}));
  // Protect unchanged members, board versions and email mappings in the same atomic commit.
  writes.push(...[...members.filter(d=>!changedNames.has(d.name)),...boards,...lookups].map(d=>({verify:d.name,currentDocument:{updateTime:d.updateTime}})));
  if(changes.length)save('commit.json',await request(base+':commit',{method:'POST',body:{writes}}));
  const [afterMembers,afterBoards,afterLookups]=await Promise.all(['members','boards','memberLookup'].map(list));
  save('after.json',{members:afterMembers,boards:afterBoards,lookups:afterLookups});
  assert.equal(afterMembers.length,members.length);
  for(const live of afterMembers){const target=desired.get(live.name);assert(target);assert.equal(live.fields.role.stringValue,target.role);assert.equal(live.fields.status.stringValue,target.status);assert.deepEqual(ids(live),target.accessboard);const before=members.find(d=>d.name===live.name);for(const key of Object.keys(before.fields).filter(k=>!['role','status','accessboard','updatedBy','updatedAt'].includes(k)))assert.deepEqual(live.fields[key],before.fields[key]);if(!changedNames.has(live.name))assert.deepEqual(live,before);}
  const sorted=docs=>docs.sort((a,b)=>a.name.localeCompare(b.name));
  assert.deepEqual(sorted(afterBoards),sorted(boards),'Boards changed');assert.deepEqual(sorted(afterLookups),sorted(lookups),'Email mappings changed');
  save('verified.json',{...summary,verifiedAt:new Date().toISOString()});
  console.log(JSON.stringify({...summary,verified:true,backup:folder},null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
