import { auth, db, storage, authReadyPromise } from './firebase-init.js';
import { getAuthManager } from './auth.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js';
import { collection, query, where, getDocs, getDoc, doc, limit, orderBy } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import { ref, uploadBytes } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-storage.js';

const FUNCTIONS_BASE = 'https://us-central1-smartcutservices-9ce54.cloudfunctions.net';
const HTG = new Intl.NumberFormat('fr-HT', { style: 'currency', currency: 'HTG', maximumFractionDigits: 0 });
const STATUS_LABELS = { RECEIVED:'Ordonnance reçue',UNDER_REVIEW:'En vérification',VALIDATED:'Vérifiée',PRICE_CONFIRMED:'Prix confirmé',PAYMENT_PENDING:'Paiement en attente',PAID:'Payée',PREPARING:'En préparation',READY:'Prête',DELIVERING:'En livraison',DELIVERED:'Livrée',NEEDS_CLARIFICATION:'Précision demandée',REJECTED:'Non traitée',CANCELLED:'Annulée',CONFIRMED:'Confirmé',COMPLETED:'Terminé',NO_SHOW:'Absence',RESCHEDULE_REQUESTED:'Report demandé' };

const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c]));
const money = (value) => HTG.format(Number(value) || 0);
const statusLabel = (value) => STATUS_LABELS[value] || String(value || 'En attente').replaceAll('_', ' ').toLowerCase();

async function callHealth(name, { method = 'GET', query: search, body, requireAuth = false } = {}) {
  const url = new URL(`${FUNCTIONS_BASE}/${name}`);
  Object.entries(search || {}).forEach(([key, value]) => value !== '' && value != null && url.searchParams.set(key, value));
  const headers = { 'Content-Type': 'application/json' };
  if (auth.currentUser) headers.Authorization = `Bearer ${await auth.currentUser.getIdToken()}`;
  else if (requireAuth) throw new Error('Connectez-vous pour continuer.');
  let response;
  try { response = await fetch(url, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body || {}) }); }
  catch (_) { throw new Error('Impossible de contacter Smart Cut Health. Vérifiez votre connexion.'); }
  let payload = null;
  try { payload = await response.json(); } catch (_) {}
  if (!response.ok || !payload?.ok) throw new Error(payload?.message || 'Une erreur est survenue.');
  return payload;
}

class SmartCutHealth {
  constructor(rootId, options = {}) {
    this.root = document.getElementById(rootId);
    this.view = options.view || document.body.dataset.healthView || 'home';
    this.user = null;
    this.profile = null;
    this.cart = [];
    this.cartPharmacyId = '';
    this.searchResults = [];
    this.render();
    this.bind();
    authReadyPromise.finally(() => onAuthStateChanged(auth, (user) => this.onAuth(user)));
    if (['home', 'pharmacy', 'doctors', 'labs'].includes(this.view)) this.loadDirectory();
  }

  render() {
    if (this.view !== 'home') {
      this.renderStandalone();
      return;
    }
    this.root.innerHTML = `<div class="health-shell">
      <section class="health-hero"><div class="health-wrap health-hero-layout"><div class="health-hero-copy">
        <h1>Votre santé, plus accessible.</h1>
        <p>Pharmacies, ordonnances et consultations vérifiées. <span class="health-privacy-inline"><i class="fas fa-lock"></i> Données privées et protégées.</span></p>
        <div class="health-hero-actions"><a class="health-btn health-btn-link primary" href="./health-teleconsultation.html">Consulter un médecin</a><a class="health-btn health-btn-link health-btn-ghost" href="./health-pharmacie.html">Trouver un médicament</a><a class="health-btn health-btn-link health-btn-ghost" href="./health-ordonnance.html">Envoyer une ordonnance</a></div>
      </div><div class="health-hero-visual health-art-home"><img src="./assets/health/home-health-visual-v2.png" alt="Espace santé sécurisé" loading="eager"></div></div></section>
      <main class="health-home-directory"><div class="health-wrap">
        <div class="health-subheading"><div><span>Pharmacies partenaires</span><h2>Médicaments disponibles</h2></div><a href="./health-pharmacie.html">Voir la pharmacie <i class="fas fa-arrow-right"></i></a></div>
        <div id="health-home-medicines" class="health-grid"><div class="health-empty"><i class="fas fa-circle-notch fa-spin"></i>Chargement des médicaments…</div></div>
        <div class="health-subheading health-subheading--spaced"><div><span>Professionnels vérifiés</span><h2>Médecins disponibles</h2></div><a href="./health-medecins.html">Voir les médecins <i class="fas fa-arrow-right"></i></a></div>
        <div id="health-home-doctors" class="health-grid"><div class="health-empty"><i class="fas fa-circle-notch fa-spin"></i>Chargement des médecins…</div></div>
      </div></main>
    </div>`;
  }

