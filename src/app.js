import {bindCommentComposer,connectNotifications,renderMentionText} from './interactions.js';
import {clearAttachmentUI,hydrateAttachmentImages,downloadAttachment,bindAttachmentUpload} from './attachment-ui.js';
import { listManagementMembers, createManagedBoard, setManagedAssignees, manageContentLifecycle } from './management.js';
import { loadWorkspace, subscribeWorkspace, persistWorkspace, restoreCard, restoreAttachment, loadDeferredAttachmentArchives, saveBoardLabel } from './storage.js?v=20261022-partial-deadline';
import { assignMovedOrderKey } from './order-key.js';
import {boardLabels,labelColor,labelInk,placeCard,placeChecklist,deadlineDisplay,deadlineFields,bindDeadlineFields} from './card-options.js?v=20261022-checklist-edit';
// UI rendering, interaction handlers, and workspace state.
'use strict';
const $=s=>document.querySelector(s), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])), uid=()=>crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2);
const boardColors=['#455f56','#c8b58f','#8fa697','#bca582','#ad9790'];
let state={version:1,boards:[],users:[]},currentCard=null,mine=false,dragged=null,toastTimer,googleAccount=null;
function toast(s){$('#toast').textContent=s;$('#toast').classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.add('hidden'),4000)}

function userId(){return googleAccount?.memberId || null}

function me(){return state.users.find(u=>u.id===userId())}

function board(){return state.boards.find(b=>b.id===state.activeBoard)}

function avatar(u){return u?`<span class="avatar" title="${esc(u.name)}">${/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(u.avatar||'')?`<img src="${esc(u.avatar)}" alt="">`:esc([...(u.name||'')].slice(0,1).join(''))}</span>`:''}

function overdue(c){return c.due&&!c.done&&new Date(c.due)<new Date()}

function formatDate(s,full=false){return new Intl.DateTimeFormat('zh-TW',full?{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}:{month:'short',day:'numeric'}).format(new Date(s))}

function safeImage(a){return /^data:image\/(png|jpeg|gif|webp|avif|bmp);base64,/i.test(a.data)}
const boardColorNames=['森林綠','暖沙色','鼠尾草綠','奶茶色','玫瑰灰'];
function applyBoardColor(value){
  const color=boardColors.includes(value)?value:boardColors[0];
  const dark=color===boardColors[0];
  $('.main').style.cssText=`--board-bg:${color};--on-primary:${dark?'var(--board-light-ink)':'var(--board-dark-ink)'};--on-primary-muted:${dark?'var(--board-light-muted)':'var(--board-dark-ink)'}`;
}
function personalBoards() {
  const positions = new Map((googleAccount?.boardOrder || []).map((id, i) => [id, i]));
  return [...state.boards].sort((a, b) =>
    Number(Boolean(b.starred)) - Number(Boolean(a.starred)) ||
    (a.starred && b.starred ? (a.starredOrder || 0) - (b.starredOrder || 0) : 0) ||
    (positions.get(a.id) ?? Infinity) - (positions.get(b.id) ?? Infinity));
}
function toggleBoardStar(){
  const active=board();
  if(!active||!canEdit()||active.archived||active.deleting)return;
  active.starred=!active.starred;
  if(active.starred){
    // Legacy favorites have rank zero; each new favorite follows all existing ones.
    active.starredOrder=state.boards.reduce((last,b)=>b.starred?Math.max(last,b.starredOrder||0):last,0)+1;
  }
  save();render();
}
let boardOrderDraft = [], boardOrderSaving = false, boardOrderDrag = null;
function moveBoardOrder(from,to){
  if(boardOrderSaving||from<0||to<0||to>=boardOrderDraft.length||from===to)return;
  const [id]=boardOrderDraft.splice(from,1);boardOrderDraft.splice(to,0,id);
  renderBoardOrder();
}
function renderBoardOrder() {
  const list=$('#boardOrderList');
  list.innerHTML = boardOrderDraft.map(id => {
    const b = state.boards.find(item => item.id === id);
    return `<div class="row board-order-row${boardOrderDrag?.id===id?' dragging':''}" data-board-order="${esc(id)}"><button type="button" class="board-order-handle" data-board-drag="${esc(id)}" aria-label="拖曳排序 ${esc(b.name)}" aria-describedby="boardOrderHelp" ${boardOrderSaving?'disabled':''}>⠿</button><span class="grow">${esc(b.name)}${b.archived?'（已封存）':''}</span></div>`;
  }).join('');
  const finish=cancel=>{
    const drag=boardOrderDrag;if(!drag)return;
    boardOrderDrag=null;
    if(cancel)boardOrderDraft=drag.original;
    if(list.hasPointerCapture?.(drag.pointerId))list.releasePointerCapture(drag.pointerId);
    renderBoardOrder();
    $$('[data-board-drag]').find(el=>el.dataset.boardDrag===drag.id)?.focus?.();
  };
  list.onpointerdown=event=>{
    const handle=event.target.closest('[data-board-drag]');
    if(!handle||boardOrderSaving||boardOrderDrag||event.button!==0||event.isPrimary===false)return;
    boardOrderDrag={id:handle.dataset.boardDrag,pointerId:event.pointerId,startY:event.clientY,original:[...boardOrderDraft]};
    list.setPointerCapture?.(event.pointerId);
    handle.closest('[data-board-order]')?.classList.add('dragging');
  };
  list.onpointermove=event=>{
    const drag=boardOrderDrag;
    if(!drag||drag.pointerId!==event.pointerId||boardOrderSaving)return;
    if(!drag.started&&Math.abs(event.clientY-drag.startY)<5)return;
    drag.started=true;
    event.preventDefault();
    const rows=$$('[data-board-order]').filter(el=>el.dataset.boardOrder!==drag.id);
    const to=rows.filter(el=>{const rect=el.getBoundingClientRect();return event.clientY>rect.top+rect.height/2;}).length;
    moveBoardOrder(boardOrderDraft.indexOf(drag.id),to);
  };
  list.onpointerup=event=>{if(boardOrderDrag?.pointerId===event.pointerId)finish(false);};
  list.onpointercancel=event=>{if(boardOrderDrag?.pointerId===event.pointerId)finish(true);};
  list.onlostpointercapture=event=>{if(boardOrderDrag?.pointerId===event.pointerId)finish(true);};
  $$('[data-board-drag]').forEach(el=>el.onkeydown=event=>{
    if(event.key==='Escape'&&boardOrderDrag){event.preventDefault();finish(true);return;}
    if(!['ArrowUp','ArrowDown'].includes(event.key)||boardOrderSaving||boardOrderDrag)return;
    event.preventDefault();
    const from=boardOrderDraft.indexOf(el.dataset.boardDrag);
    moveBoardOrder(from,from+(event.key==='ArrowUp'?-1:1));
    $$('[data-board-drag]').find(node=>node.dataset.boardDrag===el.dataset.boardDrag)?.focus?.();
  });
}
$('#sortBoards').onclick = () => {
  if (!googleAccount?.memberId || loading || saving || boardOrderSaving) return;
  boardOrderDrag=null;boardOrderDraft = personalBoards().map(b => b.id);
  $('#boardOrderStatus').textContent = '';
  renderBoardOrder(); $('#boardOrderDialog').showModal();
};
$('#closeBoardOrder').onclick = () => $('#boardOrderDialog').close();
$('#boardOrderDialog').onclose=()=>{boardOrderDrag=null;};
$('#saveBoardOrder').onclick = async () => {
  if (boardOrderSaving || boardOrderDrag || !googleAccount?.memberId) return;
  const actor = googleAccount, version = generation;
  boardOrderSaving = true; $('#saveBoardOrder').disabled = true; renderBoardOrder();
  $('#boardOrderStatus').textContent = '正在儲存順序…';
  try {
    const saved = await window.boardlyGoogleAuth.saveBoardOrder([...boardOrderDraft]);
    if (saved && googleAccount?.uid === actor.uid && googleAccount?.memberId === actor.memberId) {
      $('#boardOrderDialog').close(); toast('看板順序已儲存');
    }
  } catch (error) {
    if (version === generation) $('#boardOrderStatus').textContent = '順序未儲存：' + error.message;
  } finally {
    if (version === generation) {
      boardOrderSaving = false; $('#saveBoardOrder').disabled = false; renderBoardOrder(); flushLiveSync();
    }
  }
};
function renderBoardNavigation(active) {
  const expanded = $('#archivedBoards')?.open || false;
  const boardButton = x=>`<button class="nav-button ${x.id===active?.id?'active':''}" data-board="${x.id}" title="${esc(x.name)}"><span class="board-dot" style="background:${boardColors.includes(x.color)?x.color:boardColors[0]}"></span><span class="nav-text grow">${esc(x.name)}</span>${x.starred?'<span class="nav-text">★</span>':''}</button>`;
  const boards = personalBoards();
  const current = boards.filter(board => !board.archived);
  const archived = boards.filter(board => board.archived);
  $('#boardNav').innerHTML = current.map(boardButton).join('') + (archived.length ?
    `<details id="archivedBoards" class="archived-boards" ${expanded?'open':''}>
      <summary title="展開封存看板"><span>封存看板</span><span class="count">${archived.length}</span></summary>
      <div>${archived.map(boardButton).join('')}</div>
    </details>` : '');
  $$('[data-board]').forEach(el=>el.onclick=()=>selectBoard(el.dataset.board));
}
function selectBoard(id){
  if(!state.boards.some(b=>b.id===id))return;
  state.activeBoard=id;if(baseline)baseline.activeBoard=id;mine=false;$('#search').value='';$('#dueFilter').value='all';render();
}
function render(){const b=board();$('.main').classList.toggle('welcome-view',!b);$('#welcomeScreen').hidden=Boolean(b);if(!b){renderEmpty();return;}applyBoardColor(b.color);$('#boardTitle').textContent=b.name;$('#crumb').textContent=b.name;$('#boardDescription').textContent=b.description||'為團隊整理任務，讓進度清楚可見。';$('#starBoard').textContent=b.starred?'★':'☆';$('#starBoard').style.color=b.starred?'var(--on-primary)':'';$('#currentUser').innerHTML=avatar(me())+`<span class="user-name">${esc(me()?.name||'Google 登入')}</span><span class="muted">⌄</span>`;$('#headerMembers').innerHTML=state.users.filter(u=>u.boardIds?.includes(b.id)).slice(0,5).map(avatar).join('');renderBoardNavigation(b);const q=$('#search').value.trim().toLowerCase(),filter=$('#dueFilter').value;const visible=b.cards.filter(c=>(!q||(c.title+' '+c.description).toLowerCase().includes(q))&&(!mine||c.assignees.includes(userId()))&&(filter==='all'||filter==='none'&&!c.due||filter==='overdue'&&overdue(c)||filter==='week'&&c.due&&!c.done&&new Date(c.due)>=new Date()&&new Date(c.due)<=new Date(Date.now()+7*86400000)));$('#mineFilter').classList.toggle('filter-active',mine);$('#clearFilters').classList.toggle('hidden',!mine&&!q&&filter==='all');$('#boardStats').textContent=`${b.columns.length} 個階段 · ${b.cards.length} 張卡片${visible.length!==b.cards.length?' · 顯示 '+visible.length+' 張':''}`;$('#columns').innerHTML=b.columns.map((col,i)=>`<section class="column" data-col="${col.id}"><div class="column-head"><span class="board-dot" style="background:${boardColors[i%boardColors.length]}"></span><span class="grow">${esc(col.name)}</span><span class="count">${visible.filter(c=>c.columnId===col.id).length}</span><button data-edit-col="${col.id}" aria-label="編輯階段 ${esc(col.name)}" style="padding:2px 5px">⋯</button></div><div class="cards">${visible.filter(c=>c.columnId===col.id).map(cardHTML).join('')||'<div class="empty">'+(q||mine||filter!=='all'?'沒有符合篩選的卡片':'把想法放在這裡<br><br>拖曳卡片至此，或新增卡片')+'</div>'}</div><button class="add-card" data-add-card="${col.id}">＋ &nbsp; 新增卡片</button></section>`).join('')+'<button class="add-column" id="addColumn">＋ &nbsp; 新增階段</button>';bindBoard();applyPermissions();hydrateAttachmentImages()}
function labelOptions() {return boardLabels(board());}
function labelHTML(id) {
  const label=labelOptions()[id];
  return label ? `<span class="tag" style="background:${labelColor(label.color)};color:${labelInk(label.color)}">${esc(label.name)}</span>` : '';
}
function completionMark(done,button=false) {
  const attrs=`class="completion-toggle ${done?'completed':''}" ${button?`id="cardCompletion" type="button" aria-pressed="${Boolean(done)}" aria-label="${done?'標記為未結案':'標記為結案'}"`:`role="img" aria-label="${done?'已結案':'未結案'}"`}`;
  return button?`<button ${attrs}>${done?'✓':''}</button>`:`<span ${attrs}>${done?'✓':''}</span>`;
}
function safeExternalURL(value) {
  if (typeof value !== 'string') return false;
  try {const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password;} catch {return false;}
}
function attachmentImage(a) {
  if(a.storagePath)return /^image\/(png|jpeg|gif|webp|avif|bmp)$/i.test(a.type) ? 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=' : '';
  if(safeImage(a)) return a.data;
  return safeExternalURL(a.url) && /^image\/(png|jpeg|gif|webp|avif|bmp)$/i.test(a.type) ? a.url : '';
}
function cardHTML(c){const cover=c.attachments.find(a=>a.id===c.coverId&&attachmentImage(a)),checked=c.checklist.filter(t=>t.done).length;return `<article class="card" draggable="true" tabindex="0" role="button" aria-label="開啟卡片：${esc(c.title)}" data-card="${c.id}">${cover?`<img class="cover" ${cover.storagePath?`data-storage-path="${esc(cover.storagePath)}"`:""} src="${esc(attachmentImage(cover))}" loading="lazy" referrerpolicy="no-referrer" alt="${esc(cover.name)}">`:c.demoCover?'<div class="design-cover"><div class="mini-window"><b>MAKE ROOM FOR IDEAS.</b><div class="mini-grid"><i></i><i></i><i></i></div></div></div>':''}<div>${c.labels.map(labelHTML).join('')}</div><div class="card-title"><span class="card-completion">${completionMark(c.done)}</span><span>${esc(c.title)}</span></div>${c.description?`<p class="card-desc">${esc(c.description.slice(0,65))}${c.description.length>65?'…':''}</p>`:''}<div class="card-footer">${c.due?`<span class="due ${overdue(c)?'overdue':''} ${c.done?'done':''}">${c.done?'✓':'◷'} ${esc(c.dueParts?deadlineDisplay(c.due,c.dueParts):formatDate(c.due))}</span>`:''}${c.checklist.length?`<span title="待辦事項">☑ ${checked}/${c.checklist.length}</span>`:''}${c.comments.length?`<span title="留言">☏ ${c.comments.length}</span>`:''}${c.attachments.length?`<span title="附件">♧ ${c.attachments.length}</span>`:''}${c.assignees.length?`<span class="card-assignees" style="--assignee-count:${c.assignees.length}" aria-label="負責人">${c.assignees.map(id=>avatar(state.users.find(u=>u.id===id))).join('')}</span>`:''}</div></article>`}
function bindBoard(){$$('[data-card]').forEach(el=>{el.onclick=()=>openCard(el.dataset.card);el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openCard(el.dataset.card)}};el.ondragstart=e=>{dragged=el.dataset.card;e.dataTransfer.setData('text/plain',dragged);e.dataTransfer.effectAllowed='move';el.classList.add('dragging')};el.ondragend=()=>{dragged=null;$$('.drag-over').forEach(e=>e.classList.remove('drag-over'));el.classList.remove('dragging')}});$$('[data-col]').forEach(el=>{el.ondragover=e=>{if(dragged){e.preventDefault();e.dataTransfer.dropEffect='move';el.classList.add('drag-over')}};el.ondragleave=e=>{if(!el.contains(e.relatedTarget))el.classList.remove('drag-over')};el.ondrop=e=>{e.preventDefault();if(!dragged||!canEdit())return;const b=board(),c=b.cards.find(c=>c.id===dragged);if(!c)return;const target=e.target.closest('[data-card]');if(target?.dataset.card===c.id){el.classList.remove('drag-over');return}b.cards=b.cards.filter(x=>x.id!==c.id);c.columnId=el.dataset.col;let index=target?b.cards.findIndex(x=>x.id===target.dataset.card):-1;if(index>=0){if(e.clientY>target.getBoundingClientRect().top+target.getBoundingClientRect().height/2)index++;b.cards.splice(index,0,c)}else b.cards.push(c);try{assignMovedOrderKey(b.cards,c)}catch(error){state=structuredClone(baseline);render();toast(error.message);return}save();render()}});$$('[data-add-card]').forEach(el=>el.onclick=()=>createCard(el.dataset.addCard));$$('[data-edit-col]').forEach(el=>el.onclick=()=>editColumn(el.dataset.editCol));$('#addColumn').onclick=()=>editColumn()}
function $$(s,root=document){return [...root.querySelectorAll(s)]}

