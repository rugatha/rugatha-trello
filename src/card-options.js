import {assignMovedOrderKey,compareOrderKey} from './order-key.js';
const legacyColors={purple:'#efe7fc',blue:'#e4edff',green:'#e4f3eb',orange:'#fff0dc',pink:'#fce5ef'};
export function labelColor(value) {return /^#[0-9a-f]{6}$/i.test(value||'')?value.toLowerCase():legacyColors[value]||'#e4edff';}
export function labelInk(value) {
 const rgb=labelColor(value).slice(1).match(/../g).map(v=>{const n=parseInt(v,16)/255;return n<=0.04045?n/12.92:((n+0.055)/1.055)**2.4;});
 const luminance=rgb[0]*0.2126+rgb[1]*0.7152+rgb[2]*0.0722;
 return (luminance+0.05)/0.05 >= 1.05/(luminance+0.05)?'#17251e':'#ffffff';
}
export function boardLabels(board) {
 return Object.fromEntries(Object.entries(board?.labelDefinitions||{}).filter(([,label])=>label&&typeof label.name==='string'));
}
export function placeCard(cards, card, columnId, position) {
 const remaining=cards.filter(c=>c.id!==card.id),siblings=remaining.filter(c=>c.columnId===columnId);
 if(!Number.isInteger(position)||position<1||position>siblings.length+1)throw Error('牌卡位置已變更，請重新選擇');
 const before=siblings[position-1],last=siblings.at(-1);
 const index=before?remaining.indexOf(before):last?remaining.indexOf(last)+1:remaining.length;
 const placement={...card,columnId};remaining.splice(index,0,placement);assignMovedOrderKey(remaining,placement);
 card.columnId=columnId;card.orderKey=placement.orderKey;remaining[index]=card;return remaining;
}
export {deadlineParts,resolveDeadline,deadlineDisplay,deadlineFields,bindDeadlineFields} from './deadline.js';

// Legacy checklists may have missing or duplicate ranks. Normalize those once,
// then subsequent moves only change the moved item's rank.
export function placeChecklist(items, id, group, beforeId=null) {
 const item=items.find(item=>item.id===id);
 if(!item)throw Error('找不到待辦事項');
 const remaining=items.filter(item=>item.id!==id).map(item=>({...item}));
 const ranked=remaining.every((item,index)=>item.orderKey!=null && (!index||compareOrderKey(remaining[index-1].orderKey,item.orderKey)<0));
 if(!ranked)remaining.forEach((item,index)=>item.orderKey=`r:${index}/1`);
 const next={...item,group};
 const siblings=remaining.filter(item=>String(item.group||'').trim()===group);
 const before=beforeId? siblings.find(item=>item.id===beforeId):null;
 const last=siblings.at(-1);
 const index=before?remaining.indexOf(before):last?remaining.indexOf(last)+1:remaining.length;
 remaining.splice(index,0,next);
 // Group IDs are import metadata; use the destination group's ID when present.
 const groupId=siblings.find(item=>item.groupId)?.groupId || (String(item.group||'').trim()===group?item.groupId:'');
 if(next.groupId||groupId)next.groupId=groupId||'';
 const ranks=remaining.map(item=>({...item,columnId:''}));
 assignMovedOrderKey(ranks,ranks[index]);next.orderKey=ranks[index].orderKey;
 return remaining;
}
