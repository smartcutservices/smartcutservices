import { auth, db, storage, authReadyPromise } from './firebase-init.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js';
import { doc, getDoc, collection, query, where, orderBy, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import { ref, uploadBytes } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-storage.js';
import { getAuthManager } from './auth.js';

const FUNCTIONS_BASE = 'https://us-central1-smartcutservices-9ce54.cloudfunctions.net';
const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const appointmentId = new URLSearchParams(location.search).get('appointment') || '';
const dateText = (value) => (value ? new Date(value).toLocaleString('fr-HT', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : 'Horaire à confirmer');
const timeText = (value) => (value ? new Date(value).toLocaleTimeString('fr-HT', { hour: '2-digit', minute: '2-digit' }) : '');

async function callHealth(name, { method = 'GET', query: search, body } = {}) {
  const url = new URL(`${FUNCTIONS_BASE}/${name}`);
  Object.entries(search || {}).forEach(([key, value]) => value != null && value !== '' && url.searchParams.set(key, value));
  const headers = { 'Content-Type': 'application/json' };
  if (auth.currentUser) headers.Authorization = `Bearer ${await auth.currentUser.getIdToken()}`;
  const response = await fetch(url, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) throw new Error(payload.message || 'Une erreur est survenue.');
  return payload;
}

export default class HealthSession {
  constructor(rootId) {
    this.root = document.getElementById(rootId);
    this.timer = null;
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.messagesUnsub = null;
    this.messages = [];
    this.renderLoading();
    authReadyPromise.finally(() => onAuthStateChanged(auth, (user) => this.load(user)));
  }

  renderLoading() {
    this.root.innerHTML = '<div class="health-session"><div class="health-session__wrap"><div class="health-empty"><i class="fas fa-circle-notch fa-spin"></i>Préparation de votre espace privé…</div></div></div>';
  }

  async load(user) {
    this.user = user;
    if (!user) {
      this.root.innerHTML = '<div class="health-session"><div class="health-session__wrap"><div class="health-empty"><i class="fas fa-lock"></i><p>Connectez-vous pour accéder à votre séance.</p><button class="health-btn primary" id="health-session-login">Se connecter</button></div></div></div>';
      this.root.querySelector('#health-session-login')?.addEventListener('click', () => getAuthManager().openAuthModal('login'));
      return;
    }
    if (!appointmentId) { this.renderMissing('Aucun rendez-vous sélectionné.'); return; }
    try {
      const snap = await getDoc(doc(db, 'healthAppointments', appointmentId));
      if (!snap.exists()) { this.renderMissing('Ce rendez-vous est introuvable.'); return; }
      const item = { id: snap.id, ...snap.data() };
      if (item.patientUid !== user.uid && item.providerUid !== user.uid) { this.renderMissing('Vous n’êtes pas autorisé à ouvrir cette séance.'); return; }
      this.appointment = item;
      this.isProvider = user.uid === item.providerUid;
      this.renderSession();
    } catch (error) {
      this.renderMissing(error.message || 'Impossible d’ouvrir la séance.');
    }
  }

  renderMissing(message) {
    this.root.innerHTML = `<div class="health-session"><div class="health-session__wrap"><div class="health-empty"><i class="fas fa-calendar-xmark"></i>${esc(message)}<a class="health-btn health-btn-link primary" href="./health-espace.html">Retour à mon espace</a></div></div></div>`;
  }

  get item() { return this.appointment; }

  isSessionActive() { return ['DOCTOR_ACCEPTED', 'IN_PROGRESS'].includes(this.item.status); }

  renderSession() {
    const item = this.item;
    const active = this.isSessionActive();
    const startsAt = new Date(item.startsAt).getTime();
    const duration = Math.max(10, Number(item.consultationRights?.durationMinutes) || 10) * 60000;
    const endAt = startsAt + duration;
    const title = item.status === 'IN_PROGRESS' ? 'Téléconsultation en cours' : (active ? 'Votre médecin vous attend' : (item.status === 'COMPLETED' ? 'Séance terminée' : 'Salle d’attente'));
    const subtitle = active
      ? 'La séance est privée. Les informations partagées restent limitées aux participants autorisés.'
      : (item.status === 'COMPLETED' ? 'Vous pouvez toujours consulter les messages et ordonnances de cette séance.' : 'Votre rendez-vous est confirmé. Vous serez prêt lorsque le médecin ouvrira la séance.');
    const peerLabel = this.isProvider ? (item.patientName || 'Patient') : (item.providerName || 'Votre médecin');
    const peerSub = this.isProvider ? `${esc(item.patientAge ? `${item.patientAge} ans` : '')} ${esc(item.patientSex || '')}`.trim() || (item.specialtyName || 'Téléconsultation') : (item.specialtyName || 'Téléconsultation Smart Cut Health');
    const messagesReadable = ['DOCTOR_ACCEPTED', 'IN_PROGRESS', 'COMPLETED'].includes(item.status);

    this.root.innerHTML = `<div class="health-session"><div class="health-session__wrap">
      <header class="health-session__head"><a href="./health-espace.html"><i class="fas fa-arrow-left"></i> Mon espace</a><span class="health-badge"><i class="fas fa-lock"></i> Séance privée</span></header>
      <section class="health-session__card">
        <div class="health-session__main">
          <span class="health-eyebrow">${active ? 'Téléconsultation' : 'Salle d’attente'}</span>
          <h1>${esc(title)}</h1>
          <p>${esc(subtitle)}</p>
          <div class="health-session__doctor"><span><i class="fas ${this.isProvider ? 'fa-user' : 'fa-user-doctor'}"></i></span><div><strong>${esc(peerLabel)}</strong><small>${esc(peerSub)}</small></div></div>
          <div class="health-session__schedule"><i class="fas fa-calendar-check"></i><span>${esc(dateText(item.startsAt))}</span><strong id="health-session-clock">—</strong></div>

          ${messagesReadable ? `
          <section class="health-session__messaging" id="sessionMessaging">
            <div class="health-session__messaging-head"><strong><i class="fas fa-message"></i> Messagerie</strong><span>Supprimée automatiquement après 30 jours</span></div>
            <div class="health-session__messages" id="sessionMessages"><div class="health-empty"><i class="fas fa-circle-notch fa-spin"></i>Chargement…</div></div>
            ${active ? `
            <div class="health-session__composer">
              <div class="health-session__composer-limits" id="sessionMediaLimits"></div>
              <form id="sessionTextForm" class="health-session__text-row">
                <input type="text" id="sessionTextInput" placeholder="Écrire un message…" maxlength="2000" autocomplete="off">
                <button type="submit" aria-label="Envoyer"><i class="fas fa-paper-plane"></i></button>
              </form>
              <div class="health-session__composer-actions">
                <label class="health-session__attach" id="sessionPhotoLabel"><input type="file" accept="image/jpeg,image/png,image/webp" id="sessionPhotoInput" hidden><i class="fas fa-image"></i> Photo</label>
                <button type="button" id="sessionVoiceBtn"><i class="fas fa-microphone"></i> <span id="sessionVoiceLabel">Vocal</span></button>
              </div>
              <div class="health-status" id="sessionComposerStatus"></div>
            </div>` : '<p class="health-session__messaging-closed">La séance n’est plus active — vous pouvez encore consulter les messages ci-dessus.</p>'}
          </section>` : ''}
        </div>

        <aside class="health-session__side">
          <div class="health-session__timer">
            <span>${active ? 'Temps restant' : 'Début de la séance'}</span>
            <strong id="health-session-countdown">—</strong>
            <small>${active ? 'La séance est limitée à la durée prévue.' : 'Nous vous avertirons dès que le médecin sera présent.'}</small>
          </div>
          ${this.isProvider ? this.renderProviderActions() : ''}
        </aside>
      </section>
      <section class="health-session__notice"><i class="fas fa-shield-halved"></i><div><strong>Confidentialité médicale</strong><p>Les médias et messages de téléconsultation sont réservés à cette séance et supprimés automatiquement après 30 jours.</p></div></section>
    </div></div>
    <dialog class="health-dialog" id="sessionPrescribeDialog"><div class="health-dialog-head"><strong>Émettre une ordonnance</strong><button class="health-icon-btn" data-close-dialog="sessionPrescribeDialog" aria-label="Fermer"><i class="fas fa-times"></i></button></div><div class="health-dialog-body" id="sessionPrescribeBody"></div></dialog>
    <dialog class="health-dialog" id="sessionProposeDialog"><div class="health-dialog-head"><strong>Proposer un nouveau rendez-vous</strong><button class="health-icon-btn" data-close-dialog="sessionProposeDialog" aria-label="Fermer"><i class="fas fa-times"></i></button></div><div class="health-dialog-body"><form id="sessionProposeForm" class="health-form"><div class="health-field"><label for="sessionProposeNote">Message pour le patient</label><textarea id="sessionProposeNote" maxlength="300" placeholder="Ex. Reprenons contact la semaine prochaine pour le suivi."></textarea></div><button class="health-btn primary" type="submit">Envoyer la proposition</button><div class="health-status" id="sessionProposeStatus"></div></form></div></dialog>`;

    this.root.querySelectorAll('[data-close-dialog]').forEach((btn) => btn.addEventListener('click', () => this.root.querySelector(`#${btn.dataset.closeDialog}`)?.close()));

    const target = active ? endAt : startsAt;
    this.startClock(target, active);
    if (messagesReadable) this.bindMessaging(active);
    if (this.isProvider) this.bindProviderActions();
  }

  renderProviderActions() {
    const status = this.item.status;
    return `<div class="health-session__tools">
      ${status === 'DOCTOR_ACCEPTED' ? `
        <button type="button" data-provider-action="IN_PROGRESS"><i class="fas fa-play"></i> Démarrer la séance</button>
        <button type="button" data-provider-action="PATIENT_NO_SHOW"><i class="fas fa-user-slash"></i> Patient absent</button>` : ''}
      ${status === 'IN_PROGRESS' ? `<button type="button" data-provider-action="COMPLETED"><i class="fas fa-flag-checkered"></i> Terminer la séance</button>` : ''}
      ${['DOCTOR_ACCEPTED', 'IN_PROGRESS', 'COMPLETED'].includes(status) ? `
        <button type="button" data-open-dialog="sessionPrescribeDialog"><i class="fas fa-file-prescription"></i> Prescrire</button>
        <button type="button" data-open-dialog="sessionProposeDialog"><i class="fas fa-calendar-plus"></i> Proposer un rendez-vous</button>` : ''}
    </div>
    <div class="health-status" id="sessionProviderStatus"></div>`;
  }

  bindProviderActions() {
    this.root.querySelectorAll('[data-provider-action]').forEach((btn) => btn.addEventListener('click', () => this.updateConsultation(btn.dataset.providerAction)));
    this.root.querySelectorAll('[data-open-dialog]').forEach((btn) => btn.addEventListener('click', () => {
      if (btn.dataset.openDialog === 'sessionPrescribeDialog') this.renderPrescribeForm();
      this.root.querySelector(`#${btn.dataset.openDialog}`)?.showModal();
    }));
    this.root.querySelector('#sessionProposeForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const status = this.root.querySelector('#sessionProposeStatus');
      status.textContent = 'Envoi…';
      try {
        await callHealth('healthDoctorProposeFollowUp', { method: 'POST', body: { appointmentId, note: this.root.querySelector('#sessionProposeNote').value.trim() } });
        status.className = 'health-status success';
        status.textContent = 'Proposition envoyée au patient.';
        setTimeout(() => this.root.querySelector('#sessionProposeDialog')?.close(), 900);
      } catch (error) { status.className = 'health-status error'; status.textContent = error.message; }
    });
  }

  async updateConsultation(status) {
    const notice = this.root.querySelector('#sessionProviderStatus');
    if (status === 'PATIENT_NO_SHOW' && !confirm('Marquer ce patient absent ? Aucun remboursement ne sera émis, la séance se ferme définitivement.')) return;
    try {
      await callHealth('healthDoctorUpdateConsultation', { method: 'POST', body: { appointmentId, status } });
      const snap = await getDoc(doc(db, 'healthAppointments', appointmentId));
      this.appointment = { id: snap.id, ...snap.data() };
      this.renderSession();
    } catch (error) {
      if (notice) { notice.className = 'health-status error'; notice.textContent = error.message; }
    }
  }

  renderPrescribeForm() {
    const body = this.root.querySelector('#sessionPrescribeBody');
    body.innerHTML = `<form id="sessionPrescribeForm" class="health-form">
      <div class="health-notice"><i class="fas fa-circle-info"></i> Ajoutez au moins un médicament ou un examen. Cette ordonnance sera immédiatement visible par le patient.</div>
      <div><label class="health-field-label">Médicaments</label><div id="prescribeMeds"></div><button type="button" class="health-btn secondary" id="prescribeAddMed"><i class="fas fa-plus"></i> Ajouter un médicament</button></div>
      <div class="health-field"><label for="prescribeLabExams">Examens de laboratoire (un par ligne)</label><textarea id="prescribeLabExams" rows="2" placeholder="Ex. Numération formule sanguine"></textarea></div>
      <div class="health-field"><label for="prescribeImagingExams">Examens d’imagerie (un par ligne)</label><textarea id="prescribeImagingExams" rows="2" placeholder="Ex. Radiographie thoracique"></textarea></div>
      <div class="health-field"><label for="prescribeNotes">Notes complémentaires</label><textarea id="prescribeNotes" rows="2" maxlength="1000"></textarea></div>
      <button class="health-btn primary" type="submit">Émettre l’ordonnance</button>
      <div class="health-status" id="prescribeStatus"></div>
    </form>`;
    const medsBox = body.querySelector('#prescribeMeds');
    const addMedRow = () => {
      const row = document.createElement('div');
      row.className = 'health-session__med-row';
      row.innerHTML = `<input type="text" placeholder="Nom" data-med-name maxlength="180"><input type="text" placeholder="Dosage" data-med-dosage maxlength="120"><input type="text" placeholder="Posologie" data-med-instructions maxlength="300"><button type="button" class="health-icon-btn" aria-label="Retirer"><i class="fas fa-xmark"></i></button>`;
      row.querySelector('button').addEventListener('click', () => row.remove());
      medsBox.appendChild(row);
    };
    addMedRow();
    body.querySelector('#prescribeAddMed').addEventListener('click', addMedRow);
    body.querySelector('#sessionPrescribeForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const status = body.querySelector('#prescribeStatus');
      status.textContent = 'Envoi…';
      const medications = [...medsBox.querySelectorAll('.health-session__med-row')].map((row) => ({
        name: row.querySelector('[data-med-name]').value.trim(),
        dosage: row.querySelector('[data-med-dosage]').value.trim(),
        instructions: row.querySelector('[data-med-instructions]').value.trim()
      })).filter((m) => m.name);
      const labExams = body.querySelector('#prescribeLabExams').value.split('\n').map((l) => l.trim()).filter(Boolean);
      const imagingExams = body.querySelector('#prescribeImagingExams').value.split('\n').map((l) => l.trim()).filter(Boolean);
      try {
        await callHealth('healthDoctorIssuePrescription', { method: 'POST', body: { appointmentId, medications, labExams, imagingExams, notes: body.querySelector('#prescribeNotes').value.trim() } });
        status.className = 'health-status success';
        status.textContent = 'Ordonnance envoyée au patient.';
        setTimeout(() => this.root.querySelector('#sessionPrescribeDialog')?.close(), 900);
      } catch (error) { status.className = 'health-status error'; status.textContent = error.message; }
    });
  }

  // ---------- Messaging ----------

  bindMessaging(active) {
    const list = collection(db, 'healthMessages');
    const q = query(list, where('appointmentId', '==', appointmentId), orderBy('createdAt', 'asc'));
    this.messagesUnsub = onSnapshot(q, (snap) => {
      this.messages = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      this.renderMessages();
    }, () => {
      const box = this.root.querySelector('#sessionMessages');
      if (box) box.innerHTML = '<div class="health-empty"><i class="fas fa-triangle-exclamation"></i>Messagerie indisponible.</div>';
    });
    if (!active) return;

    this.root.querySelector('#sessionTextForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = this.root.querySelector('#sessionTextInput');
      const text = input.value.trim();
      if (!text) return;
      input.disabled = true;
      try {
        await callHealth('healthSendSessionMessage', { method: 'POST', body: { appointmentId, text } });
        input.value = '';
      } catch (error) {
        this.setComposerStatus(error.message, true);
      } finally { input.disabled = false; input.focus(); }
    });

    this.root.querySelector('#sessionPhotoInput')?.addEventListener('change', async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      await this.sendMedia(file, 'photo');
      event.target.value = '';
    });

    this.root.querySelector('#sessionVoiceBtn')?.addEventListener('click', () => this.toggleVoiceRecording());
  }

  setComposerStatus(message, isError) {
    const el = this.root.querySelector('#sessionComposerStatus');
    if (!el) return;
    el.className = `health-status ${isError ? 'error' : ''}`;
    el.textContent = message || '';
  }

  renderMessages() {
    const box = this.root.querySelector('#sessionMessages');
    if (!box) return;
    if (!this.messages.length) {
      box.innerHTML = '<div class="health-empty"><i class="fas fa-message"></i>Aucun message pour le moment.</div>';
    } else {
      const wasNearBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 40;
      box.innerHTML = this.messages.map((m) => this.renderMessageBubble(m)).join('');
      box.querySelectorAll('[data-view-media]').forEach((btn) => btn.addEventListener('click', () => this.openMedia(btn.dataset.viewMedia)));
      if (wasNearBottom || box.dataset.first !== '1') { box.scrollTop = box.scrollHeight; box.dataset.first = '1'; }
    }
    this.renderMediaLimits();
  }

  renderMessageBubble(message) {
    const mine = message.senderUid === this.user.uid;
    const time = message.createdAt ? timeText(message.createdAt) : '';
    let content = '';
    if (message.kind === 'text') content = `<p>${esc(message.text)}</p>`;
    else if (message.kind === 'photo') content = `<button type="button" class="health-session__media-btn" data-view-media="${message.id}"><i class="fas fa-image"></i> Photo</button>`;
    else content = `<button type="button" class="health-session__media-btn" data-view-media="${message.id}"><i class="fas fa-microphone"></i> Message vocal</button>`;
    return `<div class="health-session__bubble ${mine ? 'is-mine' : ''}">${content}<time>${esc(time)}</time></div>`;
  }

  renderMediaLimits() {
    const box = this.root.querySelector('#sessionMediaLimits');
    if (!box) return;
    const limits = this.item.consultationRights || { maxPhotos: 1, maxVoiceMessages: 1 };
    const mine = this.messages.filter((m) => m.senderUid === this.user.uid);
    const photosUsed = mine.filter((m) => m.kind === 'photo').length;
    const voiceUsed = mine.filter((m) => m.kind === 'voice').length;
    if (this.isProvider) { box.innerHTML = ''; return; }
    box.innerHTML = `<span><i class="fas fa-image"></i> ${photosUsed}/${limits.maxPhotos} photos</span><span><i class="fas fa-microphone"></i> ${voiceUsed}/${limits.maxVoiceMessages} vocaux</span>`;
    const photoLabel = this.root.querySelector('#sessionPhotoLabel');
    const voiceBtn = this.root.querySelector('#sessionVoiceBtn');
    if (photoLabel) photoLabel.classList.toggle('is-disabled', photosUsed >= limits.maxPhotos);
    if (voiceBtn) voiceBtn.disabled = voiceUsed >= limits.maxVoiceMessages && !this.mediaRecorder;
  }

  async openMedia(messageId) {
    try {
      const out = await callHealth('healthGetSessionMediaUrl', { query: { messageId } });
      window.open(out.url, '_blank', 'noopener,noreferrer');
    } catch (error) { this.setComposerStatus(error.message, true); }
  }

  async sendMedia(fileOrBlob, kind) {
    this.setComposerStatus(kind === 'photo' ? 'Envoi de la photo…' : 'Envoi du message vocal…', false);
    try {
      const extension = kind === 'photo' ? (fileOrBlob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg') : 'webm';
      const path = `health-session-media/${this.item.patientUid}__${appointmentId}/${kind}-${Date.now()}.${extension}`;
      await uploadBytes(ref(storage, path), fileOrBlob, { contentType: fileOrBlob.type, cacheControl: 'private,no-store,max-age=0' });
      await callHealth('healthConfirmSessionMedia', { method: 'POST', body: { appointmentId, kind, storagePath: path } });
      this.setComposerStatus('', false);
    } catch (error) {
      this.setComposerStatus(error.message, true);
    }
  }

  async toggleVoiceRecording() {
    const button = this.root.querySelector('#sessionVoiceBtn');
    const label = this.root.querySelector('#sessionVoiceLabel');
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.recordedChunks = [];
      this.mediaRecorder = new MediaRecorder(stream);
      this.mediaRecorder.ondataavailable = (event) => { if (event.data.size > 0) this.recordedChunks.push(event.data); };
      this.mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        button.classList.remove('is-recording');
        label.textContent = 'Vocal';
        const blob = new Blob(this.recordedChunks, { type: 'audio/webm' });
        if (blob.size > 0) await this.sendMedia(blob, 'voice');
      };
      this.mediaRecorder.start();
      button.classList.add('is-recording');
      label.textContent = 'Arrêter';
    } catch (error) {
      this.setComposerStatus('Micro indisponible : ' + (error.message || 'accès refusé.'), true);
    }
  }

  startClock(target, active) {
    const paint = () => {
      const diff = Math.max(0, target - Date.now());
      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      const value = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      const counter = this.root.querySelector('#health-session-countdown');
      const clock = this.root.querySelector('#health-session-clock');
      if (counter) counter.textContent = value;
      if (clock) clock.textContent = active ? `${value} restantes` : (diff ? 'À venir' : 'Prêt à démarrer');
      if (diff === 0 && this.timer) clearInterval(this.timer);
    };
    paint();
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(paint, 1000);
  }
}
