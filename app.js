import {clearAttachmentUI,hydrateAttachmentImages,downloadAttachment,bindAttachmentUpload} from './attachment-ui.js';
import { listManagementMembers, createManagedBoard, setManagedAssignees } from './management.js';
import { loadWorkspace, subscribeWorkspace, persistWorkspace, restoreCard, restoreAttachment, loadDeferredAttachmentArchives } from './storage.js?v=20261010-rest';
import { assignMovedOrderKey } from './order-key.js';
// UI rendering, interaction handlers, and workspace state.
'use strict';
const $=s=>document.querySelector(s), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])), uid=()=>crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2);
const colors={purple:'設計',blue:'開發',green:'內容',orange:'規劃',pink:'行銷'}, boardColors=['#455f56','#c8b58f','#8fa697','#bca582','#ad9790'];
let state={version:1,boards:[],users:[]},currentCard=null,mine=false,dragged=null,toastTimer,googleAccount=null;
function toast(s){$('#toast').textContent=s;$('#toast').classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.add('hidden'),4000)}

function userId(){return googleAccount?.memberId || null}

function me(){return state.users.find(u=>u.id===userId())}

function board(){return state.boards.find(b=>b.id===state.activeBoard)||state.boards[0]}

function avatar(u){return u?`<span class="avatar" title="${esc(u.name)}">${esc([...u.name].slice(0,1).join(''))}</span>`:''}

function overdue(c){return c.due&&!c.done&&new Date(c.due)<new Date()}

function formatDate(s,full=false){return new Intl.DateTimeFormat('zh-TW',full?{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}:{month:'short',day:'numeric'}).format(new Date(s))}

