// Rational ranks preserve the code-point order of any legacy string key.
// Each UTF-16 unit uses a base larger than the largest possible unit.
const base = 65537n;
const cache = new Map();
function rank(key) {
  const value = String(key ?? '');
  if(cache.has(value))return cache.get(value);
  const fraction = value.match(/^r:(-?\d+)\/(\d+)$/);
  if (fraction && BigInt(fraction[2]) > 0n) return [BigInt(fraction[1]),BigInt(fraction[2])];
  let numerator=0n,denominator=1n;
  for(let index=0;index<value.length;index++){
    numerator=numerator*base+BigInt(value.charCodeAt(index)+1);
    denominator*=base;
  }
  const result=[numerator,denominator];cache.set(value,result);
  return result;
}
export function compareOrderKey(a,b) {
  const left=rank(a),right=rank(b);
  const difference=left[0]*right[1]-right[0]*left[1];
  return difference<0n?-1:difference>0n?1:0;
}
export function assignMovedOrderKey(cards,moved) {
  const target=cards.filter(card=>card.columnId===moved.columnId);
  const index=target.indexOf(moved),before=target[index-1],after=target[index+1];
  const lower=before?rank(before.orderKey):null,upper=after?rank(after.orderKey):null;
  if(lower&&upper&&lower[0]*upper[1]>=upper[0]*lower[1]){
    throw new Error('此階段的排序值需要整理，請稍後重試');
  }
  let numerator,denominator;
  if(lower&&upper){numerator=lower[0]+upper[0];denominator=lower[1]+upper[1];}
  else if(lower){numerator=lower[0]+lower[1];denominator=lower[1];}
  else if(upper){numerator=upper[0]-upper[1];denominator=upper[1];}
  else {numerator=0n;denominator=1n;}
  moved.orderKey=`r:${numerator}/${denominator}`;
}
