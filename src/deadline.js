// Keep the user's partial input separate from the concrete Taipei deadline.
export const deadlineKeys=['year','month','day','period','hour','minute'];
export function deadlineParts(due, draft) {
  if(draft && typeof draft==='object')return Object.fromEntries(deadlineKeys.map(key=>[key,String(draft[key]||'')]));
  if(!due)return Object.fromEntries(deadlineKeys.map(key=>[key,'']));
  const date=new Date(typeof due==='string'&&due.length===10?due+'T00:00:00+08:00':due);
  if(!Number.isFinite(date.getTime()))return deadlineParts('');
  const values=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
  const part=type=>values.find(p=>p.type===type).value,hour=Number(part('hour'));
  return {year:part('year'),month:part('month'),day:part('day'),period:hour>=12?'PM':'AM',hour:String(hour%12||12).padStart(2,'0'),minute:part('minute')};
}
export function resolveDeadline(parts, now=new Date()) {
  const p=deadlineParts('',parts);
  if(deadlineKeys.every(key=>!p[key]))return {due:'',error:''};
  const currentYear=Number(new Intl.DateTimeFormat('en',{timeZone:'Asia/Taipei',year:'numeric'}).format(now));
  const year=p.year.length===4?Number(p.year):currentYear;
  const month=p.month?Number(p.month):12;
  if(year<1900||year>2200||month<1||month>12)return {due:'',error:'年份需為 1900–2200，月份需為 1–12；輸入仍會保留。'};
  const lastDay=new Date(Date.UTC(year,month,0)).getUTCDate(),day=p.day?Number(p.day):lastDay;
  const minute=p.minute?Number(p.minute):59;
  const h=p.hour?Number(p.hour):null;
  if(day<1||day>lastDay||minute<0||minute>59||h!==null&&(h<1||h>12))return {due:'',error:'請檢查日期、時或分是否超出範圍；輸入仍會保留。'};
  const hour=h===null?(p.period==='AM'?11:23):(h%12)+(p.period==='AM'?0:12);
  const pad=value=>String(value).padStart(2,'0');
  return {due:`${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00+08:00`,error:''};
}
export function deadlineDisplay(due,draft){
  if(!due&&!draft)return '';
  const p=deadlineParts(due,draft);
  return `${p.year||'YYYY'}-${p.month||'XX'}-${p.day||'XX'} ${p.period==='AM'?'上午':p.period==='PM'?'下午':'XX'} ${p.hour||'XX'}:${p.minute||'XX'}`;
}
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function deadlineFields(due, draft, key, label) {
  const p=deadlineParts(due,draft);
  const input=(part,title,placeholder)=>`<input type="text" inputmode="numeric" autocomplete="off" data-deadline-part="${part}" maxlength="${part==='year'?4:2}" placeholder="${placeholder}" aria-label="${esc(label+title)}" value="${esc(p[part])}">`;
  return `<fieldset class="partial-deadline" data-deadline-fields="${esc(key)}"><legend>${esc(label)}（台北時間）</legend><div class="deadline-date">${input('year','年份','YYYY')}<span>-</span>${input('month','月份','XX')}<span>-</span>${input('day','日期','XX')}</div><div class="deadline-time"><select data-deadline-part="period" aria-label="${esc(label)}上午或下午"><option value="" ${!p.period?'selected':''}>XX</option><option value="AM" ${p.period==='AM'?'selected':''}>上午</option><option value="PM" ${p.period==='PM'?'selected':''}>下午</option></select>${input('hour','時','XX')}<span>:</span>${input('minute','分','XX')}</div><small data-deadline-hint></small><button type="button" data-clear-deadline>清除日期</button></fieldset>`;
}
export function bindDeadlineFields(root, due, draft, onInput, onCommit) {
  if(!root?.querySelectorAll)return;
  const controls=[...root.querySelectorAll('[data-deadline-part]')];
  let parts=deadlineParts(due,draft);
  const hint=root.querySelector('[data-deadline-hint]');
  const show=()=>{const result=resolveDeadline(parts);if(hint)hint.textContent=result.error||(result.due?'計算截止：'+result.due.slice(0,16).replace('T',' ')+'；空欄位仍保留 XX。':'留空表示沒有截止日期。');};
  for(const control of controls){
    const key=control.dataset.deadlinePart;control.value=parts[key];
    control.oninput=()=>{
      if(key!=='period')control.value=control.value.replace(/\D/g,'').slice(0,key==='year'?4:2);
      parts={...parts,[key]:control.value};show();onInput({...parts},resolveDeadline(parts).due);
    };
    control.onchange=()=>{control.oninput();onCommit?.();};
    control.onblur=()=>onCommit?.();
  }
  const clear=root.querySelector('[data-clear-deadline]');
  if(clear)clear.onclick=()=>{parts=deadlineParts('');for(const c of controls)c.value='';show();onInput({...parts},'');onCommit?.();};
  show();
}