function safeImage(a){return /^data:image\/(png|jpeg|gif|webp|avif|bmp);base64,/i.test(a.data)}
const boardColorNames=['森林綠','暖沙色','鼠尾草綠','奶茶色','玫瑰灰'];
function applyBoardColor(value){
  const color=boardColors.includes(value)?value:boardColors[0];
  const dark=color===boardColors[0];
  $('.main').style.cssText=`--board-bg:${color};--on-primary:${dark?'var(--board-light-ink)':'var(--board-dark-ink)'};--on-primary-muted:${dark?'var(--board-light-muted)':'var(--board-dark-ink)'}`;
}
function renderBoardNavigation(active) {
  const expanded = $('#archivedBoards')?.open || false;
  const boardButton = x=>`<button class="nav-button ${x.id===active.id?'active':''}" data-board="${x.id}" title="${esc(x.name)}"><span class="board-dot" style="background:${boardColors.includes(x.color)?x.color:boardColors[0]}"></span><span class="nav-text grow">${esc(x.name)}</span>${x.starred?'<span class="nav-text">★</span>':''}</button>`;
  const current = state.boards.filter(board => !board.archived);
  const archived = state.boards.filter(board => board.archived);
  $('#boardNav').innerHTML = current.map(boardButton).join('') + (archived.length ?
    `<details id="archivedBoards" class="archived-boards" ${expanded?'open':''}>
      <summary title="展開封存看板"><span>封存看板</span><span class="count">${archived.length}</span></summary>
      <div>${archived.map(boardButton).join('')}</div>
    </details>` : '');
}
function render(){const b=board();if(!b){renderEmpty();return;}applyBoardColor(b.color);$('#boardTitle').textContent=b.name;$('#crumb').textContent=b.name;$('#boardDescription').textContent=b.description||'為團隊整理任務，讓進度清楚可見。';$('#starBoard').textContent=b.starred?'★':'☆';$('#starBoard').style.color=b.starred?'var(--on-primary)':'';$('#currentUser').innerHTML=avatar(me())+`<span class="user-name">${esc(me()?.name||'Google 登入')}</span><span class="muted">⌄</span>`;$('#headerMembers').innerHTML=state.users.slice(0,5).map(avatar).join('');renderBoardNavigation(b);const q=$('#search').value.trim().toLowerCase(),filter=$('#dueFilter').value;const visible=b.cards.filter(c=>(!q||(c.title+' '+c.description).toLowerCase().includes(q))&&(!mine||c.assignees.includes(userId()))&&(filter==='all'||filter==='none'&&!c.due||filter==='overdue'&&overdue(c)||filter==='week'&&c.due&&!c.done&&new Date(c.due)>=new Date()&&new Date(c.due)<=new Date(Date.now()+7*86400000)));$('#mineFilter').classList.toggle('filter-active',mine);$('#clearFilters').classList.toggle('hidden',!mine&&!q&&filter==='all');$('#boardStats').textContent=`${b.columns.length} 個階段 · ${b.cards.length} 張卡片${visible.length!==b.cards.length?' · 顯示 '+visible.length+' 張':''}`;$('#columns').innerHTML=b.columns.map((col,i)=>`<section class="column" data-col="${col.id}"><div class="column-head"><span class="board-dot" style="background:${boardColors[i%boardColors.length]}"></span><span class="grow">${esc(col.name)}</span><span class="count">${visible.filter(c=>c.columnId===col.id).length}</span><button data-edit-col="${col.id}" aria-label="編輯階段 ${esc(col.name)}" style="padding:2px 5px">⋯</button></div><div class="cards">${visible.filter(c=>c.columnId===col.id).map(cardHTML).join('')||'<div class="empty">'+(q||mine||filter!=='all'?'沒有符合篩選的卡片':'把想法放在這裡<br><br>拖曳卡片至此，或新增卡片')+'</div>'}</div><button class="add-card" data-add-card="${col.id}">＋ &nbsp; 新增卡片</button></section>`).join('')+'<button class="add-column" id="addColumn">＋ &nbsp; 新增階段</button>';bindBoard();applyPermissions();hydrateAttachmentImages()}
// Imported labels retain their names while using the existing readable palette.
function labelOptions() {
  return {...Object.fromEntries(Object.entries(colors).map(([id,name])=>[id,{name,color:id}])),
    ...(board().labelDefinitions || {})};
}
function labelHTML(id) {
  const label=labelOptions()[id];
  return label ? `<span class="tag ${Object.hasOwn(colors,label.color)?label.color:'purple'}">${esc(label.name)}</span>` : '';
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
function localDue(value) {
  if(!value) return '';
  const d=new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
function cardHTML(c){const cover=c.attachments.find(a=>a.id===c.coverId&&attachmentImage(a)),checked=c.checklist.filter(t=>t.done).length;return `<article class="card" draggable="true" tabindex="0" role="button" aria-label="開啟卡片：${esc(c.title)}" data-card="${c.id}">${cover?`<img class="cover" ${cover.storagePath?`data-storage-path="${esc(cover.storagePath)}"`:""} src="${esc(attachmentImage(cover))}" loading="lazy" referrerpolicy="no-referrer" alt="${esc(cover.name)}">`:c.demoCover?'<div class="design-cover"><div class="mini-window"><b>MAKE ROOM FOR IDEAS.</b><div class="mini-grid"><i></i><i></i><i></i></div></div></div>':''}<div>${c.labels.map(labelHTML).join('')}</div><div class="card-title">${esc(c.title)}</div>${c.description?`<p class="card-desc">${esc(c.description.slice(0,65))}${c.description.length>65?'…':''}</p>`:''}<div class="card-footer">${c.due?`<span class="due ${overdue(c)?'overdue':''} ${c.done?'done':''}">${c.done?'✓':'◷'} ${formatDate(c.due)}</span>`:''}${c.checklist.length?`<span title="待辦事項">☑ ${checked}/${c.checklist.length}</span>`:''}${c.comments.length?`<span title="留言">☏ ${c.comments.length}</span>`:''}${c.attachments.length?`<span title="附件">♧ ${c.attachments.length}</span>`:''}<span class="grow"></span>${c.assignees.map(id=>avatar(state.users.find(u=>u.id===id))).join('')}</div></article>`}
function bindBoard(){$$('[data-board]').forEach(el=>el.onclick=()=>{state.activeBoard=el.dataset.board;mine=false;$('#search').value='';$('#dueFilter').value='all';render()});$$('[data-card]').forEach(el=>{el.onclick=()=>openCard(el.dataset.card);el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openCard(el.dataset.card)}};el.ondragstart=e=>{dragged=el.dataset.card;e.dataTransfer.setData('text/plain',dragged);e.dataTransfer.effectAllowed='move';el.classList.add('dragging')};el.ondragend=()=>{dragged=null;$$('.drag-over').forEach(e=>e.classList.remove('drag-over'));el.classList.remove('dragging')}});$$('[data-col]').forEach(el=>{el.ondragover=e=>{if(dragged){e.preventDefault();e.dataTransfer.dropEffect='move';el.classList.add('drag-over')}};el.ondragleave=e=>{if(!el.contains(e.relatedTarget))el.classList.remove('drag-over')};el.ondrop=e=>{e.preventDefault();if(!dragged||!canEdit())return;const b=board(),c=b.cards.find(c=>c.id===dragged);if(!c)return;const target=e.target.closest('[data-card]');if(target?.dataset.card===c.id){el.classList.remove('drag-over');return}b.cards=b.cards.filter(x=>x.id!==c.id);c.columnId=el.dataset.col;let index=target?b.cards.findIndex(x=>x.id===target.dataset.card):-1;if(index>=0){if(e.clientY>target.getBoundingClientRect().top+target.getBoundingClientRect().height/2)index++;b.cards.splice(index,0,c)}else b.cards.push(c);try{assignMovedOrderKey(b.cards,c)}catch(error){state=structuredClone(baseline);render();toast(error.message);return}save();render()}});$$('[data-add-card]').forEach(el=>el.onclick=()=>createCard(el.dataset.addCard));$$('[data-edit-col]').forEach(el=>el.onclick=()=>editColumn(el.dataset.editCol));$('#addColumn').onclick=()=>editColumn()}
function $$(s,root=document){return [...root.querySelectorAll(s)]}

