// Read-only admin audit. No cloud writes, including when preparing a repair plan.
const fs = require('node:fs');
const root = 'workspaces/main';

function auditReferences({members, boards}) {
  const byId = new Map(members.map(member => [member.id, member]));
  const issues = [];
  const counts = {members: members.length, boards: boards.length, cards: 0, assignments: 0, comments: 0};
  const add = (code, path, details = {}, severity = 'error') => issues.push({code, path, severity, ...details});
  for (const member of members) {
    const path = `${root}/members/${member.id}`;
    if (typeof member.name !== 'string' || !member.name.trim()) add('missing-member-name', path);
    if (Object.hasOwn(member, 'cardincharge')) add('duplicate-cardincharge', path);
  }
  const commentSamples = [];
  for (const board of boards) for (const card of board.cards) {
    counts.cards++;
    const path = `${root}/boards/${board.id}/cards/${card.id}`;
    const ids = card.assigneeIds ?? [];
    if (Object.hasOwn(card, 'legacyAssigneeIds')) add('legacy-assignees', path);
    if (!Array.isArray(ids) || card.assigneeIds === null) {
      add('invalid-assignee-array', path);
    } else {
      const seen = new Set();
      for (const id of ids) {
        counts.assignments++;
        if (typeof id !== 'string' || !id.trim()) { add('invalid-assignee-id', path); continue; }
        if (seen.has(id)) add('duplicate-assignee', path, {memberId:id});
        seen.add(id);
        const member = byId.get(id);
        if (!member) add('missing-assignee', path, {memberId:id});
        else {
          // Historical assignments may legitimately outlive active membership/access.
          if (member.status !== 'active') add('inactive-assignee', path, {memberId:id}, 'warning');
          if (!Array.isArray(member.accessboard) || !member.accessboard.includes(board.id)) add('assignee-without-board-access', path, {memberId:id}, 'warning');
        }
      }
    }
    for (const comment of card.comments) {
      counts.comments++;
      if (typeof comment.memberId !== 'string' || !byId.has(comment.memberId)) {
        add('missing-comment-author', `${path}/comments/${comment.id}`);
      }
    }
    if (card.comments.length && commentSamples.length < 5) {
      commentSamples.push({board:board.name, card:card.title, authors:[...new Set(card.comments.map(c => byId.get(c.memberId)?.name || '未知成員'))]});
    }
  }
  return {counts, errors:issues.filter(x=>x.severity==='error').length,
    warnings:issues.filter(x=>x.severity==='warning').length, issues, commentSamples};
}

// Explicit replacement arrays only: never infer a person from a name or drop unknown IDs.
function planRepairs(snapshot, requests) {
  if (!Array.isArray(requests)) throw Error('Repair input must be an array.');
  const members = new Map(snapshot.members.map(m=>[m.id,m]));
  const cards = new Map(snapshot.boards.flatMap(b=>b.cards.map(c=>[`${root}/boards/${b.id}/cards/${c.id}`,{board:b,card:c}])));
  const seen = new Set();
  return requests.map(request=>{
    const {path, assigneeIds} = request;
    if (!cards.has(path) || seen.has(path)) throw Error('Unknown or duplicate card path: '+path);
    seen.add(path);
    const {board,card} = cards.get(path);
    if (!card.updateTime) throw Error('Missing server updateTime: '+path);
    if (!Array.isArray(assigneeIds) || new Set(assigneeIds).size !== assigneeIds.length) throw Error('Expected unique assignee IDs.');
    for (const id of assigneeIds) {
      const member = members.get(id);
      if (typeof id !== 'string' || !member || member.status !== 'active' || !Array.isArray(member.accessboard) || !member.accessboard.includes(board.id)) {
        throw Error('Replacement member must be active and authorized for the board: '+id);
      }
    }
    return {path, before:card.assigneeIds ?? null, after:[...assigneeIds], currentDocument:{updateTime:card.updateTime},
      updateMask:['assigneeIds','updatedAt','updatedBy']};
  });
}

function decode(value) {
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decode);
  if ('mapValue' in value) return decodeFields(value.mapValue.fields || {});
  return null;
}
const decodeFields = fields => Object.fromEntries(Object.entries(fields).map(([key,value])=>[key,decode(value)]));

async function readSnapshot(get) {
  async function list(path) {
    const rows = [];
    let pageToken;
    do {
      const query = new URLSearchParams({pageSize:'1000'});
      if (pageToken) query.set('pageToken', pageToken);
      const result = await get(path+'?'+query);
      rows.push(...(result.documents || []).map(d=>({...decodeFields(d.fields || {}), id:d.name.split('/').at(-1),updateTime:d.updateTime})));
      pageToken = result.nextPageToken;
    } while (pageToken);
    return rows;
  }
  const members = await list(root+'/members');
  const boards = await list(root+'/boards');
  for (const board of boards) {
    const base = `${root}/boards/${board.id}/cards`;
    board.cards = await list(base);
    // Read every comment collection, including archived and zero-count cards.
    // A stale commentCount must not hide a broken reference from the audit.
    for (let start=0; start<board.cards.length; start+=8) {
      await Promise.all(board.cards.slice(start,start+8).map(async card=>{
        card.comments = await list(`${base}/${card.id}/comments`);
      }));
    }
  }
  return {members, boards};
}

async function main(args) {
  const planArg = args.find(arg=>arg.startsWith('--plan='));
  if (args.some(arg=>arg !== planArg) || args.length > 1) throw Error('Usage: node scripts/audit-member-references.cjs [--plan=/private/tmp/repairs.json]');
  const requests = planArg ? JSON.parse(fs.readFileSync(planArg.slice(7),'utf8')) : null;
  const auth = require('firebase-tools/lib/auth');
  const account = auth.getProjectDefaultAccount(process.cwd());
  if (!account) throw Error('Sign in with Firebase CLI first.');
  const token = account.tokens.expires_at > Date.now()+60000 ? account.tokens : await auth.getAccessToken(account.tokens.refresh_token,account.tokens.scopes||['https://www.googleapis.com/auth/cloud-platform']);
  const base = 'https://firestore.googleapis.com/v1/projects/rugatha-trello/databases/(default)/documents/';
  const snapshot = await readSnapshot(async resource=>{
    const response = await fetch(base+resource,{headers:{Authorization:'Bearer '+token.access_token}});
    if (!response.ok) throw Error('Firestore read failed: HTTP '+response.status);
    return response.json();
  });
  const report = {at:new Date().toISOString(),project:'rugatha-trello',...auditReferences(snapshot)};
  if (requests) report.repairPlan = planRepairs(snapshot,requests);
  console.log(JSON.stringify(report,null,2));
  if (report.errors) process.exitCode=1;
}
module.exports = {auditReferences, planRepairs, readSnapshot};
if (require.main === module) main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
