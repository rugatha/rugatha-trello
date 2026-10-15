import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {moveMentions,mentionQuery,mentionParts}=await import('data:text/javascript;base64,'+Buffer.from(await readFile(new URL('../src/mentions.js',import.meta.url))).toString('base64'));
const mention={memberId:'member-a',start:3,end:7,label:'小 明'};
test('mentions track insertions and drop edited or deleted tokens',()=>{
 assert.deepEqual(moveMentions('Hi @小 明!','Hey Hi @小 明!',[mention]),[{...mention,start:7,end:11}]);
 assert.deepEqual(moveMentions('Hi @小 明!','Hi @小 王!',[mention]),[]);
 assert.deepEqual(moveMentions('Hi @小 明!','Hi !',[mention]),[]);
 assert.deepEqual(moveMentions('Hi @小 明!','Hi @小 明!!',[mention]),[mention]);
});
test('picker handles Unicode names and spaces without treating email addresses as tags',()=>{
 assert.equal(mentionQuery('user@example.com',16,[]),null);
 assert.deepEqual(mentionQuery('Hi @小 明',7,[]),{start:3,end:7,query:'小 明'});
 assert.equal(mentionQuery('Hi @小 明',7,[mention]),null);
 assert.equal(mentionQuery('@name\nhello',11,[]),null);
});
test('rendering preserves member IDs and ignores invalid token ranges',()=>{
 assert.deepEqual(mentionParts('Hi @小 明!',[mention]),[{text:'Hi '},{text:'@小 明',memberId:'member-a'},{text:'!'}]);
 assert.deepEqual(mentionParts('Hi @小 王!',[mention]),[{text:'Hi @小 王!'}]);
});
