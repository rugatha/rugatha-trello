import { auth, firestore } from './auth.js';
import {
  collection, doc, getDoc, getDocs, increment, limit, orderBy, query,
  setDoc, startAfter, updateDoc, writeBatch
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

const $ = selector => document.querySelector(selector);
const workspace = ['workspaces', 'main', 'boards'];
const editableRoles = new Set(['owner', 'admin', 'editor']);
const dialog = $('#cloudDialog');
let role = null;
let memberId = null;
let accessboard = [];
let roster = [];
let boardId = null;
let cardId = null;
let boards = [];
let columns = [];
let cards = [];
let cardCursor = null;
const pageSize = 50;
let requestVersion = 0;

function status(message) { $('#cloudStatus').textContent = message; }
function boardRef(id) { return doc(firestore, ...workspace, id); }
function columnsRef(id) { return collection(firestore, ...workspace, id, 'columns'); }
function cardsRef(id) { return collection(firestore, ...workspace, id, 'cards'); }
function cardRef(id, card) { return doc(firestore, ...workspace, id, 'cards', card); }
function commentsRef(id, card) { return collection(firestore, ...workspace, id, 'cards', card, 'comments'); }
function checklistRef(id, card) { return collection(firestore, ...workspace, id, 'cards', card, 'checklist'); }
function ordered(items) { return items.sort((a, b) => String(a.orderKey || '').localeCompare(String(b.orderKey || ''))); }
function currentUid() { return auth.currentUser?.uid || null; }
function canEdit() { return Boolean(currentUid() && editableRoles.has(role)); }
function option(value, label) {
  const element = document.createElement('option');
  element.value = value;
  element.textContent = label;
  return element;
}

function renderCards() {
  const container = $('#cloudCards');
  container.replaceChildren();
  for (const column of columns) {
    const group = document.createElement('section');
    group.className = 'cloud-column';
    const heading = document.createElement('h3');
    heading.textContent = column.name;
    group.append(heading);
    const matches = cards.filter(card => card.columnId === column.id);
    for (const card of matches) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cloud-card-row';
      button.textContent = card.title;
      button.addEventListener('click', () => openCard(card.id));
      group.append(button);
    }
    if (!matches.length) {
      const empty = document.createElement('p');
      empty.className = 'muted small';
      empty.textContent = '沒有牌卡';
      group.append(empty);
    }
    container.append(group);
  }
}

async function loadBoards() {
  const version = ++requestVersion;
  status('讀取雲端看板中…');
  $('#cloudBoardArea').hidden = true;
  $('#cloudCardDetail').hidden = true;
  try {
    const snapshots = await Promise.all(accessboard.map(id => getDoc(boardRef(id))));
    if (version !== requestVersion || !dialog.open || !role) return;
    boards = ordered(snapshots.filter(item => item.exists()).map(item => ({ ...item.data(), id: item.id })));
    const select = $('#cloudBoardSelect');
    select.replaceChildren(...boards.map(board => option(board.id, board.name)));
    if (!boards.length) { status('雲端尚無看板。'); return; }
    boardId = boards.some(board => board.id === boardId) ? boardId : boards[0].id;
    select.value = boardId;
    await loadBoard();
  } catch (error) {
    if (version === requestVersion) status('讀取看板失敗：' + error.message);
  }
}

async function loadBoard() {
  if (!boardId || !role) return;
  const version = ++requestVersion;
  status('讀取階段與牌卡中…');
  $('#cloudBoardArea').hidden = true;
  $('#cloudCardDetail').hidden = true;
  cardId = null;
  try {
    const [columnSnapshot, cardSnapshot] = await Promise.all([
      getDocs(columnsRef(boardId)),
      getDocs(query(cardsRef(boardId), orderBy('orderKey'), limit(pageSize)))
    ]);
    if (version !== requestVersion || !dialog.open || !role) return;
    columns = ordered(columnSnapshot.docs.map(item => ({ ...item.data(), id: item.id })));
    cards = ordered(cardSnapshot.docs.map(item => ({ ...item.data(), id: item.id })));
    cardCursor = cardSnapshot.docs.at(-1) || null;
    $('#cloudLoadMore').hidden = cardSnapshot.size < pageSize;
    $('#cloudNewCardColumn').replaceChildren(...columns.map(column => option(column.id, column.name)));
    $('#cloudNewCardForm').hidden = !canEdit() || !columns.length;
    $('#cloudBoardArea').hidden = false;
    renderCards();
    status(`${columns.length} 個階段 · 已載入 ${cards.length} 張雲端牌卡`);
  } catch (error) {
    if (version === requestVersion) status('讀取牌卡失敗：' + error.message);
  }
}

