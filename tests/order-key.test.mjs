import test from 'node:test';
import assert from 'node:assert/strict';
import {assignMovedOrderKey,compareOrderKey} from '../order-key.js';
import {documents,changes} from '../workspace-data.js';

test('moving one card among 600 writes only that card',()=>{
  const cards=Array.from({length:600},(_,index)=>({id:`c${index}`,columnId:'col',orderKey:String(index).padStart(12,'0'),
    assignees:[],checklist:[],comments:[],attachments:[]}));
  const before={boards:[{id:'b',columns:[],cards:structuredClone(cards)}]};
  const moved=cards.splice(550,1)[0];cards.splice(300,0,moved);
  assignMovedOrderKey(cards,moved);
  const sorted=[...cards].sort((a,b)=>compareOrderKey(a.orderKey,b.orderKey));
  assert.deepEqual(sorted.map(card=>card.id),cards.map(card=>card.id));
  assert.equal(changes(documents(before),documents({boards:[{id:'b',columns:[],cards}]})).length,1);
});

test('ranks support front, end, and repeated insertion in a narrow gap',()=>{
  const cards=[0,1,2].map(index=>({id:String(index),columnId:'col',orderKey:String(index).padStart(12,'0')}));
  const first=cards.pop();cards.unshift(first);assignMovedOrderKey(cards,first);
  assert.deepEqual([...cards].sort((a,b)=>compareOrderKey(a.orderKey,b.orderKey)),cards);
  for(let index=0;index<40;index++){
    const card={id:`new${index}`,columnId:'col'};
    cards.splice(1,0,card);assignMovedOrderKey(cards,card);
  }
  assert.deepEqual([...cards].sort((a,b)=>compareOrderKey(a.orderKey,b.orderKey)),cards);
  const last=cards.shift();cards.push(last);assignMovedOrderKey(cards,last);
  assert.deepEqual([...cards].sort((a,b)=>compareOrderKey(a.orderKey,b.orderKey)),cards);
});

test('moving among imported punctuation and text keys preserves legacy order',()=>{
  const cards=['!00001-id','!00002-id','000000000001','z123'].map((orderKey,index)=>
    ({id:String(index),columnId:'col',orderKey}));
  const moved=cards.pop();cards.splice(2,0,moved);assignMovedOrderKey(cards,moved);
  assert.deepEqual([...cards].sort((a,b)=>compareOrderKey(a.orderKey,b.orderKey)),cards);
});
