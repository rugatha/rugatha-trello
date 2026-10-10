import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';

async function setup(member = {name:'會員名稱',status:'active',role:'viewer',accessboard:[]}, hooks = {}) {
  const elements=new Map(), writes=[], reads=[], listeners=[];
  let onAuth, fail=false;
  const element=key=>{
    if(!elements.has(key))elements.set(key,{value:'',open:false,events:{},classList:{add(){},remove(){}},
      addEventListener(name,fn){this.events[name]=fn;},showModal(){this.open=true;},close(){this.open=false;},
      querySelector(){return element('save');}});
    return elements.get(key);
  };
  const auth={currentUser:null};
  const api={
    getFunctions:()=>({}),httpsCallable:()=>async()=>({data:{members:[{id:'m',name:member?.name}]}}),
    initializeApp:()=>({}),getAuth:()=>auth,getFirestore:()=>({}),GoogleAuthProvider:class{},
    onAuthStateChanged:(_,fn)=>onAuth=fn,signInWithPopup:async()=>{},
    signOut:async()=>{auth.currentUser=null;await onAuth(null);},
    doc:(_, ...parts)=>parts.join('/'),collection:()=>({}),
    getDocFromServer:async path=>{
      reads.push(path);
      if(hooks.getDoc)await hooks.getDoc(path);
      return path.includes('memberLookup')
        ? {exists:()=>Boolean(member),data:()=>({memberId:'m'})}
        : {id:'m',exists:()=>true,data:()=>({...member})};
    },
    getDocsFromServer:async()=>({docs:[{id:'m',data:()=>({...member})}]}),
    onSnapshot:(path,next,error)=>{const listener={path,next,error,stopped:false};listeners.push(listener);return ()=>listener.stopped=true;},
    updateDoc:async(path,patch)=>{if(hooks.updateDoc)await hooks.updateDoc();if(fail)throw Error('offline');writes.push({path,patch});Object.assign(member,patch);}
  };
  const window={dispatchEvent(){}};
  const context=vm.createContext({document:{querySelector:element,body:{dataset:{}}},window,setTimeout:()=>{},CustomEvent:class{}});
  const module=new vm.SourceTextModule(await fs.readFile(new URL('../auth.js',import.meta.url),'utf8'),{context});
  const dep=new vm.SyntheticModule(Object.keys(api),function(){for(const [key,value] of Object.entries(api))this.setExport(key,value);},{context});
  await module.link(()=>dep);await module.evaluate();
  return {element,window,body:context.document.body,writes,reads,listeners,setFail:()=>fail=true,
    async login(uid='u',overrides={}){const user={uid,email:uid+'@example.com',emailVerified:true,displayName:'Google 名稱',...overrides};auth.currentUser=user;await onAuth(user);},
    async save(name){element('#googleDisplayName').value=name;await element('#googleNameForm').events.submit({preventDefault(){}});}
  };
}
test('Firestore name survives different accounts without local storage or automatic writes',async()=>{
  const h=await setup();await h.login();
  assert.equal(h.window.boardlyGoogleUser.displayName,'會員名稱');
  assert.equal(h.window.boardlyGoogleUser.memberId,'m');
  assert.equal(h.element('#nameDialog').open,false);
  await h.login('second');
  assert.equal(h.window.boardlyGoogleUser.displayName,'會員名稱');
  assert.equal(h.writes.length,0);
});
test('editing saves member name and roster without changing Google profile',async()=>{
  const h=await setup();await h.login();h.window.boardlyGoogleAuth.editName();
  await h.save(' 新名稱 ');
  assert.equal(h.writes[0].path,'workspaces/main/members/m');
  assert.equal(h.window.boardlyGoogleUser.displayName,'新名稱');
  assert.equal(h.window.boardlyGoogleUser.roster[0].name,'新名稱');
  await h.login('second');
  assert.equal(h.window.boardlyGoogleUser.displayName,'新名稱');
});
test('missing names prompt; failed writes stay open and preserve published name',async()=>{
  const h=await setup({name:'',status:'active'});await h.login();
  assert.equal(h.element('#nameDialog').open,true);
  h.setFail();await h.save('名稱');
  assert.equal(h.element('#nameDialog').open,true);
  assert.match(h.element('#googleNameError').textContent,/offline/);
  assert.equal(h.writes.length,0);
  await h.element('#cancelGoogleName').events.click();
  assert.equal(h.window.boardlyGoogleUser,null);
});
test('unapproved accounts cannot open or save member name',async()=>{
  const h=await setup(null);await h.login();h.window.boardlyGoogleAuth.editName();await h.save('名稱');
  assert.equal(h.element('#nameDialog').open,false);
  assert.equal(h.window.boardlyGoogleUser.memberId,null);
  assert.equal(h.writes.length,0);
});

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
test('unverified email never reads membership data',async()=>{
  const h=await setup();await h.login('u',{emailVerified:false});
  assert.equal(h.reads.length,0);
  assert.equal(h.window.boardlyGoogleUser.memberId,null);
});
test('disabled member cannot open name editor or acquire a workspace role',async()=>{
  const h=await setup({name:'Disabled',status:'disabled',role:'editor'});
  await h.login();h.window.boardlyGoogleAuth.editName();
  assert.equal(h.window.boardlyGoogleUser.workspaceRole,null);
  assert.equal(h.element('#nameDialog').open,false);
});
test('logout during membership lookup cannot restore previous account',async()=>{
  const pending=deferred();
  const h=await setup(undefined,{getDoc:()=>pending.promise});
  const login=h.login();
  await h.window.boardlyGoogleAuth.signOut();
  pending.resolve();await login;
  assert.equal(h.window.boardlyGoogleUser,null);
  assert.equal(h.element('#nameDialog').open,false);
});
test('failed old login cannot display an error after a new account signs in',async()=>{
  const pending=deferred();
  const h=await setup(undefined,{getDoc:path=>path.includes('old@example.com')?pending.promise:undefined});
  const old=h.login('old');await h.login('new');
  pending.reject(Error('old account lookup failed'));await old;
  assert.equal(h.window.boardlyGoogleUser.uid,'new');
  assert.equal(h.element('#toast').textContent,undefined);
});
test('pending name save cannot restore a logged-out account',async()=>{
  const pending=deferred();
  const h=await setup(undefined,{updateDoc:()=>pending.promise});await h.login();
  h.window.boardlyGoogleAuth.editName();
  const save=h.save('Saved');await h.window.boardlyGoogleAuth.signOut();
  pending.resolve();await save;
  assert.equal(h.window.boardlyGoogleUser,null);
  assert.equal(h.element('#nameDialog').open,false);
});
test('invalid display names never write',async()=>{
  const h=await setup();await h.login();
  await h.save('   ');await h.save('x'.repeat(41));
  assert.equal(h.writes.length,0);
});

