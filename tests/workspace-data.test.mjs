import test from 'node:test';
import assert from 'node:assert/strict';
import {documents,changes} from '../workspace-data.js';
const fixture=()=>({boards:[{id:'b',name:'Board',columns:[{id:'col',name:'Todo'}],cards:[{
 id:'c',title:'Card',columnId:'col',assignees:['member-01'],checklist:[{id:'t',text:'Task',done:false}],
 comments:[{id:'m',userId:'member-01',text:'Hello'}],attachments:[{id:'a',url:'https://example.com'}]
}]}]});
const diff=(a,b)=>changes(documents(a),documents(b));
test('unchanged workspace produces no writes',()=>assert.deepEqual(diff(fixture(),fixture()),[]));
test('maps member references and stores children separately',()=>{
 const docs=documents(fixture()),card=docs.get('workspaces/main/boards/b/cards/c');
 assert.deepEqual(card.assigneeIds,['member-01']);assert.equal(card.checklist,undefined);
 assert.equal(docs.get('workspaces/main/boards/b/cards/c/comments/m').memberId,'member-01');
});
test('editing title only patches title and retains other cloud fields',()=>{
 const a=fixture(),b=fixture();b.boards[0].cards[0].title='Updated';
 assert.deepEqual(diff(a,b).map(op=>op.patch),[{title:'Updated'}]);
});
test('archiving a card leaves child documents intact',()=>{
 const a=fixture(),b=fixture();b.boards[0].cards=[];
 const ops=diff(a,b);assert.equal(ops.length,1);assert.equal(ops[0].path,'workspaces/main/boards/b/cards/c');assert.equal(ops[0].after,undefined);
});
test('adding checklist item updates its parent count atomically',()=>{
 const a=fixture(),b=fixture();b.boards[0].cards[0].checklist.push({id:'new',text:'New',done:false});
 const ops=diff(a,b);assert.equal(ops.length,2);assert.deepEqual(ops[0].patch,{checklistCount:2});
});
test('removing checklist item does not remove card',()=>{
 const a=fixture(),b=fixture();b.boards[0].cards[0].checklist=[];
 const ops=diff(a,b);assert.equal(ops.length,2);assert.ok(ops.find(op=>op.path.endsWith('/checklist/t')&&!op.after));
});
