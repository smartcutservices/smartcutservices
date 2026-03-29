import { auth, db } from './firebase-init.js';
import {
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  updatePassword
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js';
import { doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

const elements = {
  email: document.getElementById('security-admin-email'),
  role: document.getElementById('security-admin-role'),
  passwordDate: document.getElementById('security-password-date'),
  form: document.getElementById('security-password-form'),
  currentPassword: document.getElementById('security-current-password'),
  newPassword: document.getElementById('security-new-password'),
  confirmPassword: document.getElementById('security-confirm-password'),
  resetEmailBtn: document.getElementById('security-reset-email'),
  message: document.getElementById('security-message')
};

let currentUser = null;
let currentProfile = null;

function showMessage(text, type = 'info') {
  if (!elements.message) return;
  elements.message.textContent = text;
  elements.message.className = `security-message visible ${type}`;
}

function formatDate(value) {
  if (!value) return 'Aucune donnee';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Aucune donnee';
  return new Intl.DateTimeFormat('fr-HT', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

async function loadProfile(uid) {
  const snap = await getDoc(doc(db, 'clients', uid));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

function updateHeader() {
  if (elements.email) {
    elements.email.textContent = currentUser?.email || 'Non connecte';
  }
  if (elements.role) {
    elements.role.textContent = currentProfile?.role || 'Aucun role';
  }
  if (elements.passwordDate) {
    elements.passwordDate.textContent = formatDate(currentProfile?.lastPasswordChangeAt);
  }
}

async function markPasswordChange() {
  if (!currentUser?.uid) return;
  await setDoc(doc(db, 'clients', currentUser.uid), {
    role: currentProfile?.role || 'admin',
    dashboardAccess: currentProfile?.dashboardAccess !== false,
    lastPasswordChangeAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }, { merge: true });
}

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  currentProfile = user?.uid ? await loadProfile(user.uid) : null;
  updateHeader();
});

elements.form?.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!currentUser?.email) {
    showMessage('Connectez-vous avec un compte admin avant de changer le mot de passe.', 'error');
    return;
  }

  const currentPassword = elements.currentPassword.value;
  const newPassword = elements.newPassword.value;
  const confirmPassword = elements.confirmPassword.value;

  if (!currentPassword || !newPassword || !confirmPassword) {
    showMessage('Tous les champs sont obligatoires.', 'error');
    return;
  }

  if (newPassword.length < 8) {
    showMessage('Le nouveau mot de passe doit contenir au moins 8 caracteres.', 'error');
    return;
  }

  if (newPassword !== confirmPassword) {
    showMessage('La confirmation du nouveau mot de passe ne correspond pas.', 'error');
    return;
  }

  try {
    const credential = EmailAuthProvider.credential(currentUser.email, currentPassword);
    await reauthenticateWithCredential(currentUser, credential);
    await updatePassword(currentUser, newPassword);
    await markPasswordChange();
    currentProfile = currentUser.uid ? await loadProfile(currentUser.uid) : currentProfile;
    updateHeader();
    elements.form.reset();
    showMessage('Mot de passe admin mis a jour avec succes.', 'success');
  } catch (error) {
    console.error('Erreur mise a jour mot de passe admin:', error);
    showMessage('Impossible de mettre a jour le mot de passe. Verifiez le mot de passe actuel.', 'error');
  }
});

elements.resetEmailBtn?.addEventListener('click', async () => {
  if (!currentUser?.email) {
    showMessage('Connectez-vous avec un compte admin avant d envoyer une reinitialisation.', 'error');
    return;
  }

  try {
    await sendPasswordResetEmail(auth, currentUser.email);
    showMessage('Email de reinitialisation envoye a l adresse admin connectee.', 'info');
  } catch (error) {
    console.error('Erreur reset email admin:', error);
    showMessage('Impossible d envoyer l email de reinitialisation pour le moment.', 'error');
  }
});
