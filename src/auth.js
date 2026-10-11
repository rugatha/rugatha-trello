import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFirestore, doc, getDocFromServer, onSnapshot, updateDoc } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyB6voURDiSOGPY4Anx-HBxaCy3ShaIGias',
  authDomain: 'rugatha-trello.firebaseapp.com',
  projectId: 'rugatha-trello',
  storageBucket: 'rugatha-trello.firebasestorage.app',
  messagingSenderId: '913221850736',
  appId: '1:913221850736:web:926960f3914d4f7d2746b5'
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const firestore = getFirestore(app);
const nameDialog = document.querySelector('#nameDialog');
const nameForm = document.querySelector('#googleNameForm');
const nameInput = document.querySelector('#googleDisplayName');
const nameError = document.querySelector('#googleNameError');
const loginButton = document.querySelector('#googleSignIn');
let currentUser = null;
let currentMember = null;
let membershipVersion = 0;
let stopMembership = null;
let themeRequest = 0;
let themeSaving = false;
const themeSelect = document.querySelector('#personalTheme');
const themeStatus = document.querySelector('#themeStatus');
const validTheme = value => ['light', 'dark'].includes(value);
function syncTheme() {
  const theme = validTheme(currentMember?.theme) ? currentMember.theme : 'light';
  document.body.dataset.theme = theme;
  themeSelect.value = theme;
  themeSelect.disabled = !currentMember || themeSaving;
}

themeSelect.addEventListener('change', async () => {
  const theme = themeSelect.value;
  if (!currentUser || !currentMember || themeSaving || !validTheme(theme)) { syncTheme(); return; }
  const user = currentUser, memberId = currentMember.id, version = membershipVersion, request = ++themeRequest;
  const isCurrent = () => currentUser === user && membershipVersion === version && currentMember?.id === memberId && request === themeRequest;
  themeSaving = true;
  themeSelect.disabled = true;
  themeStatus.textContent = '正在儲存主題…';
  try {
    await updateDoc(doc(firestore, 'workspaces', 'main', 'members', memberId), { theme });
    if (!isCurrent()) return;
    currentMember.theme = theme;
    themeStatus.textContent = '個人主題已儲存';
  } catch (error) {
    if (isCurrent()) themeStatus.textContent = '主題未儲存，請重試：' + error.message;
  } finally {
    if (isCurrent()) { themeSaving = false; syncTheme(); }
  }
});
syncTheme();

function resetMembership() {
  membershipVersion++;
  themeRequest++;
  themeSaving = false;
  themeStatus.textContent = '';
  stopMembership?.();
  stopMembership = null;
  currentMember = null;
}

function notify(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 5000);
}

function publish(user, member = null) {
  syncTheme();
  const previous = JSON.stringify(window.boardlyGoogleUser);
  window.boardlyGoogleUser = user ? {
    uid: user.uid,
    email: user.email,
    displayName: member?.name || user.displayName || '',
    memberId: member?.status === 'active' ? member.id : null,
    workspaceRole: member?.status === 'active' ? member.role : null,
    accessboard: member?.accessboard || [],
    roster: member?.roster || []
  } : null;
  if (previous === JSON.stringify(window.boardlyGoogleUser)) return;
  window.dispatchEvent(new CustomEvent('boardly-auth-changed', { detail: window.boardlyGoogleUser }));
}

function hasName(member) { return typeof member?.name === 'string' && Boolean(member.name.trim()); }

async function loadMembership(user) {
  if (!user.email || !user.emailVerified) return null;
  const lookup = await getDocFromServer(doc(firestore, 'workspaces', 'main', 'memberLookup', user.email.toLowerCase()));
  if (!lookup.exists()) return null;
  const ref = doc(firestore, 'workspaces', 'main', 'members', lookup.data().memberId);
  const snapshot = await getDocFromServer(ref);
  if (!snapshot.exists() || snapshot.data().status !== 'active') return null;
  const member = { ...snapshot.data(), id: snapshot.id };
  const roster = await httpsCallable(getFunctions(app, 'asia-east1'), 'listDisplayMembers')({});
  member.roster = roster.data.members;
  return member;
}

