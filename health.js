import { auth, db, storage, authReadyPromise } from './firebase-init.js';
import { getAuthManager } from './auth.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js';
import { collection, query, where, getDocs, getDoc, doc, limit, orderBy, onSnapshot, updateDoc } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
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
    if (['home', 'pharmacy', 'doctors', 'labs', 'imaging'].includes(this.view)) this.loadDirectory();
  }

  render() {
    if (this.view !== 'home') {
      this.renderStandalone();
      return;
    }
    this.root.innerHTML = `<div class="health-shell">
      <section class="health-hero"><div class="health-wrap health-hero-layout"><div class="health-hero-copy">
        <h1 data-health-hero-title aria-label="Votre santé, plus accessible."><span aria-hidden="true"></span></h1>
        <div class="health-hero-actions"><a class="health-btn health-btn-link primary" href="./health-teleconsultation.html">Consulter un médecin</a><a class="health-btn health-btn-link health-btn-ghost" href="./health-pharmacie.html">Trouver un médicament</a><a class="health-btn health-btn-link health-btn-ghost" href="./health-espace.html?tab=prescriptions">Envoyer une ordonnance</a></div>
      </div><div class="health-hero-visual health-art-home"><img src="./assets/health/heroes/health-home-hero-professional-v1.png" alt="Médecin noire de Smart Cut Health" loading="eager"></div></div></section>
      <main class="health-home-directory"><div class="health-wrap">
        <section class="health-directory-block" aria-label="Catalogue des médicaments">
          <div class="health-subheading"><a href="./health-pharmacie.html">Voir la pharmacie <i class="fas fa-arrow-right"></i></a></div>
          <div id="health-home-medicines" class="health-grid"><div class="health-empty"><i class="fas fa-circle-notch fa-spin"></i>Chargement des médicaments…</div></div>
        </section>
        <section class="health-directory-block health-directory-block--spaced" aria-label="Annuaire des médecins">
          <div class="health-subheading"><a href="./health-medecins.html">Voir les médecins <i class="fas fa-arrow-right"></i></a></div>
          <div id="health-home-doctors" class="health-grid"><div class="health-empty"><i class="fas fa-circle-notch fa-spin"></i>Chargement des médecins…</div></div>
        </section>
      </div></main>
    </div>`;
    this.animateHeroTitle();
  }

  animateHeroTitle() {
    const title = this.root?.querySelector('[data-health-hero-title]');
    const target = title?.querySelector('span');
    if (!title || !target || title.dataset.animated === 'true') return;

    const text = title.getAttribute('aria-label') || 'Votre santé, plus accessible.';
    title.dataset.animated = 'true';

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      target.textContent = text;
      return;
    }

    const letters = Array.from(text);
    let index = 0;
    const typeNext = () => {
      target.textContent += letters[index] || '';
      index += 1;
      if (index < letters.length) window.setTimeout(typeNext, 52);
    };
    window.setTimeout(typeNext, 120);
  }

  renderStandalone() {
    const views = {
      pharmacy: { icon:'fa-prescription-bottle-medical', art:'pharmacy', heroImage:'./assets/health/heroes/pharmacy-hero-v1.png', eyebrow:'Pharmacie', title:'Vos soins, simplement.', copy:'Médicaments vérifiés, près de vous.' },
      doctors: { icon:'fa-user-doctor', art:'doctor', heroImage:'./assets/health/heroes/doctor-hero-v1.png', eyebrow:'Médecins', title:'Un médecin, quand vous en avez besoin.', copy:'Choisissez une spécialité et un créneau.' },
      labs: { icon:'fa-flask-vial', art:'lab', heroImage:'./assets/health/heroes/lab-hero-v1.png', eyebrow:'Laboratoires', title:'Vos examens, en confiance.', copy:'Trouvez un laboratoire vérifié.' },
      imaging: { icon:'fa-x-ray', art:'imaging', heroImage:'./assets/health/heroes/imaging-hero-v1.png', eyebrow:'Imagerie médicale', title:'Vos examens d’imagerie, en confiance.', copy:'Trouvez un centre d’imagerie vérifié.' },
      professional: { icon:'fa-user-shield', art:'professional', heroImage:'./assets/health/heroes/professional-hero-v1.png', eyebrow:'Espace professionnel', title:'Votre activité santé, structurée.', copy:'Un espace sécurisé pour vos opérations.' },
      // Utilisé seulement comme repli de sécurité pour `page` ci-dessous : la vue
      // « space » retourne toujours avant d'atteindre le code qui lit `page`.
      space: { icon:'fa-heart-pulse', art:'space', eyebrow:'Espace personnel', title:'Tout votre parcours santé.', copy:'Vos documents et rendez-vous au même endroit.' }
    };
    const page = views[this.view] || views.space;

    // « Mon espace » — un vrai dashboard en aside, comme les espaces pharmacie /
    // laboratoire / imagerie / médecin, plutôt qu'une page à défilement. Les anciennes
    // pages dédiées (health-commandes.html, health-notifications.html,
    // health-messages.html, health-ordonnance.html) redirigent maintenant vers
    // health-espace.html?tab=... : ce sont les mêmes conteneurs (mêmes id) qu'avant,
    // simplement regroupés en onglets, donc renderPatientOrders / renderPatientNotifications
    // / renderMyPrescriptions / renderSpace continuent de fonctionner sans changement.
    if (this.view === 'space') {
      this.root.innerHTML = `<div class="health-dashboard" id="health-space-shell">
        <aside class="health-dashboard__aside">
          <div class="health-dashboard__brand"><span class="health-dashboard__brand-mark"><i class="fas fa-heart-pulse"></i></span><span><strong>Mon espace</strong><small>Smart Cut Health</small></span></div>
          <nav class="health-dashboard__nav" aria-label="Navigation Mon espace">
            <button class="is-active" data-tab="overview"><i class="fas fa-gauge"></i> Vue d’ensemble</button>
            <button data-tab="orders"><i class="fas fa-box-open"></i> Mes commandes</button>
            <button data-tab="prescriptions"><i class="fas fa-file-prescription"></i> Mes ordonnances</button>
            <button data-tab="notifications"><i class="fas fa-bell"></i> Notifications</button>
            <button data-tab="messages"><i class="fas fa-message"></i> Messagerie</button>
            <button data-tab="profile"><i class="fas fa-user"></i> Profil</button>
          </nav>
          <div class="health-dashboard__aside-bottom">
            <a href="./index.html"><i class="fas fa-arrow-left"></i> Smart Cut Services</a>
            <a href="#" id="health-space-logout"><i class="fas fa-right-from-bracket"></i> Se déconnecter</a>
          </div>
        </aside>
        <div class="health-dashboard__main">
          <div class="health-dashboard__header"><div><span class="health-eyebrow">Espace personnel</span><h1>Bonjour, <span id="health-dashboard-name">vous</span></h1><p>Votre parcours santé, au même endroit.</p></div></div>

          <section class="health-panel" id="panel-overview">
            <div class="health-dashboard__metrics">
              <article><span>Rendez-vous à venir</span><strong id="health-space-upcoming">—</strong></article>
              <article><span>Ordonnances</span><strong id="health-space-prescriptions">—</strong></article>
              <article><span>Commandes</span><strong id="health-space-orders">—</strong></article>
              <article><span>Notifications</span><strong id="health-space-notifications">—</strong></article>
            </div>
            <section class="hspace__wallet" id="health-wallet-section" hidden>
              <span class="hspace__wallet-icon"><i class="fas fa-wallet"></i></span>
              <div><span>Portefeuille Smart Cut Health</span><strong id="health-wallet-balance">0 HTG</strong><small>Crédité automatiquement en cas de remboursement — utilisable pour un futur paiement.</small></div>
            </section>
            <div class="health-card"><h3 style="margin-top:0;">Mes dernières activités</h3><div id="health-space-auth"><div class="health-empty"><i class="fas fa-lock"></i>Connectez-vous pour consulter vos informations de santé.</div></div></div>
          </section>

          <section class="health-panel" id="panel-orders" hidden>
            <div id="health-patient-orders-empty" class="health-empty"><i class="fas fa-lock"></i>Connectez-vous pour consulter vos commandes.</div>
            <div id="health-patient-orders-groups" hidden>
              <div class="health-subheading"><div><span>Pharmacie</span><h2>Mes commandes de médicaments</h2></div></div><div id="health-orders-pharmacy" class="health-grid"></div>
              <div class="health-subheading health-subheading--spaced"><div><span>Médecin</span><h2>Mes téléconsultations et rendez-vous</h2></div></div><div id="health-orders-doctor" class="health-grid"></div>
              <div class="health-subheading health-subheading--spaced"><div><span>Laboratoire</span><h2>Mes examens de laboratoire</h2></div></div><div id="health-orders-laboratory" class="health-grid"></div>
              <div class="health-subheading health-subheading--spaced"><div><span>Imagerie</span><h2>Mes examens d’imagerie</h2></div></div><div id="health-orders-imaging" class="health-grid"></div>
            </div>
          </section>

          <section class="health-panel" id="panel-prescriptions" hidden>
            <div class="health-secure-layout">
              <div class="health-secure-copy"><span class="health-secure-icon"><i class="fas fa-lock"></i></span><h2>Votre document reste confidentiel.</h2><p>Il est accessible uniquement à vous, aux pharmacies partenaires concernées et aux administrateurs autorisés.</p><ul><li>Image ou PDF</li><li>15 Mo maximum</li><li>Accès journalisé</li></ul></div>
              <form id="health-prescription-form" class="health-form health-card health-upload-card"><div class="health-field"><label for="health-prescription-file">Choisir l’ordonnance</label><input id="health-prescription-file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required></div><div class="health-field"><label for="health-prescription-notes">Note facultative</label><textarea id="health-prescription-notes" maxlength="500" placeholder="Ajoutez uniquement une précision utile."></textarea></div><button class="health-btn primary" type="submit">Transmettre en sécurité</button><div class="health-status" id="health-prescription-status"></div></form>
            </div>
            <div class="health-subheading health-subheading--spaced"><div><span>Historique</span><h2>Mes ordonnances</h2></div></div>
            <div id="health-my-prescriptions"><div class="health-empty"><i class="fas fa-lock"></i>Connectez-vous pour consulter vos ordonnances.</div></div>
          </section>

          <section class="health-panel" id="panel-notifications" hidden>
            <div id="health-patient-notifications" class="health-notification-list"><div class="health-empty"><i class="fas fa-lock"></i>Connectez-vous pour consulter vos notifications.</div></div>
          </section>

          <section class="health-panel" id="panel-messages" hidden>
            <div class="health-card health-empty health-patient-empty"><i class="fas fa-message"></i><h2>Aucune conversation active.</h2><p>La messagerie s’ouvre automatiquement pendant une téléconsultation confirmée.</p><a class="health-btn health-btn-link primary" href="./health-teleconsultation.html">Trouver un médecin</a></div>
          </section>

          <section class="health-panel" id="panel-profile" hidden>
            <div id="health-space-profile" class="health-card">Chargement…</div>
          </section>
        </div>
      </div>${this.renderUtilityDialogs()}`;
      this.bindSpaceTabs();
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
            <a class="pharmacy-head__cta" href="./health-espace.html?tab=prescriptions"><i class="fas fa-file-shield"></i> J’ai une ordonnance</a>
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
          <div class="health-subheading"><div><span>Partenaires vérifiés</span><h2>Pharmacies disponibles</h2></div><a href="./health-espace.html?tab=prescriptions">Envoyer une ordonnance <i class="fas fa-arrow-right"></i></a></div>
          <div id="health-pharmacies" class="health-grid"></div>
        </div></main>
        <div class="health-disclaimer"><div class="health-wrap"><strong>Information importante.</strong> Smart Cut Health facilite la mise en relation. Il ne remplace pas un avis médical. La disponibilité affichée provient des stocks publiés par les pharmacies.</div></div>
      </div>${this.renderUtilityDialogs()}`;
      return;
    }

    let content = '';
    if (this.view === 'pharmacy') content = `<form class="health-search health-search--page" id="health-search-form"><i class="fas fa-magnifying-glass"></i><input id="health-search-input" type="search" minlength="2" placeholder="Nom du médicament ou principe actif" aria-label="Rechercher un médicament"><button type="submit">Rechercher</button></form><div id="health-medicine-results" class="health-empty"><i class="fas fa-magnifying-glass"></i>Saisissez au moins deux caractères pour rechercher dans les stocks publiés.</div><div class="health-subheading"><div><span>Partenaires vérifiés</span><h2>Pharmacies disponibles</h2></div><a href="./health-espace.html?tab=prescriptions">J’ai une ordonnance <i class="fas fa-arrow-right"></i></a></div><div id="health-pharmacies" class="health-grid"></div>`;
    if (this.view === 'doctors') content = `<div class="health-account-bar"><div><strong>Téléconsultation Smart Cut Health</strong><span>Choisissez une spécialité et un plan dont le tarif est fixé côté serveur.</span></div><a class="health-btn health-btn-link primary" href="./health-teleconsultation.html">Voir les consultations</a></div><div class="health-subheading"><div><span>Profils contrôlés</span><h2>Professionnels disponibles</h2></div></div><div id="health-doctors" class="health-grid"><div class="health-empty"><i class="fas fa-circle-notch fa-spin"></i>Chargement des professionnels…</div></div>`;
    if (this.view === 'labs') content = `<div class="health-subheading"><div><span>Partenaires vérifiés</span><h2>Laboratoires</h2></div></div><div id="health-labs" class="health-grid"></div><div class="health-subheading health-subheading--spaced"><div><span>Catalogue publié</span><h2>Examens disponibles</h2></div></div><div id="health-exams" class="health-grid"></div>`;
    if (this.view === 'imaging') content = `<div class="health-subheading"><div><span>Partenaires vérifiés</span><h2>Centres d’imagerie</h2></div></div><div id="health-imaging-centers" class="health-grid"></div><div class="health-subheading health-subheading--spaced"><div><span>Catalogue publié</span><h2>Examens d’imagerie disponibles</h2></div></div><div id="health-imaging-exams" class="health-grid"></div>`;
    if (this.view === 'professional') content = `<div class="health-account-bar"><div><strong>Compte professionnel</strong><span>L’accès dépend de la vérification de votre profil.</span></div><button class="health-btn primary" id="health-login-btn">Se connecter</button></div><div id="health-professional-content"><div class="health-empty"><i class="fas fa-lock"></i>Connectez-vous pour déposer ou gérer une candidature professionnelle.</div></div>`;

    const heroVisual = page.heroImage
      ? `<div class="health-hero-visual health-hero-visual--photo" role="img" aria-label="Illustration ${esc(page.eyebrow)}"><img src="${page.heroImage}" alt="" loading="eager"></div>`
      : `<div class="health-hero-visual health-art-${esc(page.art || this.view)}" role="img" aria-label="Illustration ${esc(page.eyebrow)}"><i class="fas ${page.icon}"></i><span class="health-art-orb"></span><span class="health-art-card"></span></div>`;
    this.root.innerHTML = `<div class="health-shell health-route health-route--${esc(this.view)}"><section class="health-page-hero"><div class="health-wrap health-hero-layout"><div class="health-hero-copy"><span class="health-eyebrow"><i class="fas ${page.icon}"></i> ${page.eyebrow}</span><h1>${page.title}</h1><p>${page.copy}</p></div>${heroVisual}</div></section><main class="health-route-main"><div class="health-wrap">${content}</div></main><div class="health-disclaimer"><div class="health-wrap"><strong>Information importante.</strong> Smart Cut Health facilite la mise en relation. Il ne remplace pas un avis médical.</div></div></div>${this.renderUtilityDialogs()}`;
  }

  renderUtilityDialogs() {
    return `<button id="health-cart-button" class="health-cart" hidden><i class="fas fa-basket-shopping"></i> Panier <span id="health-cart-count">0</span></button><dialog class="health-dialog" id="health-prescription-dialog"><div class="health-dialog-head"><strong>Envoyer mon ordonnance</strong><button class="health-icon-btn" data-close="health-prescription-dialog" aria-label="Fermer"><i class="fas fa-times"></i></button></div><div class="health-dialog-body"><form id="health-prescription-dialog-form" class="health-form"><div class="health-notice"><i class="fas fa-lock"></i> Fichier privé — image ou PDF, 15 Mo maximum.</div><div class="health-field"><label for="health-prescription-dialog-file">Ordonnance</label><input id="health-prescription-dialog-file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required></div><div class="health-field"><label for="health-prescription-dialog-notes">Note facultative</label><textarea id="health-prescription-dialog-notes" maxlength="500"></textarea></div><button class="health-btn primary" type="submit">Transmettre</button><div class="health-status" id="health-prescription-dialog-status"></div></form></div></dialog><dialog class="health-dialog" id="health-cart-dialog"><div class="health-dialog-head"><strong>Commande pharmacie</strong><button class="health-icon-btn" data-close="health-cart-dialog" aria-label="Fermer"><i class="fas fa-times"></i></button></div><div class="health-dialog-body" id="health-cart-content"></div></dialog><dialog class="health-dialog" id="health-book-dialog"><div class="health-dialog-head"><strong>Choisir un créneau</strong><button class="health-icon-btn" data-close="health-book-dialog" aria-label="Fermer"><i class="fas fa-times"></i></button></div><div class="health-dialog-body" id="health-book-content"></div></dialog>`;
  }

  // Bascule d'onglets propre à Mon espace (même mécanisme que les dashboards
  // prestataires : bouton data-tab / panneau id="panel-x") plutôt que le
  // mécanisme générique .health-tab utilisé ailleurs dans ce fichier (résultats
  // de recherche pharmacie/médecins), pour ne jamais mélanger les deux.
  // Prend en charge ?tab=... pour que les anciennes pages redirigées
  // (health-commandes.html, health-notifications.html, health-messages.html,
  // health-ordonnance.html) rouvrent directement le bon onglet.
  bindSpaceTabs() {
    const shell = document.getElementById('health-space-shell');
    if (!shell) return;
    const select = (name) => {
      shell.querySelectorAll('.health-dashboard__nav button[data-tab]').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === name));
      shell.querySelectorAll('.health-panel').forEach((p) => { p.hidden = p.id !== `panel-${name}`; });
    };
    shell.querySelectorAll('.health-dashboard__nav button[data-tab]').forEach((b) => b.addEventListener('click', () => select(b.dataset.tab)));
    document.getElementById('health-space-logout')?.addEventListener('click', (e) => { e.preventDefault(); signOut(auth).catch(() => {}); });
    const requested = new URLSearchParams(window.location.search).get('tab');
    const known = ['overview', 'orders', 'prescriptions', 'notifications', 'messages', 'profile'];
    if (requested && known.includes(requested)) select(requested);
  }

  async renderSpaceProfile() {
    const box = document.getElementById('health-space-profile');
    if (!box) return;
    if (!this.user) { box.innerHTML = '<div class="health-empty"><i class="fas fa-lock"></i>Connectez-vous pour voir votre profil.</div>'; return; }
    const name = this.profile?.displayName || this.user.displayName || this.user.email?.split('@')[0] || 'Vous';
    const role = String(this.profile?.role || '').toLowerCase();
    const roleLabels = { doctor: 'Médecin vérifié', pharmacy: 'Pharmacie vérifiée', laboratory: 'Laboratoire vérifié', imaging: 'Centre d’imagerie vérifié' };
    const dashboardHrefs = { doctor: './health-doctor.html', pharmacy: './health-pharmacy-dashboard.html', laboratory: './health-laboratory-dashboard.html', imaging: './health-imaging-dashboard.html' };
    const providerNote = roleLabels[role]
      ? `<i class="fas fa-shield-heart"></i> ${esc(roleLabels[role])} — <a href="${dashboardHrefs[role]}">ouvrir mon espace professionnel <i class="fas fa-arrow-right"></i></a>`
      : `<i class="fas fa-user-plus"></i> Vous n’avez pas encore d’espace professionnel. <a href="./health-candidature.html">Devenir prestataire <i class="fas fa-arrow-right"></i></a>`;
    box.innerHTML = `<h3 style="margin-top:0;">Mon profil</h3><div class="health-form-grid"><div class="health-field"><span class="health-field-label">Nom</span><p style="margin:0;color:var(--health-ink);font-weight:700;">${esc(name)}</p></div><div class="health-field"><span class="health-field-label">E-mail</span><p style="margin:0;color:var(--health-ink);font-weight:700;">${esc(this.user.email || '—')}</p></div></div><div class="health-notice" style="margin-top:1rem;">${providerNote}</div>`;
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
    if (this.view === 'space') {
      // Toutes les données de Mon espace se chargent ensemble au login : les onglets ne
      // font que montrer/cacher des panneaux déjà remplis, pas de rechargement au clic.
      await Promise.all([this.renderSpace(), this.renderPatientOrders(), this.renderPatientNotifications(), this.renderMyPrescriptions(), this.renderSpaceProfile()]);
    }
    if (this.view === 'professional') this.renderProfessional();
  }

  notifIcon(type) {
    const map = {
      appointment_proposed: 'fa-calendar-plus', appointment_expired: 'fa-calendar-xmark', payment_confirmed: 'fa-circle-check',
      teleconsultation_accepted: 'fa-video', teleconsultation_refused: 'fa-video-slash', refund_credited: 'fa-wallet',
      prescription_received: 'fa-file-prescription', pharmacy_order: 'fa-box-open', new_teleconsultation: 'fa-user-doctor',
      order_cancelled: 'fa-ban', order_status_changed: 'fa-truck', diagnostic_order_refused: 'fa-vial-circle-xmark',
      session_message: 'fa-message', appointment_status_changed: 'fa-calendar-day'
    };
    return map[type] || 'fa-bell';
  }

  // Real per-user notification inbox (healthNotifications) — read/unread, click-through,
  // and the "Rendez-vous expiré" interactive prompt when that specific type is opened.
  async renderPatientNotifications() {
    const root = document.getElementById('health-patient-notifications');
    if (!root || !this.user) return;
    root.innerHTML = '<div class="health-empty"><i class="fas fa-circle-notch fa-spin"></i>Chargement…</div>';
    if (this.notifUnsub) this.notifUnsub();
    const q = query(collection(db, 'healthNotifications'), where('userId', '==', this.user.uid), orderBy('createdAt', 'desc'), limit(60));
    this.notifUnsub = onSnapshot(q, (snap) => {
      const notifications = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (!notifications.length) {
        root.innerHTML = '<div class="health-card health-empty health-patient-empty"><i class="fas fa-bell"></i><h2>Aucune notification.</h2><p>Les évolutions de vos rendez-vous, commandes et ordonnances apparaîtront ici.</p></div>';
        return;
      }
      root.innerHTML = notifications.map((n) => `
        <div class="health-notification ${n.read ? '' : 'is-unread'}" data-notif-id="${n.id}" data-notif-type="${esc(n.type)}" data-notif-url="${esc(n.url || '')}" data-appointment-id="${esc(n.context?.appointmentId || '')}" role="button" tabindex="0">
          <span><i class="fas ${this.notifIcon(n.type)}"></i></span>
          <div><strong>${esc(n.title)}</strong><p>${esc(n.body)}</p></div>
          <time>${n.createdAt ? new Date(n.createdAt).toLocaleDateString('fr-HT', { day: 'numeric', month: 'short' }) : ''}</time>
          <i class="fas fa-chevron-right"></i>
        </div>`).join('');
      root.querySelectorAll('[data-notif-id]').forEach((el) => {
        const go = () => this.handleNotificationClick(el.dataset.notifId, el.dataset.notifType, el.dataset.notifUrl, el.dataset.appointmentId);
        el.addEventListener('click', go);
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      });
    }, () => { root.innerHTML = '<div class="health-empty"><i class="fas fa-triangle-exclamation"></i>Notifications indisponibles.</div>'; });
  }

  async handleNotificationClick(notifId, type, url, appointmentId) {
    updateDoc(doc(db, 'healthNotifications', notifId), { read: true, readAt: new Date().toISOString() }).catch(() => {});
    if (type === 'appointment_expired' && appointmentId) { this.openExpiredAppointmentPrompt(appointmentId); return; }
    if (url) window.location.assign(url);
  }

  // « Rendez-vous Expiré — Demander un nouveau rendez-vous ? Oui / Non »
  async openExpiredAppointmentPrompt(appointmentId) {
    const box = document.getElementById('health-cart-content');
    box.innerHTML = `<div class="health-card"><h3>Rendez-vous expiré</h3><p>Vous n’avez pas payé ce rendez-vous à temps et le créneau a été libéré.</p><p><strong>Demander un nouveau rendez-vous ?</strong></p><div class="health-card-actions"><button class="health-btn primary" id="expiredRetryBtn">Oui</button><button class="health-btn secondary" id="expiredDismissBtn">Non</button></div><div class="health-status" id="expiredStatus"></div></div>`;
    document.getElementById('health-cart-dialog').showModal();
    document.getElementById('expiredRetryBtn').addEventListener('click', async () => {
      const status = document.getElementById('expiredStatus');
      status.textContent = 'Préparation du paiement…';
      try {
        const retried = await callHealth('healthRetryExpiredAppointment', { method: 'POST', requireAuth: true, body: { appointmentId } });
        const payment = await callHealth('healthCreateAppointmentPayment', { method: 'POST', requireAuth: true, body: { appointmentId: retried.appointmentId } });
        localStorage.setItem('smartcut_health_payment', JSON.stringify({ sessionId: payment.sessionId, orderId: payment.orderId, amount: payment.total }));
        window.location.assign(payment.checkoutUrl);
      } catch (error) { status.className = 'health-status error'; status.textContent = error.message; }
    });
    document.getElementById('expiredDismissBtn').addEventListener('click', async () => {
      if (!confirm('Confirmer la suppression de ce rendez-vous expiré ? Cette action est définitive.')) return;
      try {
        await callHealth('healthDismissExpiredAppointment', { method: 'POST', requireAuth: true, body: { appointmentId } });
        document.getElementById('health-cart-dialog').close();
      } catch (error) { alert(error.message); }
    });
  }

  // "Mes commandes" is split by provider type: pharmacy purchases keep their delivery-style
  // progress card, while doctor/laboratory/imaging entries are payments tied to an
  // appointment (healthOrders kind:'appointment') and are shown against the appointment's
  // own real status (fetched separately) rather than a fabricated delivery pipeline.
  // Unifies the two kinds of prescriptions a patient can have: a scanned paper prescription
  // they uploaded themselves (healthPrescriptions — private file, opened via a signed URL)
  // and a doctor-issued e-prescription written during a teleconsultation
  // (healthClinicalPrescriptions — plain, already access-controlled Firestore data, no file).
  async renderMyPrescriptions() {
    const root = document.getElementById('health-my-prescriptions');
    if (!root || !this.user) return;
    root.innerHTML = '<div class="health-empty"><i class="fas fa-circle-notch fa-spin"></i>Chargement…</div>';
    try {
      const [scannedSnap, clinicalSnap] = await Promise.all([
        getDocs(query(collection(db, 'healthPrescriptions'), where('patientUid', '==', this.user.uid), limit(50))),
        getDocs(query(collection(db, 'healthClinicalPrescriptions'), where('patientUid', '==', this.user.uid), limit(50)))
      ]);
      const at = (v) => (v?.toDate ? v.toDate().getTime() : (v ? new Date(v).getTime() : 0));
      const scanned = scannedSnap.docs.map((d) => ({ id: d.id, kind: 'scanned', ts: at(d.data().createdAt), ...d.data() }));
      const clinical = clinicalSnap.docs.map((d) => ({ id: d.id, kind: 'clinical', ts: at(d.data().createdAt), ...d.data() }));
      const rows = [...scanned, ...clinical].sort((a, b) => (b.ts || 0) - (a.ts || 0));
      if (!rows.length) { root.innerHTML = '<div class="health-card health-empty health-patient-empty"><i class="fas fa-file-prescription"></i><h2>Aucune ordonnance pour le moment.</h2><p>Vos ordonnances transmises et celles reçues d’un médecin apparaîtront ici.</p></div>'; return; }
      root.innerHTML = rows.map((p) => {
        const when = p.ts ? new Date(p.ts).toLocaleDateString('fr-HT', { day:'numeric', month:'short', year:'numeric' }) : '';
        if (p.kind === 'scanned') {
          return `<article class="health-card" data-open-scanned="${esc(p.id)}" role="button" tabindex="0" style="cursor:pointer;"><span class="health-badge"><i class="fas fa-file-image"></i> Ordonnance scannée</span><h3 style="margin:.5rem 0 0;">Transmise le ${esc(when)}</h3><p class="muted">${esc(statusLabel(p.status))}${p.notes ? ' · ' + esc(p.notes) : ''}</p></article>`;
        }
        const lines = [
          ...(Array.isArray(p.medications) ? p.medications.map((m) => `${m.name}${m.dosage ? ' — ' + m.dosage : ''}${m.instructions ? ' (' + m.instructions + ')' : ''}`) : []),
          ...(Array.isArray(p.labExams) ? p.labExams.map((e) => `Examen laboratoire : ${e}`) : []),
          ...(Array.isArray(p.imagingExams) ? p.imagingExams.map((e) => `Examen imagerie : ${e}`) : [])
        ];
        return `<article class="health-card"><span class="health-badge"><i class="fas fa-user-doctor"></i> Ordonnance médecin</span><h3 style="margin:.5rem 0 0;">${esc(p.specialtyName || 'Consultation')} · ${esc(when)}</h3>${lines.length ? `<ul style="margin:.5rem 0 0;padding-left:1.1rem;">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}${p.notes ? `<p class="muted" style="margin-top:.5rem;">${esc(p.notes)}</p>` : ''}</article>`;
      }).join('');
      root.querySelectorAll('[data-open-scanned]').forEach((el) => {
        const go = () => this.openPrivate('prescription', el.dataset.openScanned);
        el.addEventListener('click', go);
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      });
    } catch (error) { root.innerHTML = `<div class="health-empty"><i class="fas fa-triangle-exclamation"></i>${esc(error.message)}</div>`; }
  }

  async renderPatientOrders() {
    const emptyBox = document.getElementById('health-patient-orders-empty');
    const groupsBox = document.getElementById('health-patient-orders-groups');
    if (!emptyBox || !groupsBox || !this.user) return;
    emptyBox.hidden = true; groupsBox.hidden = false;
    const pharmacyRoot = document.getElementById('health-orders-pharmacy');
    const doctorRoot = document.getElementById('health-orders-doctor');
    const labRoot = document.getElementById('health-orders-laboratory');
    const imagingRoot = document.getElementById('health-orders-imaging');
    [pharmacyRoot, doctorRoot, labRoot, imagingRoot].forEach((el) => { if (el) el.innerHTML = '<div class="health-empty"><i class="fas fa-circle-notch fa-spin"></i>Chargement…</div>'; });
    try {
      const [orderSnap, apptSnap] = await Promise.all([
        getDocs(query(collection(db, 'healthOrders'), where('patientUid', '==', this.user.uid), limit(50))),
        getDocs(query(collection(db, 'healthAppointments'), where('patientUid', '==', this.user.uid), limit(50)))
      ]);
      const appointments = new Map(apptSnap.docs.map((d) => [d.id, d.data()]));
      const orders = orderSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      const pharmacyOrders = orders.filter((o) => o.kind !== 'appointment');
      const appointmentOrders = orders.filter((o) => o.kind === 'appointment');
      if (pharmacyRoot) pharmacyRoot.innerHTML = pharmacyOrders.length ? pharmacyOrders.map((o) => { const status=String(o.status||'').toUpperCase();const stages=['PAID','PREPARING','READY','DELIVERED'];const active=Math.max(0,stages.indexOf(status));const items=Array.isArray(o.items)?o.items:[];return `<article class="health-order-card"><div class="health-order-card__head"><div><span class="health-eyebrow">Commande ${esc(o.id.slice(0, 8))}</span><h2>${esc(o.pharmacyName||'Pharmacie partenaire')}</h2></div><span class="health-badge">${esc(statusLabel(o.status))}</span></div><div class="health-order-card__items">${items.slice(0,3).map(item=>`<span>${esc(item.name||'Produit santé')} <b>×${Number(item.qty)||1}</b></span>`).join('')||'<span>Articles en cours de préparation</span>'}</div><div class="health-order-card__progress" aria-label="Avancement de la commande">${stages.map((stage,index)=>`<span class="${index<=active?'is-done':''}"><i class="fas ${index<=active?'fa-check':'fa-circle'}"></i><small>${['Payée','Préparation','Prête','Terminée'][index]}</small></span>`).join('')}</div><div class="health-order-card__foot"><span><i class="fas ${o.deliveryMethod==='home'?'fa-truck':'fa-store'}"></i> ${esc(o.deliveryMethod==='home'?'Livraison à domicile':'Retrait en pharmacie')}</span><strong>${money(o.total)}</strong></div></article>`; }).join('') : '<div class="health-empty"><i class="fas fa-box-open"></i>Aucune commande de médicaments pour le moment.</div>';
      const appointmentCard = (o, appt) => { const item = (Array.isArray(o.items) && o.items[0]) || {}; const when = appt?.startsAt ? new Date(appt.startsAt).toLocaleString('fr-HT', { dateStyle:'medium', timeStyle:'short' }) : null; const status = appt?.status || o.status; return `<article class="health-order-card"><div class="health-order-card__head"><div><span class="health-eyebrow">${when || 'Date à confirmer'}</span><h2>${esc(item.name || o.specialtyName || o.examName || 'Rendez-vous santé')}</h2></div><span class="health-badge">${esc(statusLabel(status))}</span></div><div class="health-order-card__foot"><span><i class="fas fa-user-doctor"></i> ${esc(appt?.providerName || 'Professionnel vérifié')}</span><strong>${money(o.total)}</strong></div></article>`; };
      const byType = (type) => appointmentOrders.filter((o) => o.providerType === type);
      const renderGroup = (root, list, emptyMessage) => { if (!root) return; root.innerHTML = list.length ? list.map((o) => appointmentCard(o, appointments.get(o.appointmentId))).join('') : `<div class="health-empty"><i class="fas fa-inbox"></i>${emptyMessage}</div>`; };
      renderGroup(doctorRoot, byType('doctor'), 'Aucune téléconsultation ou rendez-vous pour le moment.');
      renderGroup(labRoot, byType('laboratory'), 'Aucun examen de laboratoire pour le moment.');
      renderGroup(imagingRoot, byType('imaging'), 'Aucun examen d’imagerie pour le moment.');
    } catch (error) {
      [pharmacyRoot, doctorRoot, labRoot, imagingRoot].forEach((el) => { if (el) el.innerHTML = `<div class="health-empty"><i class="fas fa-triangle-exclamation"></i>${esc(error.message)}</div>`; });
    }
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
    const [pharmacies, doctors, labs, exams, medicines, imagingCenters, imagingExams] = await Promise.all([
      callHealth('healthListVerifiedPharmacies').catch(() => ({ pharmacies:[] })), callHealth('healthListDoctors').catch(() => ({ doctors:[] })), callHealth('healthListLaboratories').catch(() => ({ laboratories:[] })), callHealth('healthListLabExams').catch(() => ({ exams:[] })), callHealth('healthListAvailableMedicines').catch(() => ({ medicines:[] })), callHealth('healthListImagingCenters').catch(() => ({ centers:[] })), callHealth('healthListImagingExams').catch(() => ({ exams:[] }))
    ]);
    this.pharmacies = pharmacies.pharmacies || [];
    this.doctors = doctors.doctors || [];
    this.labs = labs.laboratories || [];
    this.exams = exams.exams || [];
    this.medicines = medicines.medicines || [];
    this.imagingCenters = imagingCenters.centers || [];
    this.imagingExams = imagingExams.exams || [];
    const pharmaciesRoot = document.getElementById('health-pharmacies');
    const doctorsRoot = document.getElementById('health-doctors');
    const labsRoot = document.getElementById('health-labs');
    const examsRoot = document.getElementById('health-exams');
    const imagingCentersRoot = document.getElementById('health-imaging-centers');
    const imagingExamsRoot = document.getElementById('health-imaging-exams');
    const homeMedicinesRoot = document.getElementById('health-home-medicines');
    const homeDoctorsRoot = document.getElementById('health-home-doctors');
    if (pharmaciesRoot) pharmaciesRoot.innerHTML = this.cards(this.pharmacies, (p) => `<span class="health-badge"><i class="fas fa-circle-check"></i> Vérifiée</span><h3>${esc(p.businessName)}</h3><p>${esc([p.commune,p.department].filter(Boolean).join(', ') || p.address)}</p><p>${esc(p.phone)}</p>`);
    if (doctorsRoot) doctorsRoot.innerHTML = this.cards(this.doctors, (p) => `<span class="health-badge"><i class="fas fa-circle-check"></i> Vérifié</span><h3>${esc(p.name)}</h3><p><strong>${esc(p.specialty)}</strong></p><p>${esc([p.facility,p.commune].filter(Boolean).join(' · '))}</p>${p.indicativeFee ? `<div class="price">${money(p.indicativeFee)}</div>`:''}<div class="health-card-actions"><button class="health-btn primary" data-book-provider="${esc(p.id)}" data-provider-name="${esc(p.name)}">Prendre rendez-vous</button></div>`);
    if (labsRoot) labsRoot.innerHTML = this.cards(this.labs, (p) => `<span class="health-badge"><i class="fas fa-circle-check"></i> Vérifié</span><h3>${esc(p.name)}</h3><p>${esc([p.address,p.commune,p.department].filter(Boolean).join(' · '))}</p><p>Choisissez un examen publié ci-dessous pour réserver.</p>`);
    if (examsRoot) examsRoot.innerHTML = this.renderExamCatalog(this.exams, 'laboratory');
    if (imagingCentersRoot) imagingCentersRoot.innerHTML = this.cards(this.imagingCenters, (p) => `<span class="health-badge"><i class="fas fa-circle-check"></i> Vérifié</span><h3>${esc(p.name)}</h3><p>${esc([p.address,p.commune,p.department].filter(Boolean).join(' · '))}</p><p>Choisissez un examen publié ci-dessous pour réserver.</p>`);
    if (imagingExamsRoot) imagingExamsRoot.innerHTML = this.renderExamCatalog(this.imagingExams, 'imaging');
    if (homeMedicinesRoot) homeMedicinesRoot.innerHTML = this.homeCards(this.medicines, 'fa-capsules', 'Aucun médicament publié pour le moment.', (p) => `<span class="health-badge"><i class="fas fa-circle-check"></i> En stock</span><h3>${esc(p.name)}</h3><p>${esc([p.dosage, p.pharmaceuticalForm].filter(Boolean).join(' · ') || p.pharmacyName)}</p><div class="health-card-footer"><strong>${money(p.price)}</strong><a href="./health-pharmacie.html?search=${encodeURIComponent(p.name)}">Voir <i class="fas fa-arrow-right"></i></a></div>`);
    if (homeDoctorsRoot) homeDoctorsRoot.innerHTML = this.homeCards(this.doctors, 'fa-user-doctor', 'Aucun médecin disponible pour le moment.', (p) => `<span class="health-badge"><i class="fas fa-circle-check"></i> Vérifié</span><h3>${esc(p.name)}</h3><p><strong>${esc(p.specialty)}</strong></p><p>${esc([p.facility, p.commune].filter(Boolean).join(' · ') || 'Smart Cut Health')}</p><div class="health-card-footer">${p.indicativeFee ? `<strong>${money(p.indicativeFee)}</strong>` : '<span></span>'}<a href="./health-medecins.html">Consulter <i class="fas fa-arrow-right"></i></a></div>`);
    document.querySelectorAll('[data-book-provider]').forEach((b) => b.addEventListener('click', () => this.openBooking(b.dataset.bookProvider, b.dataset.providerName, b.dataset.examId || '')));
  }

  cards(items, render) { return items.length ? items.map((item) => `<article class="health-card">${render(item)}</article>`).join('') : '<div class="health-empty"><i class="fas fa-inbox"></i>Aucun partenaire publié pour le moment.</div>'; }

  renderExamCatalog(items, type) {
    if (!items.length) return '<div class="health-empty"><i class="fas fa-inbox"></i>Aucun examen publié pour le moment.</div>';
    const grouped = new Map();
    items.forEach((item) => {
      const categoryKey = item.catalogCategoryId || item.catalogCategoryName || item.category || 'autres';
      const subcategory = item.catalogSubcategory || item.subcategory || '';
      const key = `${categoryKey}::${subcategory}`;
      if (!grouped.has(key)) grouped.set(key, { label: item.catalogCategoryName || item.category || 'Autres examens', subcategory, items: [] });
      grouped.get(key).items.push(item);
    });
    return [...grouped.values()].map((group) => `<section class="health-exam-category"><div class="health-subheading"><div><span>${type === 'imaging' ? 'Imagerie médicale' : 'Laboratoire'}</span><h3>${esc(group.label)}</h3>${group.subcategory ? `<small class="health-exam-subcategory">${esc(group.subcategory)}</small>` : ''}</div><small>${group.items.length} examen${group.items.length > 1 ? 's' : ''}</small></div><div class="health-grid">${this.cards(group.items, (p) => `<span class="health-badge">Examen</span><h3>${esc(p.name)}</h3><p>${esc(p.description || p.preparation || p.specimen || '')}</p><div class="price">${money(p.price)}</div><div class="health-card-actions"><button class="health-btn primary" data-book-provider="${esc(type === 'imaging' ? p.imagingCenterId : p.laboratoryId)}" data-provider-name="${esc(type === 'imaging' ? 'Centre d’imagerie' : 'Laboratoire')}" data-exam-id="${esc(p.id)}">Choisir un créneau</button></div>` )}</div></section>`).join('');
  }

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

  renderWallet() {
    const section = document.getElementById('health-wallet-section');
    if (!section) return;
    if (this.walletUnsub) this.walletUnsub();
    if (!this.user) { section.hidden = true; return; }
    this.walletUnsub = onSnapshot(doc(db, 'healthPatientWallets', this.user.uid), (snap) => {
      const balance = Number(snap.data()?.balance || 0);
      section.hidden = balance <= 0;
      const strong = document.getElementById('health-wallet-balance');
      if (strong) strong.textContent = money(balance);
    }, () => { section.hidden = true; });
  }

  async renderSpace() {
    const root = document.getElementById('health-space-auth');
    if (!root) return;
    const name = this.profile?.displayName || this.profile?.businessName || this.user?.displayName || this.user?.email?.split('@')[0] || 'vous';
    const nameNode = document.getElementById('health-dashboard-name'); if (nameNode) nameNode.textContent = name;
    this.renderWallet();

    if (!this.user) {
      root.innerHTML = '<div class="health-empty"><i class="fas fa-lock"></i><p>Connectez-vous pour voir vos dernières activités santé.</p><button class="health-btn primary" id="health-space-login" type="button">Se connecter</button></div>';
      root.querySelector('#health-space-login')?.addEventListener('click', () => this.requireUser());
      return;
    }
    root.innerHTML = '<div class="health-empty"><i class="fas fa-circle-notch fa-spin"></i>Chargement…</div>';
    try {
      const [rxSnap, orderSnap, apptSnap] = await Promise.all([
        getDocs(query(collection(db, 'healthPrescriptions'), where('patientUid', '==', this.user.uid), limit(50))),
        getDocs(query(collection(db, 'healthOrders'), where('patientUid', '==', this.user.uid), limit(50))),
        getDocs(query(collection(db, 'healthAppointments'), where('patientUid', '==', this.user.uid), limit(50)))
      ]);
      const at = (v) => (v?.toDate ? v.toDate().getTime() : (v ? new Date(v).getTime() : 0));
      const now = Date.now();
      const upcoming = apptSnap.docs.filter((d) => {
        const item = d.data() || {};
        return at(item.startsAt) >= now && !['CANCELLED', 'COMPLETED', 'NO_SHOW'].includes(item.status);
      }).sort((a, b) => at(a.data()?.startsAt) - at(b.data()?.startsAt));
      document.getElementById('health-space-upcoming')?.replaceChildren(document.createTextNode(String(upcoming.length)));
      document.getElementById('health-space-prescriptions')?.replaceChildren(document.createTextNode(String(rxSnap.size)));
      document.getElementById('health-space-orders')?.replaceChildren(document.createTextNode(String(orderSnap.size)));
      const rows = [];
      rxSnap.docs.forEach((d) => { const p = d.data() || {}; rows.push({ ts: at(p.createdAt) || at(p.updatedAt), icon: 'fa-file-prescription', title: 'Ordonnance', subtitle: `Ordonnance ${d.id.slice(0, 8)}`, status: statusLabel(p.status), act: { type: 'open-private', kind: 'prescription', id: d.id } }); });
      orderSnap.docs.forEach((d) => { const o = d.data() || {}; rows.push({ ts: at(o.paidAt) || at(o.createdAt), icon: 'fa-pills', title: 'Commande médicament', subtitle: (o.items && o.items[0] && o.items[0].name) || `Commande ${d.id.slice(0, 8)}`, status: statusLabel(o.status) }); });
      apptSnap.docs.forEach((d) => { const a = d.data() || {}; const lab = a.providerType === 'laboratory'; const imaging = a.providerType === 'imaging'; const isDoctor = a.providerType === 'doctor'; const sessionStatus=['CONFIRMED','DOCTOR_ACCEPTED','IN_PROGRESS'].includes(a.status); rows.push({ ts: at(a.startsAt) || at(a.createdAt), icon: lab ? 'fa-vial' : (imaging ? 'fa-x-ray' : 'fa-video'), title: lab ? 'Examen laboratoire' : (imaging ? 'Examen d’imagerie' : 'Téléconsultation'), subtitle: a.providerName || a.specialtyName || a.examName || a.planName || '—', status: statusLabel(a.status), act: isDoctor && sessionStatus ? { type: 'open-session', id: d.id } : null }); });
      rows.sort((x, y) => (y.ts || 0) - (x.ts || 0));
      document.getElementById('health-space-notifications')?.replaceChildren(document.createTextNode(String(rows.length)));

      if (!rows.length) {
        root.innerHTML = '<div class="health-empty"><i class="fas fa-inbox"></i>Aucune activité pour le moment.</div>';
        return;
      }
      root.innerHTML = rows.slice(0, 12).map((r) => `
        <div class="hspace__activity"${r.act ? ` data-act-type="${r.act.type}" data-act-kind="${esc(r.act.kind || '')}" data-act-id="${esc(r.act.id)}" role="button" tabindex="0"` : ''}>
          <span class="hspace__activity-ico"><i class="fas ${r.icon}"></i></span>
          <span class="hspace__activity-text"><strong>${esc(r.title)}</strong><small>${esc(r.subtitle)}</small></span>
          <span class="hspace__activity-status">${esc(r.status)}</span>
          <span class="hspace__activity-date">${r.ts ? new Date(r.ts).toLocaleDateString('fr-HT', { day: 'numeric', month: 'long', year: 'numeric' }) : ''}</span>
          <i class="fas fa-chevron-right hspace__activity-chev"></i>
        </div>`).join('');
      root.querySelectorAll('[data-act-type]').forEach((el) => {
        const go = () => {
          if (el.dataset.actType === 'open-private') this.openPrivate(el.dataset.actKind, el.dataset.actId);
          else if (el.dataset.actType === 'open-session') window.location.assign(`./health-session.html?appointment=${encodeURIComponent(el.dataset.actId)}`);
          else if (el.dataset.actType === 'cancel-appt') this.cancelAppointment(el.dataset.actId);
        };
        el.addEventListener('click', go);
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      });
    } catch (error) {
      root.innerHTML = `<div class="health-empty"><i class="fas fa-triangle-exclamation"></i>${esc(error.message)}</div>`;
    }
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
    const role=this.profile?.role;const verified=(role==='pharmacy'&&this.profile?.pharmacyStatus==='verified')||(role==='doctor'&&this.profile?.doctorStatus==='verified')||(role==='laboratory'&&this.profile?.labStatus==='verified')||(role==='imaging'&&this.profile?.imagingStatus==='verified');
    if(!verified){const status=this.profile?.doctorStatus||this.profile?.pharmacyStatus||this.profile?.labStatus||this.profile?.imagingStatus||'';root.innerHTML=`<div class="health-professional-onboarding"><span class="health-secure-icon"><i class="fas fa-shield-heart"></i></span><div><span class="health-eyebrow">Candidature professionnelle</span><h2>${status==='submitted'||status==='pending'?'Votre dossier est en vérification.':'Présentez votre activité à Smart Cut Health.'}</h2><p>${status==='submitted'||status==='pending'?'La publication restera bloquée jusqu’à la décision humaine de l’équipe Smart Cut.':'Un parcours distinct est prévu pour les médecins, pharmacies, laboratoires et centres d’imagerie, avec brouillon et contrôle documentaire.'}</p></div><a class="health-btn health-btn-link primary" href="./health-candidature.html">${status==='submitted'||status==='pending'?'Suivre mon dossier':'Commencer ma candidature'}</a></div>`;return;}
    // Les quatre métiers ont désormais chacun leur propre dashboard dédié.
    const dedicatedDashboard={
      doctor:['./health-doctor.html','Ouvrir mon espace médecin'],
      pharmacy:['./health-pharmacy-dashboard.html','Ouvrir mon espace pharmacie'],
      laboratory:['./health-laboratory-dashboard.html','Ouvrir mon espace laboratoire'],
      imaging:['./health-imaging-dashboard.html','Ouvrir mon espace imagerie']
    }[role];
    root.innerHTML=`<div class="health-notice"><i class="fas fa-circle-check"></i> Compte ${esc(role)} vérifié.</div>${dedicatedDashboard?`<a class="health-btn primary" href="${dedicatedDashboard[0]}" style="display:inline-flex;margin-top:1rem">${dedicatedDashboard[1]}</a>`:''}`;
  }

  async applyProfessional(e){e.preventDefault();const status=document.getElementById('health-application-status');try{const data=Object.fromEntries(new FormData(e.target));delete data.documents;data.professionalName=data.businessName;const files=[...e.target.documents.files];const allowed=['image/jpeg','image/png','image/webp','application/pdf'];if(files.some(f=>!allowed.includes(f.type)||f.size>10*1024*1024))throw new Error('Chaque document doit être une image ou un PDF de 10 Mo maximum.');const folder={pharmacy:'health-pharmacy-docs',doctor:'health-doctor-docs',laboratory:'health-lab-docs'}[data.type];data.documentPaths=[];for(let i=0;i<files.length;i+=1){status.textContent=`Envoi privé du document ${i+1}/${files.length}…`;const f=files[i],ext=f.type==='application/pdf'?'pdf':(f.type.split('/')[1]||'jpg').replace('jpeg','jpg'),path=`${folder}/${this.user.uid}/verification-${Date.now()}-${i}.${ext}`;await uploadBytes(ref(storage,path),f,{contentType:f.type,cacheControl:'private,no-store,max-age=0'});data.documentPaths.push(path)}await callHealth('healthApplyProfessional',{method:'POST',requireAuth:true,body:data});status.className='health-status success';status.textContent='Candidature enregistrée avec le statut En attente.';}catch(error){status.className='health-status error';status.textContent=error.message;}}

  async renderProfessionalTools(role){
    const root=document.getElementById('health-pro-tools');
    if(role==='pharmacy'){
      root.innerHTML=`<div class="health-provider-metrics"><article><span>Produits publiés</span><strong id="health-product-count">—</strong></article><article><span>Nouvelles commandes</span><strong>—</strong></article><article><span>Stock faible</span><strong id="health-low-stock-count">—</strong></article><article><span>Solde disponible</span><strong>— HTG</strong></article></div><div class="health-tabs"><button class="health-tab active">Produits & stock</button></div><form id="health-medicine-form" class="health-card health-form"><input name="productId" type="hidden"><div class="health-provider-section__head"><div><span class="health-eyebrow">Catalogue</span><h3 id="health-medicine-form-title">Ajouter un médicament</h3></div><button class="health-btn secondary" type="button" id="health-medicine-cancel" hidden>Annuler</button></div><div class="health-form-grid"><div class="health-field"><label>Nom</label><input name="name" required></div><div class="health-field"><label>DCI</label><input name="dci"></div><div class="health-field"><label>Dosage</label><input name="dosage"></div><div class="health-field"><label>Forme pharmaceutique</label><input name="pharmaceuticalForm"></div><div class="health-field"><label>Classe thérapeutique</label><input name="therapeuticClass"></div><div class="health-field"><label>Prix HTG</label><input name="price" type="number" min="0" required></div><div class="health-field"><label>Stock réel</label><input name="stock" type="number" min="0" required></div><div class="health-field"><label><input name="prescriptionRequired" type="checkbox"> Ordonnance requise</label><label><input name="coldChainRequired" type="checkbox"> Chaîne du froid requise</label></div></div><button class="health-btn primary" id="health-medicine-submit">Ajouter au catalogue</button><div id="health-pro-status" class="health-status"></div></form><section class="health-provider-section"><div class="health-provider-section__head"><div><span class="health-eyebrow">Catalogue actif</span><h3>Mes médicaments</h3></div></div><div id="health-products-list" class="health-provider-list"><div class="empty">Chargement du catalogue…</div></div></section><h3>Demandes d’ordonnance acheminées</h3><div id="health-routed-prescriptions" class="health-grid"></div>`;
      root.querySelector('form').addEventListener('submit',(e)=>this.saveMedicine(e));root.querySelector('#health-medicine-cancel')?.addEventListener('click',()=>this.resetMedicineForm());this.loadPharmacyProducts();this.loadRoutedPrescriptions();
    }else{
      root.innerHTML=`<div class="health-provider-metrics"><article><span>${role==='laboratory'?'Examens publiés':'Commandes reçues'}</span><strong>—</strong></article><article><span>${role==='laboratory'?'Commandes acceptées':'Commandes en préparation'}</span><strong>—</strong></article><article><span>Activité du mois</span><strong>—</strong></article><article><span>Solde disponible</span><strong>— HTG</strong></article></div><form id="health-slot-form" class="health-card health-form"><h3>${role==='laboratory'?'Créneaux de prélèvement':'Disponibilités'}</h3><div class="health-form-grid"><div class="health-field"><label>Début</label><input name="startsAt" type="datetime-local" required></div><div class="health-field"><label>Fin</label><input name="endsAt" type="datetime-local" required></div></div><button class="health-btn primary">Publier</button><div id="health-pro-status" class="health-status"></div></form>${role==='laboratory'?`<section class="health-provider-section"><div class="health-provider-section__head"><div><span class="health-eyebrow">Catalogue</span><h3>Examens disponibles</h3></div><span class="health-badge">Publication immédiate après validation</span></div><form id="health-exam-form" class="health-card health-form"><div class="health-form-grid"><div class="health-field"><label>Nom de l’examen</label><input name="name" required></div><div class="health-field"><label>Prix HTG</label><input name="price" type="number" min="0" required></div><div class="health-field"><label>Type de prélèvement</label><input name="specimen"></div><div class="health-field"><label>Description</label><input name="description"></div></div><button class="health-btn primary">Enregistrer l’examen</button></form></section>`:`<section class="health-provider-section"><div class="health-provider-section__head"><div><span class="health-eyebrow">Commandes</span><h3>Suivi des commandes</h3></div></div><div class="health-provider-list"><div class="empty">Les commandes acceptées, en préparation et prêtes seront regroupées ici.</div></div></section>`}`;
      document.getElementById('health-slot-form').addEventListener('submit',(e)=>this.saveSlot(e,role));document.getElementById('health-exam-form')?.addEventListener('submit',(e)=>this.saveExam(e));
    }
  }

  async saveMedicine(e){e.preventDefault();const d=Object.fromEntries(new FormData(e.target));d.prescriptionRequired=e.target.prescriptionRequired.checked;d.coldChainRequired=e.target.coldChainRequired.checked;const isEdit=Boolean(d.productId);const s=document.getElementById('health-pro-status');try{await callHealth('healthSaveMedicine',{method:'POST',requireAuth:true,body:d});s.className='health-status success';s.textContent=isEdit?'Médicament mis à jour.':'Médicament enregistré. Le stock est horodaté côté serveur.';this.resetMedicineForm(false);await this.loadPharmacyProducts();}catch(error){s.className='health-status error';s.textContent=error.message;}}
  resetMedicineForm(clearStatus=true){const form=document.getElementById('health-medicine-form');if(!form)return;form.reset();form.elements.productId.value='';const title=document.getElementById('health-medicine-form-title');const submit=document.getElementById('health-medicine-submit');const cancel=document.getElementById('health-medicine-cancel');if(title)title.textContent='Ajouter un médicament';if(submit)submit.textContent='Ajouter au catalogue';if(cancel)cancel.hidden=true;if(clearStatus){const status=document.getElementById('health-pro-status');if(status)status.textContent='';}}
  editPharmacyProduct(id){const product=(this.pharmacyProducts||[]).find(p=>p.id===id);const form=document.getElementById('health-medicine-form');if(!product||!form)return;['productId','name','dci','dosage','pharmaceuticalForm','price','stock'].forEach(key=>{if(form.elements[key])form.elements[key].value=product[key]??'';});form.elements.prescriptionRequired.checked=product.prescriptionRequired===true;form.elements.coldChainRequired.checked=product.coldChainRequired===true;document.getElementById('health-medicine-form-title').textContent='Modifier le médicament';document.getElementById('health-medicine-submit').textContent='Enregistrer les modifications';document.getElementById('health-medicine-cancel').hidden=false;form.scrollIntoView({behavior:'smooth',block:'center'});}
  async loadPharmacyProducts(){const root=document.getElementById('health-products-list');if(!root||!this.user)return;try{const snap=await getDocs(query(collection(db,'healthPharmacyProducts'),where('pharmacyId','==',this.user.uid),limit(100)));const products=snap.docs.map(d=>({id:d.id,...d.data()}));this.pharmacyProducts=products;const count=document.getElementById('health-product-count');const low=document.getElementById('health-low-stock-count');if(count)count.textContent=String(products.length);if(low)low.textContent=String(products.filter(p=>Number(p.stock||0)<=5).length);root.innerHTML=products.length?products.map(p=>`<div class="health-provider-row"><div><strong>${esc(p.name)}</strong><small>${esc([p.dci,p.dosage,p.pharmaceuticalForm].filter(Boolean).join(' · ')||'Informations non renseignées')}</small></div><div class="health-provider-row__meta"><span>${money(p.price)}</span><span class="health-badge ${Number(p.stock||0)<=5?'warn':''}">${Number(p.stock||0)} en stock</span><button class="health-icon-btn" type="button" data-edit-product="${esc(p.id)}" aria-label="Modifier ${esc(p.name)}"><i class="fas fa-pen"></i></button><button class="health-icon-btn" type="button" data-delete-product="${esc(p.id)}" aria-label="Supprimer ${esc(p.name)}"><i class="fas fa-trash"></i></button></div></div>`).join(''):'<div class="empty">Aucun médicament publié. Ajoutez votre premier produit ci-dessus.</div>';root.querySelectorAll('[data-edit-product]').forEach(btn=>btn.addEventListener('click',()=>this.editPharmacyProduct(btn.dataset.editProduct)));root.querySelectorAll('[data-delete-product]').forEach(btn=>btn.addEventListener('click',async()=>{if(!confirm('Supprimer ce médicament du catalogue ?'))return;try{await callHealth('healthDeleteMedicine',{method:'POST',requireAuth:true,body:{productId:btn.dataset.deleteProduct}});await this.loadPharmacyProducts();}catch(error){alert(error.message);}}));}catch(error){root.innerHTML=`<div class="empty">${esc(error.message)}</div>`;}}
  async saveSlot(e,role){e.preventDefault();const d=Object.fromEntries(new FormData(e.target));d.type=role;d.startsAt=new Date(d.startsAt).toISOString();d.endsAt=new Date(d.endsAt).toISOString();const s=document.getElementById('health-pro-status');try{await callHealth('healthSaveAvailability',{method:'POST',requireAuth:true,body:d});s.className='health-status success';s.textContent='Créneau publié.';e.target.reset();}catch(error){s.className='health-status error';s.textContent=error.message;}}
  async saveExam(e){e.preventDefault();try{await callHealth('healthSaveLabExam',{method:'POST',requireAuth:true,body:Object.fromEntries(new FormData(e.target))});e.target.reset();alert('Examen enregistré.');}catch(error){alert(error.message);}}
  async loadRoutedPrescriptions(){const root=document.getElementById('health-routed-prescriptions');try{const [snap,productsSnap]=await Promise.all([getDocs(query(collection(db,'healthPrescriptionRoutes'),where('pharmacyId','==',this.user.uid),limit(50))),getDocs(query(collection(db,'healthPharmacyProducts'),where('pharmacyId','==',this.user.uid),limit(100)))]);this.professionalProducts=productsSnap.docs.map(d=>({id:d.id,...d.data()}));const rows=await Promise.all(snap.docs.map(async d=>{const p=await getDoc(doc(db,'healthPrescriptions',d.data().prescriptionId));return p.exists()?{id:p.id,...p.data()}:null;}));this.routedPrescriptions=new Map(rows.filter(Boolean).map(p=>[p.id,p]));root.innerHTML=this.cards(rows.filter(Boolean),p=>`<span class="health-badge">${esc(statusLabel(p.status))}</span><h3>Ordonnance ${esc(p.id.slice(0,8))}</h3><div class="health-card-actions"><button class="health-btn secondary" data-open-private="prescription" data-private-id="${esc(p.id)}">Consulter et journaliser l’accès</button>${['RECEIVED','UNDER_REVIEW','VALIDATED'].includes(p.status)?`<button class="health-btn primary" data-offer-rx="${esc(p.id)}">Répondre</button>`:''}${['RECEIVED','UNDER_REVIEW'].includes(p.status)?`<button class="health-btn danger" data-review-rx="${esc(p.id)}" data-review-action="NEEDS_CLARIFICATION">Demander une précision</button><button class="health-btn danger" data-review-rx="${esc(p.id)}" data-review-action="REJECTED">Refuser</button>`:''}</div>`);root.querySelectorAll('[data-open-private]').forEach(b=>b.addEventListener('click',()=>this.openPrivate(b.dataset.openPrivate,b.dataset.privateId)));root.querySelectorAll('[data-offer-rx]').forEach(b=>b.addEventListener('click',()=>this.openOfferForm(b.dataset.offerRx)));root.querySelectorAll('[data-review-rx]').forEach(b=>b.addEventListener('click',()=>this.reviewPrescription(b.dataset.reviewRx,b.dataset.reviewAction)));}catch(error){root.innerHTML=`<div class="health-empty">${esc(error.message)}</div>`;}}

  openOfferForm(prescriptionId){const box=document.getElementById('health-cart-content');box.innerHTML=`<form id="health-offer-form" class="health-form"><h3>Réponse à l’ordonnance ${esc(prescriptionId.slice(0,8))}</h3><div class="health-notice">Sélectionnez uniquement les médicaments lus sur l’ordonnance. Les prix sont repris du catalogue par le serveur.</div>${(this.professionalProducts||[]).map(p=>`<div class="health-card"><label><input type="checkbox" name="product" value="${esc(p.id)}"> <strong>${esc(p.name)}</strong> · ${money(p.price)} · stock ${Number(p.stock||0)}</label><div class="health-field"><label>Quantité</label><input type="number" min="1" value="1" data-qty-product="${esc(p.id)}"></div><label><input type="checkbox" data-unavailable-product="${esc(p.id)}"> Indisponible</label></div>`).join('')||'<div class="health-empty">Ajoutez d’abord des médicaments au catalogue.</div>'}<div class="health-form-grid"><div class="health-field"><label>Frais de livraison</label><input name="deliveryFee" type="number" min="0" value="0"></div><div class="health-field"><label>Délai</label><input name="deliveryEtaLabel" placeholder="Aujourd’hui, demain…"></div></div><button class="health-btn primary">Envoyer la proposition</button><div id="health-offer-status" class="health-status"></div></form>`;document.getElementById('health-cart-dialog').showModal();document.getElementById('health-offer-form').addEventListener('submit',(e)=>this.submitOffer(e,prescriptionId));}
  async submitOffer(e,prescriptionId){e.preventDefault();const s=document.getElementById('health-offer-status');const selected=[...e.target.querySelectorAll('input[name="product"]:checked')];const items=selected.map(c=>({productId:c.value,qty:Number(e.target.querySelector(`[data-qty-product="${CSS.escape(c.value)}"]`).value),available:!e.target.querySelector(`[data-unavailable-product="${CSS.escape(c.value)}"]`).checked}));try{if(this.routedPrescriptions?.get(prescriptionId)?.status==='RECEIVED')await callHealth('healthReviewPrescription',{method:'POST',requireAuth:true,body:{prescriptionId,action:'UNDER_REVIEW'}});await callHealth('healthSubmitPrescriptionOffer',{method:'POST',requireAuth:true,body:{prescriptionId,items,deliveryFee:Number(e.target.deliveryFee.value),deliveryEtaLabel:e.target.deliveryEtaLabel.value}});s.className='health-status success';s.textContent='Proposition envoyée au patient.';await this.loadRoutedPrescriptions();}catch(error){s.className='health-status error';s.textContent=error.message;}}
  async reviewPrescription(prescriptionId,action){const reason=prompt(action==='REJECTED'?'Motif compréhensible du refus :':'Précision demandée au patient :');if(!reason)return;try{const current=this.routedPrescriptions?.get(prescriptionId)?.status;if(current==='RECEIVED'&&action==='NEEDS_CLARIFICATION')await callHealth('healthReviewPrescription',{method:'POST',requireAuth:true,body:{prescriptionId,action:'UNDER_REVIEW'}});await callHealth('healthReviewPrescription',{method:'POST',requireAuth:true,body:{prescriptionId,action,reason}});await this.loadRoutedPrescriptions();}catch(error){alert(error.message);}}
}

export default SmartCutHealth;
