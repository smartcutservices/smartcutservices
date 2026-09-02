// Header autonome de Smart Cut Health.
// Il ne dépend pas du header marketplace utilisé sur la page d'accueil.

import { auth, db, storage } from './firebase-init.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import { ref, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-storage.js';
import { getAuthManager } from './auth.js';

// Liens de découverte affichés dans la nav du haut — uniquement des pages de
// catalogue public. Les pages de compte personnel (commandes, notifications,
// messagerie, ordonnances) et les espaces prestataires ne sont plus listés à
// plat ici : ils vivent tous derrière l'icône de profil (voir spaceHref /
// paintAvatar), qui emmène directement chacun dans SON espace.
// `audience` :
//   'user'     -> visible par tout le monde ;
//   'doctor' / autre rôle -> uniquement pour ce rôle vérifié (et les admins) ;
//   'prospect' -> visible uniquement pour qui n'est PAS déjà prestataire vérifié
//                 (visiteur, simple utilisateur, candidature en cours) : c'est
//                 le point d'entrée pour rejoindre la plateforme comme médecin,
//                 pharmacie ou laboratoire. Il disparaît une fois le compte
//                 vérifié, remplacé par l'icône de profil -> dashboard dédié.
const NAV_LINKS = [
  { href: './index.html', label: 'Smart Cut Services', icon: 'fa-house', match: ['index.html'], audience: 'user', returnHome: true },
  { href: './health-pharmacie.html', label: 'Pharmacie', match: ['health-pharmacie.html'], audience: 'user' },
  { href: './health-teleconsultation.html', label: 'Téléconsultation', icon: 'fa-user-doctor', match: ['health-teleconsultation.html'], audience: 'user' },
  { href: './health-imagerie.html', label: 'Imagerie', icon: 'fa-x-ray', match: ['health-imagerie.html'], audience: 'user' },
  { href: './health-laboratoires.html', label: 'Laboratoires', match: ['health-laboratoires.html'], audience: 'user' },
  { href: './health-medecins.html', label: 'Médecins', match: ['health-medecins.html'], audience: 'doctor' },
  { href: './health-candidature.html', label: 'Devenir prestataire', icon: 'fa-user-plus', match: ['health-candidature.html'], audience: 'prospect' },
];

// Même correspondance rôle -> champ de profil que functions/health/clinical.js
// (PROFILE_FIELDS) — dupliquée ici volontairement, ce fichier tourne côté
// client et ne peut pas importer le module serveur.
const PROFILE_FIELD_BY_ROLE = { doctor: 'doctorProfile', pharmacy: 'pharmacyProfile', laboratory: 'labProfile', imaging: 'imagingProfile' };

// Espace « propriétaire » de chaque rôle vérifié : c'est là que l'icône de
// profil emmène directement un compte prestataire vérifié, plutôt que dans
// l'espace patient générique — chaque prestataire garde un accès à son espace
// patient depuis l'aside de son propre dashboard, les deux espaces coexistent
// toujours, ils ne sont simplement jamais mélangés dans une seule interface.
const DASHBOARD_HREF_BY_ROLE = {
  doctor: './health-doctor.html', pharmacy: './health-pharmacy-dashboard.html',
  laboratory: './health-laboratory-dashboard.html', imaging: './health-imaging-dashboard.html'
};

const AVATAR_COLORS = ['#0f6958', '#1f7a63', '#2c8f74', '#0b5a4a', '#146856'];

