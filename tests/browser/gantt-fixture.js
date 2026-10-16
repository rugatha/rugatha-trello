// Local memory-only fixture. Never reads or writes production Firebase.
const account = {uid:'fixture',memberId:'reader',workspaceRole:'viewer',displayName:'測試閱讀者',email:'reader@example.test',accessboard:['launch','content'],roster:[{id:'reader',name:'測試閱讀者'},{id:'designer',name:'設計夥伴'}]};
window.boardlyGoogleUser = account;
const publish = value => {window.boardlyGoogleUser=value;window.dispatchEvent(new CustomEvent('boardly-auth-changed',{detail:value}));};
window.boardlyGoogleAuth = {refreshMembership:async()=>publish(account),signOut:async()=>publish(null),editName:()=>{}};
document.querySelector('#googleSignIn').hidden=true;
const card = (id,title,due,assignees,extra={}) => ({id,title,createdAt:'2026-10-01T00:00:00Z',due,assignees,checklist:[],...extra});
const workspace = {boards:[{id:'launch',name:'秋季企劃上線',cards:[
 card('design','網站視覺與頁面設計','2026-10-24',['designer'],{checklist:[{id:'a',text:'10/12 完成設計初稿',done:true},{id:'b',text:'10月20日 確認手機版',done:false},{id:'c',text:'等待回饋',done:false}]}),
 card('review','內容審核與確認','',['reader'],{done:true,completedAt:'2026-10-14T00:00:00Z'}),
 card('old','舊任務，缺少完成紀錄','',[],{done:true}),
 card('invalid','檢查日期範圍','2026-09-30',[])]},
 {id:'content',name:'社群內容排程',cards:[card('schedule','十月社群素材','2026-10-31',['reader'],{checklist:[{id:'d',text:'2026/10/10–2026/10/22 整理素材',done:false}]})]},
 {id:'private',name:'不可見的看板',cards:[card('secret','不可見的機密任務','2026-10-30',[])]}]};
export async function loadWorkspace() {return structuredClone(workspace);}
export async function updateCardDeadline(account,boardId,cardId,due,expectedDue) {
 const card=workspace.boards.find(b=>b.id===boardId)?.cards.find(c=>c.id===cardId);
 if (!card?.assignees.includes(account.memberId) || (card.due||'')!==expectedDue) throw Error('牌卡已變更');
 card.due=due;return {due,updatedAt:new Date().toISOString()};
}
export const subscribeWorkspace = () => () => {};
