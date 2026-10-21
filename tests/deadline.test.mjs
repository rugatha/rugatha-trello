import test from 'node:test';
import assert from 'node:assert/strict';
import {deadlineParts,resolveDeadline,deadlineDisplay,deadlineFields,bindDeadlineFields} from '../src/deadline.js';
import {deadlineRoot} from './helpers/deadline.mjs';
const now=new Date('2026-10-21T12:00:00Z');
const parts=patch=>({...deadlineParts(''),...patch});
test('partial October deadline resolves to the last day and minute while preserving raw XX fields',()=>{
 const draft=parts({year:'2026',month:'10',period:'PM',hour:'09'}),before=structuredClone(draft);
 const {due}=resolveDeadline(draft,now);
 assert.equal(due,'2026-10-31T21:59:00+08:00');
 assert.equal(deadlineDisplay(due,draft),'2026-10-XX 下午 09:XX');assert.deepEqual(draft,before);
});
test('missing fields use calendar-aware maxima including leap years',()=>{
 for(const [patch,expected]of [
  [{year:'2028',month:'02'},'2028-02-29T23:59:00+08:00'],
  [{year:'2026',month:'02'},'2026-02-28T23:59:00+08:00'],
  [{year:'2026',month:'04'},'2026-04-30T23:59:00+08:00'],
  [{year:'2026'},'2026-12-31T23:59:00+08:00'],
  [{month:'10',period:'AM'},'2026-10-31T11:59:00+08:00'],
  [{year:'2',month:'10',minute:'00'},'2026-10-31T23:00:00+08:00'],
  [{year:'2026',month:'10',day:'01',period:'AM',hour:'12',minute:'00'},'2026-10-01T00:00:00+08:00'],
  [{year:'2026',month:'10',day:'01',period:'PM',hour:'12',minute:'00'},'2026-10-01T12:00:00+08:00'],
 ])assert.equal(resolveDeadline(parts(patch),now).due,expected);
 assert.deepEqual(resolveDeadline(parts({}),now),{due:'',error:''});
});
test('invalid complete values remain draft input rather than overflowing into another date',()=>{
 for(const patch of [{year:'2026',month:'02',day:'31'},{month:'13'},{hour:'13'},{minute:'60'},{year:'9999'}]){
  const draft=parts(patch),result=resolveDeadline(draft,now);
  assert.equal(result.due,'');assert.ok(result.error);assert.deepEqual(draft,parts(patch));
 }
});
test('legacy full deadlines convert into Taipei twelve-hour components',()=>{
 assert.deepEqual(deadlineParts('2026-10-31T09:30:00Z'),parts({year:'2026',month:'10',day:'31',period:'PM',hour:'05',minute:'30'}));
 assert.equal(deadlineParts('2026-10-31').hour,'12');assert.equal(deadlineParts('2026-10-31').period,'AM');
});
test('segmented controls preserve half-entered numbers and save on blur without native datetime validation',()=>{
 const d=deadlineRoot(),edits=[];let commits=0;
 bindDeadlineFields(d.root,'',undefined,(draft,due)=>edits.push({draft,due}),()=>commits++);
 d.fill({year:'2',month:'10'});d.fields.month.onblur();
 assert.equal(edits.at(-1).draft.year,'2');assert.equal(edits.at(-1).draft.day,'');assert.equal(commits,1);
 assert.equal(d.fields.day.value,'');assert.equal(d.fields.minute.value,'');
 assert.doesNotMatch(deadlineFields('',edits.at(-1).draft,'test','截止日期'),/datetime-local|required/);
 d.clear.onclick();assert.equal(edits.at(-1).due,'');assert.ok(Object.values(edits.at(-1).draft).every(value=>value===''));
});
