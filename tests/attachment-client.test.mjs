import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
async function setup({begin,finish,blob,upload}={}){
 const calls=[],revoked=[],cancelled=[],reads=[];
 const deps={auth:{app:{}},getStorage:()=>({}),ref:(_,path)=>path,getFunctions:()=>({}),
  httpsCallable:(_,name)=>async data=>{calls.push({name,data});return {data:await (name==='beginAttachmentUpload'?begin?.(data)||{stagingPath:'temporary',memberId:'m',attachmentId:'a',status:'pending'}:finish?.(data)||{attachmentId:'a'})};},
  getBlob:path=>{reads.push(path);return blob?.(path)||Promise.resolve({size:1024});},uploadBytesResumable:()=>({cancel(){cancelled.push(true);},on(event,progress,reject,resolve){if(upload)upload({progress,reject,resolve});else resolve();}})};
 let urlId=0;
 const context=vm.createContext({console,Set,Error,URL:{createObjectURL:()=> ++urlId===1?'blob:test':`blob:test-${urlId}`,revokeObjectURL:url=>revoked.push(url)}});
 const mod=new vm.SourceTextModule(await readFile(new URL('../src/attachment-client.js',import.meta.url),'utf8'),{context});
 await mod.link(()=>new vm.SyntheticModule(Object.keys(deps),function(){for(const [k,v] of Object.entries(deps))this.setExport(k,v);},{context}));await mod.evaluate();
 return {api:mod.namespace,calls,revoked,cancelled,reads};
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

test('concurrent and remounted previews share bytes but own separate releasable URLs',async()=>{
 const hold=deferred(),{api,reads,revoked}=await setup({blob:()=>hold.promise}),a={storagePath:'private'};
 const first=api.attachmentBlobURL(a,{preview:true}),second=api.attachmentBlobURL(a,{preview:true});
 assert.equal(reads.length,1);hold.resolve({size:1024});
 const [one,two]=await Promise.all([first,second]);assert.notEqual(one,two);
 api.releaseAttachmentURL(one);const three=await api.attachmentBlobURL(a,{preview:true});
 assert.equal(reads.length,1);assert.notEqual(two,three);assert.deepEqual(revoked,[one]);
 await api.attachmentBlobURL(a);assert.equal(reads.length,2,'explicit downloads recheck authorization');
 api.clearAttachmentAccess();await api.attachmentBlobURL(a,{preview:true});assert.equal(reads.length,3);
});
test('preview cache evicts least recently used bytes at its memory limit',async()=>{
 const {api,reads}=await setup({blob:()=>Promise.resolve({size:16*1024*1024})});
 const preview=async path=>api.releaseAttachmentURL(await api.attachmentBlobURL({storagePath:path},{preview:true}));
 await preview('a');await preview('b');await preview('a');await preview('c');await preview('a');
 assert.deepEqual(reads,['a','b','c']);await preview('b');assert.equal(reads.length,4);
});
test('failed preview requests can be retried and oversized files are not retained',async()=>{
 let failed=false;
 const {api,reads}=await setup({blob:()=>{if(!failed){failed=true;return Promise.reject(Error('offline'));}return Promise.resolve({size:33*1024*1024});}});
 const preview=()=>api.attachmentBlobURL({storagePath:'a'},{preview:true});
 await assert.rejects(preview(),/offline/);await preview();await preview();assert.equal(reads.length,3);
});
test('revocation isolates pending previews from the next access epoch',async()=>{
 const old=deferred(),fresh=deferred();let attempt=0;
 const {api,reads}=await setup({blob:()=>++attempt===1?old.promise:fresh.promise});
 const preview=()=>api.attachmentBlobURL({storagePath:'a'},{preview:true});
 const stale=preview();api.clearAttachmentAccess();const current=preview();
 old.resolve({size:1});await assert.rejects(stale,/存取權限已變更/);
 const shared=preview();assert.equal(reads.length,2);
 fresh.resolve({size:1});await Promise.all([current,shared]);await preview();assert.equal(reads.length,2);
});

test('all file types including xlsx and unknown extensions are accepted; missing MIME uses binary fallback',async()=>{
 const {api,calls}=await setup();
 for(const [name,type] of [['sheet.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],['data.xls','application/vnd.ms-excel'],['script.js','application/javascript'],['page.html','text/html'],['file.custom','application/x-custom-file'],['unknown','']]){
  await api.uploadAttachment({name,type,size:18*1024},'b','c',name);
  assert.equal(calls.at(-2).data.type,type||'application/octet-stream');
 }
});
test('20 MiB is allowed; oversized and empty files have distinct size errors before any requests',async()=>{
 const {api,calls}=await setup();
 await api.uploadAttachment({name:'file.any',type:'',size:20*1024*1024},'b','c','limit');
 const before=calls.length;
 await assert.rejects(api.uploadAttachment({name:'large.any',type:'',size:20*1024*1024+1},'b','c','large'),/超過 20 MiB/);
 await assert.rejects(api.uploadAttachment({name:'empty.any',type:'',size:0},'b','c','empty'),/空白/);
 assert.equal(calls.length,before);
});
