import { auth, authReadyPromise } from './firebase-init.js?v=20260908-12';
import { getAuthManager } from './auth.js?v=20260908-12';

const REVIEWS_API = 'https://us-central1-smartcutservices-9ce54.cloudfunctions.net';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
}

function stars(value, className = '') {
  const rating = Math.max(0, Math.min(5, Number(value) || 0));
  return `<span class="product-review-stars ${className}" aria-label="${rating} sur 5">${[1, 2, 3, 4, 5].map((n) => `<i class="fas fa-star ${n <= rating ? 'is-on' : ''}"></i>`).join('')}</span>`;
}

export default class ProductReviews {
  constructor(container, productId) {
    this.container = container;
    this.productId = String(productId || '').trim();
    this.reviews = [];
    this.rating = 0;
  }

  async init() {
    this.injectStyles();
    this.renderLoading();
    await authReadyPromise.catch(() => null);
    await this.load();
    this.render();
  }

  injectStyles() {
    if (document.getElementById('product-reviews-styles')) return;
    const style = document.createElement('style');
    style.id = 'product-reviews-styles';
    style.textContent = `
      .product-reviews{margin:1rem 0 2rem;padding:1.25rem;border:1px solid #e4e8ec;border-radius:16px;background:#fff;box-shadow:0 12px 28px rgba(15,23,42,.06);color:#17212b}
      .product-reviews h2{margin:0;font-size:1.35rem;letter-spacing:-.02em}.product-reviews-muted{color:#687586;font-size:.86rem}
      .product-review-summary{display:grid;grid-template-columns:180px 1fr;gap:1.25rem;margin:1rem 0 1.25rem;padding:1rem;border-radius:12px;background:#f7f9fb}
      .product-review-average{text-align:center}.product-review-average strong{display:block;font-size:2.4rem;line-height:1}.product-review-stars{display:inline-flex;gap:.18rem;color:#cbd3da}.product-review-stars .is-on{color:#f59e0b}.product-review-average .product-review-stars{margin:.45rem 0}.product-review-bars{display:grid;gap:.35rem;align-content:center}.product-review-bar{display:grid;grid-template-columns:38px 1fr 32px;align-items:center;gap:.5rem;font-size:.76rem;color:#596575}.product-review-bar-track{height:7px;border-radius:99px;background:#e6ebef;overflow:hidden}.product-review-bar-track span{display:block;height:100%;border-radius:inherit;background:#f59e0b}
      .product-review-list{display:grid;gap:.85rem}.product-review-card{padding:1rem 0;border-top:1px solid #e8edf1}.product-review-card:first-child{border-top:0}.product-review-card-head{display:flex;justify-content:space-between;gap:.75rem;align-items:flex-start}.product-review-card-head strong{display:block}.product-review-card-title{margin:.45rem 0 .25rem;font-weight:800}.product-review-card-text{margin:0;color:#465364;line-height:1.55;white-space:pre-wrap}.product-review-verified{display:inline-flex;margin-left:.4rem;padding:.2rem .4rem;border-radius:5px;background:#e8f6ee;color:#16734b;font-size:.68rem;font-weight:800}
      .product-review-form{margin-top:1rem;padding-top:1rem;border-top:1px solid #e8edf1}.product-review-form h3{margin:0 0 .75rem;font-size:1rem}.product-review-rating-input{display:flex;gap:.25rem;margin-bottom:.7rem}.product-review-rating-input button{border:0;background:transparent;padding:.15rem;color:#cbd3da;font-size:1.55rem;cursor:pointer}.product-review-rating-input button.is-on{color:#f59e0b}.product-review-field{width:100%;border:1px solid #cbd5df;border-radius:9px;padding:.7rem .8rem;margin-bottom:.65rem;font:inherit}.product-review-field:focus{outline:3px solid rgba(245,158,11,.18);border-color:#d79000}.product-review-submit{border:0;border-radius:9px;padding:.7rem 1rem;background:#f59e0b;color:#17212b;font-weight:800;cursor:pointer}.product-review-submit:disabled{opacity:.55;cursor:wait}.product-review-auth{display:flex;align-items:center;justify-content:space-between;gap:.75rem;padding:.85rem;border-radius:9px;background:#f7f9fb}.product-review-auth button{border:1px solid #d79000;border-radius:8px;background:#fff4cf;color:#17212b;padding:.55rem .75rem;font-weight:800;cursor:pointer}
      @media(max-width:600px){.product-review-summary{grid-template-columns:1fr;gap:.8rem}.product-review-average{text-align:left}.product-review-card-head{display:block}.product-review-card-head time{display:block;margin-top:.25rem}.product-reviews{padding:1rem}}
    `;
    document.head.appendChild(style);
  }