function requireUser(action){if(me())action();else openUsers()}

function openUsers(){
  $('#googleAccountPanel').hidden=!googleAccount;
  $('#localUserPanel').hidden=Boolean(googleAccount);
  $('#userDialogTitle').textContent=googleAccount?'Google 帳號':'Google 登入';
  if(googleAccount){
    $('#googleAccountSummary').textContent=`${googleAccount.displayName} · ${googleAccount.email}`;
    const roleNames={owner:'Owner',admin:'Admin',editor:'Editor',viewer:'Viewer'};
    $('#workspaceAccess').textContent=googleAccount.workspaceRole
      ?`工作空間權限：${roleNames[googleAccount.workspaceRole]||googleAccount.workspaceRole}`
      :'Google 登入成功；此帳號尚未取得工作空間成員權限。';
  }
  $('#editGoogleName').disabled=!googleAccount?.memberId;
  $('#displayMembers').hidden=!googleAccount?.memberId;
  $('#displayMembers').innerHTML=googleAccount?.memberId ? '<h3>工作空間成員</h3><p class="help-note">此名冊僅供查閱；負責人請在牌卡內由 Owner／Admin 管理。</p>'+(googleAccount.roster||state.users).map(u=>`<div class="member-display">${avatar(u)}<span>${esc(u.name)}</span></div>`).join('') : '';
  if(!$('#userDialog').open)$('#userDialog').showModal();
}
async function applyGoogleAccount(account){
  stopLiveSync();
  saveFailure='';
  saving=false;
  googleAccount=account;
  if($('#userDialog').open)openUsers();
  await refreshWorkspace();
}
window.addEventListener('boardly-auth-changed',event=>applyGoogleAccount(event.detail));
function simple(title,body,onSubmit){managementRequest++;managementLoading=false;const d=$('#simpleDialog');d.innerHTML=`<form id="simpleForm"><div class="modal-head"><h2 id="simpleTitle">${esc(title)}</h2><button type="button" data-close-simple aria-label="關閉">✕</button></div><div class="modal-body">${body}<div class="row" style="justify-content:flex-end;margin-top:22px"><button type="button" data-close-simple>取消</button><button class="primary" type="submit">儲存</button></div></div></form>`;$$('[data-close-simple]').forEach(el=>el.onclick=()=>d.close());$('#simpleForm').onsubmit=e=>{e.preventDefault();if(onSubmit()!==false)d.close()};d.showModal();applyPermissions()}
function editBoard(isNew=false){
  if(isNew){openManagedBoard();return;}
  if(!canEdit())return;
  const b=board();
  simple('看板設定',`<div class="field"><label for="boardNameInput">看板名稱</label><input id="boardNameInput" class="full" required maxlength="80" value="${esc(b.name)}" placeholder="例如：新產品開發"></div><div class="field"><label for="boardDescInput">專案說明</label><textarea id="boardDescInput">${esc(b.description)}</textarea></div><div class="field"><label for="boardColorInput">共用看板配色</label><select id="boardColorInput" class="full">${boardColors.map((color,i)=>`<option value="${color}" ${color===(boardColors.includes(b.color)?b.color:boardColors[0])?'selected':''}>${boardColorNames[i]}</option>`).join('')}</select><p class="help-note">儲存後，所有可存取此看板的成員都會看到相同配色。</p></div><button type="button" id="deleteBoard" class="danger">${b.archived?'復原看板':'封存看板'}</button>`,()=>{
    const name=$('#boardNameInput').value.trim();if(!name)return false;
    b.name=name;b.description=$('#boardDescInput').value;
    const color=$('#boardColorInput').value;if(boardColors.includes(color))b.color=color;
    save();render();
  });
  $('#deleteBoard').onclick=()=>{b.archived=!b.archived;save();render();$('#simpleDialog').close()};
}
function editColumn(id){const b=board(),col=b.columns.find(x=>x.id===id);simple(col?'編輯階段':'新增階段',`<div class="field"><label for="columnName">階段名稱</label><input id="columnName" class="full" required maxlength="50" value="${esc(col?.name||'')}"></div>${col?`<div class="field"><label for="columnPosition">欄位順序</label><select id="columnPosition" class="full">${b.columns.map((x,i)=>`<option value="${i}" ${x.id===id?'selected':''}>第 ${i+1} 欄</option>`).join('')}</select></div><button type="button" id="deleteColumn" class="danger">刪除此階段</button>`:''}`,()=>{const name=$('#columnName').value.trim();if(!name)return false;if(col){col.name=name;const pos=Number($('#columnPosition').value);b.columns=b.columns.filter(x=>x.id!==id);b.columns.splice(pos,0,col)}else b.columns.push({id:uid(),name});b.columns.forEach((item,i)=>item.orderKey=String(i).padStart(12,'0'));save();render()});if(col)$('#deleteColumn').onclick=()=>{if(b.columns.length===1){toast('至少保留一個階段');return}if(b.cards.some(c=>c.columnId===id)){toast('請先移動或刪除這個階段內的卡片');return}b.columns=b.columns.filter(x=>x.id!==id);save();render();$('#simpleDialog').close()}}
function createCard(col){requireUser(()=>{simple('新增卡片',`<div class="field"><label for="newCardTitle">卡片標題</label><input id="newCardTitle" class="full" required maxlength="150" placeholder="接下來想完成什麼？"></div>`,()=>{const title=$('#newCardTitle').value.trim();if(!title)return false;const c={id:uid(),title,columnId:col||board().columns[0].id,description:'',labels:[],assignees:[],due:'',done:false,checklist:[],attachments:[],comments:[],createdAt:new Date().toISOString(),orderKey:'z'+Date.now()};board().cards.push(c);save();render();setTimeout(()=>openCard(c.id),0)})})}
function openCard(id){const c=board().cards.find(x=>x.id===id);if(!c)return;currentCard=id;const d=$('#editor');d.innerHTML=`<div class="modal-head"><span class="muted">▤</span><input id="cardTitleInput" class="title-input" aria-label="卡片標題" maxlength="150" value="${esc(c.title)}"><button id="closeCard" aria-label="關閉卡片">✕</button></div><div class="modal-body"><div class="detail-grid"><div><div class="field"><label for="cardDescription">≡ &nbsp; 說明</label><textarea id="cardDescription" placeholder="加入更詳細的說明…">${esc(c.description)}</textarea></div><div class="field"><h3>☑ &nbsp; 待辦事項 <span id="checkCount" class="muted"></span></h3><div id="checklist"></div><form id="checkForm" class="row"><input id="checkText" class="grow" aria-label="新增待辦事項" placeholder="新增待辦事項…" required maxlength="200"><button aria-label="新增待辦事項">＋</button></form></div><div class="field"><h3>♧ &nbsp; 附件</h3><div id="attachments"></div><label class="file-label" for="attachmentInput">＋ 上傳附件（每檔最多 20 MiB）</label><input id="attachmentInput" type="file" multiple><p id="attachmentStatus" role="status" class="help-note"></p><button id="retryAttachment" type="button" hidden>重試未完成附件</button></div><div class="field"><h3>☏ &nbsp; 留言與討論</h3><form id="commentForm"><textarea id="commentText" aria-label="留言內容" placeholder="分享進度或留下你的想法…" required maxlength="5000" style="min-height:75px"></textarea><div class="row between" style="margin-top:8px"><span class="small muted">以 ${esc(me()?.name||'尚未登入')} 的身分留言</span><button class="primary">送出留言</button></div></form><div id="comments"></div></div></div><div class="detail-side"><div class="field"><label for="cardStage">所在階段</label><select id="cardStage" class="full">${board().columns.map(col=>`<option value="${col.id}" ${c.columnId===col.id?'selected':''}>${esc(col.name)}</option>`).join('')}</select></div><div class="field"><h3>負責人</h3><button type="button" id="manageAssignees" class="pill" aria-describedby="assigneeHelp">管理負責人</button><p class="help-note" id="assigneeHelp">負責人由 Owner／Admin 管理；下方勾選僅顯示目前指派。</p>${state.users.map(u=>`<label class="row" style="margin:8px 0;font-weight:400"><input type="checkbox" data-assignee="${u.id}" ${c.assignees.includes(u.id)?'checked':''}>${avatar(u)}<span>${esc(u.name)}</span></label>`).join('')}</div><div class="field"><label for="cardDue">截止日期</label><input id="cardDue" class="full" type="datetime-local" value="${esc(localDue(c.due))}"><label class="row" style="margin-top:10px;font-weight:400"><input id="cardDone" type="checkbox" ${c.done?'checked':''}>已完成任務</label></div><div class="field"><h3>標籤</h3>${Object.entries(labelOptions()).map(([key,label])=>`<label class="row" style="margin:7px 0;font-weight:400"><input type="checkbox" data-label="${key}" ${c.labels.includes(key)?'checked':''}><span class="tag ${Object.hasOwn(colors,label.color)?label.color:'purple'}">${esc(label.name)}</span></label>`).join('')}</div><div class="field"><h3>操作</h3><button id="copyCard" title="副本不會保留負責人與附件" class="full pill" style="margin-bottom:8px">▣ 複製卡片</button><button id="deleteCard" class="full danger pill">封存卡片</button></div><p class="help-note">變更會自動儲存至 Firebase，請確認上方儲存狀態。<br>建立於 ${formatDate(c.createdAt,true)}</p></div></div></div>`;const update=()=>{save();render()};$('#cardTitleInput').onchange=e=>{const title=e.target.value.trim();if(!title){e.target.value=c.title;toast('標題不可為空');return}c.title=title;update()};$('#cardDescription').onchange=e=>{c.description=e.target.value;update()};$('#cardStage').onchange=e=>{c.columnId=e.target.value;update()};$('#cardDue').onchange=e=>{c.due=e.target.value;update()};$('#cardDone').onchange=e=>{c.done=e.target.checked;update()};$('#manageAssignees').onclick=()=>openManagedAssignees(c.id);$$('[data-label]').forEach(el=>el.onchange=()=>{c.labels=el.checked?[...c.labels,el.dataset.label]:c.labels.filter(l=>l!==el.dataset.label);update()});$('#closeCard').onclick=()=>d.close();$('#checkForm').onsubmit=e=>{e.preventDefault();const text=$('#checkText').value.trim();if(!text)return;c.checklist.push({id:uid(),text,done:false});$('#checkText').value='';renderChecklist(c);update()};$('#commentForm').onsubmit=e=>{e.preventDefault();requireUser(()=>{const text=$('#commentText').value.trim();if(!text)return;c.comments.push({id:uid(),userId:me().id,text,at:new Date().toISOString()});$('#commentText').value='';renderComments(c);update()})};$('#deleteCard').onclick=()=>{if(confirm(`封存「${c.title}」？資料會保留於雲端，可由管理員復原。`)){board().archivedCards||=[];board().archivedCards.push({id:c.id,title:c.title,columnId:c.columnId});board().cards=board().cards.filter(x=>x.id!==c.id);update();d.close()}};$('#copyCard').onclick=()=>{const n=structuredClone(c);n.id=uid();n.title+='（副本）';n.comments=[];n.assignees=[];n.attachments=[];n.archivedAttachments=[];n.coverId=null;n.createdAt=new Date().toISOString();n.orderKey='z'+Date.now();board().cards.push(n);update();openCard(n.id);toast('正在儲存卡片副本')};renderChecklist(c);renderAttachments(c);renderComments(c);
const uploadVersion=generation,uploadBoard=board().id;
bindAttachmentUpload({input:$('#attachmentInput'),status:$('#attachmentStatus'),retry:$('#retryAttachment'),boardId:uploadBoard,cardId:c.id,canEdit,isCurrent:()=>uploadVersion===generation,
 busy:value=>{if(uploadVersion===generation){saving=value;applyPermissions();}},
 complete:async()=>{if(uploadVersion!==generation)return;d.close();await refreshWorkspace([uploadBoard]);if(googleAccount&&board()?.id===uploadBoard)openCard(c.id);}});
if(!d.open)d.showModal();applyPermissions()}
function renderChecklist(c){const done=c.checklist.filter(x=>x.done).length;$('#checkCount').textContent=`${done}/${c.checklist.length}`;$('#checklist').innerHTML=`${c.checklist.length?`<div class="progress"><i style="width:${done/c.checklist.length*100}%"></i></div>`:''}`+c.checklist.map(t=>`<div class="check-item ${t.done?'checked':''}"><input type="checkbox" data-check="${t.id}" ${t.done?'checked':''} aria-label="${esc(t.text)}"><span>${t.group?`<small class="muted">${esc(t.group)} · </small>`:''}${esc(t.text)}</span><button data-remove-check="${t.id}" aria-label="刪除待辦事項">×</button></div>`).join('');$$('[data-check]').forEach(el=>el.onchange=()=>{c.checklist.find(t=>t.id===el.dataset.check).done=el.checked;save();render();renderChecklist(c);applyPermissions()});$$('[data-remove-check]').forEach(el=>el.onclick=()=>{c.checklist=c.checklist.filter(t=>t.id!==el.dataset.removeCheck);save();render();renderChecklist(c);applyPermissions()})}
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
function renderComments(c){$('#comments').innerHTML=[...c.comments].reverse().map(x=>{const user=state.users.find(u=>u.id===x.userId),name=user?.name||'未知成員';return `<div class="comment">${avatar(user)}<div class="grow"><strong class="small">${esc(name)}</strong><time datetime="${esc(x.at)}">${formatDate(x.at,true)}</time><p>${esc(x.text)}</p></div></div>`}).join('')}
function renderArchive(b){
  $('#archiveBoardName').textContent=b.name;
  const cards=b.archivedCards||[];
  $('#archivedCards').innerHTML=cards.length?cards.map(c=>`<div class="archive-row"><span>${esc(c.title||'未命名牌卡')}</span><button type="button" data-restore-card="${esc(c.id)}">復原牌卡</button></div>`).join(''):'<p class="muted">沒有已封存的牌卡。</p>';
  const attachments=b.cards.flatMap(card=>(card.archivedAttachments||[]).map(file=>({...file,cardId:card.id,cardTitle:card.title})));
  $('#archivedAttachments').innerHTML=attachments.length?attachments.map(file=>`<div class="archive-row"><span>${esc(file.name||'未命名附件')} <small class="muted">${esc(file.cardTitle)}</small></span><button type="button" data-restore-attachment="${esc(file.id)}" data-parent-card="${esc(file.cardId)}">復原附件</button></div>`).join(''):'<p class="muted">沒有已封存的附件。</p>';
  $$('[data-restore-card]').forEach(button=>button.onclick=()=>restoreArchived('card',button.dataset.restoreCard));
  $$('[data-restore-attachment]').forEach(button=>button.onclick=()=>restoreArchived('attachment',button.dataset.restoreAttachment,button.dataset.parentCard));
  $$('#archiveDialog [data-restore-card], #archiveDialog [data-restore-attachment]').forEach(button=>button.disabled=!canEdit());
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
$('#editor').onclose=()=>{const id=currentCard;currentCard=null;const source=$$('[data-card]').find(el=>el.dataset.card===id);if(source)source.focus?.();else $('#quickCreate').focus?.();flushLiveSync()};$('#currentUser').onclick=openUsers;$('#membersBtn').onclick=openUsers;$('#inviteBtn').onclick=openUsers;$('#closeUser').onclick=()=>$('#userDialog').close();$('#addBoard').onclick=()=>editBoard(true);$('#editBoard').onclick=()=>editBoard();$('#starBoard').onclick=()=>{board().starred=!board().starred;save();render()};$('#quickCreate').onclick=()=>createCard();$('#workspaceNav').onclick=()=>{mine=false;$('#search').value='';$('#dueFilter').value='all';render()};$('#search').oninput=render;$('#mineFilter').onclick=()=>requireUser(()=>{mine=!mine;render()});$('#dueFilter').onchange=render;$('#clearFilters').onclick=()=>{mine=false;$('#search').value='';$('#dueFilter').value='all';render()};
let baseline=null, loading=false, saving=false, generation=0, saveFailure='';
let stopSubscription=null, livePending=false, liveTimer=null, liveBoards=new Set();
function stopLiveSync(){
  stopSubscription?.();stopSubscription=null;
  clearTimeout(liveTimer);liveTimer=null;livePending=false;liveBoards.clear();
}
function flushLiveSync(){
  if(!livePending||liveTimer||saving||loading||$('#editor').open||$('#simpleDialog').open||$('#archiveDialog').open)return;
  liveTimer=setTimeout(()=>{
    liveTimer=null;
    if(saving||loading||$('#editor').open||$('#simpleDialog').open||$('#archiveDialog').open)return;
    const boardIds=[...liveBoards];
    livePending=false;liveBoards.clear();
    refreshWorkspace(boardIds.length?boardIds:null);
  },250);
}
function queueLiveSync(boardId){livePending=true;if(boardId)liveBoards.add(boardId);flushLiveSync()}
let managementRequest=0,managementLoading=false;
$('#simpleDialog').onclose=()=>{managementRequest++;managementLoading=false;flushLiveSync()};
$('#archiveDialog').onclose=()=>{archiveRequest++;flushLiveSync()};
function canEdit(){return !loading && !saving && Boolean(baseline) && ['owner','admin','editor'].includes(googleAccount?.workspaceRole)}
function canManage(){return canEdit() && ['owner','admin'].includes(googleAccount?.workspaceRole)}
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
  if(!canManage()||board()?.archived)return;
  const boardId=board().id,version=generation;
  const request=managementForm('管理負責人','<p class="help-note">只能指派目前可存取此看板的有效會員。最多 40 位。</p><div id="managedMembers">正在讀取目前指派…</div>');
  $('#editor').close();managementLoading=true;applyPermissions();
  try{
    const {members,assigneeIds}=await listManagementMembers({boardId,cardId});
    if(request!==managementRequest||version!==generation||!$('#simpleDialog').open)return;
    $('#managedMembers').innerHTML=managedSelection(members,assigneeIds);
    let lastPayload='',operationId;
    $('#simpleForm').onsubmit=event=>{
      event.preventDefault();if(managementLoading||!canManage())return;
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
  if(!canManage())return;
  const version=generation,request=managementRequest,actor=googleAccount;
  saving=true;saveFailure='';applyPermissions();$('#managementError').textContent='';syncStatus('正在儲存管理設定…');
  try{
    const result=await write();
    if(version!==generation && !(allowMembershipRefresh && googleAccount?.uid===actor?.uid && googleAccount?.memberId===actor?.memberId && ['owner','admin'].includes(googleAccount?.workspaceRole)))return;
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
  for(const id of ['crumb','boardNav','columns','boardStats','headerMembers'])$('#'+id).replaceChildren();
  $('#currentUser').textContent=googleAccount?.displayName||'Google 登入';
  applyPermissions();
}
function applyPermissions(){
  const edit=canEdit() && Boolean(board());
  const reason=loading?'正在載入，請稍候。':saving?'正在儲存，完成後可繼續編輯。':!googleAccount?'請先使用 Google 登入。':!googleAccount.memberId?'尚未取得工作空間權限；請聯絡 Owner／Admin 核准。':!board()?'沒有可存取的看板；請聯絡 Owner／Admin 調整看板權限。':!edit?'目前為唯讀：可閱讀與下載；編輯需 Owner／Admin／Editor 權限。':'';
  $('#permissionNotice').textContent=reason;
  $('#mineFilter').disabled=!googleAccount?.memberId;
  $('#mineFilter').setAttribute?.('aria-pressed',String(mine));
  $('#starBoard').setAttribute?.('aria-pressed',String(Boolean(board()?.starred)));
  $('#currentUser').setAttribute?.('aria-label',googleAccount ? `帳號與個人設定：${googleAccount.displayName}` : '使用 Google 登入');
  for(const selector of ['#quickCreate','#editBoard','#starBoard','#addColumn','[data-add-card]','[data-edit-col]'])$$(selector).forEach(el=>{el.disabled=!edit;el.title=edit?'':reason;});
  $('#addBoard').disabled=!canManage();$('#addBoard').title='Owner／Admin 可建立看板並選擇授權會員';
  $$('.card').forEach(el=>el.draggable=edit);
  $$('#editor input, #editor textarea, #editor select, #editor button').forEach(el=>{
    if(el.id!=='closeCard'&&!el.hasAttribute('data-download'))el.disabled=!edit;
  });
  if($('#attachmentInput'))$('#attachmentInput').disabled=!edit;
  // Membership/card assignments remain controlled by the trusted management flow.
  $$('[data-assignee]').forEach(el=>el.disabled=true);
  if($('#manageAssignees'))$('#manageAssignees').disabled=!canManage() || Boolean(board()?.archived);
  if($('#managementSubmit'))$('#managementSubmit').disabled=managementLoading||!canManage();
  if($('#deleteColumn'))$('#deleteColumn').disabled=!['owner','admin'].includes(googleAccount?.workspaceRole);
  $('#refreshWorkspace').disabled=loading||saving;
  $('#archiveBtn').disabled=loading||saving||!board();
  $('#simpleDialog').inert=saving;
}
function syncStatus(message){$('#syncStatus').textContent=saveFailure?`${saveFailure}；${message}`:message;}
function clearWorkspaceDialogs(){
  clearAttachmentUI();
  managementRequest++;managementLoading=false;
  currentCard=null;dragged=null;
  $('#editor').close();$('#simpleDialog').close();$('#archiveDialog').close();
  for(const id of ['editor','simpleDialog','archiveBoardName','archivedCards','archivedAttachments'])$('#'+id).replaceChildren();
}
async function refreshWorkspace(boardIds=null,preferredBoard=null){
  const version=++generation,account=googleAccount,active=preferredBoard||state.activeBoard,previous=state;
  const partial=Boolean(boardIds?.length && previous.boards.length);
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
    state=loaded;state.activeBoard=loaded.boards.some(b=>b.id===active)?active:(loaded.boards.find(b=>!b.archived)||loaded.boards[0])?.id;
    baseline=structuredClone(state);syncStatus('已從 Firebase 載入');
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
}
async function save(){
  if(!canEdit()){if(baseline){state=structuredClone(baseline);render();}return;}
  const version=generation,before=baseline,after=structuredClone(state);
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
    state=structuredClone(before);$('#editor').close();$('#simpleDialog').close();
    saveFailure='上次儲存失敗，變更未寫入：'+error.message;
    syncStatus('畫面已還原');toast('未儲存，請重新整理後再試');
  }finally{if(version===generation){saving=false;render();applyPermissions();flushLiveSync();}}
}
// Block mutations while a write is in flight; navigation/account controls stay usable.
document.addEventListener('click',event=>{
  const target=event.target.closest('#quickCreate,#editBoard,#starBoard,#addBoard,#addColumn,[data-add-card],[data-edit-col],[data-remove-check],[data-remove-file],[data-cover],#copyCard,#deleteCard,#deleteColumn,#deleteBoard');
  if(target&&!canEdit()){event.preventDefault();event.stopImmediatePropagation();}
},true);
window.addEventListener('beforeunload',event=>{if(saving){event.preventDefault();event.returnValue='';}});
$('#refreshWorkspace').onclick=()=>{saveFailure='';return window.boardlyGoogleAuth?.refreshMembership
  ?window.boardlyGoogleAuth.refreshMembership():refreshWorkspace();};
$('#archiveBtn').onclick=showArchive;
$('#closeArchive').onclick=()=>$('#archiveDialog').close();
$('#dialogGoogleSignIn').onclick=()=>{$('#userDialog').close();$('#googleSignIn').click()};
$('#editGoogleName').onclick=()=>{$('#userDialog').close();window.boardlyGoogleAuth?.editName()};
$('#googleSignOut').onclick=async()=>{try{await window.boardlyGoogleAuth.signOut()}catch(error){toast('登出失敗：'+error.message)}};
applyGoogleAccount(window.boardlyGoogleUser || null);