const snapshot = (data, metadata = {}) => ({id:'m',exists:()=>data !== null,data:()=>data,metadata});
test('membership changes publish current board access and role without a browser reload',async()=>{
  const member={name:'Member',status:'active',role:'editor',accessboard:['a','b']};
  const h=await setup(member);await h.login();
  h.listeners[0].next(snapshot({...member,role:'viewer',accessboard:['b']}));
  assert.deepEqual(Array.from(h.window.boardlyGoogleUser.accessboard),['b']);
  assert.equal(h.window.boardlyGoogleUser.workspaceRole,'viewer');
  h.listeners[0].next(snapshot(member));
  assert.deepEqual(Array.from(h.window.boardlyGoogleUser.accessboard),['a','b']);
});
for(const kind of ['disabled','deleted','denied'])test('membership '+kind+' clears access and closes the name editor',async()=>{
  const h=await setup();await h.login();h.window.boardlyGoogleAuth.editName();
  if(kind==='denied')h.listeners[0].error(Error('permission denied'));
  else h.listeners[0].next(snapshot(kind==='deleted'?null:{status:'disabled'}));
  assert.equal(h.window.boardlyGoogleUser.memberId,null);
  assert.equal(h.window.boardlyGoogleUser.roster.length,0);
  assert.equal(h.element('#nameDialog').open,false);
  assert.equal(h.listeners[0].stopped,true);
});
test('cached snapshots cannot restore obsolete membership permissions',async()=>{
  const h=await setup();await h.login();
  h.listeners[0].next(snapshot({status:'active',role:'owner'}, {fromCache:true}));
  assert.equal(h.window.boardlyGoogleUser.workspaceRole,'viewer');
});
test('old member callbacks cannot replace a new account or show stale errors',async()=>{
  const h=await setup();await h.login('old');const old=h.listeners[0];await h.login('new');
  assert.equal(old.stopped,true);
  old.next(snapshot(null));old.error(Error('old error'));
  assert.equal(h.window.boardlyGoogleUser.uid,'new');
  assert.equal(h.window.boardlyGoogleUser.memberId,'m');
  assert.equal(h.element('#toast').textContent,undefined);
});
test('manual refresh rereads membership and restarts a failed listener',async()=>{
  const member={name:'Member',status:'active',role:'editor',accessboard:['a','b']};
  const h=await setup(member);await h.login();h.listeners[0].error(Error('denied'));
  member.accessboard=['b'];await h.window.boardlyGoogleAuth.refreshMembership();
  assert.deepEqual(Array.from(h.window.boardlyGoogleUser.accessboard),['b']);
  assert.equal(h.listeners.length,2);assert.equal(h.reads.length,4);
});
test('pending name save cannot restore revoked membership',async()=>{
  const pending=deferred();const h=await setup(undefined,{updateDoc:()=>pending.promise});await h.login();
  const save=h.save('Saved');h.listeners[0].error(Error('denied'));
  pending.resolve();await save;
  assert.equal(h.window.boardlyGoogleUser.memberId,null);
});

