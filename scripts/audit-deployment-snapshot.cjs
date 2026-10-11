// Local, read-only verification of private production snapshots; never print content.
'use strict';
const fs = require('node:fs'), path = require('node:path');
const {isDeepStrictEqual} = require('node:util');
function read(file) {
  const root = path.resolve('attachments_export/maintenance') + path.sep;
  const resolved = path.resolve(file || '');
  if (!resolved.startsWith(root) || path.basename(resolved) !== 'snapshot.json') throw Error('Use private maintenance snapshot.json files');
  const data = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  if (data.project !== 'rugatha-trello' || data.schema !== 1) throw Error('Unexpected snapshot');
  return data;
}
try {
  const before = read(process.argv[2]), after = read(process.argv[3]);
  const collection = d => d.name.split('/').at(-2);
  const boards = before.documents.filter(d => collection(d) === 'boards' && !/^階段六/.test(d.fields.name?.stringValue || ''));
  if (!boards.length) throw Error('Historical baseline has no boards');
  const historical = d => boards.some(b => d.name === b.name || d.name.startsWith(b.name + '/'));
  const originals = before.documents.filter(historical), current = new Map(after.documents.map(d => [d.name, d]));
  const changed = originals.filter(d => !isDeepStrictEqual(d.fields, current.get(d.name)?.fields));
  const added = after.documents.filter(d => historical(d) && !before.documents.some(b => b.name === d.name));
  const historicalCountErrors = [], legacyMissingCounters = [];
  for (const card of after.documents.filter(d => historical(d) && collection(d) === 'cards')) {
    for (const [kind, field] of [['checklist', 'checklistCount'], ['comments', 'commentCount'], ['attachments', 'attachmentCount']]) {
      const children = after.documents.filter(d => d.name.startsWith(card.name + '/' + kind + '/') && (kind !== 'attachments' || d.fields.archived?.booleanValue !== true));
      if (card.fields[field] === undefined) { legacyMissingCounters.push({kind, actual: children.length}); continue; }
      const stored = Number(card.fields[field].integerValue ?? card.fields[field].doubleValue);
      if (stored !== children.length) historicalCountErrors.push({kind, stored, actual: children.length});
    }
  }
  const objects = new Map(after.objects.map(o => [o.name, o]));
  const changedObjects = before.objects.filter(o => !objects.has(o.name) || objects.get(o.name).sha256 !== o.sha256);
  const counts = docs => Object.fromEntries([...new Set(docs.map(collection))].sort().map(k => [k, docs.filter(d => collection(d) === k).length]));
  const summary = {historicalBoards: boards.length, comparedDocuments: originals.length, historicalDifferences: changed.length, historicalAdditions: added.length, historicalCountErrors, legacyMissingCounters, originalObjectsChanged: changedObjects.length, historicalCounts: counts(after.documents.filter(historical)), deployedCounts: counts(after.documents), storageObjects: after.objects.length};
  console.log(JSON.stringify(summary, null, 2));
  if (changed.length || added.length || historicalCountErrors.length || changedObjects.length) process.exitCode = 1;
} catch (error) { console.error(error.message); process.exitCode = 1; }
