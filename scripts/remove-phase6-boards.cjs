// Explicitly requested cleanup of the two 2026-10-10 verification boards.
// Dry-run by default; --apply creates a private backup, uses version preconditions,
// removes child documents, upload sessions, Storage objects and member grants.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {PROJECT, BUCKET, cloudClient} = require('./cloud-client.cjs');
const targets = new Map([
  ['managed-80529c3b-2992-4e3e-8730-e741cd06a22b', '階段六驗證 20261010'],
  ['managed-ff67b7e7-f5ae-4722-ae84-654102bbd537', '階段六 Admin 範圍驗證 20261010'],
]);
const root = `projects/${PROJECT}/databases/(default)/documents`;
const workspace = root + '/workspaces/main';
const api = 'https://firestore.googleapis.com/v1/';
const sha = x => createHash('sha256').update(x).digest('hex');
async function main() {
  assert(process.argv.slice(2).every(x => x === '--apply'), 'Use no arguments or --apply');
  const request = await cloudClient();
  async function list(parent, collection, showMissing = false) {
    const rows = []; let pageToken;
    do {
      const q = new URLSearchParams({pageSize:'1000', ...(showMissing ? {showMissing:'true'} : {})});
      if (pageToken) q.set('pageToken', pageToken);
      const r = await request(api + parent + '/' + collection + '?' + q);
      rows.push(...(r.documents || [])); pageToken = r.nextPageToken;
    } while (pageToken);
    return rows;
  }
  async function walk(parent) {
    const rows = []; let pageToken;
    do {
      const r = await request(api + parent + ':listCollectionIds', {method:'POST', body:{pageSize:100, ...(pageToken ? {pageToken} : {})}});
      for (const collection of r.collectionIds || []) {
        for (const d of await list(parent, collection, true)) {
          if (d.updateTime) rows.push(d);
          rows.push(...await walk(d.name));
        }
      }
      pageToken = r.nextPageToken;
    } while (pageToken);
    return rows;
  }
  async function objects() {
    const rows = []; let pageToken;
    do {
      const q = new URLSearchParams({maxResults:'1000'}); if(pageToken) q.set('pageToken',pageToken);
      const r = await request(`https://storage.googleapis.com/storage/v1/b/${BUCKET}/o?${q}`);
      rows.push(...(r.items || [])); pageToken = r.nextPageToken;
    } while (pageToken);
    return rows;
  }
  const boards = await list(workspace, 'boards');
  const selected = boards.filter(d => targets.has(d.name.split('/').at(-1)));
  for (const d of selected) assert.equal(d.fields.name.stringValue, targets.get(d.name.split('/').at(-1)), 'Target board was renamed; stop');
  assert(boards.every(d => ![...targets.values()].includes(d.fields.name?.stringValue) || targets.has(d.name.split('/').at(-1))), 'Unexpected board with same name');
  const documents = [...selected];
  for (const d of selected) documents.push(...await walk(d.name));
  const uploads = await list(workspace, 'attachmentUploads');
  const selectedUploads = uploads.filter(d => targets.has(d.fields.boardId?.stringValue));
  documents.push(...selectedUploads);
  const members = await list(workspace, 'members');
  const updates = members.flatMap(d => {
    const prior = d.fields.accessboard?.arrayValue?.values || [];
    const values = prior.filter(v => !targets.has(v.stringValue));
    return values.length === prior.length ? [] : [{before:d, fields:{...d.fields, accessboard:{arrayValue:{values}}}}];
  });
  const allObjects = await objects();
  const ownedObject = o => [...targets.keys()].some(id => o.name.startsWith(`workspaces/main/boards/${id}/`) ||
    (o.name.startsWith('uploads/') && o.name.split('/')[2] === id));
  const selectedObjects = allObjects.filter(ownedObject);
  const summary = {boards:selected.map(d => ({id:d.name.split('/').at(-1), name:d.fields.name.stringValue})),
    documents:documents.length, uploadSessions:selectedUploads.length, memberGrants:updates.length, objects:selectedObjects.length,
    objectBytes:selectedObjects.reduce((n,o) => n + Number(o.size),0)};
  console.log(JSON.stringify(summary));
  if (!process.argv.includes('--apply')) return;
  // Fail before modifying anything if the request exceeds one atomic Firestore commit.
  assert(documents.length + updates.length <= 500, 'Too many writes for one atomic cleanup');
  const folder = path.join('attachments_export/maintenance', 'phase6-cleanup-' + new Date().toISOString().replace(/[:.]/g,'-'));
  fs.mkdirSync(folder + '/objects', {recursive:true, mode:0o700});
  function save(name, value) {fs.writeFileSync(path.join(folder,name),JSON.stringify(value,null,2),{mode:0o600,flag:'wx'});}
  for (const o of selectedObjects) {
    const bytes = await request(`https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encodeURIComponent(o.name)}?alt=media&generation=${o.generation}`,{binary:true});
    assert.equal(bytes.length,Number(o.size));
    assert.equal(createHash('md5').update(bytes).digest('base64'),o.md5Hash);
    o.backupFile = 'objects/' + sha(o.name + '@' + o.generation) + '.bin'; o.sha256 = sha(bytes);
    fs.writeFileSync(path.join(folder,o.backupFile),bytes,{mode:0o600,flag:'wx'});
    assert.equal(sha(fs.readFileSync(path.join(folder,o.backupFile))),o.sha256);
  }
  save('before.json',{at:new Date().toISOString(),project:PROJECT,bucket:BUCKET,documents,members,boards,uploads,objects:allObjects,updates,summary});
  const writes = [
    ...updates.map(u => ({update:{name:u.before.name,fields:{accessboard:u.fields.accessboard}},updateMask:{fieldPaths:['accessboard']},currentDocument:{updateTime:u.before.updateTime}})),
    // Every deletion is under a verified board path or its verified upload session.
    ...documents.sort((a,b) => b.name.length-a.name.length).map(d => ({delete:d.name,currentDocument:{updateTime:d.updateTime}})),
  ];
  for (const w of writes) if(w.delete) assert(selected.some(b => w.delete === b.name || w.delete.startsWith(b.name + '/')) || selectedUploads.some(d => d.name===w.delete));
  if (writes.length) await request(api + root + ':commit',{method:'POST',body:{writes}});
  save('firestore-committed.json',{at:new Date().toISOString(),writes:writes.length});
  for (const o of selectedObjects) await request(`https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encodeURIComponent(o.name)}?ifGenerationMatch=${o.generation}&ifMetagenerationMatch=${o.metageneration}`,{method:'DELETE'});
  const afterBoards = await list(workspace,'boards');
  assert(afterBoards.every(d => !targets.has(d.name.split('/').at(-1))));
  assert.deepEqual(afterBoards.map(d => ({name:d.name,fields:d.fields})),boards.filter(d => !selected.includes(d)).map(d => ({name:d.name,fields:d.fields})));
  for (const id of targets.keys()) assert.equal((await walk(workspace + '/boards/' + id)).length,0,'Orphan board children remain');
  const afterUploads = await list(workspace, 'attachmentUploads');
  assert.deepEqual(afterUploads.map(d => ({name:d.name,fields:d.fields})),uploads.filter(d => !selectedUploads.includes(d)).map(d => ({name:d.name,fields:d.fields})));
  const afterMembers = await list(workspace,'members');
  assert.deepEqual(afterMembers.map(d => ({name:d.name,fields:d.fields})),members.map(d => ({name:d.name,fields:updates.find(u => u.before.name===d.name)?.fields || d.fields})));
  const afterObjects = await objects();
  assert(afterObjects.every(o => !ownedObject(o)));
  assert.deepEqual(afterObjects.map(o => [o.name,o.generation,o.metageneration,o.md5Hash]),allObjects.filter(o => !ownedObject(o)).map(o => [o.name,o.generation,o.metageneration,o.md5Hash]));
  const result = {...summary, at:new Date().toISOString(),backup:folder,remainingBoards:afterBoards.length,otherBoardsUnchanged:true,membersVerified:true,otherObjectsUnchanged:true};
  save('verified.json',result); console.log(JSON.stringify(result));
}
main().catch(e => {console.error(e.message);process.exitCode=1;});