  renderStandalone() {
    const views = {
      pharmacy: { icon:'fa-prescription-bottle-medical', art:'pharmacy', heroImage:'./assets/health/heroes/pharmacy-hero-v1.png', eyebrow:'Pharmacie', title:'Vos soins, simplement.', copy:'Médicaments vérifiés, près de vous.' },
      prescription: { icon:'fa-file-shield', art:'prescription', heroImage:'./assets/health/heroes/prescription-hero-v1.png', eyebrow:'Ordonnance privée', title:'Votre ordonnance, protégée.', copy:'Transmettez-la en quelques secondes.' },
      doctors: { icon:'fa-user-doctor', art:'doctor', heroImage:'./assets/health/heroes/doctor-hero-v1.png', eyebrow:'Médecins', title:'Un médecin, quand vous en avez besoin.', copy:'Choisissez une spécialité et un créneau.' },
      labs: { icon:'fa-flask-vial', art:'lab', heroImage:'./assets/health/heroes/lab-hero-v1.png', eyebrow:'Laboratoires', title:'Vos examens, en confiance.', copy:'Trouvez un laboratoire vérifié.' },
      space: { icon:'fa-heart-pulse', art:'space', eyebrow:'Espace personnel', title:'Tout votre parcours santé.', copy:'Vos documents et rendez-vous au même endroit.' },
      professional: { icon:'fa-user-shield', art:'professional', heroImage:'./assets/health/heroes/professional-hero-v1.png', eyebrow:'Espace professionnel', title:'Votre activité santé, structurée.', copy:'Un espace sécurisé pour vos opérations.' }
    };
    const page = views[this.view] || views.space;

    if (this.view === 'space') {
      this.root.innerHTML = `<div class="health-dashboard">
        <aside class="health-dashboard__aside" aria-label="Navigation de votre espace santé">
          <div class="health-dashboard__brand"><span class="health-dashboard__brand-mark"><i class="fas fa-heart-pulse"></i></span><div><strong>Smart Cut Health</strong><small>Espace personnel</small></div></div>
          <nav class="health-dashboard__nav">
            <button type="button" class="is-active" data-space-nav="overview"><i class="fas fa-grid-2"></i> Vue d’ensemble</button>
            <button type="button" data-space-nav="appointments"><i class="fas fa-calendar-check"></i> Rendez-vous</button>
            <button type="button" data-space-nav="rx"><i class="fas fa-file-prescription"></i> Ordonnances</button>
            <button type="button" data-space-nav="orders"><i class="fas fa-pills"></i> Commandes pharmacie</button>
            <button type="button" data-space-nav="results"><i class="fas fa-flask"></i> Résultats</button>
          </nav>
          <div class="health-dashboard__aside-bottom"><a href="./health-doctors.html"><i class="fas fa-user-doctor"></i> Trouver un médecin</a><a href="./health-pharmacie.html"><i class="fas fa-prescription-bottle-medical"></i> Trouver une pharmacie</a></div>
        </aside>
        <section class="health-dashboard__main">
          <header class="health-dashboard__header"><div><span class="health-eyebrow">Espace personnel</span><h1>Bonjour, <strong id="health-dashboard-name">vous</strong></h1><p>Votre suivi santé, au même endroit.</p></div><button class="health-btn health-btn-ghost" id="health-dashboard-refresh" type="button"><i class="fas fa-rotate-right"></i> Actualiser</button></header>
          <div class="health-dashboard__quick-actions"><a href="./health-teleconsultation.html"><i class="fas fa-video"></i><span>Consulter un médecin</span><i class="fas fa-arrow-right"></i></a><a href="./health-ordonnance.html"><i class="fas fa-file-shield"></i><span>Envoyer une ordonnance</span><i class="fas fa-arrow-right"></i></a><a href="./health-pharmacie.html"><i class="fas fa-capsules"></i><span>Trouver un médicament</span><i class="fas fa-arrow-right"></i></a></div>
          <div class="health-dashboard__metrics"><article><span>Rendez-vous à venir</span><strong id="health-metric-appointments">—</strong></article><article><span>Ordonnances</span><strong id="health-metric-rx">—</strong></article><article><span>Commandes</span><strong id="health-metric-orders">—</strong></article><article><span>Résultats disponibles</span><strong id="health-metric-results">—</strong></article></div>
          <div id="health-space-auth"><div class="health-empty"><i class="fas fa-lock"></i>Connectez-vous pour consulter vos informations de santé.</div></div>
        </section>
      </div>${this.renderUtilityDialogs()}`;
      return;
    }

    if (this.view === 'pharmacy') {
      this.root.innerHTML = `<div class="health-shell health-route health-route--pharmacy health-pharmacy">
        <section class="pharmacy-head">
          <div class="health-wrap pharmacy-head__inner">
              <div class="pharmacy-head__intro">
              <span class="health-eyebrow"><i class="fas fa-prescription-bottle-medical"></i> Pharmacie en ligne</span>
              <h1>Vos médicaments, vérifiés et près de vous.</h1>
              </div>
            <div class="pharmacy-head__visual"><img src="./assets/health/heroes/pharmacy-hero-v1.png" alt="Pharmacien préparant une commande" loading="eager"></div>
            <a class="pharmacy-head__cta" href="./health-ordonnance.html"><i class="fas fa-file-shield"></i> J’ai une ordonnance</a>
          </div>
          <div class="health-wrap">
            <form class="health-search pharmacy-search" id="health-search-form" role="search">
              <i class="fas fa-magnifying-glass"></i>
              <input id="health-search-input" type="search" minlength="2" placeholder="Rechercher un médicament ou un principe actif (ex. paracétamol)" aria-label="Rechercher un médicament">
              <button type="submit">Rechercher</button>
            </form>
            <div class="pharmacy-tags">
              <span>Recherches fréquentes :</span>
              <button type="button" data-quick-search="Paracétamol">Paracétamol</button>
              <button type="button" data-quick-search="Ibuprofène">Ibuprofène</button>
              <button type="button" data-quick-search="Amoxicilline">Amoxicilline</button>
              <button type="button" data-quick-search="Vitamine C">Vitamine C</button>
            </div>
          </div>
        </section>
        <main class="health-route-main pharmacy-body"><div class="health-wrap">
          <div id="health-medicine-results" class="health-empty"><i class="fas fa-capsules"></i>Saisissez au moins deux caractères pour rechercher dans les stocks publiés par les pharmacies vérifiées.</div>
          <div class="health-subheading"><div><span>Partenaires vérifiés</span><h2>Pharmacies disponibles</h2></div><a href="./health-ordonnance.html">Envoyer une ordonnance <i class="fas fa-arrow-right"></i></a></div>
          <div id="health-pharmacies" class="health-grid"></div>
        </div></main>
        <div class="health-disclaimer"><div class="health-wrap"><strong>Information importante.</strong> Smart Cut Health facilite la mise en relation. Il ne remplace pas un avis médical. La disponibilité affichée provient des stocks publiés par les pharmacies.</div></div>
      </div>${this.renderUtilityDialogs()}`;
      return;
    }

    let content = '';
    if (this.view === 'pharmacy') content = `<form class="health-search health-search--page" id="health-search-form"><i class="fas fa-magnifying-glass"></i><input id="health-search-input" type="search" minlength="2" placeholder="Nom du médicament ou principe actif" aria-label="Rechercher un médicament"><button type="submit">Rechercher</button></form><div id="health-medicine-results" class="health-empty"><i class="fas fa-magnifying-glass"></i>Saisissez au moins deux caractères pour rechercher dans les stocks publiés.</div><div class="health-subheading"><div><span>Partenaires vérifiés</span><h2>Pharmacies disponibles</h2></div><a href="./health-ordonnance.html">J’ai une ordonnance <i class="fas fa-arrow-right"></i></a></div><div id="health-pharmacies" class="health-grid"></div>`;
    if (this.view === 'prescription') content = `<div class="health-secure-layout"><div class="health-secure-copy"><span class="health-secure-icon"><i class="fas fa-lock"></i></span><h2>Votre document reste confidentiel.</h2><p>Il est accessible uniquement à vous, aux pharmacies partenaires concernées et aux administrateurs autorisés.</p><ul><li>Image ou PDF</li><li>15 Mo maximum</li><li>Accès journalisé</li></ul></div><form id="health-prescription-form" class="health-form health-card health-upload-card"><div class="health-field"><label for="health-prescription-file">Choisir l’ordonnance</label><input id="health-prescription-file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required></div><div class="health-field"><label for="health-prescription-notes">Note facultative</label><textarea id="health-prescription-notes" maxlength="500" placeholder="Ajoutez uniquement une précision utile."></textarea></div><button class="health-btn primary" type="submit">Transmettre en sécurité</button><div class="health-status" id="health-prescription-status"></div></form></div>`;
    if (this.view === 'doctors') content = `<div class="health-account-bar"><div><strong>Téléconsultation Smart Cut Health</strong><span>Choisissez une spécialité et un plan dont le tarif est fixé côté serveur.</span></div><a class="health-btn health-btn-link primary" href="./health-teleconsultation.html">Voir les consultations</a></div><div class="health-subheading"><div><span>Profils contrôlés</span><h2>Professionnels disponibles</h2></div></div><div id="health-doctors" class="health-grid"><div class="health-empty"><i class="fas fa-circle-notch fa-spin"></i>Chargement des professionnels…</div></div>`;
    if (this.view === 'labs') content = `<div class="health-subheading"><div><span>Partenaires vérifiés</span><h2>Laboratoires</h2></div></div><div id="health-labs" class="health-grid"></div><div class="health-subheading health-subheading--spaced"><div><span>Catalogue publié</span><h2>Examens disponibles</h2></div></div><div id="health-exams" class="health-grid"></div>`;
    if (this.view === 'space') content = `<div class="health-account-bar"><div><strong>Accès confidentiel</strong><span>Connectez-vous avec votre compte Smart Cut.</span></div><button class="health-btn primary" id="health-login-btn">Se connecter</button></div><div id="health-space-auth"><div class="health-empty"><i class="fas fa-lock"></i>Connectez-vous pour consulter vos informations de santé.</div></div>`;
    if (this.view === 'professional') content = `<div class="health-account-bar"><div><strong>Compte professionnel</strong><span>L’accès dépend de la vérification de votre profil.</span></div><button class="health-btn primary" id="health-login-btn">Se connecter</button></div><div id="health-professional-content"><div class="health-empty"><i class="fas fa-lock"></i>Connectez-vous pour déposer ou gérer une candidature professionnelle.</div></div>`;

    const heroVisual = page.heroImage
      ? `<div class="health-hero-visual health-hero-visual--photo" role="img" aria-label="Illustration ${esc(page.eyebrow)}"><img src="${page.heroImage}" alt="" loading="eager"></div>`
      : `<div class="health-hero-visual health-art-${esc(page.art || this.view)}" role="img" aria-label="Illustration ${esc(page.eyebrow)}"><i class="fas ${page.icon}"></i><span class="health-art-orb"></span><span class="health-art-card"></span></div>`;
    this.root.innerHTML = `<div class="health-shell health-route health-route--${esc(this.view)}"><section class="health-page-hero"><div class="health-wrap health-hero-layout"><div class="health-hero-copy"><span class="health-eyebrow"><i class="fas ${page.icon}"></i> ${page.eyebrow}</span><h1>${page.title}</h1><p>${page.copy}</p></div>${heroVisual}</div></section><main class="health-route-main"><div class="health-wrap">${content}</div></main><div class="health-disclaimer"><div class="health-wrap"><strong>Information importante.</strong> Smart Cut Health facilite la mise en relation. Il ne remplace pas un avis médical.</div></div></div>${this.renderUtilityDialogs()}`;
  }

