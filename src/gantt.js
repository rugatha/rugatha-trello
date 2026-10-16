import './auth.js';
import { loadWorkspace, subscribeWorkspace, updateCardDeadline } from './storage.js?v=20261016-deadline';
import { DAY, dateDay, dayLabel, cardDates, checklistEnd, ganttBoards, weekSunday, canSetDeadline, deadlineInput } from './gantt-data.js?v=20261016-deadline';
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let account = null, workspace = {boards:[]}, generation = 0, stop = null, timer = null;
const expanded = new Set(), knownBoards = new Set();
let deadlineTarget = null, savingDeadline = false, syncPending = false;
function closeDeadlineEditor() {
  deadlineTarget = null; savingDeadline = false;
  $('#deadlineDialog').close();
  $('#deadlineStatus').textContent = '';
  $('#saveDeadline').disabled = $('#deadlineValue').disabled = $('#closeDeadline').disabled = false;
}
const initialSunday = weekSunday();
$('#dateFrom').value = dayLabel(initialSunday);
$('#assigneeFilter').value = '__me';
const filters = () => ({board:$('#boardFilter').value,assignee:$('#assigneeFilter').value,from:dateDay($('#dateFrom').value),to:dateDay($('#dateTo').value),showCompleted:$('#showCompleted').checked});
function options(selector, items, title, first = [], value = $(selector).value) {
  const select = $(selector);
  select.innerHTML = first.map(([id,name]) => `<option value="${esc(id)}">${esc(name)}</option>`).join('') + `<option value="">${title}</option>` + items.map(([id,name]) => `<option value="${esc(id)}">${esc(name)}</option>`).join('');
  select.value = [...first,...items].some(([id]) => id === value) ? value : '';
}
function updateFilters(selection = filters()) {
  const boards = ganttBoards(workspace, account, {showCompleted:true});
  options('#boardFilter', boards.map(b => [b.id,b.name+(b.archived?'（已封存）':'')]), '所有看板', [], selection.board);
  const selected = boards.filter(b => !$('#boardFilter').value || b.id === $('#boardFilter').value);
  const ids = new Set(selected.flatMap(b => b.cards.flatMap(c => c.assignees || [])));
  options('#assigneeFilter', [...ids].map(id => [id,account?.roster?.find(u => u.id === id)?.name || '未知成員']).concat([['__none','未指派']]), '所有負責人', [['__me','負責人為我']], selection.assignee);
}
function render() {
  const selection = filters();
  if (selection.from != null && selection.to != null && selection.to < selection.from) {
    $('#ganttChart').innerHTML = '<p class="gantt-empty">結束日期不可早於開始日期。</p>';
    $('#ganttStatus').textContent = '請調整日期篩選';
    return;
  }
  const boards = ganttBoards(workspace, account, selection);
  const today = dateDay(new Date());
  const all = boards.flatMap(b => b.cards.flatMap(c => {const dates = cardDates(c);return [dates.start,dates.end,...(c.checklist||[]).map(t => checklistEnd(t.text, dates.start))];})).filter(d => d != null);
  if (!boards.length) {
    $('#ganttChart').innerHTML = '<p class="gantt-empty">'+(account?.memberId ? '沒有符合篩選的牌卡，或尚無可存取的看板。' : '使用 Google 登入後，查看你有權限的專案時程。')+'</p>';
    $('#ganttStatus').textContent = '0 個看板 · 0 張牌卡 · 0 個清單項目';
    return;
  }
  const min = selection.from ?? (all.length ? Math.min(...all) : initialSunday);
  const max = selection.to ?? Math.max(min + 41, ...all);
  const step = 7;
  const tickWidth = 100, unit = tickWidth / step, count = Math.ceil((max-min+1)/step), width = count*tickWidth;
  const ticks = Array.from({length:count},(_,i) => `<span>${dayLabel(min+i*step)}</span>`).join('');
  const todayLine = today >= min && today <= min+count*step ? `<i class="gantt-today" style="left:${(today-min)*unit}px" title="今天 ${dayLabel(today)}"></i>` : '';
  const track = (dates, done, kind, source) => {
    const invalid = dates.start != null && dates.end != null && dates.end < dates.start;
    const outside = !invalid && dates.start != null && dates.end != null && (dates.end < min || dates.start > max);
    const label = outside ? '不在日期範圍內' : invalid ? '結束日早於開始日，請檢查' : dates.start == null ? '缺少建立日期' : dates.end == null ? source : '';
    return `<div class="gantt-track ${kind}">${todayLine}${label ? `<span class="gantt-undated">${esc(label)}</span>` : `<div class="gantt-bar ${kind} ${done?'done':dates.end<today?'late':''}" style="left:${(Math.max(dates.start,min)-min)*unit}px;width:${(Math.min(dates.end,max)-Math.max(dates.start,min)+1)*unit}px" title="${esc(source)}：${dayLabel(dates.start)} → ${dayLabel(dates.end)}"></div>`}</div>`;
  };
  const label = (title, subtitle, kind, key, href, deadline = '') => {
    const disclosure = key ? `<button type="button" data-collapse="${esc(key)}" aria-label="${expanded.has(key)?'收合':'展開'} ${esc(title)}" aria-expanded="${expanded.has(key)}"><span aria-hidden="true">${expanded.has(key)?'▾':'▸'}</span>${href?'':`<span>${esc(title)}</span>`}</button>` : '';
    const text = href ? `<a class="gantt-card-link" href="${esc(href)}">${esc(title)}</a>` : key ? '' : `<span>${esc(title)}</span>`;
    return `<div class="gantt-label ${kind}"><div class="gantt-title-row">${disclosure}${text}</div><small>${esc(subtitle)}</small>${deadline}</div>`;
  };
  let html = `<div class="gantt-grid" style="--timeline-width:${width}px;--tick-width:${tickWidth}px"><div class="gantt-label gantt-corner">專案 / 牌卡 / 清單項目</div><div class="gantt-ticks">${ticks}</div>`;
  let cards = 0, items = 0;
  for (const b of boards) {
    cards += b.cards.length; items += b.cards.reduce((sum,c) => sum+(c.checklist||[]).length,0);
    const dates = b.cards.map(cardDates), starts = dates.map(d=>d.start).filter(d=>d!=null), ends = dates.map(d=>d.end).filter(d=>d!=null);
    const key = `board/${b.id}`;
    html += label(b.name+(b.archived?'（已封存）':''),`${b.cards.length} 張牌卡`, 'board', key)+track({start:starts.length?Math.min(...starts):null,end:ends.length?Math.max(...ends):null},false,'board',ends.length?'牌卡時程範圍':'尚無完整時程');
    if (!expanded.has(key)) continue;
    for (const c of b.cards) {
      const dates = cardDates(c), key = `card/${b.id}/${c.id}`;
      const names = (c.assignees || []).map(id => account.roster?.find(u=>u.id===id)?.name || '未知成員').join('、') || '未指派';
      const range = `${dayLabel(dates.start)} → ${dayLabel(dates.end)} · ${dates.source}`;
      const deadline = canSetDeadline(account,b,c) ? `<button type="button" class="gantt-deadline" data-deadline-board="${esc(b.id)}" data-deadline-card="${esc(c.id)}" aria-label="修改 ${esc(c.title)} 的截止日期">◷ 修改截止日期</button>` : '';
      html += label((c.done?'✓ ':'')+c.title,`${names} · ${range}`,'task',c.checklist?.length?key:null,`./index.html?board=${encodeURIComponent(b.id)}&card=${encodeURIComponent(c.id)}`,deadline)+track(dates,c.done,'task',dates.source);
      if (!expanded.has(key)) continue;
      for (const item of c.checklist || []) {
        const end = checklistEnd(item.text,dates.start);
        html += label((item.done?'☑ ':'☐ ')+(item.group?item.group+' / ':'')+item.text,`文字辨識截止日：${dayLabel(end)}`,'item')+track({start:dates.start,end},item.done,'item',end==null?'未辨識日期':'文字辨識截止日');
      }
    }
  }
  $('#ganttChart').innerHTML = html+'</div>';
  $('#ganttStatus').textContent = `${boards.length} 個看板 · ${cards} 張牌卡 · ${items} 個清單項目`;
}
function clearContent(message) {
  closeDeadlineEditor();
  workspace = {boards:[]}; updateFilters(); render(); $('#ganttStatus').textContent = message;
}
async function refresh() {
  if (deadlineTarget) { syncPending = true; return; }
  const version = ++generation, actor = account, selection = filters();
  clearTimeout(timer);
  clearContent('正在讀取專案時程…');
  $('#refreshGantt').disabled = true;
  try {
    if (!actor?.memberId || !actor?.workspaceRole) { clearContent(actor ? '尚未取得工作空間權限，請聯絡管理員。' : '請先使用 Google 登入。'); return; }
    const loaded = await loadWorkspace(actor, {content:'gantt'});
    if (version !== generation) return;
    workspace = loaded;
    for (const board of workspace.boards) if (!knownBoards.has(board.id)) {
      knownBoards.add(board.id); expanded.add(`board/${board.id}`);
    }
    updateFilters(selection); render();
    if (!stop) stop = subscribeWorkspace(actor, () => {
      if (deadlineTarget) { syncPending = true; return; }
      clearTimeout(timer); timer = setTimeout(refresh,250);
    }, error => {
      if (actor !== account) return;
      generation++; stop?.(); stop = null; clearTimeout(timer);
      $('#refreshGantt').disabled = false;
      clearContent('同步失敗，已清除內容；請重新整理確認權限：'+error.message);
    });
  } catch (error) {
    if (version === generation) { stop?.(); stop = null; clearContent('讀取失敗，請重新整理重試：'+error.message); }
  } finally { if (version === generation) $('#refreshGantt').disabled = false; }
}
function applyAccount(next) {
  generation++; stop?.(); stop = null; clearTimeout(timer); account = next;
  expanded.clear(); knownBoards.clear(); syncPending = false; closeDeadlineEditor();
  $('#assigneeFilter').value = '__me';
  $('#currentUser').textContent = next?.displayName || '帳號設定';
  $('#googleAccountPanel').hidden = !next;
  $('#localUserPanel').hidden = Boolean(next);
  $('#googleAccountSummary').textContent = next?.email || '';
  $('#workspaceAccess').textContent = next?.memberId ? `工作空間身分：${next.workspaceRole}` : '尚未取得工作空間權限';
  $('#userDialog').close(); refresh();
}
window.addEventListener('boardly-auth-changed',event => applyAccount(event.detail));
for (const id of ['boardFilter','assigneeFilter','dateFrom','dateTo','showCompleted']) $('#'+id).addEventListener('change',() => {updateFilters();render();});
$('#resetGantt').onclick = () => {$('#boardFilter').value='';$('#assigneeFilter').value='__me';$('#dateFrom').value=dayLabel(initialSunday);$('#dateTo').value='';$('#showCompleted').checked=false;updateFilters();render();};
$('#ganttChart').onclick = event => {const edit=event.target.closest('[data-deadline-card]');if(edit){openDeadlineEditor(edit.dataset.deadlineBoard,edit.dataset.deadlineCard);return;}const button=event.target.closest('[data-collapse]');if (!button) return;const key=button.dataset.collapse;expanded.has(key)?expanded.delete(key):expanded.add(key);render();[...document.querySelectorAll('[data-collapse]')].find(el=>el.dataset.collapse===key)?.focus();};
function openDeadlineEditor(boardId, cardId) {
  if (savingDeadline) return;
  const board = workspace.boards.find(b => b.id === boardId), card = board?.cards.find(c => c.id === cardId);
  if (!canSetDeadline(account,board,card)) return;
  deadlineTarget = {boardId,cardId,expectedDue:card.due || ''};
  $('#deadlineCardName').textContent = card.title;
  $('#deadlineValue').value = deadlineInput(card.due);
  $('#deadlineStatus').textContent = '';
  $('#deadlineDialog').showModal();
}
function cancelDeadlineEditor() {closeDeadlineEditor();if (syncPending) {syncPending = false;refresh();}}
$('#closeDeadline').onclick = cancelDeadlineEditor;
$('#deadlineDialog').addEventListener('cancel',event => {if (savingDeadline) event.preventDefault();else cancelDeadlineEditor();});
$('#deadlineForm').addEventListener('submit',async event => {
  event.preventDefault();
  if (!deadlineTarget || savingDeadline) return;
  const value = $('#deadlineValue').value;
  if (value && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) || dateDay(value) == null)) {
    $('#deadlineStatus').textContent = '請輸入有效的截止日期'; return;
  }
  const target = deadlineTarget, actor = account, version = generation;
  const board = workspace.boards.find(b => b.id === target.boardId), card = board?.cards.find(c => c.id === target.cardId);
  if (!canSetDeadline(actor,board,card)) {closeDeadlineEditor();return;}
  const due = value ? value+':00+08:00' : '';
  savingDeadline = true;
  $('#saveDeadline').disabled = $('#deadlineValue').disabled = $('#closeDeadline').disabled = true;
  $('#deadlineStatus').textContent = '正在儲存截止日期…';
  const current = () => account === actor && generation === version && deadlineTarget === target;
  try {
    const saved = await updateCardDeadline(actor,target.boardId,target.cardId,due,target.expectedDue);
    if (!current()) return;
    Object.assign(card,saved,{updatedBy:actor.memberId});
    closeDeadlineEditor(); render();
    $('#ganttStatus').textContent += ' · 截止日期已儲存';
  } catch (error) {
    if (current()) $('#deadlineStatus').textContent = '截止日期未儲存：'+error.message;
  } finally {
    if (account === actor && generation === version) {
      savingDeadline = false;
      $('#saveDeadline').disabled = $('#deadlineValue').disabled = $('#closeDeadline').disabled = false;
      if (syncPending && !deadlineTarget) {syncPending = false;refresh();}
    }
  }
});
$('#refreshGantt').onclick = () => window.boardlyGoogleAuth.refreshMembership();
$('#currentUser').onclick = () => $('#userDialog').showModal();
$('#closeUser').onclick = () => $('#userDialog').close();
$('#dialogGoogleSignIn').onclick = () => {$('#userDialog').close();$('#googleSignIn').click();};
$('#editGoogleName').onclick = () => {$('#userDialog').close();window.boardlyGoogleAuth.editName();};
$('#googleSignOut').onclick = async () => {try {await window.boardlyGoogleAuth.signOut();} catch(error) {$('#workspaceAccess').textContent='登出失敗：'+error.message;}};
applyAccount(window.boardlyGoogleUser || null);
