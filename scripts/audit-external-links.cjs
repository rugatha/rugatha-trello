// Read-only; detailed private URLs remain in the ignored backup directory.
const fs=require('node:fs');
const {localEntries}=require('./migrate-trello-attachments.cjs');
(async()=>{
 const entries=localEntries().filter(e=>e.board.name!=='Socials'&&e.status==='external_link_saved');
 const results=[];let next=0;
 await Promise.all(Array.from({length:4},async()=>{while(next<entries.length){
  const e=entries[next++];let result;
  try {const r=await fetch(e.attachment.url,{signal:AbortSignal.timeout(25000),headers:{'User-Agent':'Mozilla/5.0 (compatible; attachment-link-check/1.0)'}});
   const body=(await r.text()).slice(0,200000);
   const gated=/accounts\.google\.com|ServiceLogin|\/login|\/signin/.test(r.url)||/you need access|request access|sign in to continue|要求存取權|您需要存取權/i.test(body);
   result={status:r.status,finalUrl:r.url,result:r.ok&&!gated?'readable':'needs-review',reason:gated?'login-or-access-required':r.ok?'HTTP success':'HTTP error'};
  }catch(error){result={result:'needs-review',reason:error.cause?.code||error.name};}
  results.push({board:e.board.name,card:e.card.name,cardId:e.card.id,attachmentId:e.attachment.id,name:e.attachment.name,url:e.attachment.url,...result});
 }}));
 results.sort((a,b)=>a.attachmentId.localeCompare(b.attachmentId));
 const report={at:new Date().toISOString(),total:results.length,readable:results.filter(r=>r.result==='readable').length,results};
 fs.writeFileSync('attachments_export/migration/external-link-audit.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({total:report.total,readable:report.readable,review:report.total-report.readable,reasons:results.reduce((m,r)=>(m[r.reason]=(m[r.reason]||0)+1,m),{})}));
})();
