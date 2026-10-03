import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFirestore, collection, doc, getDoc, getDocs, updateDoc } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

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

function notify(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 5000);
}

function publish(user, member = null) {
  window.boardlyGoogleUser = user ? {
    uid: user.uid,
    email: user.email,
    displayName: member?.name || user.displayName || '',
    memberId: member?.status === 'active' ? member.id : null,
    workspaceRole: member?.status === 'active' ? member.role : null,
    accessboard: member?.accessboard || [],
    roster: member?.roster || []
  } : null;
  window.dispatchEvent(new CustomEvent('boardly-auth-changed', { detail: window.boardlyGoogleUser }));
}

function hasName(member) { return typeof member?.name === 'string' && Boolean(member.name.trim()); }

async function loadMembership(user) {
  if (!user.email || !user.emailVerified) return null;
  const lookup = await getDoc(doc(firestore, 'workspaces', 'main', 'memberLookup', user.email.toLowerCase()));
  if (!lookup.exists()) return null;
  const ref = doc(firestore, 'workspaces', 'main', 'members', lookup.data().memberId);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists() || snapshot.data().status !== 'active') return null;
  const member = { ...snapshot.data(), id: snapshot.id };
  const roster = await getDocs(collection(firestore, 'workspaces', 'main', 'members'));
  member.roster = roster.docs.map(item => ({ id: item.id, name: item.data().name || item.id }));
  return member;
}

async function finishSignIn(user) {
  let member = null;
  try {
    member = await loadMembership(user);
  } catch (error) {
    if (auth.currentUser !== user) return;
    notify('Google 登入成功，但無法確認工作空間權限：' + error.message);
  }
  if (auth.currentUser !== user) return;
  currentMember = member;
  publish(user, member);
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
  currentMember = null;
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
    await signInWithPopup(auth, new GoogleAuthProvider());
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
  const saveButton = nameForm.querySelector('button[type="submit"]');
  saveButton.disabled = true;
  nameError.textContent = '';
  try {
    await updateDoc(doc(firestore, 'workspaces', 'main', 'members', member.id), { name });
    if (currentUser !== user) return;
    member.name = name;
    member.roster = member.roster.map(item => item.id === member.id ? { ...item, name } : item);
    publish(user, member);
    nameDialog.close();
  } catch (error) {
    if (currentUser === user) nameError.textContent = '名稱儲存失敗：' + error.message;
  } finally {
    saveButton.disabled = false;
  }
});

window.boardlyGoogleAuth = {
  editName() {
    if (!currentUser || !currentMember) { notify('尚未取得有效會員資格，無法修改名稱'); return; }
    nameInput.value = currentMember.name || '';
    nameError.textContent = '';
    nameDialog.showModal();
  },
  signOut() { return signOut(auth); }
};

export { auth, firestore };
