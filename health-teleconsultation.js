import { auth, authReadyPromise } from './firebase-init.js';
import { getAuthManager } from './auth.js';

const FUNCTIONS_BASE = 'https://us-central1-smartcutservices-9ce54.cloudfunctions.net';
const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c]));
const money = (value) => `${new Intl.NumberFormat('fr-HT', { maximumFractionDigits: 0 }).format(Number(value) || 0)} HTG`;

async function callHealth(name, { method = 'GET', query, body, authRequired = false } = {}) {
  const url = new URL(`${FUNCTIONS_BASE}/${name}`);
  Object.entries(query || {}).forEach(([key, value]) => value != null && value !== '' && url.searchParams.set(key, value));
  const headers = { 'Content-Type':'application/json' };
  if (auth.currentUser) headers.Authorization = `Bearer ${await auth.currentUser.getIdToken()}`;
  else if (authRequired) throw new Error('Connectez-vous pour continuer.');
  const response = await fetch(url, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) throw new Error(payload.message || 'Une erreur est survenue.');
  return payload;
}

export default class HealthTeleconsultation {
  constructor(rootId) {
    this.root = document.getElementById(rootId);
    this.catalog = null;
    this.specialtyCode = '';
    this.planCode = 'essential';
    this.doctor = null;
    this.slot = null;
    this.renderShell();
    authReadyPromise.finally(() => this.load());
  }

  renderShell() {
    this.root.innerHTML = `<div class="health-shell telehealth-shell">
      <section class="health-page-hero telehealth-hero"><div class="health-wrap">
        <span class="health-eyebrow"><i class="fas fa-video"></i> Téléconsultation</span>
        <h1>Un médecin vérifié, au bon format.</h1>
        <p>Choisissez votre spécialité. Les prix, limites et droits du plan sont appliqués automatiquement par la plateforme.</p>
      </div></section>
      <main class="health-route-main"><div class="health-wrap">
        <aside class="health-emergency"><i class="fas fa-triangle-exclamation"></i><div><strong>Ce service ne traite pas les urgences.</strong><span>En présence de symptômes graves ou d’une détresse, recherchez immédiatement une prise en charge d’urgence.</span></div></aside>
        <section class="telehealth-picker"><label for="telehealth-specialty">Spécialité médicale</label><select id="telehealth-specialty"><option value="">Chargement…</option></select></section>
        <section id="telehealth-plans" class="telehealth-plans"></section>
        <section class="telehealth-doctors"><div class="health-subheading"><div><span>Professionnels contrôlés</span><h2>Choisissez votre médecin</h2></div></div><div id="telehealth-doctors" class="health-grid"><div class="health-empty">Sélectionnez d’abord une spécialité.</div></div></section>
      </div></main>
      <dialog class="health-dialog telehealth-dialog" id="telehealth-book-dialog"><div class="health-dialog-head"><strong>Réserver la consultation</strong><button class="health-icon-btn" data-close aria-label="Fermer"><i class="fas fa-times"></i></button></div><div class="health-dialog-body" id="telehealth-book-content"></div></dialog>
      <div class="health-disclaimer"><div class="health-wrap"><strong>Confidentialité.</strong> L’accès à la consultation, aux médias et aux documents est limité au patient et au professionnel affecté.</div></div>
    </div>`;
    this.root.querySelector('[data-close]')?.addEventListener('click', () => this.root.querySelector('#telehealth-book-dialog')?.close());
  }

  async load() {
    try {
      this.catalog = await callHealth('healthGetConsultationCatalog');
      const select = this.root.querySelector('#telehealth-specialty');
      select.innerHTML = '<option value="">Choisir une spécialité</option>' + this.catalog.specialties.map((item) => `<option value="${esc(item.code)}">${esc(item.name)}</option>`).join('');
      select.addEventListener('change', () => { this.specialtyCode = select.value; this.renderPlans(); this.loadDoctors(); });
      const requested = new URLSearchParams(location.search).get('specialty');
      if (requested && this.catalog.specialties.some((item) => item.code === requested)) { select.value = requested; select.dispatchEvent(new Event('change')); }
      else this.renderPlans();
    } catch (error) {
      this.root.querySelector('#telehealth-plans').innerHTML = `<div class="health-empty"><i class="fas fa-triangle-exclamation"></i>${esc(error.message)}</div>`;
    }
  }

  get specialty() { return this.catalog?.specialties.find((item) => item.code === this.specialtyCode); }
  get plan() { return this.catalog?.plans.find((item) => item.code === this.planCode); }

  renderPlans() {
    const root = this.root.querySelector('#telehealth-plans');
    if (!this.specialty) { root.innerHTML = '<div class="telehealth-intro"><strong>Deux formats simples.</strong><span>Les tarifs apparaissent après le choix d’une spécialité.</span></div>'; return; }
    root.innerHTML = this.catalog.plans.map((plan) => `<article class="telehealth-plan ${this.planCode === plan.code ? 'is-selected' : ''}" data-plan="${esc(plan.code)}">
      <div class="telehealth-plan__top"><div><span>${plan.durationMinutes} minutes</span><h2>${esc(plan.name)}</h2></div><span class="telehealth-plan__check"><i class="fas fa-check"></i></span></div>
      <div class="telehealth-plan__price">${money(this.specialty.prices[plan.code])}</div>
      <ul><li>Chat texte pendant la séance</li><li>${plan.maxPhotos} photo${plan.maxPhotos > 1 ? 's' : ''} maximum</li><li>${plan.maxVoiceMessages} message${plan.maxVoiceMessages > 1 ? 's' : ''} vocal${plan.maxVoiceMessages > 1 ? 'aux' : ''}</li><li>${plan.prescriptionEnabled ? 'Prescription si médicalement appropriée' : 'Sans prescription dans ce format'}</li><li>${plan.labOrderEnabled ? 'Demande d’examens possible' : 'Sans demande d’examens'}</li></ul>
      <button type="button">Choisir ce plan</button>
    </article>`).join('');
    root.querySelectorAll('[data-plan]').forEach((card) => card.addEventListener('click', () => { this.planCode = card.dataset.plan; this.renderPlans(); }));
  }

