import test from 'node:test';
import assert from 'node:assert/strict';
import {dateDay,dayLabel,checklistEnd,cardDates,ganttBoards,weekSunday,overlapsRange} from '../src/gantt-data.js';
const start = dateDay('2026-10-16');
test('calendar dates preserve local deadlines and timestamps use Taipei dates',()=>{
 assert.equal(dayLabel(dateDay('2026-10-16T17:00:00Z')),'2026-10-17');
 assert.equal(dayLabel(dateDay('2026-10-16T23:30')),'2026-10-16');
 assert.equal(dateDay('2026-02-30'),null);assert.equal(dateDay('2026-02-30T00:00:00Z'),null);assert.equal(dateDay('invalid'),null);
});
test('card deadline has priority and completion date is never inferred from last edit',()=>{
 assert.equal(dayLabel(cardDates({createdAt:'2026-10-16',due:'2026-10-30',done:true,completedAt:'2026-10-20'}).end),'2026-10-30');
 assert.equal(dayLabel(cardDates({done:true,completedAt:'2026-10-20'}).end),'2026-10-20');
 assert.equal(cardDates({done:true,updatedAt:'2026-10-20',trelloLastActivity:'2026-10-20'}).end,null);
 assert.equal(cardDates({done:false,completedAt:'2026-10-20'}).end,null);
});
test('checklist detects explicit dates, ranges, Chinese dates and year rollover',()=>{
 for(const text of ['2026/10/31 前完成','2026-10-31','2026年10月31日','10/31 前完成','10月31日','10/20～10/31','10/20-10/31']) assert.equal(dayLabel(checklistEnd(text,start)),'2026-10-31',text);
 assert.equal(dayLabel(checklistEnd('12/30 ~ 1/5',start)),'2027-01-05');
 assert.equal(dayLabel(checklistEnd('2025/10/01',start)),'2025-10-01');
 for(const text of ['明天完成','完成 3 項','2026/02/30','版本 1.2.3','2026/13/20']) assert.equal(checklistEnd(text,start),null,text);
 assert.equal(checklistEnd('10/31',null),null);
 assert.equal(dayLabel(checklistEnd('2026/10/31',null)),'2026-10-31');
});
test('hierarchy filters enforce account board scope and card-level assignees',()=>{
 const workspace={boards:[{id:'allowed',cards:[{id:'c',assignees:['a']},{id:'u',assignees:[]},{id:'old',archived:true}]},{id:'private',cards:[{id:'secret'}]}]};
 const account={memberId:'m',workspaceRole:'viewer',accessboard:['allowed']};
 assert.deepEqual(ganttBoards(workspace,account).map(b=>b.id),['allowed']);
 assert.equal(ganttBoards(workspace,null).length,0);
 assert.equal(ganttBoards(workspace,{...account,workspaceRole:null}).length,0);
 assert.equal(ganttBoards(workspace,account,{board:'private'}).length,0);
 assert.deepEqual(ganttBoards(workspace,account,{assignee:'a'})[0].cards.map(c=>c.id),['c']);
 assert.deepEqual(ganttBoards(workspace,account,{assignee:'__none'})[0].cards.map(c=>c.id),['u']);

});

test('Taipei opening week starts on Sunday, including Sunday itself',()=>{
 assert.equal(dayLabel(weekSunday('2026-10-16T00:00:00Z')),'2026-10-11');
 assert.equal(dayLabel(weekSunday('2026-10-18T00:00:00Z')),'2026-10-18');
 assert.equal(dayLabel(weekSunday('2026-10-17T17:00:00Z')),'2026-10-18');
});
test('timeline defaults hide completed cards and items and resolve me from membership ID',()=>{
 const workspace={boards:[{id:'b',cards:[{id:'mine',createdAt:'2026-10-01',due:'2026-10-31',assignees:['m'],checklist:[{text:'10/15',done:true},{text:'10/20',done:false}]},
 {id:'other',assignees:['o']},{id:'done',done:true,assignees:['m']}]}]};
 const account={memberId:'m',workspaceRole:'viewer',accessboard:['b']};
 const mine=ganttBoards(workspace,account,{assignee:'__me'});
 assert.deepEqual(mine[0].cards.map(c=>c.id),['mine']);assert.equal(mine[0].cards[0].checklist.length,1);
 assert.equal(ganttBoards(workspace,account,{showCompleted:true})[0].cards.length,3);
 assert.equal(ganttBoards(workspace,{...account,memberId:'o'},{assignee:'__me'})[0].cards[0].id,'other');
 const from=dateDay('2026-11-01');
 assert.equal(ganttBoards(workspace,account,{assignee:'__me',from}).length,0);
});
test('date ranges include crossing and undated tasks while excluding earlier or later ranges',()=>{
 const day=dateDay('2026-10-11');
 assert.equal(overlapsRange(day-10,day+5,day,day+10),true);
 assert.equal(overlapsRange(day-10,day-1,day,null),false);
 assert.equal(overlapsRange(day+11,day+20,day,day+10),false);
 assert.equal(overlapsRange(day-10,null,day,day+10),true);
});
test('me and selecting the signed-in member return the same ongoing work across an open-ended date range',()=>{
 const account={uid:'google-uid',memberId:'member-17',workspaceRole:'viewer',accessboard:['b']};
 const workspace={boards:[{id:'b',cards:[
  {id:'undated',createdAt:'2026-03-02',due:'',assignees:['member-17','co-owner'],checklist:[]},
  {id:'future',createdAt:'2026-09-20',due:'2026-12-19',assignees:['member-17'],checklist:[{text:'10/3 確認',done:false}]},
  {id:'closed',createdAt:'2026-09-20',due:'2026-12-19',done:true,assignees:['member-17'],checklist:[]}
 ]}]};
 const filters={from:dateDay('2026-10-01'),to:null,showCompleted:false};
 const mine=ganttBoards(workspace,account,{...filters,assignee:'__me'});
 assert.deepEqual(mine,ganttBoards(workspace,account,{...filters,assignee:'member-17'}));
 assert.deepEqual(mine[0].cards.map(c=>c.id),['undated','future']);
 assert.equal(mine[0].cards[1].checklist.length,1);
});
test('deadline edit requires assignment or admin role and board access',async()=>{
 const {canSetDeadline,deadlineInput}=await import('../src/gantt-data.js');
 const board={id:'b'},card={assignees:['m']},account={memberId:'m',workspaceRole:'viewer',accessboard:['b']};
 assert.equal(canSetDeadline(account,board,card),true);
 assert.equal(canSetDeadline({...account,readOnly:true},board,card),false);
 assert.equal(canSetDeadline({...account,memberId:'other'},board,card),false);
 assert.equal(canSetDeadline({...account,accessboard:[]},board,card),false);
 assert.equal(canSetDeadline(account,{...board,archived:true},card),false);
 assert.equal(canSetDeadline(account,board,{...card,deleting:true}),false);
 assert.equal(deadlineInput('2026-10-31T09:30:00Z'),'2026-10-31T17:30');
 assert.equal(deadlineInput('2026-10-31T17:30'),'2026-10-31T17:30');
});

