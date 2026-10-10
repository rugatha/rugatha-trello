const frame=document.querySelector('#preview'),out=document.querySelector('#results');
const tick=()=>new Promise(r=>setTimeout(r,80));
const w=()=>frame.contentWindow,d=()=>frame.contentDocument,$=s=>d().querySelector(s),fixture=()=>w().phase5Fixture;
const key=(el,k)=>el.dispatchEvent(new (w().KeyboardEvent)('keydown',{key:k,bubbles:true,cancelable:true}));
const change=async(value)=>{$('#personalTheme').value=value;$('#personalTheme').dispatchEvent(new (w().Event)('change'));await tick();};
const login=async(role='owner',theme='light',uid=role)=>{await fixture().login(role,theme,uid);await tick();};
const close=async()=>{d().querySelectorAll('dialog[open]').forEach(el=>el.close());await tick();};
let count=0;
function check(value,name){if(!value)throw Error(name);count++;out.textContent+='PASS '+name+'\n';}
async function run(name,task){out.textContent=name+'\n';count=0;try{await close();await task();out.textContent='完成：'+count+' 項通過\n'+out.textContent;}catch(e){out.textContent='FAIL '+e.message+'\n'+out.textContent;}}
document.querySelector('#theme').onclick=()=>run('個人主題',async()=>{
 await login();$('#currentUser').click();await tick();check($('#personalTheme').value==='light','預設明亮主題');const loads=fixture().loads;
 await change('dark');check(d().body.dataset.theme==='dark','深色主題套用');check(fixture().writes.at(-1).path==='workspaces/main/members/m'&&Object.keys(fixture().writes.at(-1).patch).join()==='theme','只儲存既有會員的 theme');check(fixture().loads===loads,'切換主題不重讀看板');
 await login('owner','dark','alternate');check(d().body.dataset.theme==='dark','同一會員不同信箱沿用偏好');
 fixture().fail=true;await change('light');check(d().body.dataset.theme==='dark'&&$('#personalTheme').value==='dark','儲存失敗恢復已存主題');check($('#themeStatus').textContent.includes('測試離線')&&!$('#personalTheme').disabled,'失敗原因顯示並解除鎖定');await change('light');check(d().body.dataset.theme==='light','失敗後可重試');
 fixture().snapshot({theme:'dark'});await tick();check(d().body.dataset.theme==='dark','偏好訂閱即時同步');
 let release;fixture().hold=new Promise(r=>release=r);$('#personalTheme').value='light';$('#personalTheme').dispatchEvent(new (w().Event)('change'));await tick();await login('viewer','dark','new');release();fixture().hold=null;await tick();check(d().body.dataset.theme==='dark','舊帳號延遲完成不污染新帳號');
 await w().boardlyGoogleAuth.signOut();await tick();check(d().body.dataset.theme==='light'&&$('#personalTheme').disabled,'登出重設主題並停用控制');
 await login('pending');const n=fixture().writes.length;await change('dark');check(fixture().writes.length===n&&$('#personalTheme').disabled,'未核准會員無法寫入偏好');await login();await close();
});
function rgb(v){return v.match(/[\d.]+/g).slice(0,3).map(Number);}
function luminance(v){return rgb(v).map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;}).reduce((s,n,i)=>s+n*[.2126,.7152,.0722][i],0);}
function ratio(a,b){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
function contrast(el){const style=w().getComputedStyle(el);let parent=el,bg;while(parent){bg=w().getComputedStyle(parent).backgroundColor;if(bg!=='rgba(0, 0, 0, 0)'&&bg!=='transparent')break;parent=parent.parentElement;}return ratio(style.color,bg);}
document.querySelector('#palette').onclick=()=>run('色彩對比',async()=>{
 for(const theme of ['light','dark']){
  await login('owner',theme);check(contrast($('.card-title'))>=4.5,theme+' 牌卡文字至少 4.5:1');check(contrast($('.card-desc'))>=4.5,theme+' 說明文字至少 4.5:1');check(contrast($('.count'))>=4.5,theme+' 計數文字至少 4.5:1');
  for(const tag of d().querySelectorAll('.tag'))check(contrast(tag)>=4.5,theme+' '+tag.className+' 對比至少 4.5:1');
  check(contrast($('#quickCreate'))>=4.5,theme+' 主要按鈕對比至少 4.5:1');$('#currentUser').click();check(contrast($('#themeHelp'))>=4.5,theme+' 表單說明對比至少 4.5:1');await close();
  for(const color of ['#455f56','#c8b58f','#8fa697','#bca582','#ad9790']){fixture().boardColor=color;$('#refreshWorkspace').click();await tick();check(contrast($('#boardDescription'))>=4.5&&contrast($('#boardTitle'))>=4.5,theme+' 共用看板 '+color+' 對比至少 4.5:1');}
 }
 fixture().boardColor='#455f56';await login();
});
document.querySelector('#permissions').onclick=()=>run('會員與權限',async()=>{
 for(const role of ['owner','admin','editor','viewer','member']){
  await login(role);const edit=['owner','admin','editor'].includes(role),manage=['owner','admin'].includes(role);
  check($('#quickCreate').disabled===!edit&&$('.card').draggable===edit,role+' 編輯與拖曳限制一致');check($('#addBoard').disabled===!manage,role+' 建立看板限制');
  $('.card').click();check($('#manageAssignees').disabled===!manage,role+' 負責人管理限制');check([...d().querySelectorAll('[data-assignee]')].every(el=>el.disabled),'指派勾選僅供閱讀');await close();
  if(!edit)check($('#permissionNotice').textContent.includes('唯讀'),role+' 明確顯示唯讀提示');
 }
 $('#membersBtn').click();check($('#displayMembers').textContent.includes('唯讀會員')&&!$('#displayMembers').querySelector('input,button'),'會員名冊不提供身分切換');await close();
 await login('pending');check($('#permissionNotice').textContent.includes('核准'),'未核准提示包含下一步');$('#currentUser').click();check($('#editGoogleName').disabled&&$('#personalTheme').disabled,'未核准帳號設定控制停用');await close();
 await w().boardlyGoogleAuth.signOut();await tick();check($('#permissionNotice').textContent.includes('登入')&&$('#mineFilter').disabled,'未登入狀態一致');await login();
});
document.querySelector('#accessibility').onclick=()=>run('手機與無障礙',async()=>{
 await login();
 for(const width of [320,375,600,850,1100]){frame.style.width=width+'px';await tick();check(d().documentElement.scrollWidth<=w().innerWidth,width+'px 頁面不超出視窗');check($('#boardNav').getBoundingClientRect().width>40,width+'px 看板導覽保留可讀空間');}
 frame.style.width='375px';await tick();$('.card').focus();key($('.card'),'Enter');await tick();check($('#editor').open,'Enter 開啟卡片');check($('#editor').contains(d().activeElement),'開啟卡片時焦點進入對話框');check($('#editor').hasAttribute('aria-label'),'卡片對話框有可讀名稱');
 for(const el of [...d().querySelectorAll('#editor input,#editor textarea,#editor select')]){const labelled=el.getAttribute('aria-label')||d().querySelector(`label[for="${el.id}"]`)||el.closest('label');check(Boolean(labelled),'欄位有可讀標籤 '+(el.id||el.dataset.assignee||el.dataset.label));}
 check($('#editor').scrollWidth<=$('#editor').clientWidth+1,'手機卡片詳情沒有橫向溢位');
 $('#cardTitleInput').value='焦點復原測試';$('#cardTitleInput').dispatchEvent(new (w().Event)('change'));await tick();$('#closeCard').click();await tick();check(d().activeElement?.dataset.card==='c','儲存後關閉卡片焦點返回原卡片');
 $('.card').focus();key($('.card'),' ');await tick();check($('#editor').open,'Space 開啟卡片');await close();
 check($('#syncStatus').getAttribute('role')==='status'&&$('#permissionNotice').getAttribute('role')==='status','同步與權限提示提供讀屏狀態');check($('#columns').tabIndex===0,'看板橫向捲動區可用鍵盤聚焦');check(Boolean($('.skip-link')),'提供跳到看板內容連結');
 $('#currentUser').click();check($('#userDialog').getAttribute('aria-labelledby')==='userDialogTitle','帳號對話框具標題關聯');check($('#userDialog').scrollWidth<=$('#userDialog').clientWidth+1,'手機帳號設定無橫向溢位');await close();
 frame.style.width='1100px';await tick();
});
document.querySelector('#mobile').onclick=()=>frame.style.width='375px';document.querySelector('#desktop').onclick=()=>frame.style.width='1100px';