  async loadDoctors() {
    const root = this.root.querySelector('#telehealth-doctors');
    if (!this.specialty) { root.innerHTML = '<div class="health-empty">Sélectionnez d’abord une spécialité.</div>'; return; }
    root.innerHTML = '<div class="health-empty"><i class="fas fa-circle-notch fa-spin"></i>Recherche des médecins disponibles…</div>';
    try {
      let payload = await callHealth('healthListDoctors', { query:{ specialty:this.specialty.name } });
      if (!payload.doctors?.length) payload = await callHealth('healthListDoctors');
      root.innerHTML = payload.doctors?.length ? payload.doctors.map((doctor) => `<article class="health-card telehealth-doctor"><span class="health-badge"><i class="fas fa-circle-check"></i> Vérifié</span><h3>${esc(doctor.name)}</h3><p><strong>${esc(doctor.specialty || this.specialty.name)}</strong></p><p>${esc([doctor.facility, doctor.commune].filter(Boolean).join(' · '))}</p><button class="health-btn primary" data-doctor="${esc(doctor.id)}">Voir les créneaux</button></article>`).join('') : '<div class="health-empty"><i class="fas fa-user-doctor"></i>Aucun médecin publié pour cette spécialité actuellement.</div>';
      root.querySelectorAll('[data-doctor]').forEach((button) => button.addEventListener('click', () => this.openDoctor(payload.doctors.find((item) => item.id === button.dataset.doctor))));
    } catch (error) { root.innerHTML = `<div class="health-empty">${esc(error.message)}</div>`; }
  }

  async openDoctor(doctor) {
    this.doctor = doctor; this.slot = null;
    const dialog = this.root.querySelector('#telehealth-book-dialog');
    const content = this.root.querySelector('#telehealth-book-content');
    content.innerHTML = '<div class="health-empty"><i class="fas fa-circle-notch fa-spin"></i>Chargement des créneaux…</div>';
    dialog.showModal();
    try {
      const payload = await callHealth('healthListAvailability', { query:{ providerUid:doctor.id } });
      const summary = `<div class="telehealth-summary"><span>${esc(this.specialty.name)}</span><strong>${esc(this.plan.name)} · ${money(this.specialty.prices[this.planCode])}</strong><small>${this.plan.durationMinutes} min · ${this.plan.maxPhotos} photo(s) · ${this.plan.maxVoiceMessages} vocal(aux)</small></div>`;
      content.innerHTML = `${summary}<form id="telehealth-book-form" class="health-form"><div class="health-field"><label>Créneau disponible</label><div class="telehealth-slots">${payload.slots?.length ? payload.slots.map((slot) => `<label><input type="radio" name="slotId" value="${esc(slot.id)}" required><span>${esc(new Date(slot.startsAt).toLocaleString('fr-HT', { weekday:'short', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }))}</span></label>`).join('') : '<div class="health-empty">Aucun créneau disponible.</div>'}</div></div><div class="health-field"><label for="telehealth-reason">Motif en quelques mots</label><textarea id="telehealth-reason" name="reason" maxlength="500" required placeholder="Décrivez brièvement votre besoin, sans urgence médicale."></textarea></div>${payload.slots?.length ? '<button class="health-btn primary" type="submit">Continuer vers le paiement</button>' : ''}<div class="health-status" id="telehealth-status"></div></form>`;
      content.querySelector('form')?.addEventListener('submit', (event) => this.book(event));
    } catch (error) { content.innerHTML = `<div class="health-empty">${esc(error.message)}</div>`; }
  }

  async book(event) {
    event.preventDefault();
    const status = this.root.querySelector('#telehealth-status');
    if (!auth.currentUser) { getAuthManager().openAuthModal('login'); status.className = 'health-status error'; status.textContent = 'Connectez-vous puis relancez la réservation.'; return; }
    const button = event.target.querySelector('button[type="submit"]');
    button.disabled = true; status.className = 'health-status'; status.textContent = 'Réservation sécurisée du créneau…';
    try {
      const form = new FormData(event.target);
      const appointment = await callHealth('healthBookAppointment', { method:'POST', authRequired:true, body:{ slotId:form.get('slotId'), reason:form.get('reason'), specialtyCode:this.specialtyCode, planCode:this.planCode } });
      const payment = await callHealth('healthCreateAppointmentPayment', { method:'POST', authRequired:true, body:{ appointmentId:appointment.appointmentId } });
      localStorage.setItem('smartcut_health_payment', JSON.stringify({ sessionId:payment.sessionId, orderId:payment.orderId, amount:payment.total }));
      location.assign(payment.checkoutUrl);
    } catch (error) { button.disabled = false; status.className = 'health-status error'; status.textContent = error.message; }
  }
}