test('full date range starts at first creation and includes every card and checklist end without six-week padding',async()=>{
 const {ganttDateRange,ganttDateExtent}=await import('../src/gantt-data.js');
 const boards=[{cards:[{createdAt:'2024-02-10',due:'2024-02-11',checklist:[{text:'2024/02/15 完成'}]},
 {createdAt:'2024-02-12',due:'2020-01-01'}]}];
 const range=ganttDateRange(boards,{today:dateDay('2026-10-17')});
 assert.deepEqual(range,{start:dateDay('2024-02-10'),end:dateDay('2024-02-15')});
 assert.deepEqual(ganttDateExtent(boards),{firstCreated:dateDay('2024-02-10'),lastDay:dateDay('2024-02-15')});
});
test('full range includes completion dates and handles missing dates without infinite bounds',async()=>{
 const {ganttDateRange}=await import('../src/gantt-data.js');
 assert.deepEqual(ganttDateRange([{cards:[{createdAt:'2024-02-10',done:true,completedAt:'2024-03-15'}]}]),{start:dateDay('2024-02-10'),end:dateDay('2024-03-15')});
 const today=dateDay('2026-10-17');
 assert.deepEqual(ganttDateRange([{cards:[{}]}],{today}),{start:today,end:today});
});

test('admin can edit unassigned cards across accessible boards including archived boards',async()=>{
 const {canSetDeadline}=await import('../src/gantt-data.js');
 const account={memberId:'admin',workspaceRole:'admin',accessboard:['a','b']};
 for(const board of [{id:'a'},{id:'b',archived:true}]) {
  assert.equal(canSetDeadline(account,board,{assignees:[]}),true);
  assert.equal(canSetDeadline(account,board,{assignees:['other']}),true);
 }
 assert.equal(canSetDeadline(account,{id:'private'},{assignees:[]}),false);
 assert.equal(canSetDeadline(account,{id:'a',deleting:true},{assignees:[]}),false);
 assert.equal(canSetDeadline(account,{id:'a'},{archived:true}),false);
 assert.equal(canSetDeadline({...account,workspaceRole:'viewer'},{id:'a'},{assignees:[]}),false);
});

test('explicit checklist deadlines override text dates for filtering and timeline bounds',async()=>{
 const {ganttDateExtent}=await import('../src/gantt-data.js');
 assert.equal(checklistEnd('10/20 legacy',start,'2026-11-03T17:30:00+08:00'),dateDay('2026-11-03'));
 const workspace={boards:[{id:'b',cards:[{id:'c',createdAt:'2026-10-16',assignees:['m'],checklist:[{text:'10/20 legacy',due:'2026-11-03T17:30:00+08:00'}]}]}]};
 assert.equal(ganttDateExtent(workspace.boards).lastDay,dateDay('2026-11-03'));
 const filtered=ganttBoards(workspace,{memberId:'m',workspaceRole:'editor',accessboard:['b']},{from:dateDay('2026-11-01')});
 assert.equal(filtered[0].cards[0].checklist.length,1);
});

test('partial deadline effective dates determine gantt ranges without replacing input blanks',async()=>{
 const {resolveDeadline,deadlineParts}=await import('../src/deadline.js');
 const raw=deadlineParts('',{year:'2026',month:'10',period:'PM',hour:'09'}),due=resolveDeadline(raw).due;
 const card={createdAt:'2026-10-01',due,dueParts:raw,checklist:[{text:'Task',due,dueParts:raw}]};
 assert.equal(cardDates(card).end,dateDay('2026-10-31'));
 assert.equal(checklistEnd('Task',dateDay('2026-10-01'),due),dateDay('2026-10-31'));
 assert.equal(card.dueParts.day,'');
});