export default class SmartCutHealthHeader {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) return;
    this.role = null;      // null | 'doctor' | 'pharmacy' | 'laboratory' | 'imaging'
    this.isAdmin = false;
    this.signedIn = false;
    this.userLabel = '';
    this.photoUrl = null;
    this.render();
    this.bindEvents();
    this.paintAvatar();
    this.initRole();
  }

  // Détermine le rôle du compte connecté, résout sa photo d'affichage (photo
  // professionnelle vérifiée > photo du compte > initiales) puis révèle les
  // liens réservés aux prestataires. Un simple utilisateur ne voit jamais
  // « Médecins », qui n'a de sens que pour un confrère.
  initRole() {
    try {
      onAuthStateChanged(auth, async (user) => {
        this.signedIn = Boolean(user);
        this.userLabel = user ? (user.displayName || user.email || '') : '';
        let role = null;
        let isAdmin = false;
        let photoUrl = user?.photoURL || null;
        if (user) {
          try {
            const snap = await getDoc(doc(db, 'clients', user.uid));
            const data = snap.exists() ? (snap.data() || {}) : {};
            role = String(data.role || '').toLowerCase() || null;
            isAdmin = data.isAdmin === true || role === 'admin';
            const profileField = PROFILE_FIELD_BY_ROLE[role];
            const photoPath = profileField ? data[profileField]?.photoPath : null;
            if (photoPath) {
              try { photoUrl = await getDownloadURL(ref(storage, photoPath)); }
              catch (_) { /* photo pas encore disponible (émulateur, propagation) : on retombe sur celle du compte */ }
            }
          } catch (_) { /* lecture impossible : on reste sur la vue utilisateur */ }
        }
        const roleChanged = role !== this.role || isAdmin !== this.isAdmin;
        this.role = role;
        this.isAdmin = isAdmin;
        this.photoUrl = photoUrl;
        if (roleChanged) this.refreshNav();
        this.paintAvatar();
      });
    } catch (_) { /* pas d'auth disponible : vue utilisateur uniquement */ }
  }

  // La page où mène l'icône de profil : le dashboard dédié d'un prestataire
  // vérifié, sinon l'espace patient (Mon espace, auto-provisionné pour tout
  // compte Smart Cut).
  spaceHref() {
    return DASHBOARD_HREF_BY_ROLE[this.role] || './health-espace.html';
  }

  // Un compte est « prestataire vérifié » dès qu'il a un rôle avec dashboard dédié.
  isVerifiedProvider() {
    return Boolean(DASHBOARD_HREF_BY_ROLE[this.role]);
  }

  // Liens visibles selon le rôle courant.
  visibleNavLinks() {
    return NAV_LINKS.filter((link) => {
      const audience = link.audience || 'user';
      if (audience === 'user') return true;
      // « Devenir prestataire » : caché pour un prestataire déjà vérifié et pour
      // l'admin (ils ont leur propre espace), visible pour tous les autres.
      if (audience === 'prospect') return !this.isVerifiedProvider() && !this.isAdmin;
      if (this.isAdmin) return true;
      return audience === this.role;
    });
  }

  // Reconstruit le contenu du menu après un changement de rôle.
  refreshNav() {
    const menu = this.container.querySelector('[data-health-menu]');
    const header = this.container.querySelector('[data-health-header]');
    if (!menu) return;
    menu.innerHTML = this.renderNavLinks();
    menu.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => header?.classList.remove('is-menu-open')));
  }

  render() {
    this.container.innerHTML = `
      <style>
        :root { --health-header-height: 70px; }

        #health-header-root {
          position: sticky;
          top: 0;
          z-index: 1000;
          width: 100%;
          height: var(--health-header-height);
        }

        .health-site-header {
          height: 100%;
          border-bottom: 1px solid rgba(255, 255, 255, .11);
          background: linear-gradient(125deg, #073b46 0%, #0b625f 52%, #3aa897 100%);
          color: #fff;
          box-shadow: 0 4px 18px rgba(7, 43, 36, .14);
        }

        .health-site-header__inner {
          width: min(100% - 2rem, 1180px);
          height: 100%;
          margin-inline: auto;
          display: flex;
          align-items: center;
          gap: 1.25rem;
          padding-inline: .75rem;
          border: 1px solid rgba(255,255,255,.28);
          border-radius: 0 0 18px 18px;
          background: rgba(255,255,255,.12);
          backdrop-filter: blur(14px);
        }

        .health-site-header__brand {
          display: inline-flex;
          align-items: center;
          gap: .72rem;
          flex: 0 0 auto;
          color: #fff;
          text-decoration: none;
        }

        .health-site-header__logo {
          display: block;
          width: 42px;
          height: 42px;
          padding: 4px;
          border-radius: 8px;
          background: #fff;
          object-fit: contain;
          box-shadow: 0 2px 8px rgba(0, 0, 0, .18);
        }

        .health-site-header__identity { display: grid; gap: 1px; }
        .health-site-header__name { font-size: .98rem; font-weight: 800; line-height: 1.1; }
        .health-site-header__label { color: #a9d7cc; font-size: .7rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }

        .health-site-header__nav {
          display: flex;
          align-items: center;
          gap: .15rem;
          margin-left: auto;
        }

        .health-site-header__link {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: .42rem;
          min-height: 40px;
          padding: 0 .75rem;
          border-radius: 8px;
          color: #e4f1ed;
          font-size: .84rem;
          font-weight: 700;
          text-decoration: none;
          white-space: nowrap;
          transition: background .18s ease, color .18s ease;
        }

        .health-site-header__link:hover,
        .health-site-header__link:focus-visible,
        .health-site-header__link.is-active {
          color: #fff;
          background: rgba(255, 255, 255, .1);
          outline: none;
        }

        .health-site-header__link.is-active {
          background: rgba(255, 255, 255, .14);
        }

        .health-site-header__link--cta {
          border: 1px solid rgba(255, 255, 255, .34);
          color: #fff;
        }
        .health-site-header__link--cta:hover,
        .health-site-header__link--cta:focus-visible {
          background: #fff;
          color: #0b3d35;
        }

        .health-site-header__link--return {
          border: 1px solid rgba(255, 255, 255, .34);
          color: #fff;
        }
        .health-site-header__link--return:hover,
        .health-site-header__link--return:focus-visible {
          background: #fff;
          color: #0b3d35;
        }

        .health-site-header__avatar {
          flex: 0 0 auto; margin-left: .85rem;
          width: 40px; height: 40px; display: grid; place-items: center;
          border: 1px solid rgba(255, 255, 255, .28); border-radius: 999px;
          background: #fff; color: #0b3d35; cursor: pointer; font-size: .95rem;
          font-weight: 800; text-decoration: none; overflow: hidden;
        }
        .health-site-header__avatar:hover, .health-site-header__avatar:focus-visible { background: #eaf6f2; outline: none; }
        .health-site-header__avatar img { width: 100%; height: 100%; object-fit: cover; }

        .health-site-header__menu {
          display: none;
          align-items: center;
          justify-content: center;
          width: 42px;
          height: 42px;
          margin-left: auto;
          border: 1px solid rgba(255, 255, 255, .22);
          border-radius: 8px;
          background: transparent;
          color: #fff;
          cursor: pointer;
        }

        @media (max-width: 1100px) {
          :root { --health-header-height: 62px; }
          .health-site-header__inner { width: min(100% - 1.1rem, 1180px); gap: .7rem; }
          .health-site-header__logo { width: 36px; height: 36px; }
          .health-site-header__name { font-size: .9rem; }
          .health-site-header__label { font-size: .62rem; }
          .health-site-header__menu { display: inline-flex; }

          .health-site-header__nav {
            position: absolute;
            top: 100%;
            left: 0;
            right: 0;
            display: none;
            align-items: stretch;
            flex-direction: column;
            gap: .2rem;
            margin: 0;
            padding: .65rem;
            border-bottom: 1px solid #d9e6e2;
            background: rgba(7,59,70,.94);
            backdrop-filter: blur(16px);
            box-shadow: 0 16px 30px rgba(7, 43, 36, .16);
          }

          .health-site-header.is-menu-open .health-site-header__nav { display: flex; }
          .health-site-header__link {
            width: 100%;
            margin: 0;
            justify-content: flex-start;
            color: #fff;
          }
          .health-site-header__link:hover,
          .health-site-header__link:focus-visible,
          .health-site-header__link.is-active { color: #fff; background: rgba(255,255,255,.14); }
          .health-site-header__link--cta { border-color: rgba(255,255,255,.45); color: #fff; }
          .health-site-header__link--cta:hover,
          .health-site-header__link--cta:focus-visible { background: #0b3d35; color: #fff; }
          .health-site-header__link--return { border-color: rgba(255,255,255,.4); color: #fff; background: rgba(255,255,255,.1); }
          .health-site-header__link--return:hover,
          .health-site-header__link--return:focus-visible { background: #0b3d35; color: #fff; }
        }
      </style>

      <header class="health-site-header" data-health-header>
        <div class="health-site-header__inner">
          <a class="health-site-header__brand" href="./health.html" aria-label="Accueil Smart Cut Health">
            <img class="health-site-header__logo" src="./logo.png" alt="Logo Smart Cut" width="42" height="42">
            <span class="health-site-header__identity">
              <span class="health-site-header__name">Smart Cut Health</span>
              <span class="health-site-header__label">Santé &amp; pharmacie</span>
            </span>
          </a>

          <button class="health-site-header__menu" type="button" aria-label="Ouvrir le menu" aria-expanded="false" data-health-menu-button>
            <i class="fas fa-bars" aria-hidden="true"></i>
          </button>

          <nav class="health-site-header__nav" aria-label="Navigation Smart Cut Health" data-health-menu>
            ${this.renderNavLinks()}
          </nav>

          <a class="health-site-header__avatar" href="./health-espace.html" data-health-avatar aria-label="Mon espace">
            <i class="fas fa-user" aria-hidden="true"></i>
          </a>
        </div>
      </header>
    `;
  }

  escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[<>&"']/g, '');
  }

  initials(label) {
    const parts = String(label || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '';
    const first = parts[0][0] || '';
    const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (first + last).toUpperCase();
  }

  hashColor(label) {
    let hash = 0;
    const text = String(label || '');
    for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    return AVATAR_COLORS[hash % AVATAR_COLORS.length];
  }

  // Icône de profil : photo (professionnelle vérifiée ou celle du compte) si
  // disponible, sinon initiales sur fond coloré stable, sinon l'icône
  // générique par défaut pour un visiteur non connecté. Un seul clic emmène
  // directement dans l'espace propre au compte (voir spaceHref) ; pour un
  // visiteur non connecté, il ouvre la connexion sans quitter la page.
  paintAvatar() {
    const avatar = this.container.querySelector('[data-health-avatar]');
    if (!avatar) return;
    avatar.href = this.spaceHref();
    avatar.setAttribute('aria-label', this.signedIn ? 'Mon espace' : 'Se connecter');
    if (this.photoUrl) {
      avatar.innerHTML = `<img src="${this.escapeHtml(this.photoUrl)}" alt="" loading="lazy">`;
      avatar.style.background = '#fff';
    } else if (this.signedIn && this.userLabel) {
      avatar.innerHTML = this.escapeHtml(this.initials(this.userLabel)) || '<i class="fas fa-user" aria-hidden="true"></i>';
      avatar.style.background = this.hashColor(this.userLabel);
      avatar.style.color = '#fff';
    } else {
      avatar.innerHTML = '<i class="fas fa-user" aria-hidden="true"></i>';
      avatar.style.background = '#fff';
      avatar.style.color = '#0b3d35';
    }
  }

  bindEvents() {
    const header = this.container.querySelector('[data-health-header]');
    const button = this.container.querySelector('[data-health-menu-button]');
    const menu = this.container.querySelector('[data-health-menu]');
    if (!header || !button || !menu) return;

    const closeMenu = () => {
      header.classList.remove('is-menu-open');
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-label', 'Ouvrir le menu');
      const icon = button.querySelector('i');
      icon?.classList.add('fa-bars');
      icon?.classList.remove('fa-times');
    };

    button.addEventListener('click', () => {
      const willOpen = !header.classList.contains('is-menu-open');
      header.classList.toggle('is-menu-open', willOpen);
      button.setAttribute('aria-expanded', String(willOpen));
      button.setAttribute('aria-label', willOpen ? 'Fermer le menu' : 'Ouvrir le menu');
      const icon = button.querySelector('i');
      icon?.classList.toggle('fa-bars', !willOpen);
      icon?.classList.toggle('fa-times', willOpen);
    });

    menu.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu));

    // Icône de profil : connecté -> navigation normale (spaceHref, déjà posé
    // comme href) ; non connecté -> on intercepte pour ouvrir la connexion
    // sans quitter la page plutôt que d'atterrir sur Mon espace verrouillé.
    const avatar = this.container.querySelector('[data-health-avatar]');
    avatar?.addEventListener('click', (event) => {
      if (this.signedIn) return;
      event.preventDefault();
      try { getAuthManager().openAuthModal('login'); } catch (_) { /* pas de modale dispo */ }
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 1100) closeMenu();
    });
  }

  isCurrentPage(fileName) {
    return window.location.pathname.split('/').pop() === fileName;
  }

  renderNavLinks() {
    return this.visibleNavLinks().map((link) => {
      const active = link.match.some((file) => this.isCurrentPage(file));
      const icon = link.icon ? `<i class="fas ${link.icon}" aria-hidden="true"></i> ` : '';
      const cta = link.audience === 'prospect' ? ' health-site-header__link--cta' : '';
      const returnHome = link.returnHome ? ' health-site-header__link--return' : '';
      return `<a class="health-site-header__link${cta}${returnHome} ${active ? 'is-active' : ''}" href="${link.href}">${icon}${link.label}</a>`;
    }).join('');
  }
}
