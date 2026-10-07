import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {compare}=createRequire(import.meta.url)('../scripts/audit-migration-content.cjs');
const source={boards:[{id:'b',cards:[{id:'c',checklist:[{id:'t',text:'task',done:false}],comments:[{id:'m',text:'hello',at:'date'}],attachments:[{id:'a',name:'file',url:'original',type:'old',size:1,external:true}]}]}]};
function live(){return structuredClone(source);}
test('full comparison detects changed content even when counts agree',()=>{
 const target=live();target.boards[0].cards[0].comments[0].text='changed';
 assert.deepEqual(compare(source,target).differences.map(x=>x.field),['text']);
});
test('missing children and cards cannot pass',()=>{
 const target=live();target.boards[0].cards[0].checklist=[];
 assert.equal(compare(source,target).differences[0].reason,'missing');
 target.boards[0].cards=[];assert.equal(compare(source,target).missingCards.length,1);
});
test('migration compares original URL and reports additions and stale counts',()=>{
 const target=live(),card=target.boards[0].cards[0];
 Object.assign(card.attachments[0],{migrationStatus:'firebase_storage',sourceUrl:'original',url:'new',size:2,type:'new',external:false});
 card.attachments.push({id:'new'});card.attachmentCount=1;
 const result=compare(source,target);
 assert.equal(result.differences.length,0);assert.equal(result.additions.length,1);assert.equal(result.countErrors.length,1);
 card.attachments[0].sourceUrl='wrong';assert.equal(compare(source,target).differences[0].field,'url');
});
