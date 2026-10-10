// Read-only 24-hour usage/error sample. Counts are operational evidence, not billing totals.
'use strict';
const fs=require('node:fs'),{PROJECT,cloudClient}=require('./cloud-client.cjs');
(async()=>{
 const request=await cloudClient(),end=new Date(),start=new Date(end-86400000),folder='attachments_export/maintenance/monitor-'+Date.now();fs.mkdirSync(folder,{recursive:true,mode:0o700});
 const metrics=['firestore.googleapis.com/document/read_count','firestore.googleapis.com/document/write_count','storage.googleapis.com/api/request_count','run.googleapis.com/request_count'];
 const report={from:start.toISOString(),to:end.toISOString(),metrics:{},billing:'Not queried: reconcile against Firebase Usage and Cloud Billing invoices'};
 for(const metric of metrics)try{
  const q=new URLSearchParams({filter:`metric.type="${metric}"`,'interval.startTime':start.toISOString(),'interval.endTime':end.toISOString(),'aggregation.alignmentPeriod':'86400s','aggregation.perSeriesAligner':'ALIGN_SUM',pageSize:'1000'});
  const data=await request(`https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries?${q}`);fs.writeFileSync(folder+'/'+metric.split('/').at(-2)+'-'+metric.split('/').at(-1)+'.json',JSON.stringify(data),{mode:0o600});
  const series=data.timeSeries||[];report.metrics[metric]={series:series.length,sampledSum:series.flatMap(s=>s.points||[]).reduce((n,p)=>n+Number(p.value?.int64Value??p.value?.doubleValue??0),0),hasMore:!!data.nextPageToken};
 }catch(e){report.metrics[metric]={unavailable:e.message};}
 try{
  const data=await request('https://logging.googleapis.com/v2/entries:list',{method:'POST',body:{resourceNames:[`projects/${PROJECT}`],filter:`timestamp>="${start.toISOString()}" AND severity>=ERROR AND (resource.type="cloud_run_revision" OR resource.type="cloud_function")`,pageSize:1000,orderBy:'timestamp desc'}});
  fs.writeFileSync(folder+'/errors.json',JSON.stringify(data),{mode:0o600});report.errors={sampledEntries:data.entries?.length||0,hasMore:!!data.nextPageToken};
 }catch(e){report.errors={unavailable:e.message};}
 fs.writeFileSync(folder+'/summary.json',JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
