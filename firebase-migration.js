import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocsFromServer,
  writeBatch,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

const SOURCE_CONFIG = {
  apiKey: 'AIzaSyANkKGDkA-t8Ijce4SNwqNcL8ArP9jPVqE',
  authDomain: 'allin-f65df.firebaseapp.com',
  projectId: 'allin-f65df',
  storageBucket: 'allin-f65df.firebasestorage.app',
  messagingSenderId: '955152530266',
  appId: '1:955152530266:web:19952842f4559b10af9163'
};

const DESTINATION_CONFIG = {
  apiKey: 'AIzaSyBVTWSRyv7mzVhXLj5NHmg_MKKyWYgeBXg',
  authDomain: 'smartcutservices-9ce54.firebaseapp.com',
  projectId: 'smartcutservices-9ce54',
  storageBucket: 'smartcutservices-9ce54.firebasestorage.app',
  messagingSenderId: '12148835666',
  appId: '1:12148835666:web:d18d80cedd5a36ec81e68b',
  measurementId: 'G-TXG8KQDBBG'
};

const PRESETS = [
  { path: 'products', label: 'Produits', description: 'Catalogue principal.' },
  { path: 'vendorProducts', label: 'Produits vendeurs', description: 'Produits marketplace approuves.' },
  { path: 'categories_list', label: 'Categories', description: 'Categories et lignes principales.' },
  { path: 'presentations', label: 'Actualites', description: 'Slides et contenus actualites.' },
  { path: 'announcementBar', label: 'Barre annonce', description: 'Messages d annonce du site.' },
  { path: 'veltrixaGallerySectionMatrix7721', label: 'Galerie', description: 'Blocs galerie accueil.' },
  { path: 'footerConfig', label: 'Footer config', description: 'Bloc principal du footer.' },
  { path: 'footerSocial', label: 'Footer social', description: 'Reseaux sociaux.' },
  { path: 'footerInfos', label: 'Footer infos', description: 'Blocs infos footer.' },
  { path: 'footerPayment', label: 'Footer paiements', description: 'Moyens de paiement.' },
  { path: 'printingSettings', label: 'Imprimerie', description: 'Options admin impression.' },
  { path: 'pdfConfig', label: 'PDF config', description: 'Configuration PDF / checkout.' },
  { path: 'vendorApplicationSettings', label: 'Formulaire vendeur', description: 'Configuration du formulaire vendeur.' },
  { path: 'headerConfig/sierraHeaderGlobal', label: 'Header principal', description: 'Document unique du header.' },
  { path: 'heroSectionControlMatrix9472/heroPrimaryBlock8391', label: 'Hero principal', description: 'Document hero de la home.' },
  { path: 'siteMusicConfig/main', label: 'Musique du site', description: 'Document principal musique.' }
];

const els = {
  adminEmail: document.getElementById('adminEmail'),
  adminPassword: document.getElementById('adminPassword'),
  signInBtn: document.getElementById('signInBtn'),
  signOutBtn: document.getElementById('signOutBtn'),
  authStatus: document.getElementById('authStatus'),
  presetList: document.getElementById('presetList'),
  customPaths: document.getElementById('customPaths'),
  selectAllBtn: document.getElementById('selectAllBtn'),
  clearAllBtn: document.getElementById('clearAllBtn'),
  runMigrationBtn: document.getElementById('runMigrationBtn'),
  runStatus: document.getElementById('runStatus'),
  logOutput: document.getElementById('logOutput')
};

const sourceApp = initializeApp(SOURCE_CONFIG, 'migration-source');
const destinationApp = initializeApp(DESTINATION_CONFIG, 'migration-destination');
const sourceDb = getFirestore(sourceApp);
const destinationDb = getFirestore(destinationApp);
const destinationAuth = getAuth(destinationApp);

let destinationProfile = null;
let isRunning = false;

renderPresets();
wireEvents();

