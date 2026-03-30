import { auth, db } from './firebase-init.js';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js';
import { doc, getDoc, query, collection, where, limit, getDocs } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

const ADMIN_ROLE = 'admin';
const ADMIN_GATE_ID = 'smartcut-admin-gate';

async function loadAdminProfile(uid) {
  if (!uid) return null;

  try {
    const directRef = doc(db, 'clients', uid);
    const directSnap = await getDoc(directRef);
    if (directSnap.exists()) {
      return { id: directSnap.id, ...directSnap.data() };
    }
  } catch (error) {
    console.error('Erreur lecture profil admin direct:', error);
  }

  try {
    const snapshot = await getDocs(query(collection(db, 'clients'), where('uid', '==', uid), limit(1)));
    if (!snapshot.empty) {
      const item = snapshot.docs[0];
      return { id: item.id, ...item.data() };
    }
  } catch (error) {
    console.error('Erreur lecture profil admin par uid:', error);
  }

  return null;
}

function isAdminProfile(profile) {
  if (!profile) return false;
  return profile.role === ADMIN_ROLE || profile.dashboardAccess === true;
}

function ensureGate() {
  let gate = document.getElementById(ADMIN_GATE_ID);
  if (gate) return gate;

  gate = document.createElement('div');
  gate.id = ADMIN_GATE_ID;
  gate.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 1000004;
    background:
      radial-gradient(circle at top left, rgba(198,167,94,0.16), transparent 32%),
      linear-gradient(180deg, rgba(15,14,12,0.96), rgba(15,14,12,0.99));
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  `;

  gate.innerHTML = `
    <div style="
      width:min(100%, 520px);
      border-radius: 28px;
      border:1px solid rgba(198,167,94,0.24);
      background: rgba(24,22,19,0.92);
      box-shadow: 0 24px 70px rgba(0,0,0,0.35);
      padding: 2rem;
      color:#F6F1E8;
      font-family: 'Manrope', sans-serif;
      backdrop-filter: blur(16px);
      text-align:center;
    ">
      <div style="
        display:inline-flex;
        align-items:center;
        gap:.55rem;
        border-radius:999px;
        padding:.6rem .95rem;
        border:1px solid rgba(198,167,94,0.32);
        background: rgba(198,167,94,0.12);
        color:#C6A75E;
        font-size:.78rem;
        letter-spacing:.14em;
        text-transform:uppercase;
        font-weight:800;
        margin-bottom:1rem;
      ">
        <i class="fas fa-shield-halved"></i>
        <span>Acces admin protege</span>
      </div>
      <h1 style="
        font-family:'Cormorant Garamond', serif;
        font-size:clamp(2rem, 5vw, 3.2rem);
        line-height:.95;
        margin:0 0 .75rem;
      ">Connexion admin requise</h1>
      <p id="admin-gate-copy" style="
        color:#B7AE9F;
        line-height:1.75;
        font-size:.96rem;
        margin:0 auto 1.25rem;
        max-width:42ch;
      ">Connecte-toi avec ton email admin et ton mot de passe pour ouvrir le dashboard.</p>

      <form id="admin-gate-form" style="
        display:grid;
        gap:.8rem;
        margin:0 auto 1rem;
        text-align:left;
      ">
        <div>
          <label for="admin-gate-email" style="
            display:block;
            margin-bottom:.35rem;
            color:#B7AE9F;
            font-size:.9rem;
          ">Email admin</label>
          <input id="admin-gate-email" type="email" autocomplete="username" style="
            width:100%;
            padding:.95rem 1rem;
            border-radius:16px;
            border:1px solid rgba(198,167,94,0.22);
            background:rgba(255,255,255,0.06);
            color:#F6F1E8;
            font:inherit;
          " />
        </div>

        <div>
          <label for="admin-gate-password" style="
            display:block;
            margin-bottom:.35rem;
            color:#B7AE9F;
            font-size:.9rem;
          ">Mot de passe</label>
          <input id="admin-gate-password" type="password" autocomplete="current-password" style="
            width:100%;
            padding:.95rem 1rem;
            border-radius:16px;
            border:1px solid rgba(198,167,94,0.22);
            background:rgba(255,255,255,0.06);
            color:#F6F1E8;
            font:inherit;
          " />
        </div>

        <div id="admin-gate-error" style="
          display:none;
          padding:.8rem .95rem;
          border-radius:14px;
          background:rgba(127,29,29,0.18);
          border:1px solid rgba(248,113,113,0.32);
          color:#fecaca;
          font-size:.9rem;
          line-height:1.55;
        "></div>

        <div style="display:flex;justify-content:center;gap:.8rem;flex-wrap:wrap;margin-top:.2rem;">
          <button id="admin-gate-login" type="submit" style="
            border:none;
            border-radius:999px;
            padding:.95rem 1.2rem;
            background:#C6A75E;
            color:#171614;
            font-weight:800;
            cursor:pointer;
          ">Se connecter</button>
          <a href="./index.html" style="
          display:inline-flex;
          align-items:center;
          justify-content:center;
          text-decoration:none;
          border-radius:999px;
          padding:.95rem 1.2rem;
          border:1px solid rgba(198,167,94,0.28);
          color:#F6F1E8;
          background:rgba(255,255,255,0.03);
          font-weight:700;
        ">Retour au site</a>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(gate);
  return gate;
}

