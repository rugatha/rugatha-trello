// Pure mapping between the existing UI and Firestore's document/subcollection schema.
const omit = (value, keys) => Object.fromEntries(Object.entries(value).filter(([key])=>!keys.includes(key)));
export function documents(state) {
  const result = new Map();
  for (const board of state.boards) {
    const path = `workspaces/main/boards/${board.id}`;
    result.set(path, omit(board,['columns','cards']));
    board.columns.forEach(column=>result.set(`${path}/columns/${column.id}`, {...column}));
    board.cards.forEach(card=>{
      const cardPath = `${path}/cards/${card.id}`;
      result.set(cardPath, {...omit(card,['checklist','comments','attachments','assignees']), assigneeIds:card.assignees,
        checklistCount:card.checklist.length, commentCount:card.comments.length, attachmentCount:card.attachments.length});
      for (const type of ['checklist','comments','attachments']) {
        card[type].forEach(item=>result.set(`${cardPath}/${type}/${item.id}`, type==='comments'
          ? {...omit(item,['userId']),memberId:item.userId} : {...item}));
      }
    });
  }
  return result;
}
export function changes(before, after) {
  const result=[];
  for (const path of new Set([...before.keys(),...after.keys()])) {
    const a=before.get(path),b=after.get(path);
    // Archiving a card preserves all of its child documents.
    if (!b && /\/cards\/[^/]+\//.test(path) && !after.has(path.split('/').slice(0,6).join('/'))) continue;
    const patch=b && Object.fromEntries(Object.entries(b).filter(([key,value])=>JSON.stringify(a?.[key])!==JSON.stringify(value)));
    if (!a || !b || Object.keys(patch).length) result.push({path,before:a,after:b,patch});
  }
  return result;
}
