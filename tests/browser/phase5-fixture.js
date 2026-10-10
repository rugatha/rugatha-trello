// Memory-only Firebase adapter used exclusively by the phase-five browser harness.
export const fixture={member:{id:'m',name:'測試會員',status:'active',role:'owner',accessboard:['b'],theme:'light'},writes:[],fail:false,hold:null,listener:null,loads:0};
const users=[{id:'m',name:'測試會員'},{id:'viewer',name:'唯讀會員'}];
const auth={currentUser:null,app:{}};let authChanged;
export const initializeApp=()=>({});export const getAuth=()=>auth;export const getFirestore=()=>({});export const getFunctions=()=>({});export class GoogleAuthProvider {}
export const httpsCallable=()=>async()=>({data:{members:users}});
export const onAuthStateChanged=(_,fn)=>{authChanged=fn;queueMicrotask(()=>fn(null));};
export const signInWithPopup=async()=>fixture.login('owner');export const signOut=async()=>{auth.currentUser=null;await authChanged(null);};
export const doc=(_, ...parts)=>parts.join('/');
export const getDocFromServer=async path=>path.includes('memberLookup')?{exists:()=>fixture.member!==null,data:()=>({memberId:'m'})}:{id:'m',exists:()=>!!fixture.member,data:()=>({...fixture.member})};
export const onSnapshot=(_,next,error)=>{const listener={next,error};fixture.listener=listener;return ()=>{if(fixture.listener===listener)fixture.listener=null;};};
export async function updateDoc(path,patch){const hold=fixture.hold;if(hold)await hold;if(fixture.fail){fixture.fail=false;throw Error('測試離線');}fixture.writes.push({path,patch});Object.assign(fixture.member,patch);}
fixture.login=async(role='owner',theme='light',uid=role)=>{fixture.member=role==='pending'?null:{id:'m',name:'測試會員',status:'active',role,accessboard:['b'],theme};auth.currentUser={uid,email:uid+'@example.com',emailVerified:true,displayName:'Google 名稱'};await authChanged(auth.currentUser);};
fixture.snapshot=patch=>{Object.assign(fixture.member,patch);fixture.listener.next({id:'m',exists:()=>true,data:()=>({...fixture.member}),metadata:{}});};
window.phase5Fixture=fixture;
export async function loadWorkspace(account){fixture.loads++;return {users,boards:account?.memberId?[{id:'b',name:'測試看板與長標題可讀性',color:fixture.boardColor||'#455f56',description:'本機記憶體資料，不連接正式 Firebase。',columns:[{id:'col',name:'待辦'},{id:'done',name:'完成'}],cards:[{id:'c',title:'鍵盤開啟測試牌卡',columnId:'col',createdAt:'2026-10-10T00:00:00Z',description:'測試說明',assignees:['viewer'],labels:['purple','blue','green','orange','pink'],checklist:[],comments:[],attachments:[],archivedAttachments:[]}],archivedCards:[]}]:[]};}
export const subscribeWorkspace=()=>()=>{};export const persistWorkspace=async()=>[];export const restoreCard=async()=>{};export const restoreAttachment=async()=>{};export const loadDeferredAttachmentArchives=async()=>[];
export const listManagementMembers=async()=>({members:users.map(u=>({...u,eligible:true})),assigneeIds:['viewer']});export const createManagedBoard=async()=>({boardId:'b'});export const setManagedAssignees=async()=>({});export const listMembershipDirectory=async()=>({members:[],boards:[]});export const saveManagedMembership=async()=>({});
export const clearAttachmentUI=()=>{};export const hydrateAttachmentImages=()=>{};export const downloadAttachment=async()=>{};export const bindAttachmentUpload=()=>{};
