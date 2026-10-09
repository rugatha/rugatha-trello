import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
async function setup({begin,finish,blob,upload}={}){
 const calls=[],revoked=[],cancelled=[];
 const deps={auth:{app:{}},getStorage:()=>({}),ref:(_,path)=>path,getFunctions:()=>({}),
  httpsCallable:(_,name)=>async data=>{calls.push({name,data});return {data:await (name==='beginAttachmentUpload'?begin?.(data)||{stagingPath:'temporary',memberId:'m',attachmentId:'a',status:'pending'}:finish?.(data)||{attachmentId:'a'})};},
  getBlob:()=>blob?.()||Promise.resolve({}),uploadBytesResumable:()=>({cancel(){cancelled.push(true);},on(event,progress,reject,resolve){if(upload)upload({progress,reject,resolve});else resolve();}})};
 const context=vm.createContext({console,Set,Error,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL:url=>revoked.push(url)}});
 const mod=new vm.SourceTextModule(await readFile(new URL('../attachment-client.js',import.meta.url),'utf8'),{context});
 await mod.link(()=>new vm.SyntheticModule(Object.keys(deps),function(){for(const [k,v] of Object.entries(deps))this.setExport(k,v);},{context}));await mod.evaluate();
 return {api:mod.namespace,calls,revoked,cancelled};
}
const file={name:'note.txt',type:'text/plain',size:10};
test('lost upload response still attempts trusted finish using the same request ID',async()=>{
 const {api,calls}=await setup({upload:({reject})=>reject({code:'storage/unauthorized'})});
 await api.uploadAttachment(file,'b','c','request');assert.deepEqual(calls.map(c=>[c.name,c.data.requestId]),[['beginAttachmentUpload','request'],['finishAttachmentUpload','request']]);
});
test('completed upload retry skips byte upload and rechecks trusted completion',async()=>{
 const {api,calls}=await setup({begin:()=>({status:'complete'}),upload:()=>assert.fail('must not upload')});
 await api.uploadAttachment(file,'b','c','request');assert.equal(calls.length,2);
});
test('revocation during begin prevents byte upload or completion',async()=>{
 const hold=deferred(),{api,calls}=await setup({begin:()=>hold.promise,upload:()=>assert.fail('must not upload')});
 const result=api.uploadAttachment(file,'b','c','request');api.clearAttachmentAccess();hold.resolve({status:'pending'});
 await assert.rejects(result,/存取權限已變更/);assert.equal(calls.length,1);
});
test('revocation cancels active upload and prevents finalization',async()=>{
 let callback;const {api,calls,cancelled}=await setup({upload:c=>callback=c});
 const result=api.uploadAttachment(file,'b','c','request');await new Promise(setImmediate);api.clearAttachmentAccess();callback.reject({code:'storage/canceled'});
 await assert.rejects(result,/存取權限已變更/);assert.equal(cancelled.length,1);assert.equal(calls.length,1);
});
test('late private image never creates an accessible Blob URL after revocation',async()=>{
 const hold=deferred(),{api,revoked}=await setup({blob:()=>hold.promise});
 const result=api.attachmentBlobURL({storagePath:'private'});api.clearAttachmentAccess();hold.resolve({});
 await assert.rejects(result,/存取權限已變更/);assert.equal(revoked.length,0);
});
test('revocation releases existing image and download URLs',async()=>{
 const {api,revoked}=await setup();await api.attachmentBlobURL({storagePath:'private'});api.clearAttachmentAccess();assert.deepEqual(revoked,['blob:test']);
});
