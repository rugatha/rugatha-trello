// UI rendering, interaction handlers, and workspace state.
'use strict';
const $=s=>document.querySelector(s), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])), uid=()=>crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2);
const colors={purple:'設計',blue:'開發',green:'內容',orange:'規劃',pink:'行銷'}, boardColors=['#455f56','#c8b58f','#8fa697','#bca582','#ad9790'];
let state,db,currentCard=null,mine=false,dragged=null,toastTimer;const sessionKey='boardly-user-v1';
function toast(s){$('#toast').textContent=s;$('#toast').classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.add('hidden'),4000)}

function userId(){try{return sessionStorage.getItem(sessionKey)}catch{return window.tempUser}}

function setUser(id){try{sessionStorage.setItem(sessionKey,id)}catch{window.tempUser=id}}

function me(){return state.users.find(u=>u.id===userId())}

function board(){return state.boards.find(b=>b.id===state.activeBoard)||state.boards[0]}

function avatar(u){return u?`<span class="avatar" style="background:${boardColors.includes(u.color)?u.color:['#e4e9dd','#e8dfcc','#efe7db'].includes(u.color)?u.color:'#e4e9dd'}" title="${esc(u.name)}">${esc(typeof u.shortName==='string'&&u.shortName.trim()?u.shortName.trim():[...u.name].slice(0,1).join(''))}</span>`:''}

function overdue(c){return c.due&&!c.done&&new Date(c.due)<new Date()}

function formatDate(s,full=false){return new Intl.DateTimeFormat('zh-TW',full?{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}:{month:'short',day:'numeric'}).format(new Date(s))}

