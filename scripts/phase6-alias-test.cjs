// Temporarily test two explicitly authorized real logins on one isolated Viewer.
// Private preimages are durable before any write; restore uses version preconditions.
'use strict';
const fs = require('node:fs'), path = require('node:path');
const {isDeepStrictEqual} = require('node:util');
const {PROJECT, cloudClient} = require('./cloud-client.cjs');
(async () => {
  const mode = process.argv[2];
  if (!['prepare', 'restore'].includes(mode)) throw Error('Use prepare or restore');
  const folder = path.join('attachments_export/maintenance', fs.readdirSync('attachments_export/maintenance').filter(x => x.startsWith('unlisted-')).sort().at(-1));
  const file = path.join(folder, 'alias-test.json'), base = 'https://firestore.googleapis.com/v1/';
  const root = `projects/${PROJECT}/databases/(default)/documents/workspaces/main`;
  const request = await cloudClient();
  const read = async name => { try { return await request(base + name); } catch (e) { if (e.message.includes('HTTP 404')) return null; throw e; } };
  const original = JSON.parse(fs.readFileSync(path.join(folder, 'before.json')));
  if (original.member.fields.role.stringValue === 'owner') throw Error('Target must be a non-Owner test member');
  if (mode === 'prepare') {
    if (fs.existsSync(file)) throw Error('Restore the previous alias test first');
    const email = process.env.PHASE6_ALIAS_EMAIL?.trim().toLowerCase();
    if (!email || !/^[^@/]+@[^@/]+\.[^@/]+$/.test(email)) throw Error('Explicitly authorized PHASE6_ALIAS_EMAIL required');
    const aliasName = root + '/memberLookup/' + email;
    if (aliasName === original.lookup.name) throw Error('Two distinct logins required');
    const member = await read(original.member.name), primary = await read(original.lookup.name), alias = await read(aliasName);
    if (!member || !alias) throw Error('Existing member and alias preimage required');
    if (primary) throw Error('Test account must start outside the login list');
    if (alias.fields.memberId.stringValue === member.name.split('/').at(-1)) throw Error('Alias already targets this test member');
    const aliasMember = await read(root + '/members/' + alias.fields.memberId.stringValue);
    if (!aliasMember) throw Error('Alias original member missing');
    const boards = await request(base + root + '/boards?pageSize=100');
    const board = boards.documents.find(d => d.fields.name?.stringValue === '階段六驗證 20261010');
    if (!board) throw Error('Isolated board required');
    const fields = {...member.fields, role: {stringValue: 'viewer'}, status: {stringValue: 'active'}, name: {stringValue: '階段六多信箱 20261011'}, accessboard: {arrayValue: {values: [{stringValue: board.name.split('/').at(-1)}]}}};
    fs.writeFileSync(file, JSON.stringify({member, primaryName: original.lookup.name, primary, alias, aliasMember, expectedMember: fields}), {mode: 0o600, flag: 'wx'});
    await request(base + `projects/${PROJECT}/databases/(default)/documents:commit`, {method: 'POST', body: {writes: [
      {update: {name: member.name, fields}, currentDocument: {updateTime: member.updateTime}},
      {update: {name: original.lookup.name, fields: original.lookup.fields}, currentDocument: {exists: false}},
      {update: {name: alias.name, fields: {...alias.fields, memberId: original.lookup.fields.memberId}}, currentDocument: {updateTime: alias.updateTime}}
    ]}});
    const [a, b, m, preserved] = await Promise.all([read(original.lookup.name), read(alias.name), read(member.name), read(aliasMember.name)]);
    if (a.fields.memberId.stringValue !== b.fields.memberId.stringValue || !isDeepStrictEqual(m.fields, fields) || !isDeepStrictEqual(preserved.fields, aliasMember.fields)) throw Error('Preparation verification failed; use restore');
    console.log(JSON.stringify({sameMember: true, isolatedViewer: true, originalAliasMemberUnchanged: true}));
  } else {
    const before = JSON.parse(fs.readFileSync(file));
    const member = await read(before.member.name), primary = await read(before.primaryName), alias = await read(before.alias.name);
    if (!member || !alias) throw Error('Restore preimage no longer exists');
    for (const key of ['role', 'status', 'accessboard']) if (!isDeepStrictEqual(member.fields[key], before.expectedMember[key])) throw Error('Concurrent membership edit; inspect private preimages');
    if (alias.fields.memberId.stringValue !== original.lookup.fields.memberId.stringValue) throw Error('Concurrent alias edit');
    if (primary && !isDeepStrictEqual(primary.fields, original.lookup.fields)) throw Error('Concurrent primary login edit');
    await request(base + `projects/${PROJECT}/databases/(default)/documents:commit`, {method: 'POST', body: {writes: [
      {update: {name: member.name, fields: before.member.fields}, currentDocument: {updateTime: member.updateTime}},
      {update: {name: alias.name, fields: before.alias.fields}, currentDocument: {updateTime: alias.updateTime}},
      ...(primary ? [{delete: primary.name, currentDocument: {updateTime: primary.updateTime}}] : [])
    ]}});
    const [m, a, p, preserved] = await Promise.all([read(member.name), read(alias.name), read(before.primaryName), read(before.aliasMember.name)]);
    if (!isDeepStrictEqual(m.fields, before.member.fields) || !isDeepStrictEqual(a.fields, before.alias.fields) || p || !isDeepStrictEqual(preserved.fields, before.aliasMember.fields)) throw Error('Restore verification failed');
    fs.renameSync(file, file.replace('.json', '-restored-' + Date.now() + '.json'));
    console.log(JSON.stringify({testMemberRestored: true, aliasLookupRestored: true, primaryLookupAbsent: true, originalAliasMemberUnchanged: true}));
  }
})().catch(e => {console.error(e.message); process.exitCode = 1;});