async function loadMoreCards() {
  if (!boardId || !cardCursor || !role) return;
  const selectedBoard = boardId;
  const version = ++requestVersion;
  const button = $('#cloudLoadMore');
  button.disabled = true;
  status('載入更多牌卡中…');
  try {
    const snapshot = await getDocs(query(
      cardsRef(selectedBoard), orderBy('orderKey'), startAfter(cardCursor), limit(pageSize)
    ));
    if (version !== requestVersion || selectedBoard !== boardId || !dialog.open || !role) return;
    cardCursor = snapshot.docs.at(-1) || null;
    const seen = new Set(cards.map(card => card.id));
    cards.push(...snapshot.docs.filter(item => !seen.has(item.id))
      .map(item => ({ ...item.data(), id: item.id })));
    ordered(cards);
    renderCards();
    button.hidden = snapshot.size < pageSize;
    status(`已載入 ${cards.length} 張雲端牌卡`);
  } catch (error) {
    if (version === requestVersion) status('載入更多牌卡失敗：' + error.message);
  } finally { button.disabled = false; }
}

async function openCard(id) {
  const selectedBoard = boardId;
  const version = ++requestVersion;
  cardId = id;
  status('讀取牌卡與留言中…');
  try {
    const [cardSnapshot, commentSnapshot, checklistSnapshot] = await Promise.all([
      getDoc(cardRef(selectedBoard, id)),
      getDocs(commentsRef(selectedBoard, id)),
      getDocs(checklistRef(selectedBoard, id))
    ]);
    if (version !== requestVersion || selectedBoard !== boardId || !dialog.open || !role) return;
    if (!cardSnapshot.exists()) { status('這張牌卡已不存在，請重新整理。'); return; }
    const card = cardSnapshot.data();
    $('#cloudCardTitle').value = card.title || '';
    $('#cloudCardDescription').value = card.description || '';
    $('#cloudCardStage').replaceChildren(...columns.map(column => option(column.id, column.name)));
    $('#cloudCardStage').value = card.columnId || '';
    $('#cloudCardTitle').readOnly = !canEdit();
    $('#cloudCardDescription').readOnly = !canEdit();
    $('#cloudCardStage').disabled = !canEdit();
    $('#saveCloudCard').hidden = !canEdit();
    $('#cloudCommentForm').hidden = !canEdit();
    $('#cloudCheckForm').hidden = !canEdit();
    const checklist = ordered(checklistSnapshot.docs.map(item => ({ ...item.data(), id: item.id })));
    const checklistList = $('#cloudChecklist');
    checklistList.replaceChildren();
    for (const item of checklist) {
      const label = document.createElement('label');
      label.className = 'row cloud-check-item';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = Boolean(item.done);
      checkbox.disabled = !canEdit();
      checkbox.addEventListener('change', async () => {
        checkbox.disabled = true;
        try {
          await updateDoc(doc(checklistRef(selectedBoard, id), item.id), { done: checkbox.checked });
          status('待辦事項已更新。');
        } catch (error) {
          checkbox.checked = !checkbox.checked;
          status('更新待辦事項失敗：' + error.message);
        } finally { checkbox.disabled = !canEdit(); }
      });
      const text = document.createElement('span');
      text.textContent = item.text || '';
      label.append(checkbox, text);
      checklistList.append(label);
    }
    if (!checklist.length) checklistList.textContent = '尚無待辦事項。';
    const comments = commentSnapshot.docs.map(item => item.data())
      .sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
    const list = $('#cloudComments');
    list.replaceChildren();
    for (const comment of comments) {
      const row = document.createElement('p');
      row.className = 'cloud-comment';
      const name = document.createElement('strong');
      name.textContent = roster.find(item => item.id === comment.memberId)?.name || '未知成員';
      const text = document.createElement('span');
      text.textContent = comment.text || '';
      row.append(name, text);
      list.append(row);
    }
    if (!comments.length) list.textContent = '尚無留言。';
    $('#cloudCardDetail').hidden = false;
    status(`正在檢視：${card.title}`);
  } catch (error) {
    if (version === requestVersion) status('讀取牌卡失敗：' + error.message);
  }
}

$('#cloudBoardsBtn').addEventListener('click', () => {
  if (!role || !currentUid()) return;
  dialog.showModal();
  loadBoards();
});
$('#closeCloud').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => { requestVersion++; });
$('#refreshCloud').addEventListener('click', loadBoards);
$('#cloudLoadMore').addEventListener('click', loadMoreCards);
$('#cloudBoardSelect').addEventListener('change', event => {
  boardId = event.target.value;
  loadBoard();
});