onAuthStateChanged(destinationAuth, async (user) => {
  if (!user) {
    destinationProfile = null;
    updateAuthStatus('Non connecte', '');
    return;
  }

  try {
    const profileSnap = await getDoc(doc(destinationDb, 'clients', user.uid));
    destinationProfile = profileSnap.exists() ? profileSnap.data() : null;
    const isAdmin = destinationProfile?.role === 'admin' || destinationProfile?.dashboardAccess === true;

    if (!isAdmin) {
      destinationProfile = null;
      updateAuthStatus('Compte non admin', 'error');
      log(`Compte connecté mais non reconnu comme admin sur la destination: ${user.email}`);
      await signOut(destinationAuth);
      return;
    }

    updateAuthStatus(`Connecte: ${user.email}`, 'ok');
    log(`Admin destination connecté: ${user.email}`);
  } catch (error) {
    destinationProfile = null;
    updateAuthStatus('Erreur auth', 'error');
    log(`Erreur verification admin: ${error.message}`, true);
  }
});

function wireEvents() {
  els.signInBtn?.addEventListener('click', handleSignIn);
  els.signOutBtn?.addEventListener('click', async () => {
    await signOut(destinationAuth);
    log('Deconnexion effectuee.');
  });
  els.selectAllBtn?.addEventListener('click', () => {
    document.querySelectorAll('[data-preset-checkbox]').forEach((input) => {
      input.checked = true;
    });
  });
  els.clearAllBtn?.addEventListener('click', () => {
    document.querySelectorAll('[data-preset-checkbox]').forEach((input) => {
      input.checked = false;
    });
    els.customPaths.value = '';
  });
  els.runMigrationBtn?.addEventListener('click', runMigration);
}

function renderPresets() {
  els.presetList.innerHTML = PRESETS.map((preset, index) => `
    <label class="choice">
      <input type="checkbox" data-preset-checkbox value="${escapeHtml(preset.path)}" ${index < 10 ? 'checked' : ''}>
      <span>
        <strong>${escapeHtml(preset.label)}</strong>
        <span>${escapeHtml(preset.path)} · ${escapeHtml(preset.description)}</span>
      </span>
    </label>
  `).join('');
}

async function handleSignIn() {
  const email = els.adminEmail.value.trim();
  const password = els.adminPassword.value;

  if (!email || !password) {
    updateAuthStatus('Champs requis', 'error');
    log('Email admin et mot de passe requis.', true);
    return;
  }

  try {
    updateAuthStatus('Connexion...', '');
    await signInWithEmailAndPassword(destinationAuth, email, password);
  } catch (error) {
    updateAuthStatus('Echec connexion', 'error');
    log(`Connexion admin impossible: ${error.message}`, true);
  }
}

async function runMigration() {
  if (isRunning) return;

  const currentUser = destinationAuth.currentUser;
  if (!currentUser || !destinationProfile) {
    updateRunStatus('Connexion admin requise', 'error');
    log('Connectez-vous d abord avec un compte admin sur la destination.', true);
    return;
  }

  const paths = collectSelectedPaths();
  if (!paths.length) {
    updateRunStatus('Aucun chemin', 'error');
    log('Selectionnez au moins une collection ou un document.', true);
    return;
  }

  isRunning = true;
  setBusy(true);
  updateRunStatus('Migration en cours', '');
  log(`Demarrage migration. Source=${SOURCE_CONFIG.projectId} Destination=${DESTINATION_CONFIG.projectId}`);

  try {
    const failures = [];

    for (const path of paths) {
      const segments = normalizePath(path);
      if (!segments.length) continue;

      try {
        if (segments.length % 2 === 1) {
          await copyCollectionPath(segments);
        } else {
          await copyDocumentPath(segments);
        }
      } catch (error) {
        failures.push({ path: segments.join('/'), message: error.message });
        log(`Echec sur ${segments.join('/')}: ${error.message}`, true);
      }
    }

    await writeMigrationMarker(paths);

    if (failures.length) {
      updateRunStatus('Migration partielle', 'error');
      log(`Migration terminee avec ${failures.length} erreur(s).`, true);
    } else {
      updateRunStatus('Migration terminee', 'ok');
      log('Migration terminee avec succes.');
    }
  } catch (error) {
    updateRunStatus('Erreur migration', 'error');
    log(`Migration interrompue: ${error.message}`, true);
  } finally {
    setBusy(false);
    isRunning = false;
  }
}

