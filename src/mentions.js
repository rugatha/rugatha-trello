// Offsets use UTF-16, matching textarea selectionStart and Firestore strings.
export function moveMentions(before, after, mentions) {
  let start=0;
  while(start<before.length && start<after.length && before[start]===after[start])start++;
  let oldEnd=before.length,newEnd=after.length;
  while(oldEnd>start && newEnd>start && before[oldEnd-1]===after[newEnd-1]){oldEnd--;newEnd--;}
  const delta=newEnd-oldEnd;
  return mentions.filter(m=>m.end<=start || m.start>=oldEnd)
    .map(m=>m.start>=oldEnd?{...m,start:m.start+delta,end:m.end+delta}:m)
    .filter(m=>after.slice(m.start,m.end)==='@'+m.label);
}
export function mentionQuery(text, caret, mentions) {
  const prefix=text.slice(0,caret),start=prefix.lastIndexOf('@');
  if(start<0 || start>0 && !/[\s(（]/.test(text[start-1]) || mentions.some(m=>start>=m.start && start<m.end))return null;
  const query=prefix.slice(start+1);
  return /[\n@]/.test(query) || query.length>40 ? null : {start,end:caret,query};
}
export function mentionParts(text, mentions=[]) {
  const parts=[];let end=0;
  for(const m of [...mentions].sort((a,b)=>a.start-b.start)) {
    if(!Number.isInteger(m.start)||!Number.isInteger(m.end)||m.start<end||m.end>text.length||text.slice(m.start,m.end)!=='@'+m.label)continue;
    parts.push({text:text.slice(end,m.start)},{text:text.slice(m.start,m.end),memberId:m.memberId});end=m.end;
  }
  parts.push({text:text.slice(end)});return parts;
}
