import { firestore } from './auth.js';
import { collection, doc, getDocFromServer, getDocsFromServer, runTransaction } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { documents, changes } from './workspace-data.js';
const root = 'workspaces/main/boards';
const ordered = items => items.sort((a,b) => String(a.orderKey || '').localeCompare(String(b.orderKey || '')));
async function rows(path) {
  const snapshot = await getDocsFromServer(collection(firestore, path));
  return ordered(snapshot.docs.map(item => ({...item.data(), id:item.id})));
}
export async function loadWorkspace(account) {
  const boards = await Promise.all([...new Set(account.accessboard || [])].map(async id => {
    const path = `${root}/${id}`;
    const snapshot = await getDocFromServer(doc(firestore, path));
    if (!snapshot.exists()) return null;
    const [columns, cards] = await Promise.all([rows(`${path}/columns`), rows(`${path}/cards`)]);
    // Fetch in small groups to avoid flooding the connection with subcollection requests.
    const visible = cards.filter(card => !card.archived);
    for (let start=0; start<visible.length; start+=10) {
      await Promise.all(visible.slice(start,start+10).map(async card => {
        [card.checklist, card.comments, card.attachments] = await Promise.all(
          ['checklist','comments','attachments'].map(type => rows(`${path}/cards/${card.id}/${type}`)));
        card.attachments = card.attachments.filter(item => !item.archived);
        card.comments.sort((a,b)=>String(a.at).localeCompare(String(b.at)));
        card.comments.forEach(item => { item.userId = item.memberId; });
        card.assignees = card.assigneeIds || [];
        card.labels ||= []; card.description ||= ''; card.due ||= '';
      }));
    }
    return {...snapshot.data(), id, columns, cards:visible};
  }));
  return {version:1, users:account.roster || [], boards:ordered(boards.filter(Boolean)), activeBoard:null};
}
export async function persistWorkspace(before, after, memberId) {
  const operations = changes(documents(before), documents(after));
  if (!operations.length) return;
  if (operations.length > 400) throw new Error('此次變更過大，請分次操作');
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
        if (op.path.includes('/cards/') && !op.path.includes('/checklist/')) {
          transaction.update(ref, {archived:true, updatedBy:memberId});
        } else transaction.delete(ref);
      } else {
        const payload = {...op.patch};
        if (/\/cards\/[^/]+$/.test(op.path)) {
          payload.updatedBy = memberId;
          payload.updatedAt = new Date().toISOString();
          if (!op.before) payload.createdBy = memberId;
        }
        if (op.before) transaction.update(ref,payload);
        else transaction.set(ref,payload);
      }
    });
  });
}
