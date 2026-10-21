export function deadlineRoot(key='gantt'){
 const fields=Object.fromEntries(['year','month','day','period','hour','minute'].map(part=>[part,{dataset:{deadlinePart:part},value:''}]));
 const hint={textContent:''},clear={};
 const root={dataset:{deadlineFields:key},querySelectorAll:()=>Object.values(fields),querySelector:selector=>selector==='[data-deadline-hint]'?hint:clear};
 const fill=parts=>{for(const [key,value]of Object.entries(parts)){fields[key].value=value;fields[key].oninput();}};
 return {root,fields,hint,clear,fill};
}
