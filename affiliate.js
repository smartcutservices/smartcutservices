import { db } from './firebase-init.js?v=20260907-1';
import { getAuthManager } from './auth.js?v=20260907-1';
import {
  collection, getDocs, getDoc, doc, setDoc, addDoc, query, where, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

const app = document.getElementById('affiliate-app');
const PRODUCT_TAXONOMY_URL = './product-taxonomy.json';
const FUNCTION_URL = 'https://us-central1-smartcutservices-9ce54.cloudfunctions.net/';

class AffiliateApp {
  constructor() {
    this.authManager = getAuthManager();
    this.user = null;
    this.account = null;
    this.application = null;
    this.products = [];
    this.rates = new Map();
    this.links = [];
    this.commissions = [];
    this.payouts = [];
    this.activeView = 'overview';
    this.taxonomy = null;
  }

  async init() {
    await this.authManager.waitForAuthReady?.();
    this.user = this.authManager.getCurrentUser?.();
    if (!this.authManager.isAuthenticated?.()) {
      this.renderPublic();
      this.bindPublic();
      document.addEventListener('authChanged', () => this.init(), { once: true });
      return;
    }
    await this.loadData();
    this.render();
    this.bind();
  }

  async loadData() {
    this.user = this.authManager.getCurrentUser?.() || this.user;
    const uid = this.user?.uid;
    if (!uid) return;
    const [accountSnap, applicationSnap, productsSnap, vendorProductsSnap, ratesSnap, legacyRatesSnap, linksSnap, commissionsSnap, payoutsSnap] = await Promise.all([
      getDoc(doc(db, 'affiliateAccounts', uid)),
      getDocs(query(collection(db, 'affiliateApplications'), where('userId', '==', uid))),
      getDocs(collection(db, 'products')),
      getDocs(collection(db, 'vendorProducts')),
      getDocs(collection(db, 'affiliateDepartmentRates')),
      getDocs(collection(db, 'commissionDepartments')),
      getDocs(query(collection(db, 'affiliateLinks'), where('affiliateId', '==', uid))),
      getDocs(query(collection(db, 'affiliateCommissions'), where('affiliateId', '==', uid))),
      getDocs(query(collection(db, 'affiliatePayouts'), where('affiliateId', '==', uid)))
    ]);
    this.account = accountSnap.exists() ? { id: accountSnap.id, ...accountSnap.data() } : null;
    this.application = applicationSnap.docs.map(s => ({ id: s.id, ...s.data() })).sort((a,b) => this.date(b.createdAt) - this.date(a.createdAt))[0] || null;
    this.rates = new Map();
    legacyRatesSnap.forEach(s => { const d = s.data() || {}; this.rates.set(s.id, { affiliateRate: Number(d.rate || 0), customerRate: Number(d.customerDiscountRate || 0), active: d.active !== false }); });
    ratesSnap.forEach(s => { const d = s.data() || {}; this.rates.set(s.id, { affiliateRate: Number(d.affiliateCommissionRate ?? d.affiliateRate ?? d.rate ?? 0), customerRate: Number(d.customerDiscountRate ?? d.customerRate ?? 0), active: d.active !== false }); });
    const smartProducts = productsSnap.docs.map(s => ({ id: s.id, ...s.data(), sourceType: 'smartcut' })).filter(p => p.status === 'active' && p.affiliateEligible === true);
    const sellerProducts = vendorProductsSnap.docs.map(s => ({ id: s.id, ...s.data(), sourceType: 'vendor' })).filter(p => p.status === 'active' && p.affiliateEligible === true && p.sellerAffiliateEligible !== false);
    this.products = [...smartProducts, ...sellerProducts];
    this.links = linksSnap.docs.map(s => ({ id: s.id, ...s.data() }));
    this.commissions = commissionsSnap.docs.map(s => ({ id: s.id, ...s.data() })).sort((a,b) => this.date(b.createdAt) - this.date(a.createdAt));
    this.payouts = payoutsSnap.docs.map(s => ({ id: s.id, ...s.data() })).sort((a,b) => this.date(b.requestedAt) - this.date(a.requestedAt));
    try { this.taxonomy = await fetch(PRODUCT_TAXONOMY_URL, { cache: 'no-store' }).then(r => r.ok ? r.json() : null); } catch { this.taxonomy = null; }
  }

  date(value) { return value?.toDate ? value.toDate().getTime() : (Date.parse(value || '') || 0); }
  escape(value) { return String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
  price(value) { return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Number(value) || 0)} HTG`; }
  initials() { return String(this.user?.displayName || this.user?.email || 'A').trim().slice(0,1).toUpperCase(); }
  rateFor(product) { const id = product.departmentId || product.department || ''; return this.rates.get(id) || { affiliateRate: Number(product.affiliateCommissionRate || 0), customerRate: Number(product.customerDiscountRate || 0), active: true }; }
  image(product) { return Array.isArray(product.images) ? product.images[0] : (product.image || ''); }
  productDepartment(product) { return product.department || product.departmentName || product.departmentId || 'Département non défini'; }

  renderPublic() {
    app.innerHTML = `<header class="aff-public-header"><a href="./affiliate.html" class="aff-brand"><span class="aff-brand-logo"><img src="./logo.png" alt="Smart Cut" width="42" height="42"></span><span>Smart Cut<small>Affiliate Program</small></span></a><div class="aff-header-actions"><a href="./index.html" class="aff-btn aff-btn--outline">Retour au site</a><button class="aff-btn aff-btn--gold" data-aff-login>Se connecter</button></div></header>
      <main class="aff-public-main"><section class="aff-hero"><div><p class="aff-eyebrow">Smart Cut Affiliate Program</p><h1>Partagez mieux.<br><span>Gagnez justement.</span></h1><p>Recommandez les produits éligibles de Smart Cut Services, partagez un lien personnel et suivez chaque clic, vente et commission depuis un espace dédié.</p><div class="aff-hero-actions"><button class="aff-btn aff-btn--gold" data-aff-login>Devenir affilié <i class="fas fa-arrow-right"></i></button><a class="aff-btn aff-btn--light" href="#fonctionnement">Voir le fonctionnement</a></div></div><div class="aff-hero-art"><div class="aff-art-panel"><header><span>PERFORMANCE</span><i class="fas fa-chart-line"></i></header><div class="aff-art-chart"><i style="--h:35%"></i><i style="--h:52%"></i><i style="--h:44%"></i><i style="--h:72%"></i><i style="--h:88%"></i><i style="--h:100%"></i></div><div class="aff-art-kpi"><div><strong>+28%</strong><span>conversion</span></div><div><strong>5%</strong><span>commission</span></div><div><strong>7 j</strong><span>attribution</span></div></div></div></div></section><section id="fonctionnement" class="aff-section"><p class="aff-eyebrow">Simple et transparent</p><h2>Un espace pensé pour vos résultats.</h2><p class="aff-section-intro">Un lien unique par produit, une attribution claire et des commissions calculées côté serveur.</p><div class="aff-feature-grid"><article class="aff-feature"><div class="aff-feature-icon"><i class="fas fa-link"></i></div><h3>Liens personnels</h3><p>Générez et partagez vos liens pour chaque produit éligible.</p></article><article class="aff-feature"><div class="aff-feature-icon"><i class="fas fa-bolt"></i></div><h3>Attribution claire</h3><p>Le dernier clic valide est retenu pendant la durée définie par Smart Cut.</p></article><article class="aff-feature"><div class="aff-feature-icon"><i class="fas fa-wallet"></i></div><h3>Commissions suivies</h3><p>Visualisez les montants en attente, disponibles et déjà payés.</p></article></div></section></main><footer class="aff-public-footer"><span>© ${new Date().getFullYear()} Smart Cut Services</span><span>Programme soumis aux conditions Smart Cut Affiliate Program.</span></footer>`;
  }

  bindPublic() { app.querySelectorAll('[data-aff-login]').forEach(btn => btn.addEventListener('click', () => this.authManager.openAuthModal?.('login'))); }

  render() {
    if (!this.account || this.account.status !== 'ACTIVE') { this.renderApplicationState(); return; }
    this.renderDashboard();
  }

  renderApplicationState() {
    const status = this.application?.status || 'NONE';
    const statusText = { PENDING: 'Demande en cours de vérification', REJECTED: 'Demande refusée', NONE: 'Votre espace affilié commence ici.' }[status] || status;
    app.innerHTML = `<header class="aff-public-header"><a href="./affiliate.html" class="aff-brand"><span class="aff-brand-logo"><img src="./logo.png" alt="Smart Cut" width="42" height="42"></span><span>Smart Cut<small>Affiliate Program</small></span></a><div class="aff-header-actions"><span class="aff-user-chip"><span class="aff-avatar">${this.initials()}</span><span class="aff-user-name">${this.escape(this.user?.displayName || this.user?.email || 'Affilié')}</span></span><button class="aff-btn aff-btn--outline" data-aff-logout>Déconnexion</button></div></header><main class="aff-public-main"><section class="aff-section" style="max-width:760px;margin:auto"><p class="aff-eyebrow">Votre candidature</p><h1>${this.escape(statusText)}</h1><p class="aff-section-intro">${status === 'PENDING' ? 'Notre équipe vérifie vos informations. Vous recevrez une notification dès que votre compte sera traité.' : status === 'REJECTED' ? 'Vous pouvez corriger votre demande et la soumettre à nouveau.' : 'Rejoignez le programme et transformez vos recommandations en revenus suivis.'}</p>${status === 'PENDING' ? '<div class="aff-panel"><span class="aff-status aff-status--pending">PENDING</span><p style="color:var(--aff-muted);line-height:1.6">Votre demande a bien été reçue.</p></div>' : `<form id="affiliate-application-form" class="aff-panel"><div class="aff-form-grid"><div class="aff-field"><label>Nom complet</label><input class="aff-input" name="name" required value="${this.escape(this.user?.displayName || '')}"></div><div class="aff-field"><label>Téléphone</label><input class="aff-input" name="phone" placeholder="+509 ..." required></div><div class="aff-field"><label>Pays</label><input class="aff-input" name="country" value="Haïti" required></div><div class="aff-field"><label>Canal principal</label><select class="aff-select" name="promotionType" required><option value="social">Réseaux sociaux</option><option value="website">Site web / blog</option><option value="community">Communauté / groupe</option><option value="other">Autre</option></select></div><div class="aff-field aff-field--full"><label>Comment allez-vous promouvoir les produits ?</label><textarea class="aff-textarea" rows="4" name="promotionDescription" required></textarea></div><label class="aff-checkbox aff-field--full"><input type="checkbox" name="terms" required><span>J’accepte les conditions du Smart Cut Affiliate Program et comprends que les commissions sont validées après confirmation de la commande.</span></label></div><button class="aff-btn aff-btn--gold" type="submit">Envoyer ma demande <i class="fas fa-arrow-right"></i></button></form>`}</section></main>`;
    app.querySelector('[data-aff-logout]')?.addEventListener('click', () => this.authManager.logout?.());
    app.querySelector('#affiliate-application-form')?.addEventListener('submit', e => this.submitApplication(e));
  }

  async submitApplication(event) {
    event.preventDefault(); const form = event.currentTarget; const data = Object.fromEntries(new FormData(form));
    try { await addDoc(collection(db, 'affiliateApplications'), { userId: this.user.uid, email: this.user.email || '', name: data.name, phone: data.phone, country: data.country, promotionType: data.promotionType, promotionDescription: data.promotionDescription, termsAccepted: true, status: 'PENDING', createdAt: serverTimestamp(), updatedAt: serverTimestamp() }); this.toast('Demande envoyée.'); await this.loadData(); this.render(); } catch (e) { this.toast('Impossible d’envoyer la demande. Vérifiez les règles Firebase.', true); console.error(e); }
  }

  renderDashboard() {
    const views = { overview: this.renderOverview(), catalog: this.renderCatalog(), links: this.renderLinks(), commissions: this.renderCommissions(), settings: this.renderSettings() };
    app.innerHTML = `<div class="aff-topbar"><a href="./affiliate.html" class="aff-brand"><span class="aff-brand-logo"><img src="./logo.png" alt="Smart Cut" width="42" height="42"></span><span>Smart Cut<small>Affiliate Program</small></span></a><div class="aff-header-actions"><a href="./index.html" class="aff-btn aff-btn--outline">Site principal</a><button class="aff-btn aff-btn--gold" data-aff-logout>Déconnexion</button></div></div><div class="aff-layout"><aside class="aff-aside"><div class="aff-aside-title">Espace affilié</div><nav class="aff-nav">${[['overview','fa-grid-2','Vue d’ensemble'],['catalog','fa-store','Catalogue affilié'],['links','fa-link','Mes liens'],['commissions','fa-wallet','Mes commissions'],['settings','fa-gear','Paramètres']].map(([id,icon,label]) => `<button class="${this.activeView===id?'is-active':''}" data-aff-view="${id}"><i class="fas ${icon}"></i>${label}</button>`).join('')}</nav></aside><main class="aff-content"><div class="aff-content-head"><div><p class="aff-eyebrow">Compte actif</p><h1>${this.pageTitle()}</h1><p>Suivez vos recommandations et vos revenus depuis un seul espace.</p></div><div class="aff-user-chip"><span class="aff-avatar">${this.initials()}</span><span class="aff-user-name">${this.escape(this.user?.displayName || this.user?.email || 'Affilié')}</span></div></div>${views[this.activeView] || views.overview}</main></div>`;
  }

  pageTitle() { return ({ overview: 'Vue d’ensemble', catalog: 'Catalogue affilié', links: 'Mes liens affiliés', commissions: 'Mes commissions', settings: 'Paramètres' })[this.activeView] || 'Espace affilié'; }
  renderOverview() { const clicks = this.links.reduce((s,l)=>s+Number(l.clicks||0),0); const conversions=this.links.reduce((s,l)=>s+Number(l.conversions||0),0); const pending=this.account?.pendingCommission || 0; const available=this.account?.availableCommission || 0; return `<section class="aff-kpi-grid"><article class="aff-kpi-card"><span>Clics suivis</span><strong>${clicks}</strong><em><i class="fas fa-arrow-trend-up"></i> Toutes vos campagnes</em></article><article class="aff-kpi-card"><span>Conversions</span><strong>${conversions}</strong><em>Commandes attribuées</em></article><article class="aff-kpi-card"><span>En attente</span><strong>${this.price(pending)}</strong><em>Validation en cours</em></article><article class="aff-kpi-card"><span>Disponible</span><strong>${this.price(available)}</strong><em>Prêt à être payé</em></article></section><section class="aff-panel"><div class="aff-panel-head"><h2>Bienvenue dans votre espace affilié</h2><span class="aff-status">ACTIVE</span></div><p style="color:var(--aff-muted);line-height:1.7;max-width:760px">Sélectionnez des produits éligibles, générez vos liens personnels et partagez-les. Les taux sont définis par Smart Cut selon le département du produit. Une commission devient disponible après validation de la commande.</p><button class="aff-btn aff-btn--gold" data-aff-view="catalog">Explorer le catalogue <i class="fas fa-arrow-right"></i></button></section><section class="aff-panel"><div class="aff-panel-head"><h2>Vos liens récents</h2><button class="aff-btn aff-btn--light" data-aff-view="links">Voir tout</button></div>${this.links.length ? this.renderLinkTable(this.links.slice(0,5)) : this.empty('Aucun lien généré', 'Commencez par choisir un produit dans le catalogue.', 'fa-link')}</section>`; }
  renderCatalog() { return `<div class="aff-filterbar"><input class="aff-input" data-aff-filter placeholder="Rechercher un produit"/><select class="aff-select" data-aff-department><option value="">Tous les départements</option>${[...new Set(this.products.map(p=>this.productDepartment(p)))].sort().map(d=>`<option>${this.escape(d)}</option>`).join('')}</select></div><div class="aff-product-grid" data-aff-product-grid>${this.renderProductCards(this.products)}</div>`; }
  renderProductCards(products) { if (!products.length) return this.empty('Catalogue en préparation', 'Les produits éligibles apparaîtront ici dès leur activation.', 'fa-box-open'); return products.map(p => { const r=this.rateFor(p); const img=this.image(p); return `<article class="aff-product"><div class="aff-product-media">${img ? `<img src="${this.escape(img)}" alt="${this.escape(p.name)}" loading="lazy">` : '<i class="fas fa-box"></i>'}</div><div class="aff-product-body"><h3>${this.escape(p.name || 'Produit')}</h3><div class="aff-product-meta"><span><i class="fas fa-store"></i> ${this.escape(p.vendorName || p.shopName || 'Smart Cut Services')}</span><span><i class="fas fa-layer-group"></i> ${this.escape(this.productDepartment(p))}</span><span><i class="fas fa-tag"></i> Réduction client : ${r.customerRate}%</span></div><div class="aff-product-price"><div><strong>${this.price(p.price)}</strong><span>${r.affiliateRate}% affilié</span></div><button class="aff-btn aff-btn--gold" data-generate-link="${this.escape(p.id)}">Générer le lien</button></div></div></article>`; }).join(''); }
  renderLinks() { return `<section class="aff-panel"><div class="aff-panel-head"><h2>Liens générés</h2><span class="aff-status">${this.links.length} lien(s)</span></div>${this.links.length ? this.renderLinkTable(this.links) : this.empty('Aucun lien', 'Générez votre premier lien depuis le catalogue.', 'fa-link')}</section>`; }
  renderLinkTable(links) { return `<div class="aff-table-wrap"><table class="aff-table"><thead><tr><th>Produit</th><th>Créé le</th><th>Clics</th><th>Conversions</th><th>Statut</th><th></th></tr></thead><tbody>${links.map(l=>`<tr><td><strong>${this.escape(l.productName || l.productId)}</strong><small>${this.escape(l.url || '')}</small></td><td>${this.date(l.createdAt) ? new Date(this.date(l.createdAt)).toLocaleDateString('fr-FR') : '-'}</td><td>${Number(l.clicks||0)}</td><td>${Number(l.conversions||0)}</td><td><span class="aff-status">${this.escape(l.status || 'ACTIVE')}</span></td><td><button class="aff-btn aff-btn--light" data-copy-link="${this.escape(l.url || '')}"><i class="fas fa-copy"></i></button></td></tr>`).join('')}</tbody></table></div>`; }
  renderCommissions() { const rows = this.commissions.length ? this.commissions : (Array.isArray(this.account?.commissionHistory) ? this.account.commissionHistory : []); const available = rows.filter(r=>r.status==='AVAILABLE').reduce((s,r)=>s+Number(r.commissionAmount||r.amount||0),0); return `<section class="aff-panel"><div class="aff-panel-head"><h2>Historique des commissions</h2><span class="aff-status">Disponible : ${this.price(available)}</span></div>${rows.length ? `<div class="aff-table-wrap"><table class="aff-table"><thead><tr><th>Commande</th><th>Produit</th><th>Base</th><th>Taux</th><th>Montant</th><th>Statut</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${this.escape(r.orderId || '-')}</td><td>${this.escape(r.productName || '-')}</td><td>${this.price(r.baseAmount)}</td><td>${Number(r.affiliateRate||r.rate||0)}%</td><td><strong>${this.price(r.commissionAmount||r.amount)}</strong></td><td><span class="aff-status ${r.status==='PENDING'?'aff-status--pending':''}">${this.escape(r.status || 'PENDING')}</span></td></tr>`).join('')}</tbody></table></div>` : this.empty('Aucune commission', 'Vos commissions apparaîtront après une vente attribuée.', 'fa-wallet')}<div class="aff-panel" style="margin-top:1rem;background:var(--aff-surface-soft)"><div class="aff-panel-head"><h3>Demander un paiement</h3><span class="aff-status">Minimum géré par l’équipe</span></div><div class="aff-form-grid"><div class="aff-field"><label>Montant (HTG)</label><input class="aff-input" type="number" min="1" step="1" data-payout-amount value="${available||''}"></div><div class="aff-field"><label>Destination MonCash</label><input class="aff-input" data-payout-destination placeholder="+509 ..."></div></div><button class="aff-btn aff-btn--gold" data-request-payout ${available<=0?'disabled':''}>Demander le paiement</button></div>${this.payouts.length?`<div style="margin-top:1rem"><strong>Demandes récentes</strong>${this.payouts.map(p=>`<p style="color:var(--aff-muted);margin:.45rem 0">${this.price(p.amount)} · ${this.escape(p.status)} · ${this.escape(p.destination)}</p>`).join('')}</div>`:''}</section>`; }
  renderSettings() { return `<section class="aff-panel"><div class="aff-panel-head"><h2>Profil affilié</h2><span class="aff-status">ACTIVE</span></div><div class="aff-form-grid"><div class="aff-field"><label>Nom</label><input class="aff-input" value="${this.escape(this.user?.displayName || '')}" disabled></div><div class="aff-field"><label>Email</label><input class="aff-input" value="${this.escape(this.user?.email || '')}" disabled></div><div class="aff-field"><label>Statut</label><input class="aff-input" value="Compte actif" disabled></div><div class="aff-field"><label>Fenêtre d’attribution</label><input class="aff-input" value="7 jours" disabled></div></div></section>`; }
  empty(title, text, icon) { return `<div class="aff-empty"><i class="fas ${icon}"></i><strong>${title}</strong><p>${text}</p></div>`; }

  bind() { app.querySelectorAll('[data-aff-logout]').forEach(b=>b.addEventListener('click',()=>this.authManager.logout?.())); app.querySelectorAll('[data-aff-view]').forEach(b=>b.addEventListener('click',()=>{this.activeView=b.dataset.affView;this.renderDashboard();this.bind();})); app.querySelectorAll('[data-generate-link]').forEach(b=>b.addEventListener('click',()=>this.generateLink(b.dataset.generateLink))); app.querySelectorAll('[data-copy-link]').forEach(b=>b.addEventListener('click',()=>this.copy(b.dataset.copyLink))); app.querySelector('[data-request-payout]')?.addEventListener('click',()=>this.requestPayout()); const filter=app.querySelector('[data-aff-filter]'); const dep=app.querySelector('[data-aff-department]'); const apply=()=>{const q=(filter?.value||'').toLowerCase();const d=dep?.value||'';const list=this.products.filter(p=>(!q||String(p.name||'').toLowerCase().includes(q))&&(!d||this.productDepartment(p)===d));const grid=app.querySelector('[data-aff-product-grid]');if(grid)grid.innerHTML=this.renderProductCards(list);this.bind();}; filter?.addEventListener('input',apply);dep?.addEventListener('change',apply); }

  async generateLink(productId) { const product=this.products.find(p=>p.id===productId); if(!product)return; try { const token=await this.user.getIdToken(); const response=await fetch(`${FUNCTION_URL}affiliateGenerateLink`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({productId})}); const payload=await response.json().catch(()=>({})); if(!response.ok||!payload.link?.url) throw new Error(payload.message||'Lien indisponible.'); this.links=[payload.link,...this.links.filter(l=>l.id!==payload.link.id)]; await this.copy(payload.link.url); this.toast('Lien généré et copié.'); this.activeView='links'; this.renderDashboard(); this.bind(); } catch(e) { console.error(e); this.toast('Le service de génération doit être déployé avant utilisation.',true); } }
  async requestPayout() { const amount=Number(app.querySelector('[data-payout-amount]')?.value||0); const destination=String(app.querySelector('[data-payout-destination]')?.value||'').trim(); if(!amount||!destination){this.toast('Montant et destination requis.',true);return;} try { const response=await fetch(`${FUNCTION_URL}affiliateRequestPayout`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${await this.user.getIdToken()}`},body:JSON.stringify({amount,destination,method:'moncash'})}); const payload=await response.json().catch(()=>({})); if(!response.ok) throw new Error(payload.message||payload.error||'Demande refusée'); this.toast('Demande de paiement envoyée.'); await this.loadData(); this.renderDashboard(); this.bind(); } catch(e){ console.error(e); this.toast(e.message||'Paiement indisponible.',true); } }
  async copy(value) { try { await navigator.clipboard.writeText(value); this.toast('Lien copié.'); } catch { this.toast('Copiez le lien manuellement.',true); } }
  toast(message, error=false) { const old=document.querySelector('.aff-toast'); old?.remove(); const node=document.createElement('div'); node.className='aff-toast'; node.style.background=error?'var(--aff-danger)':'var(--aff-ink)'; node.textContent=message; document.body.appendChild(node); setTimeout(()=>node.remove(),3200); }
}

new AffiliateApp().init().catch(error => { console.error('[AFFILIATE] init failed', error); app.innerHTML = '<main class="aff-public-main"><div class="aff-panel"><h1>Chargement impossible</h1><p>Réessayez dans quelques instants.</p></div></main>'; });