function updateGateState({ mode = 'login' } = {}) {
  const gate = ensureGate();
  const copy = gate.querySelector('#admin-gate-copy');
  const form = gate.querySelector('#admin-gate-form');
  const loginBtn = gate.querySelector('#admin-gate-login');
  const errorBox = gate.querySelector('#admin-gate-error');
  if (!copy || !loginBtn || !form || !errorBox) return gate;

  if (mode === 'checking') {
    copy.textContent = 'Verification du compte admin en cours...';
    loginBtn.textContent = 'Verification...';
    loginBtn.disabled = true;
    loginBtn.style.opacity = '0.7';
    errorBox.style.display = 'none';
  } else if (mode === 'forbidden') {
    copy.textContent = 'Ce compte est connecte, mais il n a pas les droits admin pour ce dashboard.';
    loginBtn.textContent = 'Se connecter';
    loginBtn.disabled = false;
    loginBtn.style.opacity = '1';
    errorBox.style.display = 'block';
    errorBox.textContent = 'Ce compte ne peut pas ouvrir le dashboard admin.';
  } else {
    copy.textContent = 'Connecte-toi avec ton email admin et ton mot de passe pour ouvrir le dashboard.';
    loginBtn.textContent = 'Se connecter';
    loginBtn.disabled = false;
    loginBtn.style.opacity = '1';
    errorBox.style.display = 'none';
  }

  if (!form.dataset.bound) {
    form.addEventListener('submit', handleAdminLogin);
    form.dataset.bound = '1';
  }

  return gate;
}

function getAuthErrorMessage(code) {
  const messages = {
    'auth/user-not-found': 'Aucun compte admin n a ete trouve avec cet email.',
    'auth/wrong-password': 'Mot de passe incorrect.',
    'auth/invalid-credential': 'Email ou mot de passe invalide.',
    'auth/invalid-email': 'Email invalide.',
    'auth/too-many-requests': 'Trop de tentatives. Reessaie plus tard.',
    'auth/network-request-failed': 'Erreur reseau. Verifie la connexion.',
    'auth/operation-not-allowed': 'La connexion Email / Mot de passe n est pas activee dans Firebase Authentication.'
  };
  return messages[code] || 'Connexion admin impossible pour le moment.';
}

async function handleAdminLogin(event) {
  event.preventDefault();

  const gate = ensureGate();
  const emailInput = gate.querySelector('#admin-gate-email');
  const passwordInput = gate.querySelector('#admin-gate-password');
  const loginBtn = gate.querySelector('#admin-gate-login');
  const errorBox = gate.querySelector('#admin-gate-error');
  const copy = gate.querySelector('#admin-gate-copy');

  const email = emailInput?.value?.trim() || '';
  const password = passwordInput?.value || '';

  if (!email || !password) {
    if (errorBox) {
      errorBox.style.display = 'block';
      errorBox.textContent = 'Saisis l email admin et le mot de passe.';
    }
    return;
  }

  if (errorBox) {
    errorBox.style.display = 'none';
    errorBox.textContent = '';
  }

  if (copy) {
    copy.textContent = 'Connexion admin en cours...';
  }

  if (loginBtn) {
    loginBtn.disabled = true;
    loginBtn.textContent = 'Connexion...';
    loginBtn.style.opacity = '0.7';
  }

  try {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    const profile = await loadAdminProfile(credential.user?.uid);

    if (!isAdminProfile(profile)) {
      try {
        await signOut(auth);
      } catch (signOutError) {
        console.error('Erreur deconnexion compte non admin:', signOutError);
      }

      if (errorBox) {
        errorBox.style.display = 'block';
        errorBox.textContent = 'Ce compte ne peut pas ouvrir le dashboard admin.';
      }

      if (copy) {
        copy.textContent = 'Ce compte est connecte, mais il n a pas les droits admin pour ce dashboard.';
      }

      if (loginBtn) {
        loginBtn.disabled = false;
        loginBtn.textContent = 'Se connecter';
        loginBtn.style.opacity = '1';
      }

      return;
    }

    allowAccess(profile);
  } catch (error) {
    console.error('Erreur connexion admin:', error);
    if (errorBox) {
      errorBox.style.display = 'block';
      errorBox.textContent = getAuthErrorMessage(error?.code);
    }
    if (copy) {
      copy.textContent = 'Connecte-toi avec ton email admin et ton mot de passe pour ouvrir le dashboard.';
    }
    if (loginBtn) {
      loginBtn.disabled = false;
      loginBtn.textContent = 'Se connecter';
      loginBtn.style.opacity = '1';
    }
  }
}

function allowAccess(profile) {
  document.body.dataset.adminAccess = 'granted';
  document.dispatchEvent(new CustomEvent('adminAccessGranted', { detail: { profile } }));
  const gate = document.getElementById(ADMIN_GATE_ID);
  if (gate) gate.remove();
}

function denyAccess(mode = 'login') {
  document.body.dataset.adminAccess = 'blocked';
  updateGateState({ mode });
}

export function protectAdminPage() {
  updateGateState({ mode: 'checking' });

  onAuthStateChanged(auth, async (user) => {
    if (!user?.uid) {
      denyAccess('login');
      return;
    }

    updateGateState({ mode: 'checking' });
    const profile = await loadAdminProfile(user.uid);

    if (!isAdminProfile(profile)) {
      try {
        await signOut(auth);
      } catch (error) {
        console.error('Erreur deconnexion compte non admin:', error);
      }
      denyAccess('forbidden');
      return;
    }

    allowAccess(profile);
  });
}

protectAdminPage();