  renderUtilityDialogs() {
    return `<button id="health-cart-button" class="health-cart" hidden><i class="fas fa-basket-shopping"></i> Panier <span id="health-cart-count">0</span></button><dialog class="health-dialog" id="health-prescription-dialog"><div class="health-dialog-head"><strong>Envoyer mon ordonnance</strong><button class="health-icon-btn" data-close="health-prescription-dialog" aria-label="Fermer"><i class="fas fa-times"></i></button></div><div class="health-dialog-body"><form id="health-prescription-dialog-form" class="health-form"><div class="health-notice"><i class="fas fa-lock"></i> Fichier privé — image ou PDF, 15 Mo maximum.</div><div class="health-field"><label for="health-prescription-dialog-file">Ordonnance</label><input id="health-prescription-dialog-file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required></div><div class="health-field"><label for="health-prescription-dialog-notes">Note facultative</label><textarea id="health-prescription-dialog-notes" maxlength="500"></textarea></div><button class="health-btn primary" type="submit">Transmettre</button><div class="health-status" id="health-prescription-dialog-status"></div></form></div></dialog><dialog class="health-dialog" id="health-cart-dialog"><div class="health-dialog-head"><strong>Commande pharmacie</strong><button class="health-icon-btn" data-close="health-cart-dialog" aria-label="Fermer"><i class="fas fa-times"></i></button></div><div class="health-dialog-body" id="health-cart-content"></div></dialog><dialog class="health-dialog" id="health-book-dialog"><div class="health-dialog-head"><strong>Choisir un créneau</strong><button class="health-icon-btn" data-close="health-book-dialog" aria-label="Fermer"><i class="fas fa-times"></i></button></div><div class="health-dialog-body" id="health-book-content"></div></dialog>`;
  }

