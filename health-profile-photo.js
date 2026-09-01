// Widget réutilisable : photo de profil professionnelle. Monté à la fois dans
// l'assistant « Devenir prestataire » et dans l'onglet Profil de chaque dashboard
// vérifié (médecin, pharmacie, laboratoire, imagerie) — une seule photo, éditable à
// tout moment, avant ou après vérification (contrairement aux pièces justificatives,
// jamais remplaçables une fois déposées).
//
// Entièrement en styles inline plutôt que sur des classes health-* : les dashboards
// Smart Cut Health n'utilisent pas tous la même feuille de styles (health-doctor.html
// a la sienne, séparée de health.css utilisé par les autres), ce widget doit donc
// rester correct visuellement quelle que soit la page qui le monte.
import { auth, storage } from './firebase-init.js';
import { ref, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-storage.js';

const FUNCTIONS_BASE = 'https://us-central1-smartcutservices-9ce54.cloudfunctions.net';
const MAX_BYTES = 4 * 1024 * 1024;

/**
 * @param {string} containerId - id d'un élément vide où monter le widget.
 * @param {'doctor'|'pharmacy'|'laboratory'|'imaging'} type
 * @param {string|null} currentPhotoUrl - URL déjà résolue (optionnel, sinon affiche l'icône par défaut jusqu'au premier envoi).
 */
export default async function mountProfilePhotoUploader(containerId, type, currentPhotoUrl = null) {
  const root = document.getElementById(containerId);
  if (!root) return;
  const uid = auth.currentUser?.uid;
  if (!uid) { root.innerHTML = ''; return; }

  const paint = (photoUrl, status = '', statusColor = '#5f7d77') => {
    root.innerHTML = `
      <div style="display:flex;align-items:center;gap:1rem;">
        <span style="width:72px;height:72px;flex:0 0 auto;display:grid;place-items:center;overflow:hidden;border-radius:50%;border:1px solid #dbe6e2;background:#eaf6f2;color:#0f6958;font-size:1.6rem;">${photoUrl ? `<img src="${photoUrl}" alt="" style="width:100%;height:100%;object-fit:cover;">` : '<i class="fas fa-user" aria-hidden="true"></i>'}</span>
        <div style="display:grid;gap:.4rem;">
          <label for="profilePhotoInput" style="cursor:pointer;display:inline-flex;align-items:center;gap:.4rem;width:fit-content;padding:.5rem .85rem;border:1px solid #bdd4ce;border-radius:8px;background:#fff;color:#12302d;font-weight:600;font-size:.86rem;">
            <i class="fas fa-camera" aria-hidden="true"></i> ${photoUrl ? 'Changer la photo' : 'Ajouter une photo'}
          </label>
          <input id="profilePhotoInput" type="file" accept="image/jpeg,image/png,image/webp" style="display:none;">
          <small style="color:#7c9a94;font-size:.76rem;">Visible par les patients (annuaire, en-tête). Image, 4 Mo maximum.</small>
          <div id="profilePhotoStatus" style="font-size:.8rem;color:${statusColor};min-height:1em;">${status}</div>
        </div>
      </div>`;
    root.querySelector('#profilePhotoInput')?.addEventListener('change', onPick);
  };

  const onPick = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { paint(currentPhotoUrl, 'Choisissez une image (JPEG, PNG ou WebP).', '#a33a32'); return; }
    if (file.size > MAX_BYTES) { paint(currentPhotoUrl, 'Image trop lourde (4 Mo maximum).', '#a33a32'); return; }
    paint(currentPhotoUrl, 'Envoi en cours…');
    try {
      const storagePath = `health-profile-photos/${uid}/photo`;
      await uploadBytes(ref(storage, storagePath), file, { contentType: file.type });
      const token = await auth.currentUser.getIdToken();
      const response = await fetch(`${FUNCTIONS_BASE}/healthUpdateProfilePhoto`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.message || 'Envoi impossible.');
      currentPhotoUrl = await getDownloadURL(ref(storage, storagePath));
      paint(currentPhotoUrl, 'Photo mise à jour.', '#0d7665');
    } catch (error) {
      paint(currentPhotoUrl, error.message, '#a33a32');
    }
  };

  paint(currentPhotoUrl);
}
