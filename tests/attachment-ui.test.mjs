import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const tick=()=>new Promise(setImmediate);
async function setup({observe=true}={}){
 const requests=[],released=[],images=[],watched=new Set();let cleared=0,notify;
 const deps={attachmentBlobURL:(attachment,options)=>new Promise((resolve,reject)=>requests.push({attachment,options,resolve,reject})),
  releaseAttachmentURL:url=>released.push(url),clearAttachmentAccess:()=>cleared++,uploadAttachment:()=>{}};
 const root={querySelectorAll:()=>images.filter(img=>img.isConnected)};
 const context=vm.createContext({document:root,setTimeout,
  ...(observe?{IntersectionObserver:class{
   constructor(callback,options){notify=callback;assert.equal(options.rootMargin,'160px');}
   observe(img){watched.add(img);}unobserve(img){watched.delete(img);}disconnect(){watched.clear();}
  }}:{})});
 const mod=new vm.SourceTextModule(await readFile(new URL('../src/attachment-ui.js',import.meta.url),'utf8'),{context});
 await mod.link(()=>new vm.SyntheticModule(Object.keys(deps),function(){for(const [key,value] of Object.entries(deps))this.setExport(key,value);},{context}));
 await mod.evaluate();
 const add=(path='private/image')=>{
  const img={dataset:{storagePath:path},isConnected:true,src:'placeholder',alt:'圖片',removeAttribute(name){delete this[name];}};
  images.push(img);return img;
 };
 return {api:mod.namespace,requests,released,watched,add,cleared:()=>cleared,
  intersect:(img,isIntersecting=true)=>notify([{target:img,isIntersecting}])};
}

test('previews defer network reads until near the viewport and hydrate only once',async()=>{
 const {api,add,requests,watched,intersect}=await setup(),img=add(),offscreen=add('private/other');
 api.hydrateAttachmentImages();assert.equal(requests.length,0);assert.equal(watched.size,2);
 intersect(offscreen,false);assert.equal(requests.length,0);
 intersect(img);intersect(img);api.hydrateAttachmentImages();assert.equal(requests.length,1);
 assert.equal(requests[0].options.preview,true);assert.equal(watched.has(img),false);
 requests[0].resolve('blob:visible');await tick();assert.equal(img.src,'blob:visible');
 intersect(offscreen);assert.equal(requests.length,2);
});
test('rerender releases detached URLs and stops observing detached images',async()=>{
 const {api,add,requests,released,watched,intersect}=await setup(),img=add(),hidden=add();
 api.hydrateAttachmentImages();intersect(img);requests[0].resolve('blob:old');await tick();
 img.isConnected=false;hidden.isConnected=false;const replacement=add();api.hydrateAttachmentImages();
 assert.deepEqual(released,['blob:old']);assert.equal(watched.size,1);assert.ok(watched.has(replacement));
});
test('clear removes displayed images and late requests cannot restore revoked previews',async()=>{
 const {api,add,requests,released,watched,intersect,cleared}=await setup(),ready=add(),pending=add();
 api.hydrateAttachmentImages();intersect(ready);intersect(pending);
 requests[0].resolve('blob:ready');await tick();api.clearAttachmentUI();
 assert.equal(ready.src,undefined);assert.equal(watched.size,0);assert.equal(cleared(),1);
 // Reusing a DOM node in the next epoch must not accept the old response.
 api.hydrateAttachmentImages();intersect(pending);
 requests[1].resolve('blob:stale');await tick();assert.notEqual(pending.src,'blob:stale');
 requests[2].resolve('blob:fresh');await tick();assert.equal(pending.src,'blob:fresh');
 assert.deepEqual(released,['blob:ready','blob:stale']);
});
test('browsers without IntersectionObserver still load previews',async()=>{
 const {api,add,requests}=await setup({observe:false}),img=add();api.hydrateAttachmentImages();
 assert.equal(requests.length,1);requests[0].resolve('blob:fallback');await tick();assert.equal(img.src,'blob:fallback');
});
