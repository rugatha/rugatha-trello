"use strict";

// Browser storage holds draft boards and cards only. Firestore owns all member profiles.
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('boardly-workspace', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('data');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function readDB() {
  return new Promise((resolve, reject) => {
    const req = db.transaction('data').objectStore('data').get('workspace');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function save() {
  if (!db) {
    toast('無法儲存：請先匯出備份，並允許瀏覽器儲存資料');
    return;
  }
  const draft = structuredClone({...state, users: []});
  delete draft.userAliases;
  for (const board of draft.boards) {
    for (const card of board.cards) {
      for (const comment of card.comments) {
        delete comment.username;
        delete comment.originalUsername;
      }
    }
  }
  const transaction = db.transaction('data', 'readwrite');
  transaction.objectStore('data').put(draft, 'workspace');
  transaction.onerror = () => toast('儲存失敗，可能空間不足。請匯出備份。');
}

async function loadInitialData() {
  const response = await fetch('./data.json', {cache: 'no-cache'});
  if (!response.ok) throw new Error(`無法載入 data.json（HTTP ${response.status}）`);
  const data = await response.json();
  if (!validateImport(data)) throw new Error('data.json 格式不正確或資料不完整');
  return data;
}
