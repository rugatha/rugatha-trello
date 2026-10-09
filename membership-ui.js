import { listMembershipDirectory, saveManagedMembership } from './management.js';

const button = document.querySelector('#manageMembers');
const dialog = document.querySelector('#membershipDialog');
let generation = 0;
let directory;
const permitted = () => !!window.boardlyGoogleUser?.memberId && ['owner','admin'].includes(window.boardlyGoogleUser?.workspaceRole);
const node = (tag, text) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; return el; };
function reset() {
  generation++;
  directory = null;
  dialog.close();
  dialog.replaceChildren();
  button.hidden = !permitted();
}
window.addEventListener('boardly-auth-changed', reset);
button.hidden = !permitted();
button.onclick = load;
async function load() {
  if (!permitted()) return;
  const version = ++generation;
  dialog.replaceChildren();
  const head = node('div'); head.className = 'modal-head';
  head.append(node('h2','會員管理'));
  const close = node('button','✕'); close.type='button'; close.setAttribute('aria-label','關閉會員管理');
  close.onclick=()=>dialog.close(); head.append(close); dialog.append(head);
  const body=node('div'); body.className='modal-body'; dialog.append(body);
  const status=node('p','載入中…'); status.setAttribute('role','status'); body.append(status);
  if (!dialog.open) dialog.showModal();
  try {
    const result=await listMembershipDirectory();
    if(version!==generation || !dialog.open || !permitted())return;
    directory=result; status.remove();
    const add=node('button','邀請會員'); add.type='button'; add.onclick=()=>edit(null,body); body.append(add);
    const refresh=node('button','重新載入'); refresh.type='button'; refresh.onclick=load; body.append(refresh);
    const list=node('div'); list.className='membership-list'; body.append(list);
    for(const member of directory.members){
      const row=node('div'); row.className='membership-row';
      const label=node('div'); label.append(node('strong',member.name),node('div',`${member.role} · ${{pending:'待核准',active:'有效',disabled:'已停用'}[member.status] || member.status}`));
      const emails=node('div',member.emails.join('、')); emails.className='muted small'; label.append(emails); row.append(label);
      const editButton=node('button','管理'); editButton.type='button'; editButton.setAttribute('aria-label',`管理 ${member.name}`);
      editButton.disabled=window.boardlyGoogleUser.workspaceRole!=='owner' && ['owner','admin'].includes(member.role);
      editButton.onclick=()=>edit(member,body); row.append(editButton); list.append(row);
    }
  } catch(error) {
    if(version!==generation || !dialog.open)return;
    status.textContent=error.message; status.setAttribute('role','alert');
    const retry=node('button','重試'); retry.onclick=load; body.append(retry);
  }
}
dialog.addEventListener('close',()=>{
  // A queued close event may arrive after a different account reopens the dialog.
  if (dialog.open) return;
  generation++;directory=null;dialog.replaceChildren();
});
function edit(member,body) {
  body.querySelector('form')?.remove();
  const version=++generation, form=node('form'); form.className='membership-form';
  form.append(node('h3',member?`管理 ${member.name}`:'邀請會員'));
  const fields={};
  function field(key,title,type,options,value){
    const label=node('label',title),el=node(type==='select'?'select':'input');
    el.name=key; el.id=`membership-${key}`; label.htmlFor=el.id;
    if(type==='select')for(const [id,text] of options){const option=node('option',text);option.value=id;el.append(option);}
    else {el.type=type;el.required=true;el.maxLength=key==='name'?40:254;}
    el.value=value;fields[key]=el;form.append(label,el);
  }
  if(!member){field('name','顯示名稱','text',null,'');field('email','Google 帳號信箱','email',null,'');form.append(node('p','建立待核准邀請，不會寄送電子郵件。核准後，對方可使用此 Google 帳號登入。'));}
  const roles=window.boardlyGoogleUser.workspaceRole==='owner'?['owner','admin','editor','viewer','member']:['editor','viewer','member'];
  field('role','角色','select',roles.map(r=>[r,r]),member?.role || 'viewer');
  if(member)field('status','會員狀態','select',[['pending','待核准'],['active','核准／啟用'],['disabled','停用']],member.status);
  const boards=node('fieldset');boards.append(node('legend','可存取看板'));
  for(const board of directory.boards){const label=node('label'),input=node('input');input.type='checkbox';input.value=board.id;input.checked=member?.accessboard.includes(board.id)||false;label.append(input,document.createTextNode(board.name+(board.archived?'（已封存）':'')));boards.append(label);}
  form.append(boards);
  const error=node('p');error.setAttribute('role','alert');error.className='danger';form.append(error);
  const submit=node('button',member?'儲存會員權限':'建立邀請');submit.type='submit';submit.className='primary';form.append(submit);
  let pending=null;
  form.addEventListener('input',()=>{pending=null;error.textContent='';});
  form.onsubmit=async event=>{
    event.preventDefault();if(version!==generation || !permitted())return;
    const visible=new Set(directory.boards.map(b=>b.id));
    pending ||= {requestId:crypto.randomUUID(),...(member?{memberId:member.id,expected:{role:member.role,status:member.status,accessboard:member.accessboard}}:{name:fields.name.value,email:fields.email.value}),
      role:fields.role.value,status:member?fields.status.value:'pending',accessboard:[...(member?.accessboard || []).filter(b=>!visible.has(b)),...Array.from(boards.querySelectorAll('input:checked'),el=>el.value)]};
    const controls=Array.from(form.querySelectorAll('input,select,button'));controls.forEach(el=>el.disabled=true);error.textContent='';
    try{await saveManagedMembership(pending);if(version===generation && dialog.open)await load();}
    catch(err){if(version===generation && dialog.open)error.textContent=err.message;}
    finally{if(version===generation)controls.forEach(el=>el.disabled=false);}
  };
  body.append(form);form.querySelector('input,select')?.focus();
}