async function finishSignIn(user) {
  const version = membershipVersion;
  const isCurrent = () => auth.currentUser === user && version === membershipVersion;
  let member = null;
  try {
    member = await loadMembership(user);
  } catch (error) {
    if (!isCurrent()) return;
    notify('Google 登入成功，但無法確認工作空間權限：' + error.message);
  }
  if (!isCurrent()) return;
  currentMember = member;
  publish(user, member);
  if (member) {
    stopMembership = onSnapshot(doc(firestore, 'workspaces', 'main', 'members', member.id), snapshot => {
      if (!isCurrent() || snapshot.metadata?.fromCache || snapshot.metadata?.hasPendingWrites) return;
      const data = snapshot.exists() ? snapshot.data() : null;
      if (!data || data.status !== 'active') {
        resetMembership();
        nameDialog.close();
        publish(user);
        return;
      }
      const next = { ...data, id: snapshot.id, roster: currentMember.roster.map(item =>
        item.id === snapshot.id ? { ...item, name: data.name || snapshot.id } : item) };
      if (JSON.stringify(next) === JSON.stringify(currentMember)) return;
      currentMember = next;
      publish(user, next);
    }, error => {
      if (!isCurrent()) return;
      resetMembership();
      nameDialog.close();
      publish(user);
      notify('會員權限同步失敗，已清除看板；請重新整理重試：' + error.message);
    });
  }
  if (member && !hasName(member)) {
    nameInput.value = '';
    nameError.textContent = '';
    if (!nameDialog.open) nameDialog.showModal();
  }
}

async function cancelName() {
  if (currentUser && currentMember && !hasName(currentMember)) {
    try { await signOut(auth); }
    catch (error) { nameError.textContent = '無法登出：' + error.message; }
  } else {
    nameDialog.close();
  }
}

document.querySelector('#cancelGoogleName').addEventListener('click', cancelName);
nameDialog.addEventListener('cancel', event => {
  event.preventDefault();
  cancelName();
});

onAuthStateChanged(auth, async user => {
  currentUser = user;
  resetMembership();
  if (nameDialog.open) nameDialog.close();
  publish(null);
  loginButton.hidden = Boolean(user);
  if (!user) {
    if (nameDialog.open) nameDialog.close();
    publish(null);
    return;
  }
  await finishSignIn(user);
});

loginButton.addEventListener('click', async () => {
  loginButton.disabled = true;
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({prompt:'select_account'});
    await signInWithPopup(auth, provider);
  } catch (error) {
    if (error.code !== 'auth/popup-closed-by-user') {
      notify(error.code === 'auth/unauthorized-domain'
        ? '此網站網域尚未加入 Firebase Authentication 授權網域。'
        : 'Google 登入失敗：' + error.message);
    }
  } finally {
    loginButton.disabled = false;
  }
});

nameForm.addEventListener('submit', async event => {
  event.preventDefault();
  const name = nameInput.value.trim();
  if (!currentUser || !currentMember || !name || name.length > 40) return;
  const user = currentUser;
  const member = currentMember;
  const version = membershipVersion;
  const saveButton = nameForm.querySelector('button[type="submit"]');
  saveButton.disabled = true;
  nameError.textContent = '';
  try {
    await updateDoc(doc(firestore, 'workspaces', 'main', 'members', member.id), { name });
    if (currentUser !== user || membershipVersion !== version || !currentMember) return;
    currentMember.name = name;
    currentMember.roster = currentMember.roster.map(item => item.id === member.id ? { ...item, name } : item);
    publish(user, currentMember);
    nameDialog.close();
  } catch (error) {
    if (currentUser === user && membershipVersion === version) nameError.textContent = '名稱儲存失敗：' + error.message;
  } finally {
    saveButton.disabled = false;
  }
});

window.boardlyGoogleAuth = {
  async refreshMembership() {
    const user = currentUser;
    resetMembership();
    nameDialog.close();
    publish(user);
    if (user) await finishSignIn(user);
  },
  editName() {
    if (!currentUser || !currentMember) { notify('尚未取得有效會員資格，無法修改名稱'); return; }
    nameInput.value = currentMember.name || '';
    nameError.textContent = '';
    nameDialog.showModal();
  },
  signOut() { return signOut(auth); }
};

export { auth, firestore };