function collectSelectedPaths() {
  const selected = new Set(
    Array.from(document.querySelectorAll('[data-preset-checkbox]:checked')).map((input) => input.value.trim()).filter(Boolean)
  );

  const custom = (els.customPaths.value || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  custom.forEach((path) => selected.add(path));
  return Array.from(selected);
}

function normalizePath(path) {
  return String(path || '')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
}

async function copyCollectionPath(segments) {
  const pathLabel = segments.join('/');
  log(`Lecture collection: ${pathLabel}`);

  const sourceSnap = await readCollectionFromSource(segments);
  const docs = sourceSnap.docs;

  if (!docs.length) {
    log(`Collection vide: ${pathLabel}`);
    return;
  }

  log(`Collection ${pathLabel}: ${docs.length} document(s) trouves.`);

  let written = 0;
  for (let i = 0; i < docs.length; i += 400) {
    const slice = docs.slice(i, i + 400);
    const batch = writeBatch(destinationDb);

    slice.forEach((snap) => {
      batch.set(doc(destinationDb, ...segments, snap.id), sanitizeData(snap.data()), { merge: true });
    });

    await batch.commit();
    written += slice.length;
    log(`Collection ${pathLabel}: ${written}/${docs.length} document(s) copies.`);
  }
}

async function copyDocumentPath(segments) {
  const pathLabel = segments.join('/');
  log(`Lecture document: ${pathLabel}`);

  const sourceSnap = await readDocumentFromSource(segments);
  if (!sourceSnap.exists()) {
    log(`Document absent dans la source: ${pathLabel}`);
    return;
  }

  const batch = writeBatch(destinationDb);
  batch.set(doc(destinationDb, ...segments), sanitizeData(sourceSnap.data()), { merge: true });
  await batch.commit();
  log(`Document copie: ${pathLabel}`);
}

async function readCollectionFromSource(segments) {
  const ref = collection(sourceDb, ...segments);
  try {
    return await getDocsFromServer(ref);
  } catch (error) {
    if (!looksOffline(error)) throw error;
    log(`Lecture serveur indisponible pour ${segments.join('/')}, nouvelle tentative dans 1s...`, true);
    await wait(1000);
    return await getDocsFromServer(ref);
  }
}

async function readDocumentFromSource(segments) {
  const ref = doc(sourceDb, ...segments);
  try {
    return await getDocFromServer(ref);
  } catch (error) {
    if (!looksOffline(error)) throw error;
    log(`Lecture serveur indisponible pour ${segments.join('/')}, nouvelle tentative dans 1s...`, true);
    await wait(1000);
    return await getDocFromServer(ref);
  }
}

async function writeMigrationMarker(paths) {
  const user = destinationAuth.currentUser;
  if (!user) return;

  const markerRef = doc(destinationDb, 'migrationLogs', `migration_${Date.now()}`);
  const batch = writeBatch(destinationDb);
  batch.set(markerRef, {
    sourceProjectId: SOURCE_CONFIG.projectId,
    destinationProjectId: DESTINATION_CONFIG.projectId,
    paths,
    triggeredByUid: user.uid,
    triggeredByEmail: user.email || '',
    createdAt: serverTimestamp()
  });
  await batch.commit();
  log('Journal migration ecrit dans migrationLogs.');
}

function sanitizeData(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeData(item));
  }

  if (value && typeof value === 'object') {
    const plain = {};
    Object.entries(value).forEach(([key, nested]) => {
      if (typeof nested === 'undefined') return;
      plain[key] = sanitizeData(nested);
    });
    return plain;
  }

  return value;
}

function looksOffline(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('offline') || message.includes('network') || error?.code === 'unavailable';
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function updateAuthStatus(text, tone) {
  els.authStatus.textContent = text;
  els.authStatus.className = `status${tone ? ` ${tone}` : ''}`;
}

function updateRunStatus(text, tone) {
  els.runStatus.textContent = text;
  els.runStatus.className = `status${tone ? ` ${tone}` : ''}`;
}

function setBusy(isBusyNow) {
  [els.signInBtn, els.signOutBtn, els.selectAllBtn, els.clearAllBtn, els.runMigrationBtn].forEach((button) => {
    if (button) button.disabled = isBusyNow;
  });
}

function log(message, isError = false) {
  const timestamp = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const line = `[${timestamp}] ${isError ? 'ERREUR' : 'INFO'}  ${message}`;
  els.logOutput.textContent = `${els.logOutput.textContent === 'Pret.' ? '' : `${els.logOutput.textContent}\n`}${line}`;
  els.logOutput.scrollTop = els.logOutput.scrollHeight;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
