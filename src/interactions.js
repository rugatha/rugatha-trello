import {auth,firestore} from './auth.js';
import {getFunctions,httpsCallable} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js';
import {collection,doc,onSnapshot,query,orderBy,limit,updateDoc,writeBatch} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import {moveMentions,mentionQuery,mentionParts} from './mentions.js';
const functions=getFunctions(auth.app,'asia-east1');
async function call(name,data) {
  try{return (await httpsCallable(functions,name,{timeout:30000})(data)).data;}
  catch(error){
    if(['functions/internal','functions/not-found','functions/unavailable'].includes(error.code))
      throw new Error('留言與標註服務尚未就緒或暫時無法連線，請稍後重試');
    throw error;
  }
}
const $=s=>document.querySelector(s);
const node=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
export function renderMentionText(text,mentions) {
  const p=node('p');
  for(const part of mentionParts(text,mentions)) {
    const el=node(part.memberId?'mark':'span',part.text);
    if(part.memberId)el.className='mention';p.append(el);
  }
  return p;
}
export function bindCommentComposer({boardId,cardId,canEdit,isCurrent,busy,complete,draft}) {
  const input=$('#commentText'),form=$('#commentForm'),list=$('#mentionList'),status=$('#commentStatus');
  const cancelButton=$('#cancelCommentEdit'),submitButton=$('#submitComment');
  let members=null,mentions=draft?.mentions||[],previous=draft?.text||'',selected=0,options=[],active=null,pending=null,fetching=null,editing=null,savedDraft=null;
  const deletions=new Map();input.value=previous;
  const expected=comment=>({text:comment.text,mentions:comment.mentions||[],editedAt:comment.editedAt||null});
  const mode=()=>{cancelButton.hidden=!editing;submitButton.textContent=editing?'儲存留言':'送出留言';};
  const reset=()=>{editing=null;pending=null;input.value=previous=savedDraft?.text||'';mentions=savedDraft?.mentions||[];savedDraft=null;mode();};
  mode();
  const hide=()=>{list.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');active=null;};
  const load=()=>fetching ||= call('listMentionMembers',{boardId,cardId}).then(result=>{members=result.members;return members;}).catch(error=>{fetching=null;throw error;});
  const choose=member=>{
    if(!active || !canEdit())return;
    const {start,end}=active,label=member.name,token='@'+label;
    const next=input.value.slice(0,start)+token+' '+input.value.slice(end);
    mentions=moveMentions(input.value,next,mentions);
    mentions.push({memberId:member.id,start,end:start+token.length,label});mentions.sort((a,b)=>a.start-b.start);
    input.value=previous=next;pending=null;hide();input.focus();input.setSelectionRange(start+token.length+1,start+token.length+1);
  };
  const draw=()=>{
    list.replaceChildren();
    options.forEach((member,i)=>{
      const label=members.filter(m=>m.name===member.name).length>1?`${member.name}（${member.id}）`:member.name;
      const button=node('button',label);button.type='button';button.id=`mention-option-${i}`;button.setAttribute('role','option');button.setAttribute('aria-selected',String(i===selected));
      button.onmousedown=event=>event.preventDefault();button.onclick=()=>choose(member);list.append(button);
    });
    if(!options.length)list.append(node('div','沒有符合的可標註會員'));
    list.hidden=false;input.setAttribute('aria-expanded','true');
    if(options.length)input.setAttribute('aria-activedescendant',`mention-option-${selected}`);else input.removeAttribute('aria-activedescendant');
  };
  const suggest=async()=>{
    if(!canEdit()){hide();return;}
    const request=mentionQuery(input.value,input.selectionStart,mentions);
    if(!request){hide();return;}
    try {
      await load();if(!isCurrent() || !input.isConnected)return;
      active=mentionQuery(input.value,input.selectionStart,mentions);if(!active){hide();return;}
      options=members.filter(m=>m.name.toLocaleLowerCase().includes(active.query.toLocaleLowerCase()));selected=0;draw();status.textContent='';
    }catch(error){if(isCurrent()){hide();status.textContent='無法載入可標註名單：'+error.message;}}
  };
  input.oninput=()=>{mentions=moveMentions(previous,input.value,mentions);previous=input.value;pending=null;suggest();};
  input.onclick=suggest;
  input.onkeyup=event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key))suggest();};
  input.onblur=hide;
  input.onkeydown=event=>{
    if(list.hidden || event.isComposing)return;
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();hide();}
    else if(['ArrowDown','ArrowUp'].includes(event.key)&&options.length){event.preventDefault();selected=(selected+(event.key==='ArrowDown'?1:-1)+options.length)%options.length;draw();}
    else if(['Enter','Tab'].includes(event.key)&&options.length){event.preventDefault();choose(options[selected]);}
  };
  form.onsubmit=async event=>{
    event.preventDefault();if(!canEdit() || !input.value.trim())return;
    hide();
    pending ||= {requestId:crypto.randomUUID(),boardId,cardId,text:input.value,mentions,
      ...(editing?{commentId:editing.id,action:'edit',expected:expected(editing)}:{})};
    busy(true);status.textContent=editing?'正在儲存留言…':'正在送出留言…';
    try {
      const wasEditing=Boolean(editing),result=await call(wasEditing?'manageComment':'postComment',pending);
      if(!isCurrent())return;
      reset();status.textContent=wasEditing?'留言已更新':'留言已送出';
      busy(false);await complete(result.commentId,wasEditing?{text:input.value,mentions}:undefined);
    }catch(error){if(isCurrent()){status.textContent='留言未確認送出，可重試：'+error.message;if(error.code==='functions/failed-precondition'){members=null;fetching=null;}}}
    finally{if(isCurrent())busy(false);}
  };
  cancelButton.onclick=()=>{if(!canEdit())return;hide();reset();status.textContent='已取消編輯';};
  return {
    edit(comment){
      if(!canEdit())return;
      if(!editing)savedDraft={text:input.value,mentions};
      editing=comment;input.value=previous=comment.text;mentions=structuredClone(comment.mentions||[]);pending=null;
      hide();mode();status.textContent='正在編輯留言';input.focus();input.scrollIntoView?.({block:'center',behavior:'smooth'});
    },
    async remove(comment){
      if(!canEdit())return;
      const payload=deletions.get(comment.id)||{requestId:crypto.randomUUID(),boardId,cardId,commentId:comment.id,action:'delete',expected:expected(comment)};
      deletions.set(comment.id,payload);hide();busy(true);status.textContent='正在刪除留言…';
      try{
        await call('manageComment',payload);if(!isCurrent())return;
        deletions.delete(comment.id);if(editing?.id===comment.id)reset();
        status.textContent='留言已刪除';busy(false);await complete(null,{text:input.value,mentions});
      }catch(error){if(isCurrent())status.textContent='刪除未確認完成，可重試：'+error.message;}
      finally{if(isCurrent())busy(false);}
    }
  };
}
let stop=null,version=0;
export function connectNotifications(account,{open,toast}) {
  stop?.();stop=null;const current=++version;
  const button=$('#notificationsBtn'),dialog=$('#notificationsDialog'),list=$('#notificationList'),status=$('#notificationStatus'),all=$('#readNotifications');
  dialog.close();list.replaceChildren();status.textContent='';button.textContent='通知';button.disabled=!account?.memberId;
  $('#closeNotifications').onclick=()=>dialog.close();
  let items=[],seen=null;
  button.onclick=()=>dialog.showModal();
  if(!account?.memberId)return;
  const path=`workspaces/main/members/${account.memberId}/notifications`;
  const mark=item=>updateDoc(doc(firestore,`${path}/${item.id}`),{read:true});
  all.onclick=async()=>{
    all.disabled=true;
    try{const batch=writeBatch(firestore);items.filter(item=>!item.read).forEach(item=>batch.update(doc(firestore,`${path}/${item.id}`),{read:true}));await batch.commit();}
    catch(error){if(current===version)status.textContent='無法更新已讀狀態：'+error.message;}
    finally{if(current===version)all.disabled=false;}
  };
  stop=onSnapshot(query(collection(firestore,path),orderBy('createdAt','desc'),limit(100)),snapshot=>{
    if(current!==version)return;
    items=snapshot.docs.map(d=>({...d.data(),id:d.id}));
    const unread=items.filter(item=>!item.read).length;button.textContent=unread?`通知 (${unread})`:'通知';
    button.setAttribute('aria-label',`通知，最近 100 則中有 ${unread} 則未讀`);
    status.textContent='顯示最近 100 則通知';all.disabled=!unread;list.replaceChildren();
    if(!items.length)list.append(node('p','目前沒有通知'));
    for(const item of items){
      const label=`${item.actorName}${item.type==='mention'?' 在留言中標註了你':' 將工作指派給你'}`;
      if(seen && !seen.has(item.id) && !item.read)toast(label);
      const row=node('button');row.type='button';row.className='notification-item'+(item.read?'':' unread');
      row.append(node('strong',label),node('span',item.cardTitle),node('time',new Date(item.createdAt).toLocaleString('zh-TW')));
      row.onclick=async()=>{
        row.disabled=true;
        try{await open(item);if(current!==version)return;await mark(item);dialog.close();}
        catch(error){if(current===version){status.textContent=error.message;row.disabled=false;}}
      };
      list.append(row);
    }
    seen=new Set(items.map(item=>item.id));
  },error=>{if(current===version)status.textContent='通知載入失敗：'+error.message;});
}