test('name save finishing after a role update preserves new permissions',async()=>{
  const pending=deferred();const h=await setup(undefined,{updateDoc:()=>pending.promise});await h.login();
  h.window.boardlyGoogleAuth.editName();const save=h.save('Saved');
  h.listeners[0].next(snapshot({name:'Saved',status:'active',role:'viewer',accessboard:['new']}));
  pending.resolve();await save;
  assert.equal(h.window.boardlyGoogleUser.displayName,'Saved');
  assert.deepEqual(Array.from(h.window.boardlyGoogleUser.accessboard),['new']);
  assert.equal(h.element('#nameDialog').open,false);
});

for (const theme of ['light','dark']) test('personal '+theme+' theme persists on the existing member across emails',async()=>{
  const h=await setup();await h.login();
  h.element('#personalTheme').value=theme;await h.element('#personalTheme').events.change();
  assert.deepEqual(JSON.parse(JSON.stringify(h.writes[0])),{path:'workspaces/main/members/m',patch:{theme}});
  assert.equal(h.body.dataset.theme,theme);
  await h.login('alternate');assert.equal(h.body.dataset.theme,theme);
  await h.window.boardlyGoogleAuth.signOut();assert.equal(h.body.dataset.theme,'light');
});
test('theme failure restores saved preference and allows retry',async()=>{
  const h=await setup({name:'Member',status:'active',theme:'dark'});await h.login();h.setFail();
  h.element('#personalTheme').value='light';await h.element('#personalTheme').events.change();
  assert.equal(h.body.dataset.theme,'dark');assert.equal(h.element('#personalTheme').value,'dark');
  assert.equal(h.element('#personalTheme').disabled,false);assert.match(h.element('#themeStatus').textContent,/offline/);
});
test('unapproved and invalid themes do not write',async()=>{
  const h=await setup(null);await h.login();h.element('#personalTheme').value='dark';await h.element('#personalTheme').events.change();
  assert.equal(h.writes.length,0);assert.equal(h.element('#personalTheme').disabled,true);
  const member=await setup();await member.login();member.element('#personalTheme').value='injected';await member.element('#personalTheme').events.change();
  assert.equal(member.writes.length,0);
});
for(const failure of [false,true])test('old theme '+(failure?'failure':'completion')+' cannot change a new account',async()=>{
  const pending=deferred();const h=await setup(undefined,{updateDoc:()=>pending.promise});await h.login('old');
  h.element('#personalTheme').value='dark';const save=h.element('#personalTheme').events.change();await h.login('new');
  if(failure)pending.reject(Error('old failure'));else pending.resolve();await save;
  assert.equal(h.body.dataset.theme,'light');assert.equal(h.element('#themeStatus').textContent,'');assert.equal(h.element('#personalTheme').disabled,false);
});
test('theme snapshots sync and revoked membership resets preference',async()=>{
 const h=await setup();await h.login();h.listeners[0].next(snapshot({name:'Member',status:'active',role:'viewer',theme:'dark'}));
 assert.equal(h.body.dataset.theme,'dark');h.listeners[0].next(snapshot(null));assert.equal(h.body.dataset.theme,'light');assert.equal(h.element('#personalTheme').disabled,true);
});
