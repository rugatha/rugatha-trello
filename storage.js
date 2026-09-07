"use strict";

// IndexedDB persistence. Keep database name, version and key stable for existing users.
function openDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open('boardly-workspace',1);req.onupgradeneeded=()=>req.result.createObjectStore('data');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}

function readDB(){return new Promise((resolve,reject)=>{const r=db.transaction('data').objectStore('data').get('workspace');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}

function save(){if(!db){toast('無法儲存：請先匯出備份，並允許瀏覽器儲存資料');return}const t=db.transaction('data','readwrite');t.objectStore('data').put(state,'workspace');t.onerror=()=>toast('儲存失敗，可能空間不足。請匯出備份。')}


// data.json seeds new workspaces only; saved browser data always takes priority.
async function loadInitialData() {
  const response = await fetch("./data.json", { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`無法載入 data.json（HTTP ${response.status}）`);
  }
  const initialData = await response.json();
  if (!validateImport(initialData)) {
    throw new Error("data.json 格式不正確或資料不完整");
  }
  return initialData;
}

// Add the configured roster without changing existing identities or authorship.
function syncRoster(workspace, defaults) {
  if ((workspace.rosterVersion || 0) >= defaults.rosterVersion) return false;
  const existing = [...workspace.users];
  const members = defaults.users.map(member => {
    const match = existing.find(user => user.name.toLocaleLowerCase() === member.name.toLocaleLowerCase());
    return match || { ...member, id: uid() };
  });
  const used = new Set(workspace.boards.flatMap(board => board.cards.flatMap(card =>
    [...card.assignees, ...card.comments.map(comment => comment.userId)])));
  const demos = new Set(['Alex', 'Jamie', '小安']);
  const extras = existing.filter(user => !members.some(member => member.id === user.id) &&
    (!demos.has(user.name) || used.has(user.id)));
  workspace.users = [...members, ...extras];
  workspace.rosterVersion = defaults.rosterVersion;
  return true;
}

// Remove only the retired exact username; retain comment author snapshots.
function removeRetiredDmUser(workspace) {
  if (workspace.removedDmUserVersion === 1) return false;
  const removedIds = new Set(workspace.users
    .filter(user => user.name === 'DM')
    .map(user => user.id));
  workspace.users = workspace.users.filter(user => !removedIds.has(user.id));
  for (const board of workspace.boards) {
    for (const card of board.cards) {
      card.assignees = card.assignees.filter(id => !removedIds.has(id));
    }
  }
  workspace.removedDmUserVersion = 1;
  return true;
}

// Retire the original demo accounts without rewriting historical comments.
function removeDemoUsers(workspace) {
  if (workspace.removedDemoUsersVersion === 1) return false;
  const demoNames = new Set(['Alex', 'Jamie', '小安']);
  const removedIds = new Set(workspace.users
    .filter(user => demoNames.has(user.name))
    .map(user => user.id));
  workspace.users = workspace.users.filter(user => !removedIds.has(user.id));
  for (const board of workspace.boards) {
    for (const card of board.cards) {
      card.assignees = card.assignees.filter(id => !removedIds.has(id));
    }
  }
  workspace.removedDemoUsersVersion = 1;
  return true;
}

// Append imported boards once. Existing boards and user edits are never replaced.
function mergeTrelloImport(workspace, imported) {
  if (!imported.trelloImportVersion || (workspace.trelloImportVersion || 0) >= imported.trelloImportVersion) return false;
  const idMap = new Map();
  for (const source of imported.users) {
    const existing = workspace.users.find(user => user.id === source.id ||
      (source.trelloId && user.trelloId === source.trelloId) || user.name === source.name);
    if (existing) idMap.set(source.id, existing.id);
    else { workspace.users.push({...source}); idMap.set(source.id, source.id); }
  }
  let firstAdded;
  for (const source of imported.boards.filter(board => board.trelloId)) {
    if (workspace.boards.some(board => board.id === source.id || board.trelloId === source.trelloId)) continue;
    const added = structuredClone(source);
    for (const card of added.cards) {
      card.assignees = card.assignees.map(id => idMap.get(id) || id);
      for (const comment of card.comments) comment.userId = idMap.get(comment.userId) || comment.userId;
    }
    workspace.boards.push(added);
    firstAdded ||= added.id;
  }
  if (firstAdded) workspace.activeBoard = firstAdded;
  workspace.trelloImportVersion = imported.trelloImportVersion;
  return true;
}

// One-time cleanup of the original starter boards after real boards are available.
function removeStarterBoards(workspace) {
  if (workspace.removedStarterBoardsVersion === 1) return false;
  const starterIds = new Set(['demo', '2fab779f-cc4f-4dca-be07-44b0aeb8bc6b', '28b26dfa-d323-46d9-b105-ba8adb2f8893']);
  const starterNames = new Set(['品牌網站改版', '內容與行銷', '產品靈感庫']);
  const remaining = workspace.boards.filter(board => board.trelloId ||
    (!starterIds.has(board.id) && !starterNames.has(board.name)));
  // Retry on next load if the Trello data has not arrived yet.
  if (!remaining.length) return false;
  workspace.boards = remaining;
  if (!remaining.some(board => board.id === workspace.activeBoard)) {
    workspace.activeBoard = remaining[0].id;
  }
  workspace.removedStarterBoardsVersion = 1;
  return true;
}

// Read editable avatar abbreviations on each load without replacing workspace data.
function syncUserShortNames(workspace, configured) {
  let changed = false;
  for (const user of workspace.users) {
    const source = configured.users.find(candidate => candidate.id === user.id) ||
      configured.users.find(candidate => user.trelloId && candidate.trelloId === user.trelloId) ||
      configured.users.find(candidate => candidate.name === user.name);
    if (!source || typeof source.shortName !== 'string') continue;
    if (user.shortName !== source.shortName) {
      user.shortName = source.shortName;
      changed = true;
    }
  }
  return changed;
}

// Resolve explicit account aliases, including references in existing browser data.
function mergeUserAliases(workspace, configured, currentUserId) {
  const aliases = configured.userAliases || [];
  const redirects = new Map();
  let changed = false;
  for (const alias of aliases) {
    const definition = configured.users.find(user => user.id === alias.targetId);
    if (!definition) continue;
    let target = workspace.users.find(user => user.id === definition.id) ||
      workspace.users.find(user => user.name === definition.name);
    if (!target) { target = {...definition}; workspace.users.push(target); changed = true; }
    redirects.set(alias.sourceId, target);
    for (const user of workspace.users) {
      if (user.id !== target.id && (user.id === alias.sourceId ||
          user.name === alias.sourceName ||
          (alias.sourceName === 'Yi-Yang Cho' && user.name === 'Y-Yang Cho') ||
          (alias.trelloId && user.trelloId === alias.trelloId))) {
        redirects.set(user.id, target);
      }
    }
  }
  for (const board of workspace.boards) {
    for (const card of board.cards) {
      const assignees = [...new Set(card.assignees.map(id => redirects.get(id)?.id || id))];
      if (JSON.stringify(assignees) !== JSON.stringify(card.assignees)) {
        card.assignees = assignees; changed = true;
      }
      for (const comment of card.comments) {
        const target = redirects.get(comment.userId);
        if (!target) continue;
        comment.originalUsername ??= comment.username;
        comment.userId = target.id;
        comment.username = target.name;
        changed = true;
      }
    }
  }
  const users = workspace.users.filter(user => !redirects.has(user.id));
  if (users.length !== workspace.users.length) { workspace.users = users; changed = true; }
  return {changed, currentUserId: redirects.get(currentUserId)?.id || null};
}