$('#cloudNewCardForm').addEventListener('submit', async event => {
  event.preventDefault();
  const title = $('#cloudNewCardTitle').value.trim();
  const columnId = $('#cloudNewCardColumn').value;
  const uid = memberId;
  const targetBoard = boardId;
  if (!canEdit() || !title || !columns.some(column => column.id === columnId)) return;
  const button = event.target.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const ref = doc(cardsRef(targetBoard));
    const newCard = {
      id: ref.id, title, columnId, description: '', labels: [], due: '', done: false,
      createdAt: new Date().toISOString(), createdBy: uid, updatedBy: uid,
      assigneeIds: [],
      orderKey: '!' + String(9999999999999 - Date.now()).padStart(13, '0') + '-' + ref.id,
      checklistCount: 0, commentCount: 0, attachmentCount: 0
    };
    await setDoc(ref, newCard);
    if (targetBoard === boardId && dialog.open) {
      $('#cloudNewCardTitle').value = '';
      cards.unshift(newCard);
      renderCards();
      await openCard(ref.id);
    }
  } catch (error) { status('新增牌卡失敗：' + error.message); }
  finally { button.disabled = false; }
});

$('#saveCloudCard').addEventListener('click', async event => {
  const title = $('#cloudCardTitle').value.trim();
  const description = $('#cloudCardDescription').value;
  const columnId = $('#cloudCardStage').value;
  const selectedBoard = boardId;
  const selectedCard = cardId;
  if (!canEdit() || !title || !selectedCard || !columns.some(column => column.id === columnId)) return;
  event.target.disabled = true;
  try {
    await updateDoc(cardRef(selectedBoard, selectedCard), {
      title, description, columnId, updatedBy: memberId, updatedAt: new Date().toISOString()
    });
    if (selectedBoard === boardId) {
      const card = cards.find(item => item.id === selectedCard);
      if (card) { card.title = title; card.columnId = columnId; }
      renderCards();
    }
    status('雲端牌卡已儲存。');
  } catch (error) { status('儲存牌卡失敗：' + error.message); }
  finally { event.target.disabled = false; }
});

$('#cloudCheckForm').addEventListener('submit', async event => {
  event.preventDefault();
  const text = $('#cloudCheckText').value.trim();
  const selectedBoard = boardId;
  const selectedCard = cardId;
  if (!canEdit() || !text || !selectedCard) return;
  const button = event.target.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const ref = doc(checklistRef(selectedBoard, selectedCard));
    const batch = writeBatch(firestore);
    batch.set(ref, {
      id: ref.id, text, done: false,
      orderKey: '!' + String(9999999999999 - Date.now()).padStart(13, '0') + '-' + ref.id
    });
    batch.update(cardRef(selectedBoard, selectedCard), {
      checklistCount: increment(1), updatedBy: memberId, updatedAt: new Date().toISOString()
    });
    await batch.commit();
    if (selectedBoard === boardId && selectedCard === cardId && dialog.open) {
      $('#cloudCheckText').value = '';
      await openCard(selectedCard);
    }
  } catch (error) { status('新增待辦事項失敗：' + error.message); }
  finally { button.disabled = false; }
});

$('#cloudCommentForm').addEventListener('submit', async event => {
  event.preventDefault();
  const text = $('#cloudCommentText').value.trim();
  const selectedBoard = boardId;
  const selectedCard = cardId;
  if (!canEdit() || !text || !selectedCard) return;
  const button = event.target.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const ref = doc(commentsRef(selectedBoard, selectedCard));
    const batch = writeBatch(firestore);
    batch.set(ref, {
      id: ref.id, memberId,
      text, at: new Date().toISOString()
    });
    batch.update(cardRef(selectedBoard, selectedCard), {
      commentCount: increment(1), updatedBy: memberId, updatedAt: new Date().toISOString()
    });
    await batch.commit();
    if (selectedBoard === boardId && selectedCard === cardId && dialog.open) {
      $('#cloudCommentText').value = '';
      await openCard(selectedCard);
    }
  } catch (error) { status('留言失敗：' + error.message); }
  finally { button.disabled = false; }
});

function onAccountChanged(account) {
  role = account?.workspaceRole || null;
  memberId = account?.memberId || null;
  accessboard = account?.accessboard || [];
  roster = account?.roster || [];
  $('#cloudBoardsBtn').hidden = !role;
  if (!role && dialog.open) dialog.close();
}
window.addEventListener('boardly-auth-changed', event => onAccountChanged(event.detail));
onAccountChanged(window.boardlyGoogleUser);
