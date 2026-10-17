// Calendar days are UTC day numbers; timestamps are displayed in the workspace's Taipei timezone.
export const DAY = 86400000;
function calendarDay(year, month, day) {
  if (year < 1900 || year > 2200) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date.getTime() / DAY : null;
}
export function dateDay(value) {
  if (!value) return null;
  if (typeof value?.toDate === 'function') value = value.toDate();
  else if (typeof value === 'object' && Number.isFinite(value.seconds)) value = new Date(value.seconds * 1000);
  const match = typeof value === 'string' && value.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T\d{2}:\d{2}(?::\d{2})?$)/);
  if (match) return calendarDay(...match.slice(1,4).map(Number));
  const prefix = typeof value === 'string' && value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (prefix && calendarDay(...prefix.slice(1,4).map(Number)) == null) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  const part = type => Number(parts.find(p => p.type === type).value);
  return calendarDay(part('year'), part('month'), part('day'));
}
export const dayLabel = day => day == null ? '—' : new Date(day * DAY).toISOString().slice(0,10);
export function checklistEnd(text, start) {
  // Explicit calendar dates only: relative dates and arbitrary numbers are left undated.
  const pattern = /(?<![\d/年.])(?:(\d{4})\s*[-/.年]\s*)?(\d{1,2})\s*[-/.月]\s*(\d{1,2})(?:\s*日)?(?![\d/.])/gu;
  let previous = start, result = null;
  for (const match of String(text || '').matchAll(pattern)) {
    if (!match[1] && previous == null) continue;
    let year = match[1] ? Number(match[1]) : new Date(previous * DAY).getUTCFullYear();
    let day = calendarDay(year, Number(match[2]), Number(match[3]));
    if (!match[1] && day != null && day < previous) day = calendarDay(++year, Number(match[2]), Number(match[3]));
    if (day == null) continue;
    previous = day;
    result = result == null ? day : Math.max(result, day);
  }
  return result;
}
export function cardDates(card) {
  const start = dateDay(card.createdAt);
  const due = dateDay(card.due);
  const completed = card.done ? dateDay(card.completedAt) : null;
  const end = due ?? completed;
  return {start, end, source:due != null ? '截止日' : completed != null ? '結案日' : card.done ? '未記錄結案日期' : '未設定截止日'};
}
export function weekSunday(value = new Date()) {
  const day = dateDay(value);
  return day - new Date(day * DAY).getUTCDay();
}
export function overlapsRange(start, end, from = null, to = null) {
  if (start != null && end != null && end < start) return true;
  return !(from != null && end != null && end < from || to != null && start != null && start > to);
}
export function ganttBoards(workspace, account, filters = {}) {
  if (!account?.memberId || !account?.workspaceRole) return [];
  const positions = new Map((account.boardOrder || []).map((id, i) => [id, i]));
  const assignee = filters.assignee === '__me' ? account.memberId : filters.assignee;
  return workspace.boards.filter(b => account.accessboard?.includes(b.id) && !b.deleting && (!filters.board || b.id === filters.board))
    .map(b => ({...b, cards:b.cards.filter(c => !c.archived && !c.deleting && (filters.showCompleted || !c.done)
      && (!assignee || (assignee === '__none' ? !(c.assignees || []).length : c.assignees?.includes(assignee))))
      .map(c => {
        const dates = cardDates(c);
        return {...c, checklist:(c.checklist || []).filter(item => (filters.showCompleted || !item.done)
          && overlapsRange(dates.start, checklistEnd(item.text, dates.start), filters.from, filters.to))};
      }).filter(c => {const dates = cardDates(c);return c.checklist.length || overlapsRange(dates.start, dates.end, filters.from, filters.to);})}))
    .filter(b => b.cards.length).sort((a,b) => (positions.get(a.id) ?? Infinity) - (positions.get(b.id) ?? Infinity));
}

export function canSetDeadline(account, board, card) {
  return Boolean(account?.memberId && account?.workspaceRole && account.accessboard?.includes(board?.id)
    && (!board?.archived || account.workspaceRole === 'owner') && !board?.deleting && card && !card.archived && !card.deleting
    && (account.workspaceRole === 'owner' || (card.assignees || card.assigneeIds || []).includes(account.memberId)));
}
export function deadlineInput(value) {
  if (typeof value !== 'string' || !value || dateDay(value) == null) return '';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return value;
  const date = new Date(value.length === 10 ? value+'T00:00:00+08:00' : value);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
  const part = type => parts.find(p => p.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

// Creation dates define the beginning of a timeline; invalid earlier deadlines do not extend it.
export function ganttDateExtent(boards) {
  let firstCreated = null, lastDay = null;
  for (const board of boards) for (const card of board.cards) {
    const {start, end} = cardDates(card);
    if (start != null) firstCreated = firstCreated == null ? start : Math.min(firstCreated, start);
    for (const day of [start, end, ...(card.checklist || []).map(item => checklistEnd(item.text, start))]) {
      if (day != null) lastDay = lastDay == null ? day : Math.max(lastDay, day);
    }
  }
  return {firstCreated, lastDay};
}
export function ganttDateRange(boards, {from = null, to = null, today = dateDay(new Date())} = {}) {
  const {firstCreated, lastDay} = ganttDateExtent(boards);
  const start = from ?? firstCreated ?? lastDay ?? today;
  // An explicitly selected start keeps the default six-week view. Empty dates use the full data extent.
  const end = to ?? Math.max(start + (from == null ? 0 : 41), lastDay ?? start);
  return {start, end};
}