function safeImage(a){return /^data:image\/(png|jpeg|gif|webp|avif|bmp);base64,/i.test(a.data)}
function render(){const b=board();$('#boardTitle').textContent=b.name;$('#crumb').textContent=b.name;$('#boardDescription').textContent=b.description||'為團隊整理任務，讓進度清楚可見。';$('#starBoard').textContent=b.starred?'★':'☆';$('#starBoard').style.color=b.starred?'#c8b58f':'';$('#currentUser').innerHTML=avatar(me())+`<span class="user-name">${esc(me()?.name||'選擇身分')}</span><span class="muted">⌄</span>`;$('#headerMembers').innerHTML=state.users.slice(0,5).map(avatar).join('');$('#boardNav').innerHTML=state.boards.map(x=>`<button class="nav-button ${x.id===b.id?'active':''}" data-board="${x.id}" title="${esc(x.name)}"><span class="board-dot" style="background:${boardColors.includes(x.color)?x.color:boardColors[0]}"></span><span class="nav-text grow">${esc(x.name)}</span>${x.starred?'<span class="nav-text">★</span>':''}</button>`).join('');const q=$('#search').value.trim().toLowerCase(),filter=$('#dueFilter').value;const visible=b.cards.filter(c=>(!q||(c.title+' '+c.description).toLowerCase().includes(q))&&(!mine||c.assignees.includes(userId()))&&(filter==='all'||filter==='none'&&!c.due||filter==='overdue'&&overdue(c)||filter==='week'&&c.due&&!c.done&&new Date(c.due)>=new Date()&&new Date(c.due)<=new Date(Date.now()+7*86400000)));$('#mineFilter').classList.toggle('filter-active',mine);$('#clearFilters').classList.toggle('hidden',!mine&&!q&&filter==='all');$('#boardStats').textContent=`${b.columns.length} 個階段 · ${b.cards.length} 張卡片${visible.length!==b.cards.length?' · 顯示 '+visible.length+' 張':''}`;$('#columns').innerHTML=b.columns.map((col,i)=>`<section class="column" data-col="${col.id}"><div class="column-head"><span class="board-dot" style="background:${['#9ba6b6','#455f56','#c8b58f','#8fa697'][i%4]}"></span><span class="grow">${esc(col.name)}</span><span class="count">${visible.filter(c=>c.columnId===col.id).length}</span><button data-edit-col="${col.id}" aria-label="編輯階段 ${esc(col.name)}" style="padding:2px 5px">⋯</button></div><div class="cards">${visible.filter(c=>c.columnId===col.id).map(cardHTML).join('')||'<div class="empty">'+(q||mine||filter!=='all'?'沒有符合篩選的卡片':'把想法放在這裡<br><br>拖曳卡片至此，或新增卡片')+'</div>'}</div><button class="add-card" data-add-card="${col.id}">＋ &nbsp; 新增卡片</button></section>`).join('')+'<button class="add-column" id="addColumn">＋ &nbsp; 新增階段</button>';bindBoard()}
// Imported labels retain their names while using the existing readable palette.
function labelOptions() {
  return {...Object.fromEntries(Object.entries(colors).map(([id,name])=>[id,{name,color:id}])),
    ...(board().labelDefinitions || {})};
}
function labelHTML(id) {
  const label=labelOptions()[id];
  return label ? `<span class="tag ${esc(label.color)}">${esc(label.name)}</span>` : '';
}
function safeExternalURL(value) {
  if (typeof value !== 'string') return false;
  try {const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password;} catch {return false;}
}
function attachmentImage(a) {
  if(safeImage(a)) return a.data;
  return safeExternalURL(a.url) && /^image\/(png|jpeg|gif|webp|avif|bmp)$/i.test(a.type) ? a.url : '';
}
function localDue(value) {
  if(!value) return '';
  const d=new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
function cardHTML(c){const cover=c.attachments.find(a=>a.id===c.coverId&&attachmentImage(a)),checked=c.checklist.filter(t=>t.done).length;return `<article class="card" draggable="true" tabindex="0" role="button" aria-label="開啟卡片：${esc(c.title)}" data-card="${c.id}">${cover?`<img class="cover" src="${esc(attachmentImage(cover))}" loading="lazy" referrerpolicy="no-referrer" alt="${esc(cover.name)}">`:c.demoCover?'<div class="design-cover"><div class="mini-window"><b>MAKE ROOM FOR IDEAS.</b><div class="mini-grid"><i></i><i></i><i></i></div></div></div>':''}<div>${c.labels.map(labelHTML).join('')}</div><div class="card-title">${esc(c.title)}</div>${c.description?`<p class="card-desc">${esc(c.description.slice(0,65))}${c.description.length>65?'…':''}</p>`:''}<div class="card-footer">${c.due?`<span class="due ${overdue(c)?'overdue':''} ${c.done?'done':''}">${c.done?'✓':'◷'} ${formatDate(c.due)}</span>`:''}${c.checklist.length?`<span title="待辦事項">☑ ${checked}/${c.checklist.length}</span>`:''}${c.comments.length?`<span title="留言">☏ ${c.comments.length}</span>`:''}${c.attachments.length?`<span title="附件">♧ ${c.attachments.length}</span>`:''}<span class="grow"></span>${c.assignees.map(id=>avatar(state.users.find(u=>u.id===id))).join('')}</div></article>`}
function bindBoard(){$$('[data-board]').forEach(el=>el.onclick=()=>{state.activeBoard=el.dataset.board;mine=false;$('#search').value='';$('#dueFilter').value='all';save();render()});$$('[data-card]').forEach(el=>{el.onclick=()=>openCard(el.dataset.card);el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openCard(el.dataset.card)}};el.ondragstart=e=>{dragged=el.dataset.card;e.dataTransfer.setData('text/plain',dragged);e.dataTransfer.effectAllowed='move';el.classList.add('dragging')};el.ondragend=()=>{dragged=null;$$('.drag-over').forEach(e=>e.classList.remove('drag-over'));el.classList.remove('dragging')}});$$('[data-col]').forEach(el=>{el.ondragover=e=>{if(dragged){e.preventDefault();e.dataTransfer.dropEffect='move';el.classList.add('drag-over')}};el.ondragleave=e=>{if(!el.contains(e.relatedTarget))el.classList.remove('drag-over')};el.ondrop=e=>{e.preventDefault();if(!dragged)return;const b=board(),c=b.cards.find(c=>c.id===dragged);if(!c)return;const target=e.target.closest('[data-card]');if(target?.dataset.card===c.id){el.classList.remove('drag-over');return}b.cards=b.cards.filter(x=>x.id!==c.id);c.columnId=el.dataset.col;let index=target?b.cards.findIndex(x=>x.id===target.dataset.card):-1;if(index>=0){if(e.clientY>target.getBoundingClientRect().top+target.getBoundingClientRect().height/2)index++;b.cards.splice(index,0,c)}else b.cards.push(c);save();render();toast('已更新卡片位置')}});$$('[data-add-card]').forEach(el=>el.onclick=()=>createCard(el.dataset.addCard));$$('[data-edit-col]').forEach(el=>el.onclick=()=>editColumn(el.dataset.editCol));$('#addColumn').onclick=()=>editColumn()}
function $$(s,root=document){return [...root.querySelectorAll(s)]}

