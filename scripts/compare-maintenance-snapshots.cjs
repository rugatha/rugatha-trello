// Local-only comparison; full private differences stay beside the ignored snapshot.
'use strict';
const fs=require('node:fs'),path=require('node:path'),{isDeepStrictEqual}=require('node:util');
function read(file){const root=path.resolve('attachments_export/maintenance')+path.sep,resolved=path.resolve(file);if(!resolved.startsWith(root)||path.basename(resolved)!=='snapshot.json')throw Error('Use private maintenance snapshot.json files');return {file:resolved,data:JSON.parse(fs.readFileSync(resolved,'utf8'))};}
try{
 const before=read(process.argv[2]),after=read(process.argv[3]);if(before.data.project!==after.data.project)throw Error('Project mismatch');
 const existing=new Map(after.data.documents.map(d=>[d.name,d])),differences=[];
 for(const d of before.data.documents){const latest=existing.get(d.name);if(!latest||!isDeepStrictEqual(d.fields,latest.fields))differences.push({name:d.name,before:d.fields,after:latest?.fields});}
 const objects=new Map(after.data.objects.map(o=>[o.name,o]));const changedObjects=before.data.objects.filter(o=>!objects.has(o.name)||objects.get(o.name).sha256!==o.sha256);
 const report={before:before.file,after:after.file,documentDifferences:differences,changedObjects};
 fs.writeFileSync(path.join(path.dirname(after.file),'comparison.json'),JSON.stringify(report,null,2),{mode:0o600,flag:'wx'});
 const historicalContentDifferences=differences.filter(d=>/\/boards\//.test(d.name));
 console.log(JSON.stringify({beforeDocuments:before.data.documents.length,afterDocuments:after.data.documents.length,addedDocuments:after.data.documents.filter(d=>!before.data.documents.some(b=>b.name===d.name)).length,documentDifferences:differences.length,historicalContentDifferences:historicalContentDifferences.length,originalObjectsChanged:changedObjects.length,addedObjects:after.data.objects.length-before.data.objects.length,report:'comparison.json'}));
 if(historicalContentDifferences.length||changedObjects.length)process.exitCode=1;
}catch(e){console.error(e.message);process.exitCode=1;}
