import { auth, db } from './firebase-init.js';
import { getAuthManager } from './auth.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js';
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
      ">Seul un compte connecte avec le role admin peut ouvrir ce dashboard.</p>
      <div style="display:flex;justify-content:center;gap:.8rem;flex-wrap:wrap;">
        <button id="admin-gate-login" type="button" style="
          border:none;
          border-radius:999px;
          padding:.95rem 1.2rem;
          background:#C6A75E;
          color:#171614;
          font-weight:800;
          cursor:pointer;
        ">Se connecter</button>
        <a href="./admin-setup.html" style="
          display:inline-flex;
          align-items:center;
          justify-content:center;
          text-decoration:none;
          border-radius:999px;
          padding:.95rem 1.2rem;
          background:rgba(198,167,94,0.12);
          border:1px solid rgba(198,167,94,0.32);
          color:#F6F1E8;
          font-weight:700;
        ">Creer le compte admin</a>
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
    </div>
  `;

  document.body.appendChild(gate);
  return gate;
}

function updateGateState({ mode = 'login' } = {}) {
  const gate = ensureGate();
  const copy = gate.querySelector('#admin-gate-copy');
  const loginBtn = gate.querySelector('#admin-gate-login');
  if (!copy || !loginBtn) return gate;

  if (mode === 'checking') {
    copy.textContent = 'Verification du compte admin en cours...';
    loginBtn.textContent = 'Verification...';
    loginBtn.disabled = true;
    loginBtn.style.opacity = '0.7';
  } else if (mode === 'forbidden') {
    copy.textContent = 'Ce compte est connecte, mais il n a pas le role admin dans la base de donnees.';
    loginBtn.textContent = 'Se reconnecter';
    loginBtn.disabled = false;
    loginBtn.style.opacity = '1';
  } else {
    copy.textContent = 'Seul un compte connecte avec le role admin peut ouvrir ce dashboard.';
    loginBtn.textContent = 'Se connecter';
    loginBtn.disabled = false;
    loginBtn.style.opacity = '1';
  }

  loginBtn.onclick = () => {
    getAuthManager().openAuthModal('login');
  };

  return gate;
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
      denyAccess('forbidden');
      return;
    }

    allowAccess(profile);
  });
}

protectAdminPage();