  renderLoading() {
    this.container.innerHTML = '<section class="product-reviews"><h2>Avis clients</h2><p class="product-review-muted">Chargement des évaluations…</p></section>';
  }

  async load() {
    try {
      const response = await fetch(`${REVIEWS_API}/listProductReviews?productId=${encodeURIComponent(this.productId)}`);
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload.ok) this.reviews = Array.isArray(payload.reviews) ? payload.reviews : [];
    } catch (_) {
      this.reviews = [];
    }
    this.rating = this.reviews.length ? this.reviews.reduce((sum, item) => sum + Number(item.rating || 0), 0) / this.reviews.length : 0;
  }

  render() {
    const counts = [5, 4, 3, 2, 1].map((rating) => this.reviews.filter((item) => Number(item.rating) === rating).length);
    const total = this.reviews.length;
    this.container.innerHTML = `
      <section class="product-reviews" aria-labelledby="product-reviews-title">
        <h2 id="product-reviews-title">Avis clients</h2>
        <div class="product-review-summary">
          <div class="product-review-average"><strong>${this.rating ? this.rating.toFixed(1) : '—'}</strong>${stars(Math.round(this.rating))}<div class="product-review-muted">${total} évaluation${total === 1 ? '' : 's'}</div></div>
          <div class="product-review-bars">${counts.map((count, index) => { const rating = 5 - index; const percent = total ? Math.round((count / total) * 100) : 0; return `<div class="product-review-bar"><span>${rating} ★</span><div class="product-review-bar-track"><span style="width:${percent}%"></span></div><span>${count}</span></div>`; }).join('')}</div>
        </div>
        <div class="product-review-list">${total ? this.reviews.map((review) => this.renderReview(review)).join('') : '<p class="product-review-muted">Aucun avis pour le moment. Soyez le premier à partager votre expérience.</p>'}</div>
        ${this.renderForm()}
      </section>`;
    this.attachEvents();
  }

  renderReview(review) {
    const date = review.createdAt ? new Date(review.createdAt).toLocaleDateString('fr-FR') : '';
    return `<article class="product-review-card"><div class="product-review-card-head"><div><strong>${escapeHtml(review.authorName || 'Client Smart Cut')}</strong>${review.verifiedPurchase ? '<span class="product-review-verified">Achat vérifié</span>' : ''}<div>${stars(review.rating)}</div></div><time class="product-review-muted">${escapeHtml(date)}</time></div>${review.title ? `<div class="product-review-card-title">${escapeHtml(review.title)}</div>` : ''}<p class="product-review-card-text">${escapeHtml(review.text)}</p></article>`;
  }

  renderForm() {
    if (!auth?.currentUser) return '<div class="product-review-form"><div class="product-review-auth"><span class="product-review-muted">Connectez-vous pour noter ce produit et laisser un avis.</span><button type="button" data-review-login>Se connecter</button></div></div>';
    return `<form class="product-review-form" data-review-form><h3>Votre avis</h3><div class="product-review-rating-input" role="radiogroup" aria-label="Votre note">${[1, 2, 3, 4, 5].map((rating) => `<button type="button" data-review-rating="${rating}" aria-label="${rating} étoile${rating > 1 ? 's' : ''}"><i class="fas fa-star"></i></button>`).join('')}</div><input class="product-review-field" name="title" maxlength="100" placeholder="Titre de votre avis (facultatif)"><textarea class="product-review-field" name="text" rows="4" maxlength="1200" required placeholder="Que doivent savoir les autres clients ?"></textarea><button class="product-review-submit" type="submit">Publier mon avis</button></form>`;
  }

  attachEvents() {
    const login = this.container.querySelector('[data-review-login]');
    login?.addEventListener('click', () => getAuthManager().openAuthModal('login'));
    const form = this.container.querySelector('[data-review-form]');
    if (!form) return;
    let rating = 0;
    const buttons = [...form.querySelectorAll('[data-review-rating]')];
    const paint = () => buttons.forEach((button) => button.classList.toggle('is-on', Number(button.dataset.reviewRating) <= rating));
    buttons.forEach((button) => button.addEventListener('click', () => { rating = Number(button.dataset.reviewRating); paint(); }));
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const text = String(new FormData(form).get('text') || '').trim();
      if (!rating || text.length < 3) return;
      const submit = form.querySelector('.product-review-submit');
      submit.disabled = true;
      try {
        const token = await auth.currentUser.getIdToken();
        const response = await fetch(`${REVIEWS_API}/submitProductReview`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ productId: this.productId, rating, title: String(new FormData(form).get('title') || '').trim(), text }) });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok) throw new Error(payload.message || 'Impossible de publier cet avis.');
        await this.load();
        this.render();
      } catch (error) {
        submit.disabled = false;
        window.alert(error.message || 'Impossible de publier cet avis.');
      }
    });
  }
}
