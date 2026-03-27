import { db } from './firebase-init.js';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

class CustomPageViewer {
  constructor(containerId = 'custom-page-root', options = {}) {
    this.containerId = containerId;
    this.container = document.getElementById(containerId);
    this.options = {
      collectionName: 'footerPages',
      ...options
    };
    this.pageData = null;

    if (!this.container) {
      console.error(`❌ Conteneur #${containerId} introuvable`);
      return;
    }

    this.init();
  }

  async init() {
    this.renderLoading();
    await this.loadPage();
    this.render();
  }

  async loadPage() {
    const params = new URLSearchParams(window.location.search);
    const pageId = params.get('id');
    const pageSlug = params.get('slug');

    try {
      if (pageId) {
        const snapshot = await getDoc(doc(db, this.options.collectionName, pageId));
        if (snapshot.exists()) {
          this.pageData = { id: snapshot.id, ...snapshot.data() };
          return;
        }
      }

      if (pageSlug) {
        const pageQuery = query(
          collection(db, this.options.collectionName),
          where('slug', '==', pageSlug),
          limit(1)
        );
        const snapshot = await getDocs(pageQuery);
        if (!snapshot.empty) {
          const match = snapshot.docs[0];
          this.pageData = { id: match.id, ...match.data() };
        }
      }
    } catch (error) {
      console.error('❌ Erreur chargement page personnalisée:', error);
      this.pageData = null;
    }
  }

  escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  renderLoading() {
    this.container.innerHTML = `
      <section style="max-width: 920px; margin: 0 auto; padding: 2rem 1.25rem 2rem; min-height: 50vh;">
        <div style="background: #ffffff; border: 1px solid rgba(198, 167, 94, 0.18); border-radius: 1.5rem; padding: 2rem;">
          <p style="color: #8B7E6B;">Chargement de la page...</p>
        </div>
      </section>
    `;
  }

  render() {
    if (!this.pageData || this.pageData.active === false) {
      this.container.innerHTML = `
        <section style="max-width: 920px; margin: 0 auto; padding: 2rem 1.25rem 2rem; min-height: 50vh;">
          <div style="background: #ffffff; border: 1px solid rgba(198, 167, 94, 0.18); border-radius: 1.5rem; padding: 2rem;">
            <p style="font-size: 0.85rem; letter-spacing: 0.12em; text-transform: uppercase; color: #8B7E6B; margin-bottom: 0.75rem;">Page introuvable</p>
            <h1 style="font-family: 'Cormorant Garamond', serif; font-size: clamp(2rem, 6vw, 3.5rem); color: #1F1E1C; margin-bottom: 1rem;">Cette page n'est pas disponible.</h1>
            <p style="color: #6E6557; line-height: 1.7; margin-bottom: 1.5rem;">Le contenu demande n'existe plus ou a ete desactive depuis le dashboard.</p>
            <a href="./index.html" style="display: inline-flex; align-items: center; gap: 0.5rem; background: #1F1E1C; color: #F5F1E8; text-decoration: none; padding: 0.9rem 1.25rem; border-radius: 999px;">Retour a l'accueil</a>
          </div>
        </section>
      `;
      return;
    }

    const title = this.escapeHtml(this.pageData.title || 'Page personnalisée');
    const summary = this.escapeHtml(this.pageData.summary || '');
    const content = this.escapeHtml(this.pageData.content || '').replace(/\n/g, '<br>');

    document.title = `${this.pageData.title || 'Page'} | Smart Cut Services`;

    this.container.innerHTML = `
      <section style="max-width: 920px; margin: 0 auto; padding: 2rem 1.25rem 2rem; min-height: 50vh;">
        <div style="margin-bottom: 1.5rem;">
          <a href="./index.html" style="display: inline-flex; align-items: center; gap: 0.5rem; color: #6E6557; text-decoration: none; font-size: 0.95rem;">
            <i class="fas fa-arrow-left"></i>
            <span>Retour a l'accueil</span>
          </a>
        </div>
        <article style="background: linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(245,241,232,0.94) 100%); border: 1px solid rgba(198, 167, 94, 0.18); border-radius: 1.75rem; padding: clamp(1.5rem, 4vw, 3rem); box-shadow: 0 24px 60px rgba(31, 30, 28, 0.08);">
          <p style="font-size: 0.8rem; letter-spacing: 0.16em; text-transform: uppercase; color: #8B7E6B; margin-bottom: 1rem;">Page personnalisee</p>
          <h1 style="font-family: 'Cormorant Garamond', serif; font-size: clamp(2.5rem, 7vw, 4.5rem); line-height: 0.95; color: #1F1E1C; margin-bottom: 1rem;">${title}</h1>
          ${summary ? `<p style="font-size: 1.05rem; line-height: 1.8; color: #6E6557; margin-bottom: 2rem; max-width: 60ch;">${summary}</p>` : ''}
          <div style="font-size: 1rem; line-height: 1.9; color: #2C2A29;">${content || 'Aucun contenu disponible.'}</div>
        </article>
      </section>
    `;
  }
}

export default CustomPageViewer;
