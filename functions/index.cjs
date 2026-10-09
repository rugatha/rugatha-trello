'use strict';
const {initializeApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {createManagement,ManagementError}=require('./management.cjs');
initializeApp();
const service=createManagement(getFirestore());
const options={region:'asia-east1',maxInstances:3,timeoutSeconds:30,memory:'256MiB'};
const callable=method=>onCall(options,async request=>{
  try{return await service[method](request.auth,request.data);}
  catch(error){
    if(error instanceof ManagementError)throw new HttpsError(error.code,error.message);
    // Never return SDK errors containing document contents or credentials.
    console.error('Management request failed',{method,code:error.code||'unknown'});
    throw new HttpsError('internal','管理操作暫時無法完成，請稍後重試');
  }
});
exports.listManagementMembers=callable('listMembers');
exports.createManagedBoard=callable('createBoard');
exports.setManagedAssignees=callable('setAssignees');

exports.listDisplayMembers=callable('displayMembers');
exports.listMembershipDirectory=callable('membershipDirectory');
exports.saveManagedMembership=callable('saveMembership');

const {getStorage}=require('firebase-admin/storage');
const {onSchedule}=require('firebase-functions/v2/scheduler');
const {createAttachments}=require('./attachments.cjs');
const attachments=createAttachments(getFirestore(),getStorage().bucket());
const attachmentCall=method=>onCall({...options,timeoutSeconds:120,memory:'512MiB'},async request=>{
  try{return await attachments[method](request.auth,request.data);}
  catch(error){
    if(error instanceof ManagementError)throw new HttpsError(error.code,error.message);
    console.error('Attachment request failed',{method,code:error.code||'unknown'});
    throw new HttpsError('internal','附件服務暫時無法完成，請重試');
  }
});
exports.beginAttachmentUpload=attachmentCall('begin');
exports.finishAttachmentUpload=attachmentCall('finish');
exports.cleanupAttachmentUploads=onSchedule({schedule:'every 24 hours',region:'asia-east1',timeoutSeconds:540,memory:'256MiB'},()=>attachments.cleanup());
