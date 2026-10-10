import { firestore } from './auth.js';
import { collection, doc, onSnapshot, runTransaction } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import {getFirestore as getReadFirestore, doc as readDoc, collection as readCollection, getDoc, getDocs} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore-lite.js';
import { documents, changes } from './workspace-data.js';
import { compareOrderKey } from './order-key.js';
// One-shot reads use REST, independent of the live SDK's already-current query view.
// The same Firebase app supplies Authentication and enforces the same security rules.
const readFirestore = getReadFirestore(firestore.app);
const root = 'workspaces/main/boards';
const ordered = items => items.sort((a,b) => compareOrderKey(a.orderKey,b.orderKey));
async function rows(path) {
  const snapshot = await getDocs(readCollection(readFirestore, path));
  return ordered(snapshot.docs.map(item => ({...item.data(), id:item.id})));
}
export async function loadWorkspace(account, {previous,boardIds}={}) {
  const saved = new Map(previous?.boards?.map(board => [board.id,board]) || []);
  const reload = boardIds ? new Set(boardIds) : null;
  const boards = await Promise.all([...new Set(account.accessboard || [])].map(async id => {
    if(reload && !reload.has(id) && saved.has(id))return saved.get(id);
    const path = `${root}/${id}`;
    const snapshot = await getDoc(readDoc(readFirestore, path));
    if (!snapshot.exists()) return null;
    const [columns, cards] = await Promise.all([rows(`${path}/columns`), rows(`${path}/cards`)]);
    // Fetch in small groups to avoid flooding the connection with subcollection requests.
    const visible = cards.filter(card => !card.archived);
    const archivedCards = cards.filter(card => card.archived).map(({id,title,columnId}) => ({id,title,columnId}));
    for (let start=0; start<visible.length; start+=10) {
      await Promise.all(visible.slice(start,start+10).map(async card => {
        [card.checklist, card.comments, card.attachments] = await Promise.all(
          ['checklist','comments','attachments'].map(type =>
            type==='checklist' && card.checklistCount===0 || type==='comments' && card.commentCount===0 || type==='attachments' && card.attachmentCount===0
              ? [] : rows(`${path}/cards/${card.id}/${type}`)));
        card.attachmentArchiveLoaded = card.attachmentCount!==0;
        card.archivedAttachments = card.attachments.filter(item => item.archived).map(({id,name}) => ({id,name}));
        card.attachments = card.attachments.filter(item => !item.archived);
        card.comments.sort((a,b)=>String(a.at).localeCompare(String(b.at)));
        card.comments.forEach(item => { item.userId = item.memberId; });
        card.assignees = card.assigneeIds || [];
        card.labels ||= []; card.description ||= ''; card.due ||= '';
      }));
    }
    return {...snapshot.data(), id, columns, cards:visible, archivedCards};
  }));
  return {version:1, users:account.roster || [], boards:ordered(boards.filter(Boolean)), activeBoard:null};
}
// Zero active attachments does not imply an empty archive. Fetch those collections
// only when the board archive is opened; never change editable card data here.
export async function loadDeferredAttachmentArchives(board) {
  const result = [];
  const deferred = board.cards.filter(card => card.attachmentArchiveLoaded === false);
  for (let start=0; start<deferred.length; start+=10) {
    result.push(...await Promise.all(deferred.slice(start,start+10).map(async card => {
      const files = await rows(`${root}/${board.id}/cards/${card.id}/attachments`);
      return {cardId:card.id, files:files.filter(file=>file.archived).map(({id,name})=>({id,name}))};
    })));
  }
  return result;
}
export function subscribeWorkspace(account, onChange, onError) {
  const unsubscribe = [];
  for (const id of new Set(account.accessboard || [])) {
    const path = `${root}/${id}`;
    for (const ref of [doc(firestore,path),collection(firestore,`${path}/columns`),collection(firestore,`${path}/cards`)]) {
      let initial = true;
      unsubscribe.push(onSnapshot(ref, snapshot => {
        if (snapshot.metadata.hasPendingWrites) return;
        if (initial) { initial = false; return; }
        onChange(id);
      }, onError));
    }
  }
  return () => unsubscribe.forEach(stop => stop());
}
export async function restoreCard(boardId, cardId, memberId) {
  const ref = doc(firestore, `${root}/${boardId}/cards/${cardId}`);
  await runTransaction(firestore, async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists() || snapshot.data().archived !== true) throw new Error('牌卡已變更，請重新整理');
    transaction.update(ref, {archived:false, updatedBy:memberId, updatedAt:new Date().toISOString()});
  });
}
export async function restoreAttachment(boardId, cardId, attachmentId, memberId) {
  const cardRef = doc(firestore, `${root}/${boardId}/cards/${cardId}`);
  const attachmentRef = doc(firestore, `${root}/${boardId}/cards/${cardId}/attachments/${attachmentId}`);
  await runTransaction(firestore, async transaction => {
    const [card, attachment] = await Promise.all([transaction.get(cardRef), transaction.get(attachmentRef)]);
    if (!card.exists() || card.data().archived || !attachment.exists() || attachment.data().archived !== true) {
      throw new Error('附件或牌卡已變更，請重新整理');
    }
    transaction.update(attachmentRef, {archived:false});
    transaction.update(cardRef, {
      attachmentCount: (card.data().attachmentCount || 0) + 1,
      updatedBy:memberId, updatedAt:new Date().toISOString()
    });
  });
}
export async function persistWorkspace(before, after, memberId) {
  const operations = changes(documents(before), documents(after));
  // Child-only edits must notify the card listener too.
  const parentPaths = new Set(operations.map(op => op.path));
  const beforeDocs = documents(before), afterDocs = documents(after);
  for (const op of [...operations]) {
    const match = op.path.match(/^(.*\/cards\/[^/]+)\/(?:checklist|comments|attachments)\/[^/]+$/);
    const path = match?.[1];
    if (path && !parentPaths.has(path) && afterDocs.has(path)) {
      operations.push({path,before:beforeDocs.get(path),after:afterDocs.get(path),patch:{updatedAt:beforeDocs.get(path)?.updatedAt}});
      parentPaths.add(path);
    }
  }
  if (!operations.length) return [];
  if (operations.length > 400) throw new Error('此次變更過大，請分次操作');
  const updatedAt = new Date().toISOString();
  const committedCards = operations.filter(op=>op.after && /\/cards\/[^/]+$/.test(op.path))
    .map(op=>({boardId:op.path.split('/')[3],cardId:op.path.split('/')[5],updatedAt,
      createdBy:op.before?null:memberId}));
  await runTransaction(firestore, async transaction => {
    const snapshots = await Promise.all(operations.map(op => transaction.get(doc(firestore, op.path))));
    operations.forEach((op,index) => {
      const snapshot = snapshots[index];
      if (op.before ? !snapshot.exists() : snapshot.exists()) throw new Error('資料已變更，請重新整理後再試');
      const remote = snapshot.data() || {};
      for (const key of Object.keys(op.patch || op.before || {})) {
        if (op.before && JSON.stringify(remote[key]) !== JSON.stringify(op.before[key])) {
          throw new Error('其他成員已修改此資料，請重新整理後再試');
        }
      }
    });
    operations.forEach(op => {
      const ref = doc(firestore, op.path);
      if (!op.after) {
        if (/\/cards\/[^/]+(?:\/attachments\/[^/]+)?$/.test(op.path)) {
          transaction.update(ref, {archived:true, updatedBy:memberId});
        } else transaction.delete(ref);
      } else {
        const payload = {...op.patch};
        if (/\/cards\/[^/]+$/.test(op.path)) {
          payload.updatedBy = memberId;
          payload.updatedAt = updatedAt;
          if (!op.before) payload.createdBy = memberId;
        }
        if (op.before) transaction.update(ref,payload);
        else transaction.set(ref,payload);
      }
    });
  });
  return committedCards;
}
