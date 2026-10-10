// Read-only, anonymous probes. Never save or print sensitive response bodies.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const repo = 'rugatha/rugatha-trello';
const api = `https://api.github.com/repos/${repo}`;
const pages = 'https://rugatha.github.io/rugatha-trello/';
const oldRoot = '9f648176a8fc4495ecee44e72cdebdb2c61559e3';
const beforeCleanup = '836a68447bc1383506addd9d841e3464b3ea573b';
const knownOldArtifact = 11496432980;
const directory = resolve('attachments_export/stage-one-audit/run-20261010');
const report = { checkedAt: new Date().toISOString(), probes: [], inventory: {} };

async function request(url, readJson = false) {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'rugatha-public-exposure-audit', 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(20000),
    });
    const result = { status: response.status };
    if (readJson && response.ok) result.data = await response.json();
    else await response.body?.cancel();
    return result;
  } catch (error) {
    return { status: null, error: error.cause?.code || error.name };
  }
}

const targets = [
  ['pages-home', pages, [200]],
  ...['data.json', 'new_member_info.csv', 'import/3d.json', 'import-report.json', '.DS_Store']
    .map(path => [`pages-${path}`, pages + path, [404, 410]]),
  ['old-root-raw', `https://raw.githubusercontent.com/${repo}/${oldRoot}/data.json`, [404, 410]],
  ['old-precleanup-raw', `https://raw.githubusercontent.com/${repo}/${beforeCleanup}/data.json`, [404, 410]],
  ['old-content-api', `${api}/contents/data.json?ref=${oldRoot}`, [404, 410]],
  ['old-pages-artifact', `${api}/actions/artifacts/${knownOldArtifact}`, [404, 410]],
  ...['boards', 'members', 'memberLookup'].map(collection => [
    `anonymous-firestore-${collection}`,
    `https://firestore.googleapis.com/v1/projects/rugatha-trello/databases/(default)/documents/workspaces/main/${collection}`,
    [401, 403],
  ]),
];
report.probes = await Promise.all(targets.map(async ([name, url, expected]) => {
  const result = await request(url);
  return { name, url, ...result, expected, passed: expected.includes(result.status) };
}));

// Follow every page; failure is unknown, never an empty/clean inventory.
for (const resource of ['artifacts', 'pulls', 'releases', 'forks', 'branches', 'tags']) {
  const entries = [];
  let complete = false;
  for (let page = 1; page <= 100; page++) {
    const endpoint = resource === 'artifacts' ? 'actions/artifacts' : resource;
    const result = await request(`${api}/${endpoint}?per_page=100&page=${page}&state=all`, true);
    const list = resource === 'artifacts' ? result.data?.artifacts : result.data;
    if (!Array.isArray(list)) {
      report.inventory[resource] = { complete: false, status: result.status, error: result.error, entries };
      break;
    }
    entries.push(...list.map(item => resource === 'artifacts'
      ? { id: item.id, name: item.name, expired: item.expired, expiresAt: item.expires_at, sha: item.workflow_run?.head_sha }
      : { name: item.name, number: item.number, sha: item.commit?.sha, url: item.html_url }));
    if (list.length < 100) { complete = true; break; }
  }
  report.inventory[resource] ??= { complete, entries };
}
report.knownEntrypointsPassed = report.probes.every(probe => probe.passed)
  && Object.values(report.inventory).every(inventory => inventory.complete);
report.scope = 'Known entrypoints only; does not prove absence of copies, other old objects, or completion of notifications.';
await mkdir(directory, { recursive: true, mode: 0o700 });
const filename = resolve(directory, `public-exposure-${Date.now()}.json`);
await writeFile(filename, JSON.stringify(report, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
console.log(JSON.stringify({ report: filename, probes: report.probes.map(({ name, status, passed }) => ({ name, status, passed })), inventory: report.inventory, knownEntrypointsPassed: report.knownEntrypointsPassed }, null, 2));
// Non-zero on reachable old data, unexpected statuses, or incomplete checks.
process.exitCode = report.knownEntrypointsPassed ? 0 : 1;