function requireUser(action){if(me())action();else openUsers()}

function openUsers(){
  $('#googleAccountPanel').hidden=!googleAccount;
  $('#localUserPanel').hidden=Boolean(googleAccount);
  $('#userDialogTitle').textContent=googleAccount?'帳號設定':'登入';
  if(googleAccount){
    $('#googleAccountSummary').textContent=`${googleAccount.displayName} · ${googleAccount.email}`;
    const roleNames={admin:'Admin（全站管理員）',owner:'Owner（看板管理者）',editor:'Editor',viewer:'Viewer'};
    $('#workspaceAccess').textContent=googleAccount.workspaceRole
      ?`工作空間權限：${roleNames[googleAccount.workspaceRole]||googleAccount.workspaceRole}`
      :'Google 登入成功；此帳號尚未取得工作空間成員權限。';
  }
  $('#editGoogleName').disabled=!googleAccount?.memberId;
  $('#displayMembers').hidden=!googleAccount?.memberId;
  $('#displayMembers').innerHTML=googleAccount?.memberId ? '<h3>工作空間成員</h3><p class="help-note">此名冊僅供查閱；負責人請在牌卡內由 Admin／Owner／Editor 管理。</p>'+(googleAccount.roster||state.users).map(u=>`<div class="member-display">${avatar(u)}<span>${esc(u.name)}</span></div>`).join('') : '';
  if(!$('#userDialog').open)$('#userDialog').showModal();
}
async function applyGoogleAccount(account){
  stopLiveSync();
  saveFailure='';
  saving=false;
  googleAccount=account;
  connectNotifications(account,{open:openNotification,toast});
  if($('#userDialog').open)openUsers();
  const loaded = await refreshWorkspace();
  if (loaded && googleAccount === account) openLinkedCard();
}
function openLinkedCard(search = window.location?.search || '') {
  if (!search || !googleAccount?.memberId) return;
  const params = new URLSearchParams(search), boardId = params.get('board'), cardId = params.get('card');
  if (!boardId || !cardId) return;
  const target = state.boards.find(b => b.id === boardId && googleAccount.accessboard?.includes(b.id) && !b.deleting);
  const card = target?.cards.find(c => c.id === cardId && !c.deleting);
  if (!card) { toast('此牌卡已封存、刪除或無法存取'); return; }
  selectBoard(target.id); openCard(card.id);
}
window.addEventListener('boardly-auth-changed',event=>applyGoogleAccount(event.detail));
async function openNotification(item){
  if(loading || saving)throw new Error('正在同步或儲存，請稍後再開啟通知');
  if(!googleAccount?.accessboard?.includes(item.boardId))throw new Error('你已無此牌卡的存取權限');
  const actor=googleAccount;
  $('#editor').close();
  const refreshed=await refreshWorkspace([item.boardId],item.boardId);
  if(!refreshed || googleAccount!==actor || !baseline)throw new Error('權限或連線已變更，請重新整理後再試');
  const target=state.boards.find(b=>b.id===item.boardId),card=target?.cards.find(c=>c.id===item.cardId);
  if(!card || target.archived || target.deleting)throw new Error('此牌卡已封存、刪除或無法存取');
  state.activeBoard=target.id;render();openCard(card.id);
  if(item.commentId){
    const comment=$$('[data-comment-id]').find(el=>el.dataset.commentId===item.commentId);
    if(!comment){toast('原留言已刪除');return;}
    comment.classList.add('comment-target');comment.scrollIntoView({block:'center',behavior:'smooth'});comment.focus({preventScroll:true});
  }
}
function simple(title,body,onSubmit){lifecycleDialog=false;assigneeDialog=false;managementRequest++;managementLoading=false;const d=$('#simpleDialog');d.innerHTML=`<form id="simpleForm"><div class="modal-head"><h2 id="simpleTitle">${esc(title)}</h2><button type="button" data-close-simple aria-label="關閉">✕</button></div><div class="modal-body">${body}<div class="row" style="justify-content:flex-end;margin-top:22px"><button type="button" data-close-simple>取消</button><button class="primary" type="submit">儲存</button></div></div></form>`;$$('[data-close-simple]').forEach(el=>el.onclick=()=>d.close());$('#simpleForm').onsubmit=e=>{e.preventDefault();if(onSubmit()!==false)d.close()};d.showModal();applyPermissions()}
function editBoard(isNew=false){
  if(isNew){openManagedBoard();return;}
  if(!canEdit())return;
  const b=board();
  simple('看板設定',`<div class="field"><label for="boardNameInput">看板名稱</label><input id="boardNameInput" class="full" required maxlength="80" value="${esc(b.name)}" placeholder="例如：新產品開發"></div><div class="field"><label for="boardDescInput">專案說明</label><textarea id="boardDescInput">${esc(b.description)}</textarea></div><div class="field"><label for="boardColorInput">共用看板配色</label><select id="boardColorInput" class="full">${boardColors.map((color,i)=>`<option value="${color}" ${color===(boardColors.includes(b.color)?b.color:boardColors[0])?'selected':''}>${boardColorNames[i]}</option>`).join('')}</select><p class="help-note">儲存後，所有可存取此看板的成員都會看到相同配色。</p></div><button type="button" id="archiveBoard" ${b.deleting?'disabled':''}>${b.archived?'復原看板':'封存看板'}</button>${googleAccount?.workspaceRole==='admin'?`<button type="button" id="deleteBoard" class="danger" ${!b.archived?'disabled':''}>${b.deleting?'重試永久刪除':'永久刪除看板'}</button><p class="help-note">永久刪除僅限 Admin；需先封存，會一併移除牌卡與附件。</p>`:''}`,()=>{
    const name=$('#boardNameInput').value.trim();if(!name)return false;
    b.name=name;b.description=$('#boardDescInput').value;
    const color=$('#boardColorInput').value;if(boardColors.includes(color))b.color=color;
    save();render();
  });
  $('#archiveBoard').onclick=()=>openLifecycle(b.archived?'restore':'archive');
  if(googleAccount?.workspaceRole==='admin')$('#deleteBoard').onclick=()=>openLifecycle('delete');
  applyPermissions();
}
function editColumn(id){const b=board(),col=b.columns.find(x=>x.id===id);simple(col?'編輯階段':'新增階段',`<div class="field"><label for="columnName">階段名稱</label><input id="columnName" class="full" required maxlength="50" value="${esc(col?.name||'')}"></div>${col?`<div class="field"><label for="columnPosition">欄位順序</label><select id="columnPosition" class="full">${b.columns.map((x,i)=>`<option value="${i}" ${x.id===id?'selected':''}>第 ${i+1} 欄</option>`).join('')}</select></div><button type="button" id="deleteColumn" class="danger">刪除此階段</button>`:''}`,()=>{const name=$('#columnName').value.trim();if(!name)return false;if(col){col.name=name;const pos=Number($('#columnPosition').value);b.columns=b.columns.filter(x=>x.id!==id);b.columns.splice(pos,0,col)}else b.columns.push({id:uid(),name});b.columns.forEach((item,i)=>item.orderKey=String(i).padStart(12,'0'));save();render()});if(col)$('#deleteColumn').onclick=()=>{if(b.columns.length===1){toast('至少保留一個階段');return}if(b.cards.some(c=>c.columnId===id)){toast('請先移動或刪除這個階段內的卡片');return}b.columns=b.columns.filter(x=>x.id!==id);save();render();$('#simpleDialog').close()}}
function positionOptions(cards,columnId,excludeId,selected) {
  const siblings=cards.filter(c=>c.columnId===columnId && c.id!==excludeId);
  return Array.from({length:siblings.length+1},(_,i)=>`<option value="${i+1}" ${i+1===selected?'selected':''}>第 ${i+1} 張${i===siblings.length?'（最後）':''}</option>`).join('');
}
function renderCardPosition(card) {
  const column=$('#cardStage').value || card.columnId;
  const current=board().cards.filter(c=>c.columnId===card.columnId).findIndex(c=>c.id===card.id)+1;
  const position=column===card.columnId?current:board().cards.filter(c=>c.columnId===column).length+1;
  $('#cardPosition').innerHTML=positionOptions(board().cards,column,card.id,position);
  $('#cardPosition').value=String(position);
}
function syncCompletionButton(card) {
  const button=$('#cardCompletion');
  button.textContent=card.done?'✓':'';button.classList.toggle('completed',Boolean(card.done));
  button.setAttribute?.('aria-pressed',String(Boolean(card.done)));
  button.setAttribute?.('aria-label',card.done?'標記為未結案':'標記為結案');
}
function openCopyCard(card) {
  if(!canEdit())return;
  const sourceBoard=board(),version=generation;
  simple('複製卡片',`<p class="help-note">副本的負責人預設為你，不保留留言與附件；待辦事項會全部取消勾選並清空項目負責人。</p><div class="field"><label for="copyStage">目標階段</label><select id="copyStage" class="full">${sourceBoard.columns.map(col=>`<option value="${esc(col.id)}" ${col.id===card.columnId?'selected':''}>${esc(col.name)}</option>`).join('')}</select></div><div class="field"><label for="copyPosition">副本位置</label><select id="copyPosition" class="full"></select></div>`,()=>{
    if(version!==generation||board()!==sourceBoard||!canEdit())return false;
    const n=structuredClone(card);n.id=uid();n.title=(n.title.slice(0,146)+'（副本）');n.comments=[];n.assignees=[userId()];n.checklist=n.checklist.map(item=>({...item,done:false,assigneeId:''}));n.attachments=[];n.archivedAttachments=[];n.coverId=null;n.createdAt=new Date().toISOString();n.completedAt=n.done?n.createdAt:'';
    try{sourceBoard.cards=placeCard(sourceBoard.cards,n,$('#copyStage').value,Number($('#copyPosition').value));}
    catch(error){toast(error.message);return false;}
    save();render();openCard(n.id);toast('正在儲存卡片副本');
  });
  const positions=()=>{const column=$('#copyStage').value||card.columnId;const selected=column===card.columnId?sourceBoard.cards.filter(c=>c.columnId===column).findIndex(c=>c.id===card.id)+2:sourceBoard.cards.filter(c=>c.columnId===column).length+1;$('#copyPosition').innerHTML=positionOptions(sourceBoard.cards,column,null,selected);$('#copyPosition').value=String(selected);};
  $('#copyStage').value=card.columnId;$('#copyStage').onchange=positions;positions();
}
function renderLabelControls(card) {
  $('#selectedLabels').innerHTML=card.labels.map(labelHTML).join('')||'<span class="help-note">尚未選取標籤</span>';
  $('#labelOptions').innerHTML=Object.entries(labelOptions()).map(([id])=>`<label class="row"><input type="checkbox" data-label="${esc(id)}" ${card.labels.includes(id)?'checked':''}>${labelHTML(id)}</label>`).join('')||'<p class="help-note">尚無標籤，請先新增。</p>';
  $$('[data-label]').forEach(el=>el.onchange=()=>{if(!canEdit())return;card.labels=el.checked?[...new Set([...card.labels,el.dataset.label])]:card.labels.filter(id=>id!==el.dataset.label);$('#selectedLabels').innerHTML=card.labels.map(labelHTML).join('')||'<span class="help-note">尚未選取標籤</span>';save();render();});
}
let labelEditExpected=null;
function canManageLabels(){return !loading&&!saving&&Boolean(baseline)&&Boolean(googleAccount?.memberId)&&!googleAccount.readOnly&&googleAccount.accessboard?.includes(board()?.id)&&!board()?.archived&&!board()?.deleting;}
function labelManagerOptions(selected='') {
  $('#editLabelSelect').innerHTML='<option value="">＋ 新增標籤</option>'+Object.entries(labelOptions()).map(([id,label])=>`<option value="${esc(id)}">${esc(label.name)}</option>`).join('');
  $('#editLabelSelect').value=selected;
}
function loadLabelDraft(){const label=labelOptions()[$('#editLabelSelect').value];labelEditExpected=label?structuredClone(label):null;$('#labelName').value=label?.name||'';$('#labelColor').value=labelColor(label?.color);$('#labelStatus').textContent='';}
function openLabelManager(){if(!canManageLabels())return;labelManagerOptions();loadLabelDraft();$('#labelsDialog').showModal();}
$('#editLabelSelect').onchange=loadLabelDraft;
$('#closeLabels').onclick=()=>$('#labelsDialog').close();
$('#labelsDialog').onclose=()=>{labelEditExpected=null;flushLiveSync();};
$('#labelsDialog').oncancel=event=>{if(saving)event.preventDefault();};
$('#labelForm').onsubmit=async event=>{
  event.preventDefault();if(!canManageLabels())return;
  const name=$('#labelName').value.trim(),color=$('#labelColor').value;
  if(!name||name.length>40||!/^#[0-9a-f]{6}$/i.test(color)){ $('#labelStatus').textContent='請輸入 1–40 字的標籤名稱與有效顏色。';return; }
  const id=$('#editLabelSelect').value||uid(),target=board(),actor=googleAccount,version=generation,expected=labelEditExpected;
  if(Object.entries(labelOptions()).some(([key,label])=>key!==id&&label.name===name)){$('#labelStatus').textContent='此看板已有同名標籤';return;}
  saving=true;applyPermissions();$('#labelStatus').textContent='正在儲存標籤…';
  try{
    const definitions=await saveBoardLabel(actor,target.id,id,{name,color},expected);
    if(version!==generation||googleAccount!==actor||board()!==target)return;
    target.labelDefinitions=definitions;
    const original=baseline?.boards.find(b=>b.id===target.id);if(original)original.labelDefinitions=structuredClone(definitions);
    labelManagerOptions(id);labelEditExpected=structuredClone(definitions[id]);
    $('#labelStatus').textContent='標籤已儲存';render();
    const card=target.cards.find(c=>c.id===currentCard);if(card)renderLabelControls(card);
  }catch(error){if(version===generation)$('#labelStatus').textContent='標籤未儲存：'+error.message;}
  finally{if(version===generation){saving=false;applyPermissions();flushLiveSync();}}
};
function createCard(col){requireUser(()=>{simple('新增卡片',`<div class="field"><label for="newCardTitle">卡片標題</label><input id="newCardTitle" class="full" required maxlength="150" placeholder="接下來想完成什麼？"></div>`,()=>{const title=$('#newCardTitle').value.trim();if(!title)return false;const c={id:uid(),title,columnId:col||board().columns[0].id,description:'',labels:[],assignees:[userId()],due:'',done:false,checklist:[],attachments:[],comments:[],createdAt:new Date().toISOString(),orderKey:'z'+Date.now()};board().cards.push(c);save();render();setTimeout(()=>openCard(c.id),0)})})}
function openCard(id,commentDraft){const c=board().cards.find(x=>x.id===id);if(!c)return;currentCard=id;const d=$('#editor');d.innerHTML=`<div class="modal-head">${completionMark(c.done,true)}<input id="cardTitleInput" class="title-input" aria-label="卡片標題" maxlength="150" value="${esc(c.title)}"><button id="closeCard" aria-label="關閉卡片">✕</button></div><div class="modal-body"><div class="detail-grid"><div><div class="field"><label for="cardDescription">≡ &nbsp; 說明</label><textarea id="cardDescription" placeholder="加入更詳細的說明…">${esc(c.description)}</textarea></div><div class="field"><h3>☑ &nbsp; 待辦清單 <span id="checkCount" class="muted"></span></h3><div id="checklist"></div></div><div class="field"><h3>♧ &nbsp; 附件</h3><div id="attachments"></div><label class="file-label" for="attachmentInput">＋ 上傳附件（不限類型，每檔最多 20 MiB）</label><input id="attachmentInput" type="file" multiple><p id="attachmentStatus" role="status" class="help-note"></p><button id="retryAttachment" type="button" hidden>重試未完成附件</button></div><div class="field"><h3>☏ &nbsp; 留言與討論</h3><form id="commentForm"><textarea id="commentText" aria-label="留言內容" placeholder="分享進度，輸入 @ 標註會員…" aria-autocomplete="list" aria-controls="mentionList" aria-expanded="false" required maxlength="5000" style="min-height:75px"></textarea><div id="mentionList" class="mention-list" role="listbox" aria-label="可標註的會員" hidden></div><p id="commentStatus" role="status" class="help-note"></p><div class="row between" style="margin-top:8px"><span class="small muted">以 ${esc(me()?.name||'尚未登入')} 的身分留言</span><div class="row"><button id="cancelCommentEdit" type="button" hidden>取消編輯</button><button id="submitComment" class="primary">送出留言</button></div></div></form><div id="comments"></div></div></div><div class="detail-side"><div class="field"><label for="cardStage">所在階段</label><select id="cardStage" class="full">${board().columns.map(col=>`<option value="${col.id}" ${c.columnId===col.id?'selected':''}>${esc(col.name)}</option>`).join('')}</select><label for="cardPosition" style="margin-top:10px">牌卡位置</label><select id="cardPosition" class="full"></select><button id="moveCard" type="button" class="pill full" style="margin-top:8px">套用階段與位置</button></div><div class="field"><h3>負責人</h3><button type="button" id="manageAssignees" class="pill">管理負責人</button>${c.assignees.length?c.assignees.map(id=>{const u=state.users.find(user=>user.id===id)||{name:'未知成員'};return `<div class="row" style="margin:8px 0">${avatar(u)}<span>${esc(u.name)}</span></div>`}).join(''):'<p class="help-note">尚未指派負責人</p>'}</div><div class="field">${deadlineFields(c.due,c.dueParts,'card','截止日期')}<label class="row" style="margin-top:10px;font-weight:400"><input id="cardDone" type="checkbox" ${c.done?'checked':''}>已結案</label></div><div class="field"><h3>標籤</h3><div id="selectedLabels" class="selected-labels">${c.labels.map(labelHTML).join('')||'<span class="help-note">尚未選取標籤</span>'}</div><details id="labelPicker" class="label-picker"><summary>選擇標籤</summary><div id="labelOptions" class="label-options">${Object.entries(labelOptions()).map(([key,label])=>`<label class="row"><input type="checkbox" data-label="${esc(key)}" ${c.labels.includes(key)?'checked':''}>${labelHTML(key)}</label>`).join('')||'<p class="help-note">尚無標籤，請先新增。</p>'}</div></details><button id="manageLabels" type="button" class="pill full" style="margin-top:8px">新增／管理標籤</button></div><div class="field"><h3>操作</h3><button id="copyCard" title="副本的負責人預設為你，不保留附件" class="full pill" style="margin-bottom:8px">▣ 複製卡片</button><button id="deleteCard" class="full danger pill">封存卡片</button></div><p class="help-note">變更會自動儲存至 Firebase，請確認上方儲存狀態。<br>建立於 ${formatDate(c.createdAt,true)}</p></div></div></div>`;const update=()=>{save();render()};$('#cardTitleInput').onchange=e=>{const title=e.target.value.trim();if(!title){e.target.value=c.title;toast('標題不可為空');return}c.title=title;update()};$('#cardDescription').onchange=e=>{c.description=e.target.value;update()};$('#cardStage').onchange=()=>renderCardPosition(c);renderCardPosition(c);$('#moveCard').onclick=()=>{if(!canEdit())return;try{board().cards=placeCard(board().cards,c,$('#cardStage').value,Number($('#cardPosition').value));update();renderCardPosition(c);}catch(error){toast(error.message);}};bindDeadlineFields($('[data-deadline-fields="card"]'),c.due,c.dueParts,(parts,due)=>editDeadlineDraft(c,parts,due),flushDeadlineSave);const complete=done=>{if(!canEdit())return;c.done=done;c.completedAt=done?new Date().toISOString():'';$('#cardDone').checked=done;syncCompletionButton(c);update();};$('#cardDone').onchange=e=>complete(e.target.checked);$('#cardCompletion').onclick=()=>complete(!c.done);$('#manageAssignees').onclick=()=>openManagedAssignees(c.id);renderLabelControls(c);$('#manageLabels').onclick=()=>openLabelManager();$('#closeCard').onclick=()=>d.close();$('#deleteCard').onclick=()=>{if(confirm(`封存「${c.title}」？資料會保留於雲端，可由管理員復原。`)){board().archivedCards||=[];board().archivedCards.push({id:c.id,title:c.title,columnId:c.columnId});board().cards=board().cards.filter(x=>x.id!==c.id);update();d.close()}};$('#copyCard').onclick=()=>openCopyCard(c);renderChecklist(c);renderAttachments(c);renderComments(c);
const uploadVersion=generation,uploadBoard=board().id;
const commentComposer=bindCommentComposer({draft:commentDraft,boardId:uploadBoard,cardId:c.id,canEdit:()=>canEdit() && !board()?.archived && !board()?.deleting,isCurrent:()=>uploadVersion===generation,
 busy:value=>{if(uploadVersion===generation){saving=value;applyPermissions();}},
 complete:async (commentId,draft)=>{if(uploadVersion!==generation)return;await refreshWorkspace([uploadBoard]);if(googleAccount && board()?.id===uploadBoard && currentCard===c.id){openCard(c.id,draft);const comment=$$('[data-comment-id]').find(el=>el.dataset.commentId===commentId);comment?.scrollIntoView({block:'nearest'});}}});
$$('[data-edit-comment]').forEach(el=>el.onclick=()=>{const comment=c.comments.find(x=>x.id===el.dataset.editComment);if(comment?.userId===userId())commentComposer.edit(comment);});
$$('[data-delete-comment]').forEach(el=>el.onclick=()=>{const comment=c.comments.find(x=>x.id===el.dataset.deleteComment);if(comment?.userId===userId() && canEdit() && confirm('確定刪除這則留言？此操作無法復原。'))commentComposer.remove(comment);});
bindAttachmentUpload({input:$('#attachmentInput'),status:$('#attachmentStatus'),retry:$('#retryAttachment'),boardId:uploadBoard,cardId:c.id,canEdit,isCurrent:()=>uploadVersion===generation,
 busy:value=>{if(uploadVersion===generation){saving=value;applyPermissions();}},
 complete:async()=>{if(uploadVersion!==generation)return;d.close();await refreshWorkspace([uploadBoard]);if(googleAccount&&board()?.id===uploadBoard)openCard(c.id);}});
if(!d.open)d.showModal();applyPermissions()}
function renderChecklist(c){
  const expanded=new Set($$('#checklist [data-check-details]:not([hidden])').map(el=>el.dataset.checkDetails));
  const done=c.checklist.filter(x=>x.done).length;
  $('#checkCount').textContent=`${done}/${c.checklist.length}`;
  const groups=new Map((c.checklistGroups||[]).filter(name=>typeof name==='string'&&name.trim()).map(name=>[name,[]]));
  for(const item of c.checklist){
    const name=String(item.group||'').trim();
    if(!groups.has(name))groups.set(name,[]);
    groups.get(name).push(item);
  }
  if(!groups.size)groups.set('',[]);
  const sections=[...groups];
  const manageGroups=['admin','owner'].includes(googleAccount?.workspaceRole)&&!board()?.archived&&!board()?.deleting;
  const names=(c.assignees||[]).map(id=>({id,name:state.users.find(u=>u.id===id)?.name||'未知成員'}));
  const renderItem=t=>`<div class="checklist-entry" data-check-entry="${esc(t.id)}"><div class="check-item ${t.done?'checked':''}"><button type="button" class="checklist-toggle" data-check-toggle="${esc(t.id)}" aria-label="${esc(t.text)}的日期與負責人" aria-expanded="${expanded.has(t.id)}" aria-controls="checkDetails-${esc(t.id)}">${expanded.has(t.id)?'▾':'▸'}</button><input type="checkbox" data-check="${esc(t.id)}" ${t.done?'checked':''} aria-label="${esc(t.text)}"><span>${esc(t.text)}</span><button type="button" class="checklist-drag" draggable="true" data-check-drag="${esc(t.id)}" aria-label="拖曳排序：${esc(t.text)}" title="拖曳排序；方向鍵可上下移動">⠿</button><button type="button" data-edit-check="${esc(t.id)}" aria-label="編輯待辦事項">編輯</button><button data-remove-check="${esc(t.id)}" aria-label="刪除待辦事項">×</button></div><div class="checklist-details" id="checkDetails-${esc(t.id)}" data-check-details="${esc(t.id)}" ${expanded.has(t.id)?'':'hidden'}><div class="checklist-settings">${deadlineFields(t.due,t.dueParts,t.id,t.text+'的截止日期')}<label>負責人<select data-check-assignee="${esc(t.id)}" aria-label="${esc(t.text)}的負責人"><option value="">未指派</option>${names.map(u=>`<option value="${esc(u.id)}" ${t.assigneeId===u.id?'selected':''}>${esc(u.name)}</option>`).join('')}</select></label></div>${names.length?'':'<p class="help-note checklist-hint">請先指派牌卡負責人，再分配此項目。</p>'}</div></div>`;
  $('#checklist').innerHTML=sections.map(([name,items],index)=>{
    const completed=items.filter(item=>item.done).length,title=name||'待辦事項';
    return `<section class="checklist-group" data-check-group="${index}" aria-labelledby="checklistGroup${index}"><div class="checklist-group-heading"><h4 id="checklistGroup${index}">${esc(title)}</h4><span class="muted small">${completed}/${items.length}</span>${manageGroups?`<button type="button" data-rename-checklist="${index}" aria-label="編輯${esc(title)}清單名稱">編輯名稱</button>`:''}</div>${items.length?`<div class="progress"><i style="width:${completed/items.length*100}%"></i></div>`:''}${items.map(renderItem).join('')}<form data-check-add="${index}" class="row checklist-add"><input class="grow" aria-label="新增${esc(title)}項目" placeholder="新增待辦事項…" required maxlength="200"><button aria-label="新增${esc(title)}項目">＋</button></form></section>`;
  }).join('');
  if(manageGroups)$('#checklist').innerHTML+='<details class="checklist-create"><summary>＋ 新增待辦清單</summary><form id="createChecklistForm" class="row checklist-add"><input id="newChecklistName" class="grow" aria-label="待辦清單名稱" placeholder="清單名稱，例如：發文" required maxlength="80"><button type="submit">新增清單</button></form><p id="checklistCreateError" class="danger small" role="alert"></p></details>';
  const update=()=>{save();render();renderChecklist(c);applyPermissions();};
  if(manageGroups)$('#createChecklistForm').onsubmit=event=>{
    event.preventDefault();if(!canManage()||!board()||board().archived||board().deleting)return;
    const name=$('#newChecklistName').value.trim();
    if(!name||name.length>80)return;
    if(sections.some(([existing])=>(existing||'待辦事項')===name)){$('#checklistCreateError').textContent='已有同名待辦清單';return;}
    const saved=sections.map(([group])=>group).filter(Boolean);
    if(saved.length>=50){$('#checklistCreateError').textContent='最多可新增 50 組待辦清單';return;}
    c.checklistGroups=[...saved,name];update();
  };
  $$('[data-check-toggle]').forEach(el=>el.onclick=()=>{
    const panel=$$('[data-check-details]').find(item=>item.dataset.checkDetails===el.dataset.checkToggle);
    if(!panel)return;
    panel.hidden=!panel.hidden;el.setAttribute('aria-expanded',String(!panel.hidden));el.textContent=panel.hidden?'▸':'▾';
  });
  $$('[data-check-add]').forEach(form=>form.onsubmit=event=>{
    event.preventDefault();if(!canEdit())return;
    const input=form.querySelector('input'),text=input.value.trim();if(!text)return;
    const [name,items]=sections[Number(form.dataset.checkAdd)];
    const item={id:uid(),text,done:false};
    if(name)item.group=name;
    if(items[0]?.groupId)item.groupId=items[0].groupId;
    c.checklist=placeChecklist([...c.checklist,item],item.id,name);update();
  });
  $$('[data-edit-check]').forEach(el=>el.onclick=()=>{
    if(!canEdit())return;
    const item=c.checklist.find(t=>t.id===el.dataset.editCheck);
    const version=generation;
    simple('編輯待辦事項',`<div class="field"><label for="editChecklistText">待辦事項</label><input id="editChecklistText" class="full" value="${esc(item.text)}" required maxlength="200"></div>`,()=>{
      if(version!==generation||!canEdit())return false;
      const text=$('#editChecklistText').value.trim();if(!text)return false;
      item.text=text;update();
    });
  });
  $$('[data-rename-checklist]').forEach(el=>el.onclick=()=>{
    if(!canManage())return;
    const [oldName]=sections[Number(el.dataset.renameChecklist)],version=generation;
    simple('編輯待辦清單名稱',`<div class="field"><label for="editChecklistName">清單名稱</label><input id="editChecklistName" class="full" value="${esc(oldName||'待辦事項')}" required maxlength="80"></div>`,()=>{
      if(version!==generation||!canManage())return false;
      const name=$('#editChecklistName').value.trim();if(!name||name.length>80)return false;
      if(name!==oldName&&sections.some(([existing])=>(existing||'待辦事項')===name)){toast('已有同名待辦清單');return false;}
      c.checklistGroups=sections.map(([group])=>group===oldName?name:group).filter(Boolean);
      c.checklist.forEach(item=>{if(String(item.group||'').trim()===oldName)item.group=name;});update();
    });
  });
  let dragging=null;
  const move=(id,group,before=null)=>{
    if(!canEdit()||!board()||board().archived||board().deleting)return;
    c.checklist=placeChecklist(c.checklist,id,group,before);update();
  };
  $$('[data-check-drag]').forEach(el=>{
    el.ondragstart=event=>{
      if(!canEdit()){event.preventDefault();return;}
      dragging=el.dataset.checkDrag;event.stopPropagation();
      event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',dragging);
    };
    el.ondragend=()=>{dragging=null;$$('.checklist-drop-target').forEach(node=>node.classList.remove('checklist-drop-target'));};
    el.onkeydown=event=>{
      if(!['ArrowUp','ArrowDown'].includes(event.key)||!canEdit())return;
      event.preventDefault();
      const item=c.checklist.find(t=>t.id===el.dataset.checkDrag),group=String(item.group||'').trim();
      const siblings=c.checklist.filter(t=>String(t.group||'').trim()===group),index=siblings.indexOf(item);
      if(event.key==='ArrowUp'&&index>0)move(item.id,group,siblings[index-1].id);
      if(event.key==='ArrowDown'&&index<siblings.length-1)move(item.id,group,siblings[index+2]?.id);
      $$('[data-check-drag]').find(node=>node.dataset.checkDrag===item.id)?.focus?.();
    };
  });
  $$('[data-check-group]').forEach(el=>{
    el.ondragover=event=>{if(!dragging||!canEdit())return;event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='move';el.classList.add('checklist-drop-target');};
    el.ondragleave=()=>el.classList.remove('checklist-drop-target');
    el.ondrop=event=>{
      if(!dragging)return;event.preventDefault();event.stopPropagation();
      const id=dragging;dragging=null;
      const entry=event.target.closest('[data-check-entry]');
      let before=entry?.dataset.checkEntry;
      if(before===id)return;
      if(entry&&event.clientY>entry.getBoundingClientRect().top+entry.getBoundingClientRect().height/2){
        const items=sections[Number(el.dataset.checkGroup)][1];before=items[items.findIndex(item=>item.id===before)+1]?.id;
      }
      if(before===id)return;
      move(id,sections[Number(el.dataset.checkGroup)][0],before);
    };
  });
  $$('[data-check]').forEach(el=>el.onchange=()=>{if(!canEdit())return;c.checklist.find(t=>t.id===el.dataset.check).done=el.checked;update();});
  $$('[data-remove-check]').forEach(el=>el.onclick=()=>{if(!canEdit())return;c.checklist=c.checklist.filter(t=>t.id!==el.dataset.removeCheck);update();});
  $$('[data-deadline-fields]').forEach(root=>{
    const item=c.checklist.find(t=>t.id===root.dataset.deadlineFields);
    if(item)bindDeadlineFields(root,item.due,item.dueParts,(parts,due)=>editDeadlineDraft(item,parts,due),flushDeadlineSave);
  });
  $$('[data-check-assignee]').forEach(el=>el.onchange=()=>{
    if(!canEdit())return;
    if(el.value&&!c.assignees.includes(el.value)){toast('只能選擇此牌卡的負責人');return;}
    c.checklist.find(t=>t.id===el.dataset.checkAssignee).assigneeId=el.value;update();
  });
}
function renderAttachments(c) {
  $('#attachments').innerHTML=c.attachments.map(a=>`<div class="attachment">
    ${attachmentImage(a)?`<img ${a.storagePath?`data-storage-path="${esc(a.storagePath)}"`:""} src="${esc(attachmentImage(a))}" alt="${esc(a.name)}" loading="lazy" referrerpolicy="no-referrer">`:'<span style="font-size:24px">▤</span>'}
    <div class="grow"><button data-download="${a.id}" class="attachment-link">${esc(a.name)}</button>
    <div class="small muted">${a.storagePath?'Firebase Storage · '+(a.size/1024).toFixed(1)+' KB':a.url?'原始附件連結 · 可能需要登入來源網站':(a.size/1024).toFixed(1)+' KB'}
    ${attachmentImage(a)?`<button data-cover="${a.id}" class="small">${c.coverId===a.id?'✓ 取消封面':'設為封面'}</button>`:''}</div></div>
    <button data-remove-file="${a.id}" aria-label="封存附件">×</button></div>`).join('');
  $$('[data-cover]').forEach(el=>el.onclick=()=>{
    c.coverId=c.coverId===el.dataset.cover?null:el.dataset.cover;c.demoCover=false;save();render();renderAttachments(c);applyPermissions();
  });
  hydrateAttachmentImages();
  $$('[data-download]').forEach(el=>el.onclick=async()=>{
    const a=c.attachments.find(a=>a.id===el.dataset.download),link=document.createElement('a');
    if(a.storagePath){try{await downloadAttachment(a);}catch(error){toast('下載失敗：'+error.message);}return;}
    if(a.url){if(!safeExternalURL(a.url))return;link.href=a.url;link.target='_blank';link.rel='noopener noreferrer';}
    else{link.href=a.data;link.download=a.name;}
    link.click();
  });
  $$('[data-remove-file]').forEach(el=>el.onclick=()=>{
    if(!confirm('封存此附件？可從封存項目復原。'))return;const file=c.attachments.find(a=>a.id===el.dataset.removeFile);c.archivedAttachments||=[];c.archivedAttachments.push({id:file.id,name:file.name});c.attachments=c.attachments.filter(a=>a.id!==el.dataset.removeFile);
    save();render();renderAttachments(c);applyPermissions();
  });
}
function renderComments(c){$('#comments').innerHTML=[...c.comments].reverse().map(x=>{const user=state.users.find(u=>u.id===x.userId),name=user?.name||'未知成員';return `<div class="comment" data-comment-id="${esc(x.id)}" tabindex="-1">${avatar(user)}<div class="grow"><strong class="small">${esc(name)}</strong><time datetime="${esc(x.at)}">${formatDate(x.at,true)}</time>${x.editedAt?'<span class="small muted">（已編輯）</span>':''}<div data-comment-body="${esc(x.id)}"></div>${x.userId===userId()?`<div class="row comment-actions"><button type="button" data-edit-comment="${esc(x.id)}">編輯</button><button type="button" data-delete-comment="${esc(x.id)}" class="danger">刪除</button></div>`:''}</div></div>`}).join('');$$('[data-comment-body]').forEach(el=>{const comment=c.comments.find(x=>x.id===el.dataset.commentBody);el.append(renderMentionText(comment.text,comment.mentions));})}
function renderArchive(b){
  $('#archiveBoardName').textContent=b.name;
  const cards=b.archivedCards||[];
  $('#archivedCards').innerHTML=cards.length?cards.map(c=>`<div class="archive-row"><span>${esc(c.title||'未命名牌卡')}</span><button type="button" data-restore-card="${esc(c.id)}" ${c.deleting?'disabled':''}>復原牌卡</button>${googleAccount?.workspaceRole==='admin'?`<button type="button" class="danger" data-delete-card="${esc(c.id)}">${c.deleting?'重試永久刪除':'永久刪除牌卡'}</button>`:''}</div>`).join(''):'<p class="muted">沒有已封存的牌卡。</p>';
  const attachments=b.cards.flatMap(card=>(card.archivedAttachments||[]).map(file=>({...file,cardId:card.id,cardTitle:card.title})));
  $('#archivedAttachments').innerHTML=attachments.length?attachments.map(file=>`<div class="archive-row"><span>${esc(file.name||'未命名附件')} <small class="muted">${esc(file.cardTitle)}</small></span><button type="button" data-restore-attachment="${esc(file.id)}" data-parent-card="${esc(file.cardId)}">復原附件</button></div>`).join(''):'<p class="muted">沒有已封存的附件。</p>';
  $$('[data-delete-card]').forEach(button=>button.onclick=()=>openLifecycle('delete',button.dataset.deleteCard));
  $$('[data-restore-card]').forEach(button=>button.onclick=()=>restoreArchived('card',button.dataset.restoreCard));
  $$('[data-restore-attachment]').forEach(button=>button.onclick=()=>restoreArchived('attachment',button.dataset.restoreAttachment,button.dataset.parentCard));
  $$('#archiveDialog [data-restore-card], #archiveDialog [data-restore-attachment]').forEach(button=>button.disabled=!canEdit() || Boolean(b.archived) || Boolean(cards.find(c=>c.id===button.dataset.restoreCard)?.deleting));
}
let archiveRequest=0;
async function showArchive(){
  const b=board();
  if(!b||loading||saving)return;
  const version=generation, request=++archiveRequest;
  renderArchive(b);
  $('#archiveStatus').textContent='';
  if(!$('#archiveDialog').open)$('#archiveDialog').showModal();
  if(!b.cards.some(card=>card.attachmentArchiveLoaded===false))return;
  $('#archivedAttachments').textContent='正在讀取封存附件…';
  const current=()=>version===generation && request===archiveRequest && $('#archiveDialog').open && board()===b;
  try{
    const results=await loadDeferredAttachmentArchives(b);
    if(!current())return;
    for(const result of results){
      const card=b.cards.find(card=>card.id===result.cardId);
      card.archivedAttachments=result.files;
      card.attachmentArchiveLoaded=true;
    }
    renderArchive(b);
  }catch(error){
    if(!current())return;
    $('#archivedAttachments').textContent='無法載入封存附件。';
    $('#archiveStatus').textContent='讀取失敗：'+error.message+'；請關閉後重新開啟重試';
  }
}
async function restoreArchived(type,id,cardId){
  if(!canEdit())return;
  const version=generation, selectedBoard=board().id, member=userId();
  saving=true;applyPermissions();
  $$('#archiveDialog [data-restore-card], #archiveDialog [data-restore-attachment]').forEach(button=>button.disabled=true);
  $('#archiveStatus').textContent='正在復原至 Firebase…';
  try{
    if(type==='card')await restoreCard(selectedBoard,id,member);
    else await restoreAttachment(selectedBoard,cardId,id,member);
    if(version!==generation)return;
    $('#archiveDialog').close();
    saving=false;
    syncStatus('已復原，正在重新讀取 Firebase…');
    await refreshWorkspace();
  }catch(error){
    if(version!==generation)return;
    $('#archiveStatus').textContent='復原失敗：'+error.message;
    syncStatus('復原失敗：'+error.message);
  }finally{
    if(version===generation){
      saving=false;
      applyPermissions();
      $$('#archiveDialog [data-restore-card], #archiveDialog [data-restore-attachment]').forEach(button=>button.disabled=!canEdit());
      flushLiveSync();
    }
  }
}
$('#editor').onclose=()=>{flushDeadlineSave();const id=currentCard;currentCard=null;const source=$$('[data-card]').find(el=>el.dataset.card===id);if(source)source.focus?.();else $('#quickCreate').focus?.();flushLiveSync()};$('#currentUser').onclick=openUsers;$('#membersBtn').onclick=openUsers;$('#inviteBtn').onclick=openUsers;$('#closeUser').onclick=()=>$('#userDialog').close();$('#addBoard').onclick=()=>editBoard(true);$('#editBoard').onclick=()=>editBoard();$('#starBoard').onclick=toggleBoardStar;$('#quickCreate').onclick=()=>createCard();$('#workspaceNav').onclick=()=>{state.activeBoard=null;if(baseline)baseline.activeBoard=null;mine=false;$('#search').value='';$('#dueFilter').value='all';render()};$('#search').oninput=render;$('#mineFilter').onclick=()=>requireUser(()=>{mine=!mine;render()});$('#dueFilter').onchange=render;$('#clearFilters').onclick=()=>{mine=false;$('#search').value='';$('#dueFilter').value='all';render()};
let deadlineSaveTimer=null,deadlineSavePending=false;
let baseline=null, loading=false, saving=false, generation=0, saveFailure='', lifecycleDialog=false, assigneeDialog=false;
let stopSubscription=null, livePending=false, liveTimer=null, liveBoards=new Set();
function stopLiveSync(){
  stopSubscription?.();stopSubscription=null;
  clearTimeout(liveTimer);liveTimer=null;livePending=false;liveBoards.clear();
}
function flushLiveSync(){
  if(!livePending||liveTimer||saving||loading||deadlineSavePending||$('#editor').open||$('#simpleDialog').open||$('#archiveDialog').open||$('#boardOrderDialog').open||$('#labelsDialog').open||boardOrderSaving)return;
  liveTimer=setTimeout(()=>{
    liveTimer=null;
    if(saving||loading||$('#editor').open||$('#simpleDialog').open||$('#archiveDialog').open||$('#boardOrderDialog').open||$('#labelsDialog').open||boardOrderSaving)return;
    const boardIds=[...liveBoards];
    livePending=false;liveBoards.clear();
    refreshWorkspace(boardIds.length?boardIds:null);
  },250);
}
function queueLiveSync(boardId){livePending=true;if(boardId)liveBoards.add(boardId);flushLiveSync()}
let managementRequest=0,managementLoading=false;
$('#simpleDialog').onclose=()=>{managementRequest++;managementLoading=false;flushLiveSync()};
$('#archiveDialog').onclose=()=>{archiveRequest++;flushLiveSync()};
$('#boardOrderDialog').onclose=()=>{flushLiveSync();$('#sortBoards').focus?.()};
function canEdit(){return !loading && !saving && Boolean(baseline) && ['admin','owner','editor'].includes(googleAccount?.workspaceRole)}
function canManage(){return canEdit() && ['admin','owner'].includes(googleAccount?.workspaceRole)}
function canAdmin(){return canEdit() && googleAccount?.workspaceRole==='admin'}
function openLifecycle(action,cardId){
  if(!canAdmin())return;
  const b=board(),card=cardId?(b.cards.find(c=>c.id===cardId)||(b.archivedCards||[]).find(c=>c.id===cardId)):null;
  if(!b || (cardId&&!card))return;
  const name=card?card.title:b.name,kind=card?'牌卡':'看板';
  const archived=card?!(b.cards.some(c=>c.id===card.id)):Boolean(b.archived);
  if(action==='delete'&&!archived){toast('請先封存，再永久刪除');return;}
  $('#archiveDialog').close();$('#editor').close();
  const operationId=uid();
  const verb={archive:'封存',restore:'復原',delete:'永久刪除'}[action];
  managementForm(`${verb}${kind}`,`<p>${verb}「${esc(name)}」？</p>${action==='delete'?`<p class="danger">此操作無法復原。${card?'此牌卡的待辦、留言及附件':'此看板的全部階段、牌卡、待辦、留言、附件與看板授權'}會一併移除。</p><div class="field"><label for="lifecycleConfirm">請輸入完整${kind}名稱確認</label><input id="lifecycleConfirm" class="full" required autocomplete="off"></div>`:'<p class="help-note">封存會保留資料，可稍後復原。</p>'}`);
  lifecycleDialog=true;
  const submit=$('#managementSubmit');submit.textContent=verb;submit.classList.toggle('danger',action==='delete');
  $('#simpleForm').onsubmit=event=>{
    event.preventDefault();if(!canAdmin())return;
    if(action==='delete'&&$('#lifecycleConfirm').value!==name){$('#managementError').textContent='輸入的名稱不一致，請確認';return;}
    runManagedWrite(()=>manageContentLifecycle({requestId:operationId,boardId:b.id,...(card?{cardId:card.id}:{}),action,confirmName:name,expectedArchived:archived}),async()=>{
      const actor=googleAccount;
      stopLiveSync();
      if(action==='delete'&&!card&&window.boardlyGoogleAuth?.refreshMembership)await window.boardlyGoogleAuth.refreshMembership();
      if(googleAccount?.uid!==actor?.uid||googleAccount?.memberId!==actor?.memberId)return;
      await refreshWorkspace(null,card?b.id:undefined);
    },true);
  };
  applyPermissions();
}
function managementForm(title,body){
  simple(title,body+'<p id="managementError" class="danger" role="alert"></p>',()=>false);
  const button=$('#simpleForm button[type="submit"]');
  button.id='managementSubmit';
  return ++managementRequest;
}
function managedSelection(members,selected=[]){
  return members.map(member=>`<label class="row" style="margin:8px 0"><input type="checkbox" data-managed-member="${esc(member.id)}" ${selected.includes(member.id)?'checked':''} ${!member.eligible&&!selected.includes(member.id)?'disabled':''}><span>${esc(member.name)}${member.eligible?'':'（歷史指派，請取消後再儲存）'}</span></label>`).join('');
}
async function openManagedBoard(){
  if(!canManage())return;
  const version=generation;
  const request=managementForm('新增專案看板',`<div class="field"><label for="managedBoardName">看板名稱</label><input id="managedBoardName" class="full" required maxlength="80"></div><div class="field"><label for="managedBoardDescription">專案說明</label><textarea id="managedBoardDescription" maxlength="5000"></textarea></div><div class="field"><label for="managedBoardColor">配色</label><select id="managedBoardColor">${boardColors.map((color,i)=>`<option value="${color}">${boardColorNames[i]}</option>`).join('')}</select></div><fieldset><legend>可存取此看板的會員</legend><p class="help-note">你會自動取得權限；其他會員沿用既有角色。最多另選 40 位。</p><div id="managedMembers">正在讀取會員…</div></fieldset>`);
  managementLoading=true;applyPermissions();
  let lastPayload='',operationId;
  $('#simpleForm').onsubmit=event=>{
    event.preventDefault();if(managementLoading||!canManage())return;
    const payload={name:$('#managedBoardName').value.trim(),description:$('#managedBoardDescription').value,color:$('#managedBoardColor').value,memberIds:$$('[data-managed-member]').filter(el=>el.checked).map(el=>el.dataset.managedMember).sort()};
    if(!payload.name)return;
    const signature=JSON.stringify(payload);if(signature!==lastPayload){lastPayload=signature;operationId=uid();}
    runManagedWrite(()=>createManagedBoard({...payload,requestId:operationId}),async result=>{
      const actor=googleAccount;
      if(window.boardlyGoogleAuth?.refreshMembership)await window.boardlyGoogleAuth.refreshMembership();
      if(googleAccount?.uid!==actor?.uid || googleAccount?.memberId!==actor?.memberId)return;
      await refreshWorkspace(null,result.boardId);
    },true);
  };
  try{
    const {members}=await listManagementMembers({});
    if(request!==managementRequest||version!==generation||!$('#simpleDialog').open)return;
    $('#managedMembers').innerHTML=managedSelection(members.filter(m=>m.id!==userId()));
  }catch(error){
    if(request===managementRequest&&version===generation){$('#managementError').textContent=error.message;$('#managedMembers').textContent='會員載入失敗，請關閉後重新開啟。';return;}
  }finally{
    if(request===managementRequest&&version===generation){
      // A failed member fetch must not permit submitting a partial authorization list.
      managementLoading=Boolean($('#managementError').textContent);applyPermissions();
    }
  }
}
async function openManagedAssignees(cardId){
  if(!canEdit()||!board()||board().archived||board().deleting)return;
  const boardId=board().id,version=generation;
  const request=managementForm('管理負責人','<p class="help-note">只能指派目前可存取此看板的有效會員。最多 40 位。</p><div id="managedMembers">正在讀取目前指派…</div>');
  assigneeDialog=true;$('#editor').close();managementLoading=true;applyPermissions();
  try{
    const {members,assigneeIds}=await listManagementMembers({boardId,cardId});
    if(request!==managementRequest||version!==generation||!$('#simpleDialog').open)return;
    $('#managedMembers').innerHTML=managedSelection(members,assigneeIds);
    let lastPayload='',operationId;
    $('#simpleForm').onsubmit=event=>{
      event.preventDefault();if(managementLoading||!canEdit())return;
      const selected=$$('[data-managed-member]').filter(el=>el.checked).map(el=>el.dataset.managedMember).sort();
      const signature=JSON.stringify(selected);if(signature!==lastPayload){lastPayload=signature;operationId=uid();}
      runManagedWrite(()=>setManagedAssignees({requestId:operationId,boardId,cardId,assigneeIds:selected,expectedAssigneeIds:assigneeIds}),()=>refreshWorkspace([boardId]));
    };
    managementLoading=false;applyPermissions();
  }catch(error){
    if(request===managementRequest&&version===generation){$('#managementError').textContent=error.message;$('#managedMembers').textContent='指派載入失敗，請關閉後重新開啟。';}
  }
}
async function runManagedWrite(write,reload,allowMembershipRefresh=false){
  if(assigneeDialog?(!canEdit()||!board()||board().archived||board().deleting):!canManage())return;
  const version=generation,request=managementRequest,actor=googleAccount;
  saving=true;saveFailure='';applyPermissions();$('#managementError').textContent='';syncStatus('正在儲存管理設定…');
  try{
    const result=await write();
    if(version!==generation && !(allowMembershipRefresh && googleAccount?.uid===actor?.uid && googleAccount?.memberId===actor?.memberId && ['admin','owner'].includes(googleAccount?.workspaceRole)))return;
    saving=false;
    if(request===managementRequest)$('#simpleDialog').close();
    await reload(result);
  }catch(error){
    if(version!==generation)return;
    saveFailure='管理操作未確認完成：'+error.message;
    if(request===managementRequest&&$('#simpleDialog').open)$('#managementError').textContent=error.message;
    syncStatus('請重試；如持續發生衝突，請重新開啟表單');
  }finally{
    if(version===generation){saving=false;applyPermissions();flushLiveSync();}
  }
}
function renderEmpty(){
  applyBoardColor(null);
  $('#boardTitle').textContent=loading?'正在讀取 Firebase…':googleAccount?.workspaceRole?'沒有可存取的看板':googleAccount?'尚未取得工作空間權限':'請先使用 Google 登入';
  $('#boardDescription').textContent=googleAccount&&!googleAccount.workspaceRole?'此帳號尚未取得工作空間權限。':'看板與牌卡由 Firebase 提供。';
  for(const id of ['crumb','columns','boardStats','headerMembers'])$('#'+id).replaceChildren();
  $('#currentUser').innerHTML=googleAccount?avatar({name:googleAccount.displayName,avatar:googleAccount.avatar})+`<span class="user-name">${esc(googleAccount.displayName)}</span>`:'Google 登入';
  renderBoardNavigation(null);
  applyPermissions();
}
function applyPermissions(){
  const edit=canEdit() && Boolean(board()) && !board().archived && !board().deleting;
  const reason=loading?'正在載入，請稍候。':saving?'正在儲存，完成後可繼續編輯。':!googleAccount?'請先使用 Google 登入。':!googleAccount.memberId?'尚未取得工作空間權限；請聯絡 Admin／Owner 核准。':!board()?'沒有可存取的看板；請聯絡 Admin／Owner 調整看板權限。':!edit?'目前為唯讀：可閱讀與下載；編輯需 Admin／Owner／Editor 權限。':'';
  $('#permissionNotice').textContent=reason;
  $('#search').disabled=!board();
  $('#mineFilter').disabled=!googleAccount?.memberId;
  $('#mineFilter').setAttribute?.('aria-pressed',String(mine));
  $('#starBoard').setAttribute?.('aria-pressed',String(Boolean(board()?.starred)));
  $('#currentUser').setAttribute?.('aria-label',googleAccount ? `帳號與個人設定：${googleAccount.displayName}` : '使用 Google 登入');
  for(const selector of ['#quickCreate','#editBoard','#starBoard','#addColumn','[data-add-card]','[data-edit-col]'])$$(selector).forEach(el=>{el.disabled=!edit;el.title=edit?'':reason;});
  $('#editBoard').disabled=!board() || (!edit&&!canAdmin());
  if($('#archiveBoard'))$('#archiveBoard').disabled=!canAdmin() || Boolean(board()?.deleting);
  if($('#deleteBoard'))$('#deleteBoard').disabled=!canAdmin() || !board()?.archived;
  if(board()?.archived || board()?.deleting)$('#permissionNotice').textContent=board().deleting?'此看板正在永久刪除中；Admin 可重試完成清理。':'此看板已封存；Admin 可復原或永久刪除。';
  $('#sortBoards').disabled=loading||saving||!googleAccount?.memberId||state.boards.length<2;
  $('#addBoard').disabled=!canManage();$('#addBoard').title='Admin／Owner 可建立看板並選擇授權會員';
  $$('.card').forEach(el=>el.draggable=edit);
  $$('[data-check-drag]').forEach(el=>el.draggable=edit);
  $$('#editor input, #editor textarea, #editor select, #editor button').forEach(el=>{
    if(el.id!=='closeCard'&&!el.hasAttribute('data-download'))el.disabled=!edit;
  });
  $$('[data-check-toggle]').forEach(el=>el.disabled=false);
  if($('#createChecklistForm'))$$('#createChecklistForm input, #createChecklistForm button').forEach(el=>el.disabled=!edit||!canManage());
  $$('#editor [data-deadline-part], #editor [data-clear-deadline]').forEach(el=>el.disabled=!canEditDeadlineDraft());
  if($('#labelPicker'))$('#labelPicker').hidden=!edit;
  if($('#manageLabels'))$('#manageLabels').disabled=!canManageLabels();
  $$('#labelsDialog input, #labelsDialog select, #saveLabel').forEach(el=>el.disabled=!canManageLabels());
  $('#closeLabels').disabled=saving;
  if($('#attachmentInput'))$('#attachmentInput').disabled=!edit;
  if($('#manageAssignees'))$('#manageAssignees').disabled=!edit;
  if($('#managementSubmit'))$('#managementSubmit').disabled=managementLoading||(lifecycleDialog?!canAdmin():assigneeDialog?!edit:!canManage());
  if($('#deleteColumn'))$('#deleteColumn').disabled=!['admin','owner'].includes(googleAccount?.workspaceRole);
  $('#refreshWorkspace').disabled=loading||saving;
  $('#archiveBtn').disabled=loading||saving||!board();
  $('#simpleDialog').inert=saving;
  if((board()?.archived || board()?.deleting) && !lifecycleDialog)$$('#simpleDialog input, #simpleDialog textarea, #simpleDialog select, #simpleDialog button[type="submit"]').forEach(el=>el.disabled=true);
  if(lifecycleDialog)$$('#simpleDialog input, #simpleDialog button[type="submit"]').forEach(el=>el.disabled=!canAdmin());
  $$('[data-delete-card]').forEach(el=>el.disabled=!canAdmin());
}
function syncStatus(message){$('#syncStatus').textContent=saveFailure?`${saveFailure}；${message}`:message;}
function clearWorkspaceDialogs(){
  clearTimeout(deadlineSaveTimer);deadlineSavePending=false;
  clearAttachmentUI();
  managementRequest++;managementLoading=false;
  currentCard=null;dragged=null;
  $('#editor').close();$('#simpleDialog').close();$('#archiveDialog').close();$('#boardOrderDialog').close();$('#labelsDialog').close();
  boardOrderDrag=null;boardOrderSaving=false;$('#saveBoardOrder').disabled=false;
  for(const id of ['editor','simpleDialog','archiveBoardName','archivedCards','archivedAttachments'])$('#'+id).replaceChildren();
}
async function refreshWorkspace(boardIds=null,preferredBoard=null){
  const version=++generation,account=googleAccount,active=preferredBoard||state.activeBoard,previous=state;
  const partial=Boolean(boardIds?.length && previous.boards.length);
  let refreshed=false;
  clearTimeout(liveTimer);liveTimer=null;livePending=false;liveBoards.clear();
  baseline=null;loading=true;
  if(!partial){
    state={version:1,boards:[],users:account?.roster||[]};
    clearWorkspaceDialogs();render();
  }else applyPermissions();
  if(!account?.workspaceRole){loading=false;syncStatus('尚未取得 Firebase 存取權限');render();return;}
  syncStatus(partial?'正在同步 Firebase…':'正在讀取 Firebase…');
  try{
    const loaded=await loadWorkspace(account,boardIds?{previous,boardIds}:undefined);
    if(version!==generation)return;
    state=loaded;state.activeBoard=loaded.boards.some(b=>b.id===active)?active:null;
    baseline=structuredClone(state);refreshed=true;syncStatus('已從 Firebase 載入');
    if(!stopSubscription)stopSubscription=subscribeWorkspace(account,queueLiveSync,error=>{
      if(googleAccount!==account)return;
      if(error.code==='permission-denied'){
        applyGoogleAccount({...account,workspaceRole:null,roster:[]});
        syncStatus('看板存取權限已變更，已清除內容；請重新整理確認最新權限');
        return;
      }
      stopLiveSync();syncStatus('即時同步中斷：'+error.message+'；請重新整理重試');
    });
  }catch(error){if(version===generation){
    if(error.code==='permission-denied'){
      stopLiveSync();state={version:1,boards:[],users:[]};
      clearWorkspaceDialogs();
    }else if(partial){state=previous;baseline=structuredClone(previous);}
    syncStatus('讀取失敗：'+error.message+'；請重新整理重試');
  }}
  finally{if(version===generation){loading=false;render();flushLiveSync();}}
  return version===generation && refreshed;
}
function canEditDeadlineDraft(){return !loading&&Boolean(baseline)&&['admin','owner','editor'].includes(googleAccount?.workspaceRole)&&Boolean(board())&&!board().archived&&!board().deleting;}
function editDeadlineDraft(target,parts,due){
  if(!canEditDeadlineDraft())return;
  target.dueParts=parts;target.due=due;deadlineSavePending=true;
  clearTimeout(deadlineSaveTimer);deadlineSaveTimer=setTimeout(flushDeadlineSave,350);
}
function flushDeadlineSave(){
  clearTimeout(deadlineSaveTimer);deadlineSaveTimer=null;
  if(!deadlineSavePending||saving||loading)return;
  if(!canEditDeadlineDraft()){deadlineSavePending=false;return;}
  deadlineSavePending=false;return save(true);
}
async function save(deadlineOnly=false){
  if(!canEdit()){if(baseline){state=structuredClone(baseline);render();}return;}
  const version=generation,before=baseline,after=structuredClone(state);
  clearTimeout(deadlineSaveTimer);deadlineSavePending=false;
  saveFailure='';
  saving=true;applyPermissions();syncStatus('正在儲存至 Firebase…');
  try{
    const committedCards=await persistWorkspace(before,after,userId());
    if(version!==generation)return;
    for(const {boardId,cardId,updatedAt,createdBy} of committedCards){
      for(const workspace of [after,state]){
        const card=workspace.boards.find(board=>board.id===boardId)?.cards.find(card=>card.id===cardId);
        if(card){card.updatedBy=userId();card.updatedAt=updatedAt;if(createdBy)card.createdBy=createdBy;}
      }
    }
    baseline=after;syncStatus('已儲存至 Firebase');
  }catch(error){
    if(version!==generation)return;
    if(deadlineOnly){deadlineSavePending=true;saveFailure='日期輸入已保留，尚未儲存：'+error.message;syncStatus('離開欄位可重試');return;}
    state=structuredClone(before);$('#editor').close();$('#simpleDialog').close();
    saveFailure='上次儲存失敗，變更未寫入：'+error.message;
    syncStatus('畫面已還原');toast('未儲存，請重新整理後再試');
  }finally{if(version===generation){saving=false;render();applyPermissions();if(!saveFailure)flushDeadlineSave();flushLiveSync();}}
}
// Block mutations while a write is in flight; navigation/account controls stay usable.
document.addEventListener('click',event=>{
  const target=event.target.closest('#quickCreate,#editBoard,#starBoard,#addBoard,#addColumn,[data-add-card],[data-edit-col],[data-remove-check],[data-remove-file],[data-cover],#copyCard,#moveCard,#cardCompletion,#deleteCard,#deleteColumn,#deleteBoard');
  if(target&&!canEdit()){event.preventDefault();event.stopImmediatePropagation();}
},true);
window.addEventListener('beforeunload',event=>{flushDeadlineSave();if(saving||deadlineSavePending){event.preventDefault();event.returnValue='';}});
$('#refreshWorkspace').onclick=()=>{saveFailure='';return window.boardlyGoogleAuth?.refreshMembership
  ?window.boardlyGoogleAuth.refreshMembership():refreshWorkspace();};
$('#archiveBtn').onclick=showArchive;
$('#closeArchive').onclick=()=>$('#archiveDialog').close();
$('#dialogGoogleSignIn').onclick=()=>{$('#userDialog').close();$('#googleSignIn').click()};
$('#editGoogleName').onclick=()=>{$('#userDialog').close();window.boardlyGoogleAuth?.editName()};
$('#googleSignOut').onclick=async()=>{try{await window.boardlyGoogleAuth.signOut()}catch(error){toast('登出失敗：'+error.message)}};
applyGoogleAccount(window.boardlyGoogleUser || null);
