const frame=document.querySelector('#preview'),out=document.querySelector('#results');
const tick=()=>new Promise(r=>setTimeout(r,100));
const w=()=>frame.contentWindow,d=()=>frame.contentDocument,$=s=>d().querySelector(s);
let count=0;
function check(value,name){if(!value)throw Error(name);count++;out.textContent+='PASS '+name+'\n';}
async function close(){d().querySelectorAll('dialog[open]').forEach(el=>el.close());await tick();}
document.querySelector('#run').onclick=async()=>{
 out.textContent='測試中\n';count=0;
 try {
  await close();await w().phase5Fixture.login('viewer');await tick();
  check(!$('#sortBoards').disabled,'唯讀會員可排序自己的看板');
  $('#sortBoards').click();
  check($('#boardOrderDialog').open,'排序視窗開啟');
  const handle=$('[data-board-drag="second"]');
  const first=$('#boardOrderList').firstElementChild.getBoundingClientRect();
  const start=handle.getBoundingClientRect();
  const list=$('#boardOrderList'),capture=list.setPointerCapture;list.setPointerCapture=()=>{};
  handle.dispatchEvent(new (w().PointerEvent)('pointerdown',{bubbles:true,pointerId:1,button:0,isPrimary:true,clientY:start.top+start.height/2}));
  $('#boardOrderList').dispatchEvent(new (w().PointerEvent)('pointermove',{bubbles:true,pointerId:1,clientY:first.top}));
  $('#boardOrderList').dispatchEvent(new (w().PointerEvent)('pointerup',{bubbles:true,pointerId:1}));
  list.setPointerCapture=capture;
  check($('#boardOrderList').firstElementChild.textContent.includes('第二個看板'),'拖曳把手調整順序');
  $('#saveBoardOrder').click();await tick();
  check($('#boardNav [data-board]').dataset.board==='second','儲存後導覽套用個人順序');
  check(w().phase5Fixture.writes.at(-1).patch.boardOrder.join(',')==='second,b,new,old','只寫入會員的個人順序');
  w().phase5Fixture.snapshot({boardOrder:['second','b']});await tick();
  check([...d().querySelectorAll('#boardNav > [data-board]')].map(el=>el.dataset.board).join(',')==='second,b,new','未排序的新看板接在最後');
  $('#sortBoards').click();w().phase5Fixture.fail=true;$('#saveBoardOrder').click();await tick();
  check($('#boardOrderStatus').textContent.includes('未儲存')&&!$('#saveBoardOrder').disabled,'排序失敗可重試');await close();
  $('#currentUser').click();
  const canvas=d().createElement('canvas');canvas.width=400;canvas.height=200;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#455f56';ctx.fillRect(0,0,400,200);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
  const file=new (w().File)([blob],'avatar.png',{type:'image/png'}),transfer=new (w().DataTransfer)();transfer.items.add(file);
  $('#avatarInput').files=transfer.files;$('#avatarInput').dispatchEvent(new (w().Event)('change'));
  for(let i=0;i<30&&!$('#avatarStatus').textContent.includes('已儲存');i++)await tick();
  check($('#avatarStatus').textContent.includes('已儲存'),'真實 PNG 上傳並完成 JPEG 縮圖');
  await $('#avatarPreview').decode();
  check($('#avatarPreview').naturalWidth===160&&$('#avatarPreview').naturalHeight===160,'大頭貼縮為 160×160');
  check(Boolean($('#currentUser .avatar img'))&&Boolean($('#displayMembers .avatar img')),'帳號與成員名單顯示圖片');
  check($('#avatarPreview').src.length<50000,'縮圖符合儲存大小限制');
  for(const width of [375,1100]){
    frame.style.width=width+'px';await tick();
    check($('#userDialog').scrollWidth<=$('#userDialog').clientWidth+1,width+'px 個人設定沒有橫向溢位');
  }
  $('#removeAvatar').click();await tick();
  check($('#avatarPreview').hidden&&!$('#currentUser .avatar img'),'移除圖片恢復名字首字');await close();
  frame.style.width='375px';$('#sortBoards').click();await tick();
  check($('#boardOrderDialog').scrollWidth<=$('#boardOrderDialog').clientWidth+1,'手機排序視窗沒有橫向溢位');
  frame.style.width='1100px';
  out.textContent='完成：'+count+' 項通過\n'+out.textContent;
 }catch(error){out.textContent='FAIL '+error.message+'\n'+out.textContent;}
};
