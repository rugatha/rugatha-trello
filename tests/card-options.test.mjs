import test from 'node:test';
import assert from 'node:assert/strict';
import {boardLabels,labelColor,labelInk,placeCard} from '../src/card-options.js';
import {compareOrderKey} from '../src/order-key.js';
test('board labels generate no default presets, preserve imported IDs and sanitize colors',()=>{
 assert.deepEqual(boardLabels({}),{});
 const labels=boardLabels({labelDefinitions:{imported:{name:'Facebook粉專',color:'blue'},custom:{name:'審閱',color:'#abcd12'}}});
 assert.deepEqual(Object.keys(labels),['imported','custom']);
 assert.equal(labelColor('red;background:url(x)'), '#e4edff');
 assert.equal(labelInk('#000000'),'#ffffff');assert.equal(labelInk('#ffffff'),'#17251e');
});
test('placement chooses first, middle, last and empty stage without reranking other cards',()=>{
 const original=[{id:'a',columnId:'one',orderKey:'1'},{id:'b',columnId:'one',orderKey:'2'},{id:'c',columnId:'two',orderKey:'3'}];
 const moving={...original[2]};let cards=placeCard(original,moving,'one',1);
 assert.deepEqual(cards.filter(c=>c.columnId==='one').map(c=>c.id),['c','a','b']);
 assert.equal(cards.find(c=>c.id==='a').orderKey,'1');
 cards=placeCard(cards,moving,'one',2);assert.deepEqual(cards.filter(c=>c.columnId==='one').map(c=>c.id),['a','c','b']);
 cards=placeCard(cards,moving,'one',3);assert.deepEqual(cards.filter(c=>c.columnId==='one').map(c=>c.id),['a','b','c']);
 assert.deepEqual([...cards].sort((a,b)=>compareOrderKey(a.orderKey,b.orderKey)),cards);
 cards=placeCard(cards,moving,'empty',1);assert.equal(cards.filter(c=>c.columnId==='empty').length,1);
 assert.throws(()=>placeCard(cards,moving,'one',9),/位置/);
});
test('rank conflicts leave the original card stage and rank untouched',()=>{
 const moving={id:'move',columnId:'source',orderKey:'9'};
 const cards=[moving,{id:'a',columnId:'target',orderKey:'same'},{id:'b',columnId:'target',orderKey:'same'}];
 assert.throws(()=>placeCard(cards,moving,'target',2),/排序/);
 assert.equal(moving.columnId,'source');assert.equal(moving.orderKey,'9');
});