  bind() {
    this.root.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => document.getElementById(b.dataset.close)?.close()));
    this.root.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => this.go(b.dataset.go)));
    this.root.querySelectorAll('[data-dialog="prescription"]').forEach((b) => b.addEventListener('click', () => this.openPrescription()));
    this.root.querySelectorAll('.health-tab').forEach((b) => b.addEventListener('click', () => this.selectTab(b.dataset.tab)));
    document.getElementById('health-search-form')?.addEventListener('submit', (e) => { e.preventDefault(); this.search(document.getElementById('health-search-input').value); });
    this.root.querySelectorAll('[data-quick-search]').forEach((b) => b.addEventListener('click', () => { const input = document.getElementById('health-search-input'); if (input) input.value = b.dataset.quickSearch; this.search(b.dataset.quickSearch); }));
    document.getElementById('health-login-btn')?.addEventListener('click', () => this.requireUser());
    document.getElementById('health-dashboard-refresh')?.addEventListener('click', () => this.user ? this.renderSpace() : this.requireUser());
    document.getElementById('health-professional-btn')?.addEventListener('click', () => { document.getElementById('health-professional').hidden = false; document.getElementById('health-professional').scrollIntoView(); this.renderProfessional(); });
    document.getElementById('health-prescription-form')?.addEventListener('submit', (e) => this.submitPrescription(e));
    document.getElementById('health-prescription-dialog-form')?.addEventListener('submit', (e) => this.submitPrescription(e, true));
    document.getElementById('health-cart-button')?.addEventListener('click', () => this.openCart());
  }

  async onAuth(user) {
    this.user = user;
    this.profile = null;
    if (user) {
      const snap = await getDoc(doc(db, 'clients', user.uid)).catch(() => null);
      this.profile = snap?.exists() ? snap.data() : {};
    }
    const loginButton = document.getElementById('health-login-btn');
    if (loginButton) loginButton.textContent = user ? 'Actualiser' : 'Se connecter';
    if (this.view === 'space') await this.renderSpace();
    if (this.view === 'professional') this.renderProfessional();
  }

  requireUser() {
    if (this.user) return this.user;
    getAuthManager().openAuthModal('login');
    return null;
  }

  go(target) {
    if (target === 'space') return document.getElementById('health-space').scrollIntoView();
    this.selectTab(target);
    document.getElementById('health-directory').scrollIntoView();
  }

  selectTab(name) {
    document.querySelectorAll('.health-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.health-panel').forEach((p) => { p.hidden = p.dataset.panel !== name; });
  }

  async loadDirectory() {
    const [pharmacies, doctors, labs, exams, medicines] = await Promise.all([
      callHealth('healthListVerifiedPharmacies').catch(() => ({ pharmacies:[] })), callHealth('healthListDoctors').catch(() => ({ doctors:[] })), callHealth('healthListLaboratories').catch(() => ({ laboratories:[] })), callHealth('healthListLabExams').catch(() => ({ exams:[] })), callHealth('healthListAvailableMedicines').catch(() => ({ medicines:[] }))
    ]);
    this.pharmacies = pharmacies.pharmacies || [];
    this.doctors = doctors.doctors || [];
    this.labs = labs.laboratories || [];
    this.exams = exams.exams || [];
    this.medicines = medicines.medicines || [];
    const pharmaciesRoot = document.getElementById('health-pharmacies');
    const doctorsRoot = document.getElementById('health-doctors');
    const labsRoot = document.getElementById('health-labs');
    const examsRoot = document.getElementById('health-exams');
    const homeMedicinesRoot = document.getElementById('health-home-medicines');
    const homeDoctorsRoot = document.getElementById('health-home-doctors');
    if (pharmaciesRoot) pharmaciesRoot.innerHTML = this.cards(this.pharmacies, (p) => `<span class="health-badge"><i class="fas fa-circle-check"></i> Vérifiée</span><h3>${esc(p.businessName)}</h3><p>${esc([p.commune,p.department].filter(Boolean).join(', ') || p.address)}</p><p>${esc(p.phone)}</p>`);
    if (doctorsRoot) doctorsRoot.innerHTML = this.cards(this.doctors, (p) => `<span class="health-badge"><i class="fas fa-circle-check"></i> Vérifié</span><h3>${esc(p.name)}</h3><p><strong>${esc(p.specialty)}</strong></p><p>${esc([p.facility,p.commune].filter(Boolean).join(' · '))}</p>${p.indicativeFee ? `<div class="price">${money(p.indicativeFee)}</div>`:''}<div class="health-card-actions"><button class="health-btn primary" data-book-provider="${esc(p.id)}" data-provider-name="${esc(p.name)}">Prendre rendez-vous</button></div>`);
    if (labsRoot) labsRoot.innerHTML = this.cards(this.labs, (p) => `<span class="health-badge"><i class="fas fa-circle-check"></i> Vérifié</span><h3>${esc(p.name)}</h3><p>${esc([p.address,p.commune,p.department].filter(Boolean).join(' · '))}</p><p>Choisissez un examen publié ci-dessous pour réserver.</p>`);
    if (examsRoot) examsRoot.innerHTML = this.cards(this.exams, (p) => `<span class="health-badge">Examen</span><h3>${esc(p.name)}</h3><p>${esc(p.description || p.specimen || '')}</p><div class="price">${money(p.price)}</div><div class="health-card-actions"><button class="health-btn primary" data-book-provider="${esc(p.laboratoryId)}" data-provider-name="Laboratoire" data-exam-id="${esc(p.id)}">Choisir un créneau</button></div>`);
    if (homeMedicinesRoot) homeMedicinesRoot.innerHTML = this.homeCards(this.medicines, 'fa-capsules', 'Aucun médicament publié pour le moment.', (p) => `<span class="health-badge"><i class="fas fa-circle-check"></i> En stock</span><h3>${esc(p.name)}</h3><p>${esc([p.dosage, p.pharmaceuticalForm].filter(Boolean).join(' · ') || p.pharmacyName)}</p><div class="health-card-footer"><strong>${money(p.price)}</strong><a href="./health-pharmacie.html?search=${encodeURIComponent(p.name)}">Voir <i class="fas fa-arrow-right"></i></a></div>`);
    if (homeDoctorsRoot) homeDoctorsRoot.innerHTML = this.homeCards(this.doctors, 'fa-user-doctor', 'Aucun médecin disponible pour le moment.', (p) => `<span class="health-badge"><i class="fas fa-circle-check"></i> Vérifié</span><h3>${esc(p.name)}</h3><p><strong>${esc(p.specialty)}</strong></p><p>${esc([p.facility, p.commune].filter(Boolean).join(' · ') || 'Smart Cut Health')}</p><div class="health-card-footer">${p.indicativeFee ? `<strong>${money(p.indicativeFee)}</strong>` : '<span></span>'}<a href="./health-medecins.html">Consulter <i class="fas fa-arrow-right"></i></a></div>`);
    document.querySelectorAll('[data-book-provider]').forEach((b) => b.addEventListener('click', () => this.openBooking(b.dataset.bookProvider, b.dataset.providerName, b.dataset.examId || '')));
  }

  cards(items, render) { return items.length ? items.map((item) => `<article class="health-card">${render(item)}</article>`).join('') : '<div class="health-empty"><i class="fas fa-inbox"></i>Aucun partenaire publié pour le moment.</div>'; }

  homeCards(items, icon, emptyMessage, render) { return items.length ? items.slice(0, 6).map((item) => `<article class="health-card health-home-card">${render(item)}</article>`).join('') : `<div class="health-empty"><i class="fas ${icon}"></i>${emptyMessage}</div>`; }

  async search(raw) {
    const q = String(raw || '').trim();
    if (q.length < 2) return;
    const box = document.getElementById('health-medicine-results');
    box.className = 'health-empty'; box.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i>Recherche en cours…';
    const [meds, docs] = await Promise.all([callHealth('healthSearchMedicines', { query:{ q } }).catch(() => ({ results:[] })), callHealth('healthListDoctors', { query:{ q } }).catch(() => ({ doctors:[] }))]);
    this.searchResults = meds.results || [];
    if (document.querySelector('.health-tab[data-tab]')) this.selectTab(this.searchResults.length ? 'pharmacy' : 'doctors');
    if (this.searchResults.length) {
      box.className = 'health-grid';
      box.innerHTML = this.searchResults.map((p) => `<article class="health-card health-medicine-card"><div class="health-medicine-card-head"><span class="health-medicine-icon"><i class="fas fa-prescription-bottle-medical"></i></span><span class="health-badge ${p.prescriptionRequired?'warn':''}">${p.prescriptionRequired?'Ordonnance requise':'Sans ordonnance'}</span></div><h3>${esc(p.name)}</h3><p class="health-medicine-meta">${esc([p.dci,p.dosage,p.pharmaceuticalForm].filter(Boolean).join(' · '))}</p><div class="health-medicine-info"><span><small>Pharmacie</small><strong>${esc(p.pharmacyName)}</strong></span><span><small>Disponibilité</small><strong>${p.stock > 0 ? `${p.stock} en stock` : 'Rupture'}</strong></span></div><div class="health-medicine-footer"><div class="price">${money(p.price)}</div><div class="health-card-actions">${p.prescriptionRequired ? '<button class="health-btn secondary" data-dialog="prescription">Envoyer une ordonnance</button>' : `<button class="health-btn primary" data-add-product="${esc(p.id)}" ${p.stock<=0?'disabled':''}>Ajouter</button>`}</div></div></article>`).join('');
      box.querySelectorAll('[data-add-product]').forEach((b) => b.addEventListener('click', () => this.addToCart(b.dataset.addProduct)));
      box.querySelectorAll('[data-dialog="prescription"]').forEach((b) => b.addEventListener('click', () => this.openPrescription()));
    } else {
      box.className = 'health-empty'; box.innerHTML = '<i class="fas fa-box-open"></i>Aucun médicament correspondant n’est actuellement publié. La disponibilité n’est pas estimée.';
      if (docs.doctors?.length) box.innerHTML += '<p><a class="health-inline-link" href="./health-medecins.html">Des médecins correspondent à votre recherche <i class="fas fa-arrow-right"></i></a></p>';
    }
  }

  addToCart(id) {
    const product = this.searchResults.find((p) => p.id === id);
    if (!product) return;
    if (this.cartPharmacyId && this.cartPharmacyId !== product.pharmacyId) { alert('Une commande doit concerner une seule pharmacie. Finalisez ou videz le panier actuel.'); return; }
    this.cartPharmacyId = product.pharmacyId;
    const line = this.cart.find((p) => p.id === id);
    if (line) line.qty = Math.min(product.stock, line.qty + 1); else this.cart.push({ ...product, qty:1 });
    const count = this.cart.reduce((n,p) => n+p.qty,0);
    document.getElementById('health-cart-count').textContent = count;
    document.getElementById('health-cart-button').hidden = false;
  }

  openCart() {
    const target = document.getElementById('health-cart-content');
    target.innerHTML = this.cart.length ? `<div class="health-form">${this.cart.map((p) => `<div class="health-card"><strong>${esc(p.name)}</strong><p>${p.qty} × ${money(p.price)} = ${money(p.qty*p.price)}</p></div>`).join('')}<div class="health-field"><label>Mode de remise</label><select id="health-delivery-method"><option value="pickup">Retrait en pharmacie</option><option value="home">Livraison à domicile</option></select></div><div id="health-address-fields" hidden class="health-form-grid"><div class="health-field"><label>Adresse</label><input id="health-address"></div><div class="health-field"><label>Département</label><input id="health-department"></div><div class="health-field"><label>Commune</label><input id="health-commune"></div><div class="health-field"><label>Téléphone</label><input id="health-phone"></div></div><button id="health-checkout" class="health-btn primary">Payer avec MonCash</button><div id="health-checkout-status" class="health-status"></div><button id="health-clear-cart" class="health-btn secondary">Vider le panier</button></div>` : '<div class="health-empty">Votre panier est vide.</div>';
    document.getElementById('health-cart-dialog').showModal();
    document.getElementById('health-delivery-method')?.addEventListener('change', (e) => { document.getElementById('health-address-fields').hidden = e.target.value !== 'home'; });
    document.getElementById('health-clear-cart')?.addEventListener('click', () => { this.cart=[];this.cartPharmacyId='';document.getElementById('health-cart-button').hidden=true;document.getElementById('health-cart-dialog').close(); });
    document.getElementById('health-checkout')?.addEventListener('click', () => this.checkout());
  }

  async checkout() {
    if (!this.requireUser()) return;
    const status = document.getElementById('health-checkout-status'); status.textContent='Préparation du paiement sécurisé…';
    const button=document.getElementById('health-checkout');button.disabled=true;try {
      const method = document.getElementById('health-delivery-method').value;
      const payload = await callHealth('healthCreateOtcOrder', { method:'POST', requireAuth:true, body:{ pharmacyId:this.cartPharmacyId, items:this.cart.map((p) => ({ productId:p.id, qty:p.qty })), deliveryMethod:method, address:method==='home'?{ address:document.getElementById('health-address').value,department:document.getElementById('health-department').value,commune:document.getElementById('health-commune').value,phone:document.getElementById('health-phone').value }:null } });
      localStorage.setItem('smartcut_health_payment', JSON.stringify({ sessionId:payload.sessionId, orderId:payload.orderId, amount:payload.total }));
      window.location.assign(payload.checkoutUrl);
    } catch (error) { status.className='health-status error';status.textContent=error.message;button.disabled=false; }
  }

  openPrescription() { if (!this.requireUser()) return; document.getElementById('health-prescription-dialog').showModal(); }

  async submitPrescription(event, fromDialog = false) {
    event.preventDefault(); if (!this.requireUser()) return;
    const prefix = fromDialog ? 'health-prescription-dialog' : 'health-prescription';
    const file = document.getElementById(`${prefix}-file`).files[0];
    const status = document.getElementById(`${prefix}-status`);
    const allowed = ['image/jpeg','image/png','image/webp','application/pdf'];
    if (!file || !allowed.includes(file.type) || file.size > 15*1024*1024) { status.className='health-status error';status.textContent='Choisissez une image JPG/PNG/WEBP ou un PDF de 15 Mo maximum.';return; }
    status.className='health-status';status.textContent='Chiffrement de transport et envoi privé…';
    try {
      const prescriptionId = doc(collection(db,'healthPrescriptions')).id;
      const extension = file.type === 'application/pdf' ? 'pdf' : (file.type.split('/')[1] || 'jpg').replace('jpeg','jpg');
      const safeName = `ordonnance-${Date.now()}.${extension}`;
      const path = `health-prescriptions/${this.user.uid}__${prescriptionId}/${safeName}`;
      await uploadBytes(ref(storage,path), file, { contentType:file.type, cacheControl:'private,no-store,max-age=0' });
      await callHealth('healthSubmitPrescription', { method:'POST', requireAuth:true, body:{ prescriptionId,storagePath:path,fileName:safeName,mimeType:file.type,notes:document.getElementById(`${prefix}-notes`).value } });
      status.className='health-status success';status.textContent='Ordonnance transmise. Vous pourrez comparer les offres dans votre espace santé.';
      event.target.reset();
    } catch (error) { status.className='health-status error';status.textContent=error.message; }
  }

  async openBooking(providerUid, name, examId = '') {
    if (!this.requireUser()) return;
    const box = document.getElementById('health-book-content'); box.innerHTML='<div class="health-empty"><i class="fas fa-circle-notch fa-spin"></i>Chargement des créneaux…</div>';document.getElementById('health-book-dialog').showModal();
    try {
      const { slots } = await callHealth('healthListAvailability',{ query:{ providerUid } });
      box.innerHTML = slots.length ? `<p>Créneaux publiés par <strong>${esc(name)}</strong>.</p><div class="health-form">${slots.sort((a,b)=>a.startsAt.localeCompare(b.startsAt)).map((s)=>`<button class="health-btn secondary" data-slot="${esc(s.id)}">${esc(new Date(s.startsAt).toLocaleString('fr-HT',{dateStyle:'medium',timeStyle:'short'}))}</button>`).join('')}<div class="health-field"><label>Motif (visible uniquement par les participants autorisés)</label><textarea id="health-book-reason" maxlength="500"></textarea></div><div id="health-book-status" class="health-status"></div></div>` : '<div class="health-empty"><i class="fas fa-calendar-xmark"></i>Aucun créneau disponible n’est publié.</div>';
      box.querySelectorAll('[data-slot]').forEach((b)=>b.addEventListener('click',()=>this.bookSlot(b.dataset.slot, examId)));
    } catch(error){box.innerHTML=`<div class="health-empty">${esc(error.message)}</div>`;}
  }

  async bookSlot(slotId, examId='') { const status=document.getElementById('health-book-status');try{status.textContent='Réservation atomique du créneau…';const booked=await callHealth('healthBookAppointment',{method:'POST',requireAuth:true,body:{slotId,examId,reason:document.getElementById('health-book-reason').value}});if(booked.paymentRequired){status.textContent='Créneau réservé. Ouverture du paiement MonCash…';const out=await callHealth('healthCreateAppointmentPayment',{method:'POST',requireAuth:true,body:{appointmentId:booked.appointmentId}});localStorage.setItem('smartcut_health_payment',JSON.stringify({sessionId:out.sessionId,orderId:out.orderId,amount:out.total}));window.location.assign(out.checkoutUrl);return}status.className='health-status success';status.textContent='Rendez-vous confirmé.';await this.renderSpace();}catch(error){status.className='health-status error';status.textContent=error.message;} }

  async renderSpace() {
    const root=document.getElementById('health-space-auth');
    if(!this.user){root.innerHTML='<div class="health-empty"><i class="fas fa-lock"></i>Connectez-vous pour consulter vos informations de santé.</div>';return;}
    root.innerHTML='<div class="health-empty"><i class="fas fa-circle-notch fa-spin"></i>Chargement de votre espace privé…</div>';
    try {
      const [rxSnap,orderSnap,apptSnap,resultSnap]=await Promise.all([
        getDocs(query(collection(db,'healthPrescriptions'),where('patientUid','==',this.user.uid),limit(50))),
        getDocs(query(collection(db,'healthOrders'),where('patientUid','==',this.user.uid),limit(50))),
        getDocs(query(collection(db,'healthAppointments'),where('patientUid','==',this.user.uid),limit(50))),
        getDocs(query(collection(db,'healthLabResults'),where('patientUid','==',this.user.uid),limit(50)))
      ]);
      const prescriptions=rxSnap.docs.map(d=>({id:d.id,...d.data()}));const orders=orderSnap.docs.map(d=>({id:d.id,...d.data()}));const appointments=apptSnap.docs.map(d=>({id:d.id,...d.data()}));const results=resultSnap.docs.map(d=>({id:d.id,...d.data()}));
      const upcomingAppointments = appointments.filter((item) => item.status !== 'CANCELLED' && (!item.startsAt || new Date(item.startsAt) >= new Date())).length;
      [['health-metric-appointments', upcomingAppointments],['health-metric-rx', prescriptions.length],['health-metric-orders', orders.length],['health-metric-results', results.length]].forEach(([id,value]) => { const node=document.getElementById(id); if(node) node.textContent=String(value); });
      const name = this.profile?.displayName || this.profile?.businessName || this.user?.displayName || this.user?.email?.split('@')[0] || 'vous';
      const nameNode = document.getElementById('health-dashboard-name'); if (nameNode) nameNode.textContent = name;
      root.innerHTML=`<div class="health-tabs"><button class="health-tab active" data-space-tab="rx">Ordonnances (${prescriptions.length})</button><button class="health-tab" data-space-tab="orders">Commandes (${orders.length})</button><button class="health-tab" data-space-tab="appointments">Rendez-vous (${appointments.length})</button><button class="health-tab" data-space-tab="results">Résultats (${results.length})</button></div>
      <div data-space-panel="rx" class="health-grid">${this.cards(prescriptions,p=>`<span class="health-badge">${esc(statusLabel(p.status))}</span><h3>Ordonnance ${esc(p.id.slice(0,8))}</h3><p>${esc(p.rejectionReason||p.notes||'Suivi sécurisé')}</p><div class="health-card-actions"><button class="health-btn secondary" data-open-private="prescription" data-private-id="${esc(p.id)}">Voir le fichier</button><button class="health-btn primary" data-view-offers="${esc(p.id)}">Comparer les offres</button></div>`)}</div>
      <div data-space-panel="orders" class="health-grid" hidden>${this.cards(orders,p=>`<span class="health-badge">${esc(statusLabel(p.status))}</span><h3>Commande ${esc(p.id.slice(0,8))}</h3><div class="price">${money(p.total)}</div><p>${esc(p.deliveryMethod==='home'?'Livraison':'Retrait pharmacie')}</p>`)}</div>
      <div data-space-panel="appointments" class="health-grid" hidden>${this.cards(appointments,p=>`<span class="health-badge">${esc(statusLabel(p.status))}</span><h3>${p.providerType==='doctor'?'Consultation':'Laboratoire'}</h3><p>${esc(new Date(p.startsAt).toLocaleString('fr-HT',{dateStyle:'medium',timeStyle:'short'}))}</p><div class="health-card-actions">${p.status==='CONFIRMED'?`<button class="health-btn danger" data-cancel-appt="${esc(p.id)}">Annuler</button>`:''}</div>`)}</div>
      <div data-space-panel="results" class="health-grid" hidden>${this.cards(results,p=>`<span class="health-badge">Résultat disponible</span><h3>Résultat laboratoire</h3><p>Document privé journalisé à chaque ouverture.</p><button class="health-btn primary" data-open-private="lab-result" data-private-id="${esc(p.id)}">Ouvrir 5 minutes</button>`)}</div>`;
      root.querySelectorAll('[data-space-tab]').forEach(b=>b.addEventListener('click',()=>{root.querySelectorAll('[data-space-tab]').forEach(x=>x.classList.toggle('active',x===b));root.querySelectorAll('[data-space-panel]').forEach(p=>p.hidden=p.dataset.spacePanel!==b.dataset.spaceTab);}));
      root.querySelectorAll('[data-open-private]').forEach(b=>b.addEventListener('click',()=>this.openPrivate(b.dataset.openPrivate,b.dataset.privateId)));
      root.querySelectorAll('[data-view-offers]').forEach(b=>b.addEventListener('click',()=>this.showOffers(b.dataset.viewOffers)));
      root.querySelectorAll('[data-cancel-appt]').forEach(b=>b.addEventListener('click',()=>this.cancelAppointment(b.dataset.cancelAppt)));
      document.querySelectorAll('[data-space-nav]').forEach((button)=>button.addEventListener('click',()=>{
        const target=button.dataset.spaceNav;
        document.querySelectorAll('[data-space-nav]').forEach((item)=>item.classList.toggle('is-active', item===button));
        if(target==='overview'){root.querySelectorAll('[data-space-panel]').forEach(panel=>{panel.hidden=panel.dataset.spacePanel!=='rx';});return;}
        root.querySelectorAll('[data-space-tab]').forEach(tab=>{tab.classList.toggle('active',tab.dataset.spaceTab===target);});
        root.querySelectorAll('[data-space-panel]').forEach(panel=>{panel.hidden=panel.dataset.spacePanel!==target;});
        root.scrollIntoView({behavior:'smooth',block:'start'});
      }));
    } catch(error){root.innerHTML=`<div class="health-empty"><i class="fas fa-triangle-exclamation"></i>${esc(error.message)}</div>`;}
  }

  async openPrivate(type,id){try{const out=await callHealth('healthGetPrivateDocument',{requireAuth:true,query:{type,id}});window.open(out.url,'_blank','noopener,noreferrer');}catch(error){alert(error.message);}}
  async cancelAppointment(id){if(!confirm('Annuler ce rendez-vous et libérer le créneau ?'))return;try{await callHealth('healthUpdateAppointment',{method:'POST',requireAuth:true,body:{appointmentId:id,status:'CANCELLED'}});await this.renderSpace();}catch(error){alert(error.message);}}

  async showOffers(prescriptionId){
    const box=document.getElementById('health-cart-content');box.innerHTML='<div class="health-empty"><i class="fas fa-circle-notch fa-spin"></i>Chargement des propositions…</div>';document.getElementById('health-cart-dialog').showModal();
    try{const snap=await getDocs(query(collection(db,'healthPrescriptionOffers'),where('prescriptionId','==',prescriptionId),limit(30)));const offers=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(Number(b.allAvailable)-Number(a.allAvailable))||(Number(a.deliveryFee)-Number(b.deliveryFee))||(Number(a.subtotal)-Number(b.subtotal)));
      box.innerHTML=offers.length?`<div class="health-notice">Les options complètes sont présentées en premier, puis le délai, la livraison et le prix. Smart Cut ne fournit aucun choix médical automatique.</div><div class="health-form">${offers.map(o=>`<div class="health-card"><span class="health-badge ${o.allAvailable?'':'warn'}">${o.allAvailable?'Ordonnance complète':'Disponibilité partielle'}</span><h3>${esc(o.pharmacyName)}</h3><p>${o.items.filter(i=>i.available).length} produit(s) disponible(s) · ${esc(o.deliveryEtaLabel||'Délai non précisé')}</p><div class="price">${money(Number(o.subtotal)+Number(o.deliveryFee||0))}</div><button class="health-btn primary" data-accept-offer="${esc(o.id)}">Choisir cette option</button></div>`).join('')}</div>`:'<div class="health-empty">Aucune pharmacie n’a encore envoyé de proposition.</div>';
      box.querySelectorAll('[data-accept-offer]').forEach(b=>b.addEventListener('click',()=>this.acceptOffer(b.dataset.acceptOffer)));
    }catch(error){box.innerHTML=`<div class="health-empty">${esc(error.message)}</div>`;}
  }

  async acceptOffer(offerId){try{document.querySelectorAll('[data-accept-offer]').forEach(b=>b.disabled=true);await callHealth('healthAcceptPrescriptionOffer',{method:'POST',requireAuth:true,body:{offerId}});const out=await callHealth('healthCreatePrescriptionOrderPayment',{method:'POST',requireAuth:true,body:{offerId,deliveryMethod:'pickup'}});localStorage.setItem('smartcut_health_payment',JSON.stringify({sessionId:out.sessionId,orderId:out.orderId,amount:out.total}));window.location.assign(out.checkoutUrl);}catch(error){document.querySelectorAll('[data-accept-offer]').forEach(b=>b.disabled=false);alert(error.message);}}

  renderProfessional(){
    const root=document.getElementById('health-professional-content');
    if(!this.user){root.innerHTML='<div class="health-empty"><i class="fas fa-lock"></i>Connectez-vous pour déposer ou gérer une candidature professionnelle.</div>';return;}
    const role=this.profile?.role;const verified=(role==='pharmacy'&&this.profile?.pharmacyStatus==='verified')||(role==='doctor'&&this.profile?.doctorStatus==='verified')||(role==='laboratory'&&this.profile?.labStatus==='verified');
    if(!verified){const status=this.profile?.doctorStatus||this.profile?.pharmacyStatus||this.profile?.labStatus||'';root.innerHTML=`<div class="health-professional-onboarding"><span class="health-secure-icon"><i class="fas fa-shield-heart"></i></span><div><span class="health-eyebrow">Candidature professionnelle</span><h2>${status==='submitted'||status==='pending'?'Votre dossier est en vérification.':'Présentez votre activité à Smart Cut Health.'}</h2><p>${status==='submitted'||status==='pending'?'La publication restera bloquée jusqu’à la décision humaine de l’équipe Smart Cut.':'Un parcours distinct est prévu pour les médecins, pharmacies et laboratoires, avec brouillon et contrôle documentaire.'}</p></div><a class="health-btn health-btn-link primary" href="./health-candidature.html">${status==='submitted'||status==='pending'?'Suivre mon dossier':'Commencer ma candidature'}</a></div>`;return;}
    root.innerHTML=`<div class="health-notice"><i class="fas fa-circle-check"></i> Compte ${esc(role)} vérifié.</div>${role==='doctor'?'<a class="health-btn primary" href="./health-doctor.html" style="display:inline-flex;margin-top:1rem">Ouvrir mon espace médecin</a>':''}<div id="health-pro-tools" style="margin-top:1rem"></div>`;this.renderProfessionalTools(role);
  }

  async applyProfessional(e){e.preventDefault();const status=document.getElementById('health-application-status');try{const data=Object.fromEntries(new FormData(e.target));delete data.documents;data.professionalName=data.businessName;const files=[...e.target.documents.files];const allowed=['image/jpeg','image/png','image/webp','application/pdf'];if(files.some(f=>!allowed.includes(f.type)||f.size>10*1024*1024))throw new Error('Chaque document doit être une image ou un PDF de 10 Mo maximum.');const folder={pharmacy:'health-pharmacy-docs',doctor:'health-doctor-docs',laboratory:'health-lab-docs'}[data.type];data.documentPaths=[];for(let i=0;i<files.length;i+=1){status.textContent=`Envoi privé du document ${i+1}/${files.length}…`;const f=files[i],ext=f.type==='application/pdf'?'pdf':(f.type.split('/')[1]||'jpg').replace('jpeg','jpg'),path=`${folder}/${this.user.uid}/verification-${Date.now()}-${i}.${ext}`;await uploadBytes(ref(storage,path),f,{contentType:f.type,cacheControl:'private,no-store,max-age=0'});data.documentPaths.push(path)}await callHealth('healthApplyProfessional',{method:'POST',requireAuth:true,body:data});status.className='health-status success';status.textContent='Candidature enregistrée avec le statut En attente.';}catch(error){status.className='health-status error';status.textContent=error.message;}}

  async renderProfessionalTools(role){
    const root=document.getElementById('health-pro-tools');
    if(role==='pharmacy'){
      root.innerHTML=`<div class="health-tabs"><button class="health-tab active">Produits & stock</button></div><form id="health-medicine-form" class="health-card health-form"><div class="health-form-grid"><div class="health-field"><label>Nom</label><input name="name" required></div><div class="health-field"><label>DCI</label><input name="dci"></div><div class="health-field"><label>Dosage</label><input name="dosage"></div><div class="health-field"><label>Forme</label><input name="pharmaceuticalForm"></div><div class="health-field"><label>Fabricant</label><input name="manufacturer"></div><div class="health-field"><label>Prix HTG</label><input name="price" type="number" min="0" required></div><div class="health-field"><label>Stock réel</label><input name="stock" type="number" min="0" required></div><div class="health-field"><label><input name="prescriptionRequired" type="checkbox"> Ordonnance requise</label><label><input name="coldChainRequired" type="checkbox"> Chaîne du froid requise</label></div></div><button class="health-btn primary">Ajouter au catalogue</button><div id="health-pro-status" class="health-status"></div></form><h3>Demandes d’ordonnance acheminées</h3><div id="health-routed-prescriptions" class="health-grid"></div>`;
      root.querySelector('form').addEventListener('submit',(e)=>this.saveMedicine(e));this.loadRoutedPrescriptions();
    }else{
      root.innerHTML=`<form id="health-slot-form" class="health-card health-form"><h3>Publier un créneau</h3><div class="health-form-grid"><div class="health-field"><label>Début</label><input name="startsAt" type="datetime-local" required></div><div class="health-field"><label>Fin</label><input name="endsAt" type="datetime-local" required></div></div><button class="health-btn primary">Publier</button><div id="health-pro-status" class="health-status"></div></form>${role==='laboratory'?`<form id="health-exam-form" class="health-card health-form" style="margin-top:1rem"><h3>Ajouter un examen</h3><div class="health-form-grid"><div class="health-field"><label>Nom</label><input name="name" required></div><div class="health-field"><label>Prix HTG</label><input name="price" type="number" min="0" required></div><div class="health-field"><label>Type de prélèvement</label><input name="specimen"></div><div class="health-field"><label>Description</label><input name="description"></div></div><button class="health-btn primary">Enregistrer</button></form><form id="health-result-form" class="health-card health-form" style="margin-top:1rem"><h3>Déposer un résultat privé</h3><div class="health-field"><label>Rendez-vous concerné</label><select name="appointmentId" id="health-result-appointment" required><option value="">Chargement…</option></select></div><div class="health-field"><label>Résultat PDF, 15 Mo maximum</label><input name="result" type="file" accept="application/pdf" required></div><button class="health-btn primary">Transmettre au patient</button><div id="health-result-status" class="health-status"></div></form>`:''}`;
      document.getElementById('health-slot-form').addEventListener('submit',(e)=>this.saveSlot(e,role));document.getElementById('health-exam-form')?.addEventListener('submit',(e)=>this.saveExam(e));if(role==='laboratory'){document.getElementById('health-result-form').addEventListener('submit',(e)=>this.uploadLabResult(e));this.loadLabAppointments();}
    }
  }

  async saveMedicine(e){e.preventDefault();const d=Object.fromEntries(new FormData(e.target));d.prescriptionRequired=e.target.prescriptionRequired.checked;d.coldChainRequired=e.target.coldChainRequired.checked;const s=document.getElementById('health-pro-status');try{await callHealth('healthSaveMedicine',{method:'POST',requireAuth:true,body:d});s.className='health-status success';s.textContent='Médicament enregistré. Le stock est horodaté côté serveur.';e.target.reset();}catch(error){s.className='health-status error';s.textContent=error.message;}}
  async saveSlot(e,role){e.preventDefault();const d=Object.fromEntries(new FormData(e.target));d.type=role;d.startsAt=new Date(d.startsAt).toISOString();d.endsAt=new Date(d.endsAt).toISOString();const s=document.getElementById('health-pro-status');try{await callHealth('healthSaveAvailability',{method:'POST',requireAuth:true,body:d});s.className='health-status success';s.textContent='Créneau publié.';e.target.reset();}catch(error){s.className='health-status error';s.textContent=error.message;}}
  async saveExam(e){e.preventDefault();try{await callHealth('healthSaveLabExam',{method:'POST',requireAuth:true,body:Object.fromEntries(new FormData(e.target))});e.target.reset();alert('Examen enregistré.');}catch(error){alert(error.message);}}
  async loadLabAppointments(){const select=document.getElementById('health-result-appointment');try{const snap=await getDocs(query(collection(db,'healthAppointments'),where('providerUid','==',this.user.uid),limit(100)));const items=snap.docs.map(d=>({id:d.id,...d.data()})).filter(x=>['CONFIRMED','COMPLETED'].includes(x.status));select.innerHTML='<option value="">Choisir…</option>'+items.map(x=>`<option value="${esc(x.id)}">${esc(x.examName||'Examen')} · ${esc(new Date(x.startsAt).toLocaleString('fr-HT'))}</option>`).join('');}catch(error){select.innerHTML='<option value="">Chargement impossible</option>';}}
  async uploadLabResult(e){e.preventDefault();const status=document.getElementById('health-result-status'),appointmentId=e.target.appointmentId.value,file=e.target.result.files[0];try{if(!file||file.type!=='application/pdf'||file.size>15*1024*1024)throw new Error('Choisissez un PDF de 15 Mo maximum.');const appointment=await getDoc(doc(db,'healthAppointments',appointmentId));if(!appointment.exists())throw new Error('Rendez-vous introuvable.');status.textContent='Envoi privé du résultat…';const path=`health-lab-results/${appointment.data().patientUid}__${appointmentId}/resultat-${Date.now()}.pdf`;await uploadBytes(ref(storage,path),file,{contentType:'application/pdf',cacheControl:'private,no-store,max-age=0'});await callHealth('healthUploadLabResult',{method:'POST',requireAuth:true,body:{appointmentId,storagePath:path}});status.className='health-status success';status.textContent='Résultat transmis au patient et accès journalisé.';e.target.reset();}catch(error){status.className='health-status error';status.textContent=error.message;}}
  async loadRoutedPrescriptions(){const root=document.getElementById('health-routed-prescriptions');try{const [snap,productsSnap]=await Promise.all([getDocs(query(collection(db,'healthPrescriptionRoutes'),where('pharmacyId','==',this.user.uid),limit(50))),getDocs(query(collection(db,'healthPharmacyProducts'),where('pharmacyId','==',this.user.uid),limit(100)))]);this.professionalProducts=productsSnap.docs.map(d=>({id:d.id,...d.data()}));const rows=await Promise.all(snap.docs.map(async d=>{const p=await getDoc(doc(db,'healthPrescriptions',d.data().prescriptionId));return p.exists()?{id:p.id,...p.data()}:null;}));this.routedPrescriptions=new Map(rows.filter(Boolean).map(p=>[p.id,p]));root.innerHTML=this.cards(rows.filter(Boolean),p=>`<span class="health-badge">${esc(statusLabel(p.status))}</span><h3>Ordonnance ${esc(p.id.slice(0,8))}</h3><div class="health-card-actions"><button class="health-btn secondary" data-open-private="prescription" data-private-id="${esc(p.id)}">Consulter et journaliser l’accès</button>${['RECEIVED','UNDER_REVIEW','VALIDATED'].includes(p.status)?`<button class="health-btn primary" data-offer-rx="${esc(p.id)}">Répondre</button>`:''}${['RECEIVED','UNDER_REVIEW'].includes(p.status)?`<button class="health-btn danger" data-review-rx="${esc(p.id)}" data-review-action="NEEDS_CLARIFICATION">Demander une précision</button><button class="health-btn danger" data-review-rx="${esc(p.id)}" data-review-action="REJECTED">Refuser</button>`:''}</div>`);root.querySelectorAll('[data-open-private]').forEach(b=>b.addEventListener('click',()=>this.openPrivate(b.dataset.openPrivate,b.dataset.privateId)));root.querySelectorAll('[data-offer-rx]').forEach(b=>b.addEventListener('click',()=>this.openOfferForm(b.dataset.offerRx)));root.querySelectorAll('[data-review-rx]').forEach(b=>b.addEventListener('click',()=>this.reviewPrescription(b.dataset.reviewRx,b.dataset.reviewAction)));}catch(error){root.innerHTML=`<div class="health-empty">${esc(error.message)}</div>`;}}

  openOfferForm(prescriptionId){const box=document.getElementById('health-cart-content');box.innerHTML=`<form id="health-offer-form" class="health-form"><h3>Réponse à l’ordonnance ${esc(prescriptionId.slice(0,8))}</h3><div class="health-notice">Sélectionnez uniquement les médicaments lus sur l’ordonnance. Les prix sont repris du catalogue par le serveur.</div>${(this.professionalProducts||[]).map(p=>`<div class="health-card"><label><input type="checkbox" name="product" value="${esc(p.id)}"> <strong>${esc(p.name)}</strong> · ${money(p.price)} · stock ${Number(p.stock||0)}</label><div class="health-field"><label>Quantité</label><input type="number" min="1" value="1" data-qty-product="${esc(p.id)}"></div><label><input type="checkbox" data-unavailable-product="${esc(p.id)}"> Indisponible</label></div>`).join('')||'<div class="health-empty">Ajoutez d’abord des médicaments au catalogue.</div>'}<div class="health-form-grid"><div class="health-field"><label>Frais de livraison</label><input name="deliveryFee" type="number" min="0" value="0"></div><div class="health-field"><label>Délai</label><input name="deliveryEtaLabel" placeholder="Aujourd’hui, demain…"></div></div><button class="health-btn primary">Envoyer la proposition</button><div id="health-offer-status" class="health-status"></div></form>`;document.getElementById('health-cart-dialog').showModal();document.getElementById('health-offer-form').addEventListener('submit',(e)=>this.submitOffer(e,prescriptionId));}
  async submitOffer(e,prescriptionId){e.preventDefault();const s=document.getElementById('health-offer-status');const selected=[...e.target.querySelectorAll('input[name="product"]:checked')];const items=selected.map(c=>({productId:c.value,qty:Number(e.target.querySelector(`[data-qty-product="${CSS.escape(c.value)}"]`).value),available:!e.target.querySelector(`[data-unavailable-product="${CSS.escape(c.value)}"]`).checked}));try{if(this.routedPrescriptions?.get(prescriptionId)?.status==='RECEIVED')await callHealth('healthReviewPrescription',{method:'POST',requireAuth:true,body:{prescriptionId,action:'UNDER_REVIEW'}});await callHealth('healthSubmitPrescriptionOffer',{method:'POST',requireAuth:true,body:{prescriptionId,items,deliveryFee:Number(e.target.deliveryFee.value),deliveryEtaLabel:e.target.deliveryEtaLabel.value}});s.className='health-status success';s.textContent='Proposition envoyée au patient.';await this.loadRoutedPrescriptions();}catch(error){s.className='health-status error';s.textContent=error.message;}}
  async reviewPrescription(prescriptionId,action){const reason=prompt(action==='REJECTED'?'Motif compréhensible du refus :':'Précision demandée au patient :');if(!reason)return;try{const current=this.routedPrescriptions?.get(prescriptionId)?.status;if(current==='RECEIVED'&&action==='NEEDS_CLARIFICATION')await callHealth('healthReviewPrescription',{method:'POST',requireAuth:true,body:{prescriptionId,action:'UNDER_REVIEW'}});await callHealth('healthReviewPrescription',{method:'POST',requireAuth:true,body:{prescriptionId,action,reason}});await this.loadRoutedPrescriptions();}catch(error){alert(error.message);}}
}

export default SmartCutHealth;
