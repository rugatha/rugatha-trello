import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {auditReferences,planRepairs,readSnapshot} = createRequire(import.meta.url)('../scripts/audit-member-references.cjs');
const path = 'workspaces/main/boards/b/cards/c';
const fixture = () => ({members:[{id:'m',name:'Member',status:'active',accessboard:['b']}],
  boards:[{id:'b',name:'Board',cards:[{id:'c',title:'Card',updateTime:'2026-10-07T00:00:00Z',assigneeIds:['m'],comments:[{id:'comment',memberId:'m'}]}]}]});

test('reference audit counts valid cards, assignments and authors without changing data',()=>{
  const data=fixture(),before=structuredClone(data),report=auditReferences(data);
  assert.deepEqual(report.counts,{members:1,boards:1,cards:1,assignments:1,comments:1});
  assert.equal(report.errors,0);assert.equal(report.warnings,0);assert.deepEqual(data,before);
});
test('audit detects orphan IDs, duplicate assignments, legacy fields and unnamed members on archived cards',()=>{
  const data=fixture(),card=data.boards[0].cards[0];
  card.archived=true;card.assigneeIds=['m','missing','m','',42];card.legacyAssigneeIds=['old'];
  card.comments[0].memberId='missing';data.members[0].cardincharge=[];data.members[0].name=' ';
  const codes=auditReferences(data).issues.map(x=>x.code);
  for(const code of ['missing-assignee','duplicate-assignee','invalid-assignee-id','legacy-assignees','missing-comment-author','duplicate-cardincharge','missing-member-name']) assert.ok(codes.includes(code),code);
});
test('missing optional assignment list is empty; null or scalar values are malformed',()=>{
  const data=fixture(),card=data.boards[0].cards[0];delete card.assigneeIds;
  assert.equal(auditReferences(data).errors,0);
  for(const value of [null,'m',{}]) {card.assigneeIds=value;assert.equal(auditReferences(data).issues[0].code,'invalid-assignee-array');}
});
test('historical inactive or unauthorized assignees are warnings and are never removed',()=>{
  const data=fixture();data.members[0].status='disabled';data.members[0].accessboard=[];
  const report=auditReferences(data);assert.equal(report.errors,0);assert.equal(report.warnings,2);
  assert.deepEqual(data.boards[0].cards[0].assigneeIds,['m']);
});
test('repair plan preserves before state and server precondition without mutating source',()=>{
  const data=fixture();data.boards[0].cards[0].assigneeIds=['orphan'];const before=structuredClone(data);
  const [plan]=planRepairs(data,[{path,assigneeIds:['m']}]);
  assert.deepEqual(plan.before,['orphan']);assert.deepEqual(plan.after,['m']);
  assert.equal(plan.currentDocument.updateTime,data.boards[0].cards[0].updateTime);
  assert.deepEqual(planRepairs(data,[{path,assigneeIds:[]}])[0].after,[]);
  assert.deepEqual(data,before);
});
test('repair refuses guessed, inactive, unauthorized, duplicate or stale targets',()=>{
  for(const ids of [['missing'],['m','m'],[null],'m']) assert.throws(()=>planRepairs(fixture(),[{path,assigneeIds:ids}]));
  assert.throws(()=>planRepairs(fixture(),[{path:path+'bad',assigneeIds:[]}]));
  assert.throws(()=>planRepairs(fixture(),[{path,assigneeIds:[]},{path,assigneeIds:[]}]));
  for(const patch of [{status:'disabled'},{accessboard:[]},{accessboard:'b'}]) {
    const data=fixture();Object.assign(data.members[0],patch);assert.throws(()=>planRepairs(data,[{path,assigneeIds:['m']}]));
  }
  const data=fixture();delete data.boards[0].cards[0].updateTime;
  assert.throws(()=>planRepairs(data,[{path,assigneeIds:[]}]));
});
test('server audit follows pagination and reads zero-count and archived comment collections',async()=>{
  const calls=[];
  const doc=(name,fields={})=>({name,fields,updateTime:'server-time'});
  const result=await readSnapshot(async resource=>{
    calls.push(resource);const [path,query]=resource.split('?');const page=new URLSearchParams(query).get('pageToken');
    if(path.endsWith('/members'))return page?{documents:[doc('members/n')]}:{documents:[doc('members/m')],nextPageToken:'next page'};
    if(path.endsWith('/boards'))return {documents:[doc('boards/b')]};
    if(path.endsWith('/cards'))return {documents:[doc('cards/c',{commentCount:{integerValue:'0'},archived:{booleanValue:true}})]};
    if(path.endsWith('/comments'))return {documents:[doc('comments/comment',{memberId:{stringValue:'missing'}})]};
    throw Error('unexpected path');
  });
  assert.equal(result.members.length,2);assert.equal(result.boards[0].cards[0].comments.length,1);
  assert.ok(calls.some(p=>p.includes('pageToken=next+page')));
  assert.ok(auditReferences(result).issues.some(i=>i.code==='missing-comment-author'));
});
