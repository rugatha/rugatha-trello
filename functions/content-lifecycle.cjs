'use strict';
const {createHash} = require('node:crypto');
const {FieldValue} = require('firebase-admin/firestore');
const {ManagementError} = require('./management.cjs');
const ROOT = 'workspaces/main';
const fail = (code,message) => {throw new ManagementError(code,message);};
const hash = value => createHash('sha256').update(value).digest('hex');
const validId = value => typeof value==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
function createContentLifecycle(db,bucket) {
  async function administrator(tx,auth) {
    const email=auth?.token?.email;
    if (!auth?.uid || auth.token.email_verified!==true || typeof email!=='string' || email.includes('/')) fail('unauthenticated','請使用已驗證的 Google 帳號登入');
    const lookup=await tx.get(db.doc(`${ROOT}/memberLookup/${email.toLowerCase()}`));
    if (!lookup.exists || !validId(lookup.data().memberId)) fail('permission-denied','沒有 Admin 權限');
    const member=await tx.get(db.doc(`${ROOT}/members/${lookup.data().memberId}`));
    if (!member.exists || member.data().status!=='active' || member.data().role!=='admin') fail('permission-denied','只有有效 Admin 可執行此操作');
    return {...member.data(),id:member.id};
  }
  async function manage(auth,data) {
    const allowed=['requestId','boardId','cardId','action','confirmName','expectedArchived'];
    if (!data || Object.keys(data).some(k=>!allowed.includes(k)) || !validId(data.boardId) ||
        (data.cardId!==undefined && !validId(data.cardId)) || !['archive','restore','delete'].includes(data.action) ||
        typeof data.confirmName!=='string' || !data.confirmName || typeof data.expectedArchived!=='boolean' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.requestId||'')) fail('invalid-argument','請重新開啟操作視窗');
    const boardRef=db.doc(`${ROOT}/boards/${data.boardId}`);
    const ref=data.cardId ? boardRef.collection('cards').doc(data.cardId) : boardRef;
    const payload=JSON.stringify(data);
    const receiptRef=db.doc(`${ROOT}/managementRequests/lifecycle-${hash(auth?.uid+':'+data.requestId)}`);
    const jobRef=db.doc(`${ROOT}/managementRequests/deletion-${hash(ref.path)}`);
    const result={boardId:data.boardId,...(data.cardId?{cardId:data.cardId}:{}),action:data.action};
    const start=await db.runTransaction(async tx => {
      const member=await administrator(tx,auth);
      const [board,target,receipt,job]=await Promise.all([tx.get(boardRef),tx.get(ref),tx.get(receiptRef),tx.get(jobRef)]);
      // Replays still require an active Admin; a completed deletion no longer has grants.
      if (receipt.exists) {
        if (receipt.data().fingerprint!==hash(payload)) fail('already-exists','請求識別碼已用於不同內容');
        if (receipt.data().status==='done') return 'done';
      }
      if (data.action==='delete' && job.exists && job.data().status==='done') {
        if (target.exists || job.data().confirmName!==data.confirmName) fail('failed-precondition','此 ID 的刪除紀錄與目前內容不一致，請重新整理');
        return 'done';
      }
      if (!member.accessboard?.includes(data.boardId) && !(data.action==='delete' && job.exists && job.data().actorId===member.id)) fail('permission-denied','沒有此看板的權限');
      if (!board.exists || !target.exists) fail('not-found','看板或牌卡已不存在');
      if (data.cardId && board.data().deleting) fail('failed-precondition','看板正在刪除中');
      const name=data.cardId?target.data().title:target.data().name;
      if (name!==data.confirmName) fail('aborted','名稱已被修改，請重新整理後確認');
      const deleting=target.data().deleting===true;
      if (deleting && data.action!=='delete') fail('failed-precondition','內容正在刪除中，只能重試刪除');
      if (!deleting && !!target.data().archived!==data.expectedArchived) fail('aborted','封存狀態已變更，請重新整理');
      if (data.action==='delete' && !target.data().archived) fail('failed-precondition','請先封存，再永久刪除');
      const now=new Date().toISOString();
      if (data.action!=='delete') {
        tx.update(ref,{archived:data.action==='archive',updatedBy:member.id,updatedAt:now});
        tx.create(receiptRef,{kind:'contentLifecycle',fingerprint:hash(payload),actorId:member.id,status:'done',result,createdAt:now});
        return 'done';
      }
      if (!deleting) tx.update(ref,{deleting:true,updatedBy:member.id,updatedAt:now});
      if (!job.exists) tx.create(jobRef,{kind:'deleteContent',targetPath:ref.path,confirmName:name,actorId:member.id,status:'deleting',createdAt:now});
      if (!receipt.exists) tx.create(receiptRef,{kind:'contentLifecycle',fingerprint:hash(payload),actorId:member.id,status:'deleting',result,createdAt:now});
      return 'delete';
    });
    if (start==='done') return result;
    // Keep the locked parent until all cleanup succeeds; partial failures are retryable.
    // Expire sessions before removing bytes so completion cannot publish new attachments.
    const sessions=await db.collection(`${ROOT}/attachmentUploads`).where('boardId','==',data.boardId).get();
    const selected=sessions.docs.filter(d=>!data.cardId || d.data().cardId===data.cardId);
    for (const session of selected) await session.ref.update({status:'expired'});
    // Derive paths exclusively from validated IDs; never trust source URLs or storagePath fields.
    await bucket.deleteFiles({prefix:ref.path+'/',force:false});
    const [staging]=await bucket.getFiles({prefix:'uploads/'});
    for (const file of staging) {
      const parts=file.name.split('/');
      if (parts[2]===data.boardId && (!data.cardId || parts[3]===data.cardId)) await file.delete({ignoreNotFound:true});
    }
    for (const collection of await ref.listCollections()) await db.recursiveDelete(collection);
    // A late upload may leave only inaccessible staging bytes; the daily upload cleanup
    // removes those by age. Keep expired session records to reject old completion retries.
    if (!data.cardId) {
      const members=await db.collection(`${ROOT}/members`).get();
      const writer=db.bulkWriter();
      for (const m of members.docs) if(m.data().accessboard?.includes(data.boardId)) writer.update(m.ref,{accessboard:FieldValue.arrayRemove(data.boardId)});
      await writer.close();
    }
    await db.runTransaction(async tx=>{
      await administrator(tx,auth);
      const target=await tx.get(ref);
      if (target.exists && !target.data().deleting) fail('aborted','刪除鎖定已變更');
      if (target.exists) tx.delete(ref);
      tx.update(jobRef,{status:'done',completedAt:new Date().toISOString()});
      tx.update(receiptRef,{status:'done'});
    });
    return result;
  }
  return {manage};
}
module.exports={createContentLifecycle};