function requireUser(action){if(me())action();else openUsers()}

function openUsers(){$('#userList').innerHTML=state.users.map(u=>`<button class="user-option" data-user="${u.id}">${avatar(u)}<span class="grow">${esc(u.name)}</span>${u.id===userId()?'<span class="badge">目前身分</span>':'<span class="muted">→</span>'}</button>`).join('');$$('[data-user]').forEach(el=>el.onclick=()=>{setUser(el.dataset.user);$('#userDialog').close();render();if(currentCard&&$('#editor').open)openCard(currentCard);toast('已切換為 '+me().name)});if(!$('#userDialog').open)$('#userDialog').showModal()}
$('#newUserForm').onsubmit=e=>{e.preventDefault();const name=$('#newUsername').value.trim();if(!name)return;let u=state.users.find(u=>u.name.toLocaleLowerCase()===name.toLocaleLowerCase());if(u){toast('此 username 已存在，請從清單選擇');return}u={id:uid(),name,shortName:[...name][0],color:['#e4e9dd','#e8dfcc','#efe7db'][state.users.length%3]};state.users.push(u);setUser(u.id);save();$('#newUsername').value='';$('#userDialog').close();render();toast('歡迎，'+name)};
function simple(title,body,onSubmit){const d=$('#simpleDialog');d.innerHTML=`<form id="simpleForm"><div class="modal-head"><h2>${esc(title)}</h2><button type="button" data-close-simple aria-label="關閉">✕</button></div><div class="modal-body">${body}<div class="row" style="justify-content:flex-end;margin-top:22px"><button type="button" data-close-simple>取消</button><button class="primary" type="submit">儲存</button></div></div></form>`;$$('[data-close-simple]').forEach(el=>el.onclick=()=>d.close());$('#simpleForm').onsubmit=e=>{e.preventDefault();if(onSubmit()!==false)d.close()};d.showModal()}
function editBoard(isNew=false){const b=board();simple(isNew?'新增專案看板':'看板設定',`<div class="field"><label for="boardNameInput">看板名稱</label><input id="boardNameInput" class="full" required maxlength="80" value="${isNew?'':esc(b.name)}" placeholder="例如：新產品開發"></div><div class="field"><label for="boardDescInput">專案說明</label><textarea id="boardDescInput">${isNew?'':esc(b.description)}</textarea></div>${!isNew?'<button type="button" id="deleteBoard" class="danger">刪除整個看板</button>':''}`,()=>{const name=$('#boardNameInput').value.trim();if(!name)return false;if(isNew){const n={id:uid(),name,description:$('#boardDescInput').value,color:boardColors[state.boards.length%5],columns:['待辦','進行中','已完成'].map(name=>({id:uid(),name})),cards:[]};state.boards.push(n);state.activeBoard=n.id}else{b.name=name;b.description=$('#boardDescInput').value}save();render()});if(!isNew)$('#deleteBoard').onclick=()=>{if(state.boards.length===1){toast('至少保留一個看板');return}if(confirm(`刪除「${b.name}」及其所有卡片？此操作無法復原。`)){state.boards=state.boards.filter(x=>x.id!==b.id);state.activeBoard=state.boards[0].id;save();render();$('#simpleDialog').close()}}}
function editColumn(id){const b=board(),col=b.columns.find(x=>x.id===id);simple(col?'編輯階段':'新增階段',`<div class="field"><label for="columnName">階段名稱</label><input id="columnName" class="full" required maxlength="50" value="${esc(col?.name||'')}"></div>${col?`<div class="field"><label for="columnPosition">欄位順序</label><select id="columnPosition" class="full">${b.columns.map((x,i)=>`<option value="${i}" ${x.id===id?'selected':''}>第 ${i+1} 欄</option>`).join('')}</select></div><button type="button" id="deleteColumn" class="danger">刪除此階段</button>`:''}`,()=>{const name=$('#columnName').value.trim();if(!name)return false;if(col){col.name=name;const pos=Number($('#columnPosition').value);b.columns=b.columns.filter(x=>x.id!==id);b.columns.splice(pos,0,col)}else b.columns.push({id:uid(),name});save();render()});if(col)$('#deleteColumn').onclick=()=>{if(b.columns.length===1){toast('至少保留一個階段');return}if(b.cards.some(c=>c.columnId===id)){toast('請先移動或刪除這個階段內的卡片');return}b.columns=b.columns.filter(x=>x.id!==id);save();render();$('#simpleDialog').close()}}
function createCard(col){requireUser(()=>{simple('新增卡片',`<div class="field"><label for="newCardTitle">卡片標題</label><input id="newCardTitle" class="full" required maxlength="150" placeholder="接下來想完成什麼？"></div>`,()=>{const title=$('#newCardTitle').value.trim();if(!title)return false;const c={id:uid(),title,columnId:col||board().columns[0].id,description:'',labels:[],assignees:[],due:'',done:false,checklist:[],attachments:[],comments:[],createdAt:new Date().toISOString()};board().cards.push(c);save();render();setTimeout(()=>openCard(c.id),0)})})}
function openCard(id){const c=board().cards.find(x=>x.id===id);if(!c)return;currentCard=id;const d=$('#editor');d.innerHTML=`<div class="modal-head"><span class="muted">▤</span><input id="cardTitleInput" class="title-input" aria-label="卡片標題" maxlength="150" value="${esc(c.title)}"><button id="closeCard" aria-label="關閉卡片">✕</button></div><div class="modal-body"><div class="detail-grid"><div><div class="field"><label for="cardDescription">≡ &nbsp; 說明</label><textarea id="cardDescription" placeholder="加入更詳細的說明…">${esc(c.description)}</textarea></div><div class="field"><h3>☑ &nbsp; 待辦事項 <span id="checkCount" class="muted"></span></h3><div id="checklist"></div><form id="checkForm" class="row"><input id="checkText" class="grow" placeholder="新增待辦事項…" required maxlength="200"><button>＋</button></form></div><div class="field"><h3>♧ &nbsp; 附件</h3><div id="attachments"></div><label class="file-label" for="attachmentInput">＋ 選擇檔案或照片（每個上限 15 MB）</label><input id="attachmentInput" type="file" multiple></div><div class="field"><h3>☏ &nbsp; 留言與討論</h3><form id="commentForm"><textarea id="commentText" placeholder="分享進度或留下你的想法…" required maxlength="5000" style="min-height:75px"></textarea><div class="row between" style="margin-top:8px"><span class="small muted">以 ${esc(me()?.name||'尚未選擇身分')} 的身分留言</span><button class="primary">送出留言</button></div></form><div id="comments"></div></div></div><div class="detail-side"><div class="field"><label for="cardStage">所在階段</label><select id="cardStage" class="full">${board().columns.map(col=>`<option value="${col.id}" ${c.columnId===col.id?'selected':''}>${esc(col.name)}</option>`).join('')}</select></div><div class="field"><h3>負責人</h3>${state.users.map(u=>`<label class="row" style="margin:8px 0;font-weight:400"><input type="checkbox" data-assignee="${u.id}" ${c.assignees.includes(u.id)?'checked':''}>${avatar(u)}<span>${esc(u.name)}</span></label>`).join('')}</div><div class="field"><label for="cardDue">截止日期</label><input id="cardDue" class="full" type="datetime-local" value="${esc(localDue(c.due))}"><label class="row" style="margin-top:10px;font-weight:400"><input id="cardDone" type="checkbox" ${c.done?'checked':''}>已完成任務</label></div><div class="field"><h3>標籤</h3>${Object.entries(labelOptions()).map(([key,label])=>`<label class="row" style="margin:7px 0;font-weight:400"><input type="checkbox" data-label="${key}" ${c.labels.includes(key)?'checked':''}><span class="tag ${esc(label.color)}">${esc(label.name)}</span></label>`).join('')}</div><div class="field"><h3>操作</h3><button id="copyCard" class="full pill" style="margin-bottom:8px">▣ 複製卡片</button><button id="deleteCard" class="full danger pill">刪除卡片</button></div><p class="help-note">變更會自動儲存。<br>建立於 ${formatDate(c.createdAt,true)}</p></div></div></div>`;const update=()=>{save();render()};$('#cardTitleInput').onchange=e=>{const title=e.target.value.trim();if(!title){e.target.value=c.title;toast('標題不可為空');return}c.title=title;update()};$('#cardDescription').oninput=e=>{c.description=e.target.value;update()};$('#cardStage').onchange=e=>{c.columnId=e.target.value;update()};$('#cardDue').onchange=e=>{c.due=e.target.value;update()};$('#cardDone').onchange=e=>{c.done=e.target.checked;update()};$$('[data-assignee]').forEach(el=>el.onchange=()=>{c.assignees=el.checked?[...c.assignees,el.dataset.assignee]:c.assignees.filter(id=>id!==el.dataset.assignee);update()});$$('[data-label]').forEach(el=>el.onchange=()=>{c.labels=el.checked?[...c.labels,el.dataset.label]:c.labels.filter(l=>l!==el.dataset.label);update()});$('#closeCard').onclick=()=>d.close();$('#checkForm').onsubmit=e=>{e.preventDefault();const text=$('#checkText').value.trim();if(!text)return;c.checklist.push({id:uid(),text,done:false});$('#checkText').value='';renderChecklist(c);update()};$('#commentForm').onsubmit=e=>{e.preventDefault();requireUser(()=>{const text=$('#commentText').value.trim();if(!text)return;c.comments.push({id:uid(),userId:me().id,username:me().name,text,at:new Date().toISOString()});$('#commentText').value='';renderComments(c);update()})};$('#attachmentInput').onchange=e=>uploadFiles(c,[...e.target.files]);$('#deleteCard').onclick=()=>{if(confirm(`刪除「${c.title}」？此操作無法復原。`)){board().cards=board().cards.filter(x=>x.id!==c.id);update();d.close()}};$('#copyCard').onclick=()=>{const n=structuredClone(c);n.id=uid();n.title+='（副本）';n.comments=[];n.createdAt=new Date().toISOString();board().cards.push(n);update();openCard(n.id);toast('已複製卡片')};renderChecklist(c);renderAttachments(c);renderComments(c);if(!d.open)d.showModal()}
function renderChecklist(c){const done=c.checklist.filter(x=>x.done).length;$('#checkCount').textContent=`${done}/${c.checklist.length}`;$('#checklist').innerHTML=`${c.checklist.length?`<div class="progress"><i style="width:${done/c.checklist.length*100}%"></i></div>`:''}`+c.checklist.map(t=>`<div class="check-item ${t.done?'checked':''}"><input type="checkbox" data-check="${t.id}" ${t.done?'checked':''} aria-label="${esc(t.text)}"><span>${t.group?`<small class="muted">${esc(t.group)} · </small>`:''}${esc(t.text)}</span><button data-remove-check="${t.id}" aria-label="刪除待辦事項">×</button></div>`).join('');$$('[data-check]').forEach(el=>el.onchange=()=>{c.checklist.find(t=>t.id===el.dataset.check).done=el.checked;save();render();renderChecklist(c)});$$('[data-remove-check]').forEach(el=>el.onclick=()=>{c.checklist=c.checklist.filter(t=>t.id!==el.dataset.removeCheck);save();render();renderChecklist(c)})}
async function uploadFiles(c,files){for(const f of files){if(f.size>15*1024*1024){toast(f.name+' 超過 15 MB，未加入');continue}try{const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(f)});c.attachments.push({id:uid(),name:f.name,type:f.type,size:f.size,data});save();render();if(currentCard===c.id&&$('#editor').open)renderAttachments(c)}catch{toast('無法讀取 '+f.name)}}if($('#attachmentInput'))$('#attachmentInput').value=''}
function renderAttachments(c) {
  $('#attachments').innerHTML=c.attachments.map(a=>`<div class="attachment">
    ${attachmentImage(a)?`<img src="${esc(attachmentImage(a))}" alt="${esc(a.name)}" loading="lazy" referrerpolicy="no-referrer">`:'<span style="font-size:24px">▤</span>'}
    <div class="grow"><button data-download="${a.id}" class="attachment-link">${esc(a.name)}</button>
    <div class="small muted">${a.url?'原始附件連結 · 可能需要登入來源網站':(a.size/1024).toFixed(1)+' KB'}
    ${attachmentImage(a)?`<button data-cover="${a.id}" class="small">${c.coverId===a.id?'✓ 取消封面':'設為封面'}</button>`:''}</div></div>
    <button data-remove-file="${a.id}" aria-label="刪除附件">×</button></div>`).join('');
  $$('[data-cover]').forEach(el=>el.onclick=()=>{
    c.coverId=c.coverId===el.dataset.cover?null:el.dataset.cover;c.demoCover=false;save();render();renderAttachments(c);
  });
  $$('[data-download]').forEach(el=>el.onclick=()=>{
    const a=c.attachments.find(a=>a.id===el.dataset.download),link=document.createElement('a');
    if(a.url){if(!safeExternalURL(a.url))return;link.href=a.url;link.target='_blank';link.rel='noopener noreferrer';}
    else{link.href=a.data;link.download=a.name;}
    link.click();
  });
  $$('[data-remove-file]').forEach(el=>el.onclick=()=>{
    if(!confirm('刪除此附件？'))return;c.attachments=c.attachments.filter(a=>a.id!==el.dataset.removeFile);
    if(c.coverId===el.dataset.removeFile)c.coverId=null;save();render();renderAttachments(c);
  });
}
function renderComments(c){$('#comments').innerHTML=[...c.comments].reverse().map(x=>`<div class="comment">${avatar(state.users.find(u=>u.id===x.userId)||{name:x.username})}<div class="grow"><strong class="small">${esc(x.username)}</strong><time datetime="${esc(x.at)}">${formatDate(x.at,true)}</time><p>${esc(x.text)}</p></div></div>`).join('')}
$('#editor').onclose=()=>currentCard=null;$('#currentUser').onclick=openUsers;$('#membersBtn').onclick=openUsers;$('#inviteBtn').onclick=openUsers;$('#closeUser').onclick=()=>$('#userDialog').close();$('#addBoard').onclick=()=>editBoard(true);$('#editBoard').onclick=()=>editBoard();$('#starBoard').onclick=()=>{board().starred=!board().starred;save();render()};$('#quickCreate').onclick=()=>createCard();$('#workspaceNav').onclick=()=>{mine=false;$('#search').value='';$('#dueFilter').value='all';render()};$('#search').oninput=render;$('#mineFilter').onclick=()=>requireUser(()=>{mine=!mine;render()});$('#dueFilter').onchange=render;$('#clearFilters').onclick=()=>{mine=false;$('#search').value='';$('#dueFilter').value='all';render()};
function validateImport(s){const str=(v,max=200000)=>typeof v==='string'&&v.length<=max;const id=v=>str(v,100)&&/^[a-zA-Z0-9_-]+$/.test(v);const arr=Array.isArray;const unique=xs=>new Set(xs.map(x=>x.id)).size===xs.length;const validDate=v=>str(v,40)&&!isNaN(new Date(v).getTime());if(!s||s.version!==1||!arr(s.users)||!s.users.length||!unique(s.users)||!s.users.every(u=>id(u.id)&&str(u.name,40)&&u.name.trim()&&(u.shortName===undefined||str(u.shortName,40)))||!arr(s.boards)||!s.boards.length||!unique(s.boards))return false;return s.boards.every(b=>id(b.id)&&str(b.name,80)&&str(b.description)&&(!b.labelDefinitions||Object.entries(b.labelDefinitions).every(([key,l])=>id(key)&&l&&str(l.name,200)&&Object.hasOwn(colors,l.color)))&&arr(b.columns)&&b.columns.length&&unique(b.columns)&&b.columns.every(c=>id(c.id)&&str(c.name,50))&&arr(b.cards)&&unique(b.cards)&&b.cards.every(c=>id(c.id)&&str(c.title,150)&&str(c.description)&&b.columns.some(col=>col.id===c.columnId)&&arr(c.labels)&&c.labels.every(l=>Object.hasOwn(colors,l)||(id(l)&&b.labelDefinitions&&Object.hasOwn(b.labelDefinitions,l)))&&arr(c.assignees)&&c.assignees.every(id=>s.users.some(u=>u.id===id))&&str(c.due,40)&&(!c.due||validDate(c.due))&&typeof c.done==='boolean'&&validDate(c.createdAt)&&arr(c.checklist)&&c.checklist.every(t=>id(t.id)&&str(t.text)&&typeof t.done==='boolean')&&arr(c.comments)&&c.comments.every(x=>id(x.id)&&id(x.userId)&&str(x.username,40)&&str(x.text)&&validDate(x.at))&&arr(c.attachments)&&c.attachments.every(a=>id(a.id)&&str(a.name,300)&&typeof a.size==='number'&&a.size>=0&&((str(a.data,23*1024*1024)&&/^data:[^,]*;base64,[A-Za-z0-9+/=]*$/.test(a.data))||(safeExternalURL(a.url)&&str(a.type,200))))))}
$('#importInput').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{const s=JSON.parse(await file.text());if(!validateImport(s))throw Error('備份格式不正確或資料不完整');if(confirm('匯入將取代目前所有看板與成員。建議先匯出備份。確定繼續？')){state=s;state.activeBoard=state.boards.some(b=>b.id===s.activeBoard)?s.activeBoard:s.boards[0].id;mine=false;$('#search').value='';$('#dueFilter').value='all';save();render();if(!me())openUsers();toast('備份匯入完成')}}catch(err){toast('匯入失敗：'+err.message)}e.target.value=''};
// Initialize saved workspaces before consulting the seed file.
async function initialize() {
  const surfaces = [$('.topbar'), $('.layout')];
  surfaces.forEach(element => element.inert = true);
  try {
    try {
      db = await openDB();
      state = await readDB();
    } catch {
      // Do not overwrite existing data if opening or reading the database fails.
      db = null;
      toast('瀏覽器無法儲存資料，請使用匯出備份保留變更');
    }
    if (!state) {
      state = await loadInitialData();
      if (db) save();
    }
    if (!state.rosterVersion) {
      try {
        const defaults = await loadInitialData();
        if (syncRoster(state, defaults) && db) save();
      } catch {
        toast('暫時無法更新預設成員，已保留現有資料；請重新整理再試');
      }
    }
    if ((state.trelloImportVersion || 0) < 1) {
      try {
        const imported = await loadInitialData();
        if (mergeTrelloImport(state, imported) && db) save();
      } catch {
        toast('Trello 匯入資料暫時無法載入，已保留現有資料；請重新整理再試');
      }
    }
    if (removeRetiredDmUser(state) && db) save();
    if (removeDemoUsers(state) && db) save();
    if (removeStarterBoards(state) && db) save();
    try {
      const configured = await loadInitialData();
      const merged = mergeUserAliases(state, configured, userId());
      if (merged.currentUserId) setUser(merged.currentUserId);
      const shortNamesChanged = syncUserShortNames(state, configured);
      if ((merged.changed || shortNamesChanged) && db) save();
    } catch {
      toast('暫時無法同步成員與簡稱，保留目前設定；請重新整理再試');
    }
    render();
    surfaces.forEach(element => element.inert = false);
    if (!me()) openUsers();
  } catch (error) {
    const message = document.createElement('p');
    message.className = 'startup-error';
    message.setAttribute('role', 'alert');
    message.textContent = '啟動失敗：' + error.message +
      '。請在專案目錄執行 python3 -m http.server 8000，' +
      '再開啟 http://localhost:8000，並確認 data.json 存在且格式正確。';
    $('.main').replaceChildren(message);
  }
}

initialize();

