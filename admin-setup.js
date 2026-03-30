import { auth, db } from './firebase-init.js';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  updateProfile
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js';
import {
  doc,
  getDoc,
  setDoc
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

const form = document.getElementById('admin-setup-form');
const messageBox = document.getElementById('admin-setup-message');
const nameInput = document.getElementById('admin-setup-name');
const emailInput = document.getElementById('admin-setup-email');
const passwordInput = document.getElementById('admin-setup-password');
const confirmInput = document.getElementById('admin-setup-confirm');

function showMessage(type, text) {
  if (!messageBox) return;
  messageBox.className = `setup-message visible ${type}`;
  messageBox.textContent = text;
}

function setSubmitting(isSubmitting) {
  const submitBtn = form?.querySelector('button[type="submit"]');
  if (!submitBtn) return;
  submitBtn.disabled = isSubmitting;
  submitBtn.textContent = isSubmitting ? 'Creation en cours...' : 'Creer le compte admin';
  submitBtn.style.opacity = isSubmitting ? '0.7' : '1';
  submitBtn.style.cursor = isSubmitting ? 'wait' : 'pointer';
}

function getErrorMessage(code) {
  const messages = {
    'auth/email-already-in-use': 'Cet email est deja utilise. Connecte-toi avec ce compte ou choisis un autre email.',
    'auth/weak-password': 'Le mot de passe doit contenir au moins 6 caracteres.',
    'auth/invalid-email': 'L email admin n est pas valide.',
    'auth/network-request-failed': 'Connexion reseau indisponible. Reessaie dans un instant.',
    'auth/operation-not-allowed': 'La methode Email / Mot de passe n est pas activee dans Firebase Authentication.',
    'permission-denied': 'Firestore a refuse la creation du profil admin. Verifie les regles du projet Firebase.',
    'unavailable': 'Le service Firebase est temporairement indisponible.'
  };

  return messages[code] || 'La creation du compte admin a echoue. Reessaie apres verification de Firebase.';
}

async function saveAdminProfile(user, name) {
  const now = new Date().toISOString();
  const clientRef = doc(db, 'clients', user.uid);
  const existingSnap = await getDoc(clientRef);
  const existing = existingSnap.exists() ? existingSnap.data() : {};

  await setDoc(clientRef, {
    uid: user.uid,
    name: name || existing.name || user.displayName || 'Administrateur Smart Cut Services',
    email: user.email || existing.email || '',
    role: 'admin',
    dashboardAccess: true,
    setupCompleted: true,
    createdAt: existing.createdAt || now,
    updatedAt: now,
    lastPasswordChangeAt: existing.lastPasswordChangeAt || now
  }, { merge: true });
}

async function handleSubmit(event) {
  event.preventDefault();

  const name = nameInput?.value?.trim() || '';
  const email = emailInput?.value?.trim() || '';
  const password = passwordInput?.value || '';
  const confirmPassword = confirmInput?.value || '';

  if (!name) {
    showMessage('error', 'Saisis le nom du compte admin.');
    return;
  }

  if (password.length < 8) {
    showMessage('error', 'Le mot de passe doit contenir au moins 8 caracteres.');
    return;
  }

  if (password !== confirmPassword) {
    showMessage('error', 'Les deux mots de passe ne correspondent pas.');
    return;
  }

  setSubmitting(true);
  showMessage('info', 'Creation du compte admin et synchronisation avec la base en cours...');

  try {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    const user = credential.user;

    if (name) {
      await updateProfile(user, { displayName: name });
    }

    await saveAdminProfile(user, name);

    showMessage(
      'success',
      'Le compte admin a ete cree avec succes. Tu peux maintenant ouvrir le dashboard et il reconnaitra automatiquement ce compte.'
    );

    form?.reset();
    setTimeout(() => {
      window.location.href = './dashboard.html';
    }, 1400);
  } catch (error) {
    console.error('Erreur creation compte admin:', error);
    showMessage('error', getErrorMessage(error?.code));
  } finally {
    setSubmitting(false);
  }
}

async function hydrateCurrentUser(user) {
  if (!user?.uid) return;

  try {
    const clientSnap = await getDoc(doc(db, 'clients', user.uid));
    if (!clientSnap.exists()) {
      showMessage(
        'info',
        'Un compte est connecte, mais son profil admin n est pas encore detecte. Tu peux quand meme creer ou recreer le profil admin depuis ce formulaire.'
      );
      return;
    }

    const profile = clientSnap.data();
    if (profile?.role === 'admin' || profile?.dashboardAccess === true) {
      showMessage(
        'success',
        'Ce compte est deja reconnu comme admin. Tu peux ouvrir directement le dashboard.'
      );
      const dashboardLink = document.querySelector('a[href="./dashboard.html"]');
      if (dashboardLink) {
        dashboardLink.textContent = 'Ouvrir le dashboard';
      }
    }
  } catch (error) {
    console.error('Erreur verification profil admin:', error);
  }
}

form?.addEventListener('submit', handleSubmit);

onAuthStateChanged(auth, (user) => {
  hydrateCurrentUser(user);
});
