'use strict';
const {createHash} = require('node:crypto');
const ROOT = 'workspaces/main';
const COLORS = ['#455f56','#c8b58f','#8fa697','#bca582','#ad9790'];
class ManagementError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = (code, message) => { throw new ManagementError(code, message); };
function id(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) fail('invalid-argument','資料 ID 格式不正確');
  return value;
}
function ids(value, limit=40) {
  if (!Array.isArray(value) || value.length>limit) fail('invalid-argument',`最多選擇 ${limit} 位會員`);
  value.forEach(id);
  if (new Set(value).size!==value.length) fail('invalid-argument','會員不可重複');
  return [...value].sort();
}
const equalIds = (a,b) => Array.isArray(a) && Array.isArray(b) && JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
function input(data, keys) {
  if (!data || typeof data!=='object' || Array.isArray(data) || Object.keys(data).some(k=>!keys.includes(k))) fail('invalid-argument','請求欄位不正確');
}
function requestId(value) {
  if (typeof value!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) fail('invalid-argument','請重新開啟表單後再試');
  return value.toLowerCase();
}
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function createManagement(db) {
  async function actor(tx, auth) {
    const email=auth?.token?.email;
    if (!auth?.uid || auth.token.email_verified!==true || typeof email!=='string' || !email.includes('@') || email.includes('/')) fail('unauthenticated','請使用已驗證的 Google 帳號登入');
    const lookup=await tx.get(db.doc(`${ROOT}/memberLookup/${email.toLowerCase()}`));
    if (!lookup.exists) fail('permission-denied','尚未取得工作空間權限');
    const memberRef=db.doc(`${ROOT}/members/${id(lookup.data().memberId)}`);
    const member=await tx.get(memberRef), data=member.data();
    if (!member.exists || data.status!=='active' || !['owner','admin'].includes(data.role) || !Array.isArray(data.accessboard)) fail('permission-denied','此操作僅限有效的 Owner／Admin');
    return {...data,id:member.id,ref:memberRef};
  }
  async function cardContext(tx, member, boardId, cardId) {
    if (!member.accessboard.includes(boardId)) fail('permission-denied','沒有此看板的管理權限');
    const boardRef=db.doc(`${ROOT}/boards/${boardId}`),cardRef=boardRef.collection('cards').doc(cardId);
    const [board,card]=await Promise.all([tx.get(boardRef),tx.get(cardRef)]);
    if (!board.exists || !card.exists || board.data().archived || card.data().archived) fail('failed-precondition','看板或牌卡已封存或不存在，請重新整理');
    return {ref:cardRef,data:card.data()};
  }
  function operation(auth, operationId, kind, payload) {
    return {ref:db.doc(`${ROOT}/managementRequests/${digest([auth.uid,operationId])}`),fingerprint:digest([kind,payload])};
  }
  function replay(snapshot, fingerprint) {
    if (!snapshot.exists) return null;
    if (snapshot.data().fingerprint!==fingerprint) fail('already-exists','此重試識別碼已用於不同內容，請重新開啟表單');
    return snapshot.data().result;
  }
  return {
    async listMembers(auth, data) {
      input(data,['boardId','cardId']);
      const forCard=data.boardId!==undefined || data.cardId!==undefined;
      if (forCard) {id(data.boardId);id(data.cardId);}
      return db.runTransaction(async tx=>{
        const member=await actor(tx,auth);
        const card=forCard?await cardContext(tx,member,data.boardId,data.cardId):null;
        const snapshot=await tx.get(db.collection(`${ROOT}/members`));
        const assigned=card?.data.assigneeIds || [];
        const members=snapshot.docs.filter(d=>d.data().status==='active' && (!forCard || d.data().accessboard?.includes(data.boardId)))
          .map(d=>({id:d.id,name:d.data().name || d.id,eligible:true}));
        for (const memberId of assigned) if (!members.some(m=>m.id===memberId)) {
          const historical=snapshot.docs.find(d=>d.id===memberId);
          members.push({id:memberId,name:historical?.data().name || '未知會員',eligible:false});
        }
        return {members,assigneeIds:assigned};
      });
    },
    async createBoard(auth,data) {
      input(data,['requestId','name','description','color','memberIds']);
      const operationId=requestId(data.requestId),memberIds=ids(data.memberIds);
      const name=typeof data.name==='string'?data.name.trim():'';
      if (!name || name.length>80 || typeof data.description!=='string' || data.description.length>5000 || !COLORS.includes(data.color)) fail('invalid-argument','請檢查看板名稱、說明長度與配色');
      const payload={name,description:data.description,color:data.color,memberIds};
      return db.runTransaction(async tx=>{
        const member=await actor(tx,auth),op=operation(auth,operationId,'createBoard',payload);
        const previous=await tx.get(op.ref),result=replay(previous,op.fingerprint);
        if (result) return result;
        const recipients=[...new Set([member.id,...memberIds])];
        const refs=recipients.map(m=>db.doc(`${ROOT}/members/${m}`));
        const snapshots=await Promise.all(refs.map(ref=>tx.get(ref)));
        if(snapshots.some(s=>!s.exists || s.data().status!=='active' || !Array.isArray(s.data().accessboard))) fail('failed-precondition','選取的會員已停用或不存在，請重新載入名單');
        const boardId=`managed-${operationId}`,boardRef=db.doc(`${ROOT}/boards/${boardId}`);
        const existing=await tx.get(boardRef);
        if(existing.exists)fail('already-exists','看板 ID 已存在，請重新開啟表單');
        const now=new Date().toISOString();
        tx.create(boardRef,{id:boardId,name,description:data.description,color:data.color,archived:false,starred:false,createdBy:member.id,createdAt:now,updatedBy:member.id,updatedAt:now,orderKey:'z'+now});
        ['待辦','進行中','已完成'].forEach((name,i)=>{
          const columnId=['todo','doing','done'][i];
          tx.create(boardRef.collection('columns').doc(columnId),{id:columnId,name,orderKey:String(i).padStart(12,'0')});
        });
        snapshots.forEach(s=>tx.update(s.ref,{accessboard:[...new Set([...s.data().accessboard,boardId])]}));
        const created={boardId};
        tx.create(op.ref,{kind:'createBoard',actorId:member.id,fingerprint:op.fingerprint,result:created,createdAt:now});
        return created;
      });
    },
    async setAssignees(auth,data) {
      input(data,['requestId','boardId','cardId','assigneeIds','expectedAssigneeIds']);
      const operationId=requestId(data.requestId),boardId=id(data.boardId),cardId=id(data.cardId);
      const assigneeIds=ids(data.assigneeIds),expectedAssigneeIds=ids(data.expectedAssigneeIds);
      const payload={boardId,cardId,assigneeIds,expectedAssigneeIds};
      return db.runTransaction(async tx=>{
        const member=await actor(tx,auth);
        const card=await cardContext(tx,member,boardId,cardId);
        const op=operation(auth,operationId,'setAssignees',payload),previous=await tx.get(op.ref),result=replay(previous,op.fingerprint);
        if(result)return result;
        if(!equalIds(card.data.assigneeIds||[],expectedAssigneeIds))fail('aborted','其他管理員已修改負責人，請重新開啟指派視窗');
        const targets=await Promise.all(assigneeIds.map(m=>tx.get(db.doc(`${ROOT}/members/${m}`))));
        if(targets.some(s=>!s.exists || s.data().status!=='active' || !Array.isArray(s.data().accessboard) || !s.data().accessboard.includes(boardId))) fail('failed-precondition','負責人必須是仍可存取此看板的有效會員；請取消無效的歷史指派');
        const now=new Date().toISOString(),updated={boardId,cardId,assigneeIds};
        tx.update(card.ref,{assigneeIds,updatedBy:member.id,updatedAt:now});
        tx.create(op.ref,{kind:'setAssignees',actorId:member.id,fingerprint:op.fingerprint,result:updated,createdAt:now});
        return updated;
      });
    }
  };
}
module.exports={createManagement,ManagementError};
