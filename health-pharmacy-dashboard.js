import { auth, db, storage } from './firebase-init.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js';
import { collection, getDocs, query, where, doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import { ref, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-storage.js';
import { uploadImageFile } from './firebase-storage.js';
import mountProfilePhotoUploader from './health-profile-photo.js';

const FN = 'https://us-central1-smartcutservices-9ce54.cloudfunctions.net/';
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (v) => `${Number(v || 0).toLocaleString('fr-FR')} HTG`;
const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const ORDER_LABELS = { PAYMENT_PENDING: 'Paiement en attente', PAID: 'Nouvelle', ACCEPTED: 'Acceptée', PREPARING: 'En préparation', READY: 'Prête', DELIVERING: 'En livraison', DELIVERED: 'Remise / Livrée', COMPLETED: 'Terminée', CANCELLED: 'Annulée', REFUNDED: 'Remboursée' };
const PAYOUT_LABELS = { requested: 'Demandé', approved: 'Approuvé', paid: 'Payé', rejected: 'Refusé' };
const SALE_STATUSES = ['PAID', 'ACCEPTED', 'PREPARING', 'READY', 'DELIVERING', 'DELIVERED', 'COMPLETED'];

let user, products = [], orders = [], ledgerEntries = [], payoutRequests = [], balance = { availableAmount: 0 }, editingProductId = null, editingImages = [], routedPrescriptions = [];
const RX_STATUS_LABELS = { RECEIVED: 'Ordonnance reçue', UNDER_REVIEW: 'En cours de vérification', VALIDATED: 'Vérifiée — en attente de paiement', PRICE_CONFIRMED: 'Prix confirmé par le patient', PAYMENT_PENDING: 'En attente de paiement', PAID: 'Payée', PREPARING: 'En préparation', READY: 'Prête', DELIVERING: 'En livraison', DELIVERED: 'Livrée', NEEDS_CLARIFICATION: 'Précision demandée', REJECTED: 'Non traitée', CANCELLED: 'Annulée' };
const notice = (t, isError = false) => { $('#notice').textContent = t; $('#notice').className = `health-status ${isError ? 'error' : 'success'}`; };

async function call(name, body) {
  const token = await user.getIdToken();
  const r = await fetch(FN + name, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(d.message || 'Action impossible');
  return d;
}
async function callGet(name, params = {}) {
  const url = new URL(FN + name);
  Object.entries(params).forEach(([k, v]) => { if (v != null && v !== '') url.searchParams.set(k, v); });
  const r = await fetch(url);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(d.message || 'Action impossible');
  return d;
}

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}
function fmt(value) { const d = toDate(value); return d ? d.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }) : '—'; }

function groupByMonth(items, dateField) {
  const groups = new Map();
  items.forEach((item) => {
    const d = toDate(item[dateField]);
    if (!d) return;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!groups.has(key)) groups.set(key, { key, label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`, items: [] });
    groups.get(key).items.push(item);
  });
  return [...groups.values()].sort((a, b) => b.key.localeCompare(a.key));
}

async function load() {
  const profileSnap = await getDoc(doc(db, 'clients', user.uid));
  const data = profileSnap.data() || {};
  if (data.role !== 'pharmacy' || data.pharmacyStatus !== 'verified') throw Object.assign(new Error('not-verified'), { code: 'not-verified' });
  const p = data.pharmacyProfile || {};
  $('#pharmacyName').textContent = p.businessName || user.email || 'Pharmacie';
  $('#pharmacyProfileSummary').innerHTML = `<div class="professional-grid"><div><span class="stat__label">Nom commercial</span><strong>${esc(p.businessName || 'À renseigner')}</strong></div><div><span class="stat__label">Responsable</span><strong>${esc(p.responsibleName || 'À renseigner')}</strong></div><div><span class="stat__label">Adresse</span><strong>${esc(p.address || 'À renseigner')}</strong></div><div><span class="stat__label">Téléphone</span><strong>${esc(p.phone || 'À renseigner')}</strong></div><div><span class="stat__label">E-mail</span><strong>${esc(p.email || 'À renseigner')}</strong></div></div><div class="professional-note"><i class="fas fa-shield-heart"></i><span>Profil vérifié — visible par les patients lors de leurs commandes.</span></div><div class="professional-actions"><a class="btn health-btn secondary" href="./health-candidature.html">Gérer mon dossier</a></div>`;
  const pharmacyPhotoUrl = p.photoPath ? await getDownloadURL(ref(storage, p.photoPath)).catch(() => null) : null;
  mountProfilePhotoUploader('pharmacyProfilePhoto', 'pharmacy', pharmacyPhotoUrl);

  const [productSnap, orderSnap, ledgerSnap, payoutSnap, balanceSnap, routeSnap] = await Promise.all([
    getDocs(query(collection(db, 'healthPharmacyProducts'), where('pharmacyId', '==', user.uid))),
    getDocs(query(collection(db, 'healthOrders'), where('pharmacyId', '==', user.uid))),
    getDocs(query(collection(db, 'ledgerEntries'), where('organizationId', '==', user.uid))),
    getDocs(query(collection(db, 'payoutRequests'), where('organizationId', '==', user.uid))),
    getDoc(doc(db, 'balances', user.uid)),
    getDocs(query(collection(db, 'healthPrescriptionRoutes'), where('pharmacyId', '==', user.uid)))
  ]);
  products = productSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  orders = orderSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0));
  ledgerEntries = ledgerSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((x) => x.type === 'payment');
  payoutRequests = payoutSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  balance = balanceSnap.data() || { availableAmount: 0 };
  const routedPrescriptionDocs = await Promise.all(routeSnap.docs.map((r) => getDoc(doc(db, 'healthPrescriptions', r.data().prescriptionId))));
  routedPrescriptions = routedPrescriptionDocs.filter((s) => s.exists()).map((s) => ({ id: s.id, ...s.data() }));

  renderOverview();
  renderProducts();
  renderPrescriptions();
  renderOrderTabs();
  renderSales();
  renderStockAlerts();
  renderWallet();
  renderWithdrawals();
}

// ---------- Overview ----------
function renderOverview() {
  const newOrders = orders.filter((o) => o.status === 'PAID');
  const activeProducts = products.filter((p) => p.active !== false);
  const lowStock = products.filter((p) => Number(p.stock || 0) <= 5);
  const todayKey = new Date().toISOString().slice(0, 10);
  const todaySales = orders.filter((o) => SALE_STATUSES.includes(o.status) && toDate(o.paidAt)?.toISOString().slice(0, 10) === todayKey).reduce((n, o) => n + Number(o.total || 0), 0);
  $('#statNewOrders').textContent = newOrders.length;
  $('#statProducts').textContent = activeProducts.length;
  $('#statLowStock').textContent = lowStock.length;
  $('#statTodaySales').textContent = money(todaySales);
  $('#overviewOrders').innerHTML = orders.length ? orders.slice(0, 8).map(orderRow).join('') : '<div class="empty">Aucune commande pour le moment.</div>';
  bindOrderActions($('#overviewOrders'));
}

// ---------- Products ----------
function renderProducts() {
  $('#productsList').innerHTML = products.length ? products.map((p) => `
    <div class="health-provider-row">
      <div style="display:flex;align-items:center;gap:.7rem;min-width:0;">
        ${p.images?.[0] ? `<img src="${esc(p.images[0])}" alt="" style="width:48px;height:48px;object-fit:cover;border-radius:8px;">` : '<span style="width:48px;height:48px;display:grid;place-items:center;border-radius:8px;background:var(--health-soft);color:var(--health);"><i class="fas fa-pills"></i></span>'}
        <div><strong>${esc(p.name)}</strong><small>${esc([p.dosage, p.pharmaceuticalForm, p.therapeuticClass].filter(Boolean).join(' · ') || 'Informations non renseignées')}</small></div>
      </div>
      <div class="health-provider-row__meta">
        <span>${money(p.price)}</span>
        <span class="health-badge ${Number(p.stock || 0) <= 5 ? 'warn' : ''}">${Number(p.stock || 0)} en stock</span>
        ${p.active === false ? '<span class="health-badge">Inactif</span>' : ''}
        <button class="health-icon-btn" type="button" data-edit-product="${p.id}" aria-label="Modifier ${esc(p.name)}"><i class="fas fa-pen"></i></button>
        <button class="health-icon-btn" type="button" data-toggle-active="${p.id}" aria-label="${p.active === false ? 'Activer' : 'Désactiver'}"><i class="fas ${p.active === false ? 'fa-eye' : 'fa-eye-slash'}"></i></button>
        <button class="health-icon-btn" type="button" data-delete-product="${p.id}" aria-label="Supprimer ${esc(p.name)}"><i class="fas fa-trash"></i></button>
      </div>
    </div>`).join('') : '<div class="empty">Aucun produit publié. Ajoutez votre premier produit.</div>';

  $('#productsList').querySelectorAll('[data-edit-product]').forEach((b) => b.addEventListener('click', () => editProduct(b.dataset.editProduct)));
  $('#productsList').querySelectorAll('[data-toggle-active]').forEach((b) => b.addEventListener('click', () => toggleActive(b.dataset.toggleActive)));
  $('#productsList').querySelectorAll('[data-delete-product]').forEach((b) => b.addEventListener('click', () => deleteProduct(b.dataset.deleteProduct)));
}

async function toggleActive(id) {
  const product = products.find((p) => p.id === id);
  if (!product) return;
  try {
    await call('healthSaveMedicine', { ...productPayloadFrom(product), productId: id, active: product.active === false });
    notice(product.active === false ? 'Produit activé.' : 'Produit désactivé.');
    await load();
  } catch (error) { notice(error.message, true); }
}

async function deleteProduct(id) {
  const product = products.find((p) => p.id === id);
  if (!confirm(`Supprimer « ${product?.name || 'ce produit'} » du catalogue ? Cette action est définitive.`)) return;
  try {
    await call('healthDeleteMedicine', { productId: id });
    notice('Produit supprimé.');
    await load();
  } catch (error) { notice(error.message, true); }
}

function productPayloadFrom(p) {
  return {
    name: p.name, dci: p.dci, dosage: p.dosage, pharmaceuticalForm: p.pharmaceuticalForm,
    therapeuticClass: p.therapeuticClass, therapeuticSubclass: p.therapeuticSubclass, activeIngredients: p.activeIngredients,
    presentation: p.presentation, manufacturer: p.manufacturer, images: p.images || [], price: p.price, stock: p.stock,
    prescriptionRequired: p.prescriptionRequired === true, coldChainRequired: p.coldChainRequired === true, notes: p.notes
  };
}

function editProduct(id) {
  const product = products.find((p) => p.id === id);
  if (!product) return;
  editingProductId = id;
  editingImages = [...(product.images || [])];
  $('#pId').value = id;
  $('#pName').value = product.name || '';
  $('#pDci').value = product.dci || '';
  $('#pDosage').value = product.dosage || '';
  $('#pForm').value = product.pharmaceuticalForm || '';
  $('#pClass').value = product.therapeuticClass || '';
  $('#pSubclass').value = product.therapeuticSubclass || '';
  $('#pIngredients').value = product.activeIngredients || '';
  $('#pPresentation').value = product.presentation || '';
  $('#pManufacturer').value = product.manufacturer || '';
  $('#pPrice').value = product.price ?? '';
  $('#pStock').value = product.stock ?? '';
  $('#pNotes').value = product.notes || '';
  $('#pPrescriptionRequired').checked = product.prescriptionRequired === true;
  $('#pColdChain').checked = product.coldChainRequired === true;
  $('#pActive').checked = product.active !== false;
  $('#productFormTitle').textContent = 'Modifier le produit';
  $('#pSubmitBtn').textContent = 'Enregistrer les modifications';
  $('#cancelProductEdit').hidden = false;
  renderPhotoGrid();
  selectTab('add-product');
}

function resetProductForm() {
  editingProductId = null;
  editingImages = [];
  $('#productForm').reset();
  $('#pId').value = '';
  $('#productFormTitle').textContent = 'Ajouter un produit';
  $('#pSubmitBtn').textContent = 'Ajouter au catalogue';
  $('#cancelProductEdit').hidden = true;
  renderPhotoGrid();
}

function renderPhotoGrid() {
  $('#pPhotoGrid').innerHTML = editingImages.map((url, i) => `<div class="ph-photo-item"><img src="${esc(url)}" alt=""><button type="button" data-remove-photo="${i}" aria-label="Retirer"><i class="fas fa-xmark"></i></button></div>`).join('');
  $('#pPhotoGrid').querySelectorAll('[data-remove-photo]').forEach((b) => b.addEventListener('click', () => { editingImages.splice(Number(b.dataset.removePhoto), 1); renderPhotoGrid(); }));
}

$('#goAddProduct').addEventListener('click', () => { resetProductForm(); selectTab('add-product'); });
$('#cancelProductEdit').addEventListener('click', () => resetProductForm());

$('#pPhotoInput').addEventListener('change', async (event) => {
  const files = [...event.target.files].slice(0, 6 - editingImages.length);
  if (!files.length) return;
  const status = $('#pPhotoStatus');
  for (const file of files) {
    status.textContent = `Envoi de ${file.name}…`;
    try {
      const uploaded = await uploadImageFile(file, `health-pharmacy-products/${user.uid}`, { maxSizeMb: 8 });
      editingImages.push(uploaded.url);
    } catch (error) { status.textContent = `Échec pour ${file.name} : ${error.message}`; }
  }
  status.textContent = '';
  event.target.value = '';
  renderPhotoGrid();
});

$('#productForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const status = $('#productFormStatus');
  status.textContent = 'Enregistrement…';
  try {
    await call('healthSaveMedicine', {
      productId: editingProductId || undefined,
      name: $('#pName').value.trim(), dci: $('#pDci').value.trim(), dosage: $('#pDosage').value.trim(),
      pharmaceuticalForm: $('#pForm').value, therapeuticClass: $('#pClass').value, therapeuticSubclass: $('#pSubclass').value.trim(),
      activeIngredients: $('#pIngredients').value.trim(), presentation: $('#pPresentation').value.trim(), manufacturer: $('#pManufacturer').value.trim(),
      images: editingImages, price: Number($('#pPrice').value), stock: Number($('#pStock').value), notes: $('#pNotes').value.trim(),
      prescriptionRequired: $('#pPrescriptionRequired').checked, coldChainRequired: $('#pColdChain').checked, active: $('#pActive').checked
    });
    status.className = 'health-status success';
    status.textContent = editingProductId ? 'Produit mis à jour.' : 'Produit ajouté au catalogue.';
    resetProductForm();
    await load();
    selectTab('products');
  } catch (error) { status.className = 'health-status error'; status.textContent = error.message; }
});

async function loadFormOptions() {
  try {
    const options = await callGet('healthGetMedicineFormOptions');
    $('#pForm').innerHTML = '<option value="">Choisir…</option>' + options.pharmaceuticalForms.map((f) => `<option>${esc(f)}</option>`).join('');
    $('#pClass').innerHTML = '<option value="">Choisir…</option>' + options.therapeuticClasses.map((c) => `<option>${esc(c)}</option>`).join('');
  } catch (_) {
    $('#pForm').innerHTML = '<option value="">Indisponible</option>';
    $('#pClass').innerHTML = '<option value="">Indisponible</option>';
  }
}

// ---------- Ordonnances scannées routées vers cette pharmacie ----------
function renderPrescriptions() {
  $('#prescriptionsList').innerHTML = routedPrescriptions.length ? routedPrescriptions.map((p) => `
    <div class="health-provider-row">
      <div><strong>Ordonnance ${esc(p.id.slice(0, 8))}</strong> <span class="health-badge ${['REJECTED', 'CANCELLED'].includes(p.status) ? 'danger' : ''}">${esc(RX_STATUS_LABELS[p.status] || p.status)}</span><br><small class="muted">Reçue le ${esc(fmt(p.createdAt))}</small></div>
      <div class="health-provider-row__meta">
        <button class="health-btn secondary" style="padding:.4rem .7rem;font-size:.76rem;" data-view-rx="${p.id}">Consulter</button>
        ${['RECEIVED', 'UNDER_REVIEW', 'VALIDATED'].includes(p.status) ? `<button class="health-btn primary" style="padding:.4rem .7rem;font-size:.76rem;" data-offer-rx="${p.id}">Répondre</button>` : ''}
        ${['RECEIVED', 'UNDER_REVIEW'].includes(p.status) ? `<button class="health-btn danger" style="padding:.4rem .7rem;font-size:.76rem;" data-review-rx="${p.id}" data-review-action="REJECTED">Refuser</button>` : ''}
      </div>
    </div>`).join('') : '<div class="empty">Aucune ordonnance transmise pour le moment.</div>';

  $('#prescriptionsList').querySelectorAll('[data-view-rx]').forEach((b) => b.addEventListener('click', async () => {
    try { const out = await call('healthGetPrivateDocument', { type: 'prescription', id: b.dataset.viewRx }); window.open(out.url, '_blank', 'noopener,noreferrer'); } catch (error) { notice(error.message, true); }
  }));
  $('#prescriptionsList').querySelectorAll('[data-offer-rx]').forEach((b) => b.addEventListener('click', () => openOfferDialog(b.dataset.offerRx)));
  $('#prescriptionsList').querySelectorAll('[data-review-rx]').forEach((b) => b.addEventListener('click', async () => {
    const reason = prompt('Motif compréhensible du refus, visible par le patient :');
    if (!reason) return;
    try {
      const prescription = routedPrescriptions.find((p) => p.id === b.dataset.reviewRx);
      if (prescription?.status === 'RECEIVED') await call('healthReviewPrescription', { prescriptionId: b.dataset.reviewRx, action: 'UNDER_REVIEW' });
      await call('healthReviewPrescription', { prescriptionId: b.dataset.reviewRx, action: b.dataset.reviewAction, reason });
      notice('Ordonnance mise à jour.');
      await load();
    } catch (error) { notice(error.message, true); }
  }));
}

function openOfferDialog(prescriptionId) {
  const body = $('#offerDialogBody');
  const activeProducts = products.filter((p) => p.active !== false);
  body.innerHTML = `<form id="offerForm" class="health-form">
    <div class="health-notice"><i class="fas fa-circle-info"></i> Cochez uniquement les médicaments réellement lus sur l’ordonnance. Les prix viennent de votre catalogue.</div>
    ${activeProducts.length ? activeProducts.map((p) => `<div class="health-provider-row"><label style="display:flex;align-items:center;gap:.6rem;flex:1;"><input type="checkbox" name="product" value="${p.id}"> <span><strong>${esc(p.name)}</strong><br><small class="muted">${money(p.price)} · Stock ${Number(p.stock || 0)}</small></span></label><input type="number" min="1" value="1" data-qty-product="${p.id}" style="width:64px;padding:.4rem;border:1px solid var(--health-line);border-radius:8px;"><label style="display:flex;align-items:center;gap:.3rem;font-size:.76rem;"><input type="checkbox" data-unavailable-product="${p.id}"> Indispo.</label></div>`).join('') : '<div class="empty">Ajoutez d’abord des produits à votre catalogue.</div>'}
    <div class="health-form-grid">
      <div class="health-field"><label for="offerDeliveryFee">Frais de livraison (HTG)</label><input id="offerDeliveryFee" type="number" min="0" value="0"></div>
      <div class="health-field"><label for="offerEta">Délai</label><input id="offerEta" placeholder="Aujourd’hui, demain…"></div>
    </div>
    <button class="health-btn primary" type="submit">Envoyer la proposition</button>
    <div class="health-status" id="offerFormStatus"></div>
  </form>`;
  $('#offerDialog').showModal();
  $('#offerForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = $('#offerFormStatus');
    const selected = [...body.querySelectorAll('input[name="product"]:checked')];
    if (!selected.length) { status.className = 'health-status error'; status.textContent = 'Sélectionnez au moins un médicament.'; return; }
    const items = selected.map((c) => ({
      productId: c.value,
      qty: Number(body.querySelector(`[data-qty-product="${CSS.escape(c.value)}"]`).value) || 1,
      available: !body.querySelector(`[data-unavailable-product="${CSS.escape(c.value)}"]`).checked
    }));
    try {
      const prescription = routedPrescriptions.find((p) => p.id === prescriptionId);
      if (prescription?.status === 'RECEIVED') await call('healthReviewPrescription', { prescriptionId, action: 'UNDER_REVIEW' });
      await call('healthSubmitPrescriptionOffer', { prescriptionId, items, deliveryFee: Number($('#offerDeliveryFee').value) || 0, deliveryEtaLabel: $('#offerEta').value.trim() });
      status.className = 'health-status success';
      status.textContent = 'Proposition envoyée au patient.';
      setTimeout(() => { $('#offerDialog').close(); load(); }, 900);
    } catch (error) { status.className = 'health-status error'; status.textContent = error.message; }
  });
}
$('#offerDialogClose').addEventListener('click', () => $('#offerDialog').close());

// ---------- Orders ----------
function orderRow(o) {
  const badgeClass = { PAID: 'warn', ACCEPTED: '', PREPARING: '', READY: '', DELIVERING: '', DELIVERED: '', COMPLETED: '', CANCELLED: 'danger', REFUNDED: 'danger' }[o.status] || '';
  const items = Array.isArray(o.items) ? o.items : [];
  const nextActions = {
    PAID: ['ACCEPTED', 'CANCELLED'], ACCEPTED: ['PREPARING', 'CANCELLED'], PREPARING: ['READY', 'CANCELLED'],
    READY: [o.deliveryMethod === 'home' ? 'DELIVERING' : 'DELIVERED'], DELIVERING: ['DELIVERED'], DELIVERED: ['COMPLETED']
  }[o.status] || [];
  const actionLabels = { ACCEPTED: 'Accepter', PREPARING: 'Mettre en préparation', READY: 'Marquer prête', DELIVERING: 'Marquer en livraison', DELIVERED: o.deliveryMethod === 'home' ? 'Marquer livrée' : 'Marquer remise', COMPLETED: 'Terminer', CANCELLED: 'Refuser' };
  return `<div class="health-provider-row" style="align-items:flex-start;">
    <div style="min-width:0;">
      <strong>Commande ${esc(o.id.slice(0, 8))}</strong> <span class="health-badge ${badgeClass}">${esc(ORDER_LABELS[o.status] || o.status)}</span>
      <br><small>${esc(o.customerName || o.patientName || 'Client')} · ${esc(fmt(o.createdAt))}</small>
      <br><small>${items.slice(0, 3).map((i) => `${esc(i.name)} ×${i.qty}`).join(', ') || 'Détails indisponibles'}</small>
      <br><small><i class="fas ${o.deliveryMethod === 'home' ? 'fa-truck' : 'fa-store'}"></i> ${o.deliveryMethod === 'home' ? 'Livraison à domicile' : 'Retrait en pharmacie'}${o.address ? ` · ${esc(o.address.address || '')}` : ''}</small>
    </div>
    <div class="health-provider-row__meta" style="flex-direction:column;align-items:flex-end;gap:.4rem;">
      <strong>${money(o.total)}</strong>
      <div style="display:flex;gap:.4rem;flex-wrap:wrap;justify-content:flex-end;">
        ${nextActions.map((next) => `<button class="health-btn ${next === 'CANCELLED' ? 'danger' : 'secondary'}" style="padding:.4rem .7rem;font-size:.76rem;" data-order-action="${next}" data-order-id="${o.id}">${actionLabels[next]}</button>`).join('')}
      </div>
    </div>
  </div>`;
}

function bindOrderActions(container) {
  container.querySelectorAll('[data-order-action]').forEach((btn) => btn.addEventListener('click', async () => {
    const status = btn.dataset.orderAction;
    if (status === 'CANCELLED' && !confirm('Refuser cette commande ? Le montant payé sera automatiquement remboursé dans le portefeuille du patient.')) return;
    try {
      await call('healthUpdateOrderFulfillment', { orderId: btn.dataset.orderId, status });
      notice('Commande mise à jour.');
      await load();
    } catch (error) { notice(error.message, true); }
  }));
}

function renderOrderTabs() {
  const newOrders = orders.filter((o) => o.status === 'PAID');
  const accepted = orders.filter((o) => ['ACCEPTED', 'PREPARING', 'READY', 'DELIVERING'].includes(o.status));
  const completed = orders.filter((o) => ['DELIVERED', 'COMPLETED'].includes(o.status));
  const cancelled = orders.filter((o) => ['CANCELLED', 'REFUNDED'].includes(o.status));
  $('#newOrdersList').innerHTML = newOrders.length ? newOrders.map(orderRow).join('') : '<div class="empty">Aucune nouvelle commande.</div>';
  $('#acceptedOrdersList').innerHTML = accepted.length ? accepted.map(orderRow).join('') : '<div class="empty">Aucune commande en cours.</div>';
  $('#completedOrdersList').innerHTML = completed.length ? completed.map(orderRow).join('') : '<div class="empty">Aucune commande terminée.</div>';
  $('#cancelledOrdersList').innerHTML = cancelled.length ? cancelled.map(orderRow).join('') : '<div class="empty">Aucune commande refusée ou annulée.</div>';
  [$('#newOrdersList'), $('#acceptedOrdersList'), $('#completedOrdersList')].forEach(bindOrderActions);
}

// ---------- Sales ----------
function renderSales() {
  const sold = orders.filter((o) => SALE_STATUSES.includes(o.status));
  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);
  const monthKey = todayKey.slice(0, 7);
  const yearKey = todayKey.slice(0, 4);
  const sum = (list) => list.reduce((n, o) => n + Number(o.total || 0), 0);
  $('#salesToday').textContent = money(sum(sold.filter((o) => toDate(o.paidAt)?.toISOString().slice(0, 10) === todayKey)));
  $('#salesMonth').textContent = money(sum(sold.filter((o) => toDate(o.paidAt)?.toISOString().slice(0, 7) === monthKey)));
  $('#salesYear').textContent = money(sum(sold.filter((o) => toDate(o.paidAt)?.toISOString().slice(0, 4) === yearKey)));
  const groups = groupByMonth(sold, 'paidAt');
  $('#salesMonthly').innerHTML = groups.length ? groups.map((g) => `<div class="ph-sales-month"><h4><span>${esc(g.label)}</span><strong>${money(sum(g.items))}</strong></h4><small class="muted">${g.items.length} commande(s)</small></div>`).join('') : '<div class="empty">Aucune vente enregistrée.</div>';
}
$('#printSalesBtn').addEventListener('click', () => window.print());

// ---------- Stock ----------
function renderStockAlerts() {
  const alerts = products.filter((p) => Number(p.stock || 0) <= 5);
  $('#stockAlertsList').innerHTML = alerts.length ? alerts.map((p) => `
    <div class="health-provider-row">
      <div><strong>${esc(p.name)}</strong><small>${Number(p.stock || 0) === 0 ? 'Rupture de stock' : `Stock faible : ${p.stock}`}</small></div>
      <div class="health-provider-row__meta">
        <input type="number" min="0" value="${p.stock ?? 0}" data-restock="${p.id}" style="width:80px;padding:.4rem .5rem;border:1px solid var(--health-line);border-radius:8px;">
        <button class="health-btn secondary" style="padding:.4rem .7rem;font-size:.76rem;" data-save-stock="${p.id}">Mettre à jour</button>
        <button class="health-icon-btn" type="button" data-delete-product="${p.id}" aria-label="Supprimer"><i class="fas fa-trash"></i></button>
      </div>
    </div>`).join('') : '<div class="empty">Aucun produit en stock faible ou en rupture.</div>';
  $('#stockAlertsList').querySelectorAll('[data-save-stock]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.saveStock;
    const input = $('#stockAlertsList').querySelector(`[data-restock="${id}"]`);
    const product = products.find((p) => p.id === id);
    try { await call('healthSaveMedicine', { ...productPayloadFrom(product), productId: id, stock: Number(input.value) }); notice('Stock mis à jour.'); await load(); } catch (error) { notice(error.message, true); }
  }));
  $('#stockAlertsList').querySelectorAll('[data-delete-product]').forEach((b) => b.addEventListener('click', () => deleteProduct(b.dataset.deleteProduct)));
}

// ---------- Wallet & withdrawals ----------
function renderWallet() {
  $('#pharmWalletAvailable').textContent = money(balance.availableAmount);
  $('#pharmWalletLifetime').textContent = money(ledgerEntries.reduce((n, e) => n + Number(e.creatorNet || 0), 0));
  if (!ledgerEntries.length) { $('#pharmWalletMonthly').innerHTML = '<div class="empty">Aucun revenu enregistré pour le moment.</div>'; return; }
  $('#pharmWalletMonthly').innerHTML = groupByMonth(ledgerEntries, 'createdAt').map((g) => {
    const total = g.items.reduce((n, e) => n + Number(e.creatorNet || 0), 0);
    return `<div class="ph-sales-month"><h4><span>${esc(g.label)}</span><strong>${money(total)}</strong></h4>${g.items.map((e) => `<div class="health-provider-row"><small class="muted">${esc(fmt(e.createdAt))}</small><span>${money(e.creatorNet)}</span></div>`).join('')}</div>`;
  }).join('');
}

function renderWithdrawals() {
  const openRequest = payoutRequests.find((p) => ['requested', 'approved'].includes(p.status));
  const available = Number(balance.availableAmount) || 0;
  const canRequest = !openRequest && available >= 500;
  const formHtml = `<div class="health-card" style="margin-bottom:1rem;">
    <h3 style="margin-top:0;">Demander un décaissement</h3>
    <p class="muted">Solde disponible : <strong>${money(available)}</strong>${openRequest ? ' — une demande est déjà en cours.' : ''}</p>
    ${canRequest ? `<form id="payoutForm" class="health-form" style="max-width:320px;"><div class="health-field"><label for="payoutAmount">Montant (HTG)</label><input id="payoutAmount" type="number" min="500" max="${available}" value="${available}" required></div><button class="health-btn primary" type="submit">Demander</button></form>` : (openRequest ? '' : '<p class="muted">Solde insuffisant (minimum 500 HTG) ou pas encore disponible — les revenus deviennent disponibles après la période de validation.</p>')}
  </div>`;
  const historyHtml = payoutRequests.length
    ? `<h3>Historique</h3>${payoutRequests.slice().sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0)).map((p) => `<div class="health-provider-row"><div><strong>${money(p.amountRequested)}</strong><br><small class="muted">${esc(fmt(p.createdAt))}</small></div><span class="health-badge">${esc(PAYOUT_LABELS[p.status] || p.status)}</span></div>`).join('')}`
    : '<div class="empty">Aucun décaissement enregistré pour le moment.</div>';
  $('#pharmWithdrawals').innerHTML = formHtml + historyHtml;
  $('#payoutForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try { await call('healthRequestPayout', { amountRequested: Number($('#payoutAmount').value) }); notice('Demande de décaissement envoyée.'); await load(); } catch (error) { notice(error.message, true); }
  });
}

// ---------- Tabs & boot ----------
function selectTab(name) {
  document.querySelectorAll('.health-dashboard__nav button').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === name));
  document.querySelectorAll('.health-panel').forEach((p) => { p.hidden = p.id !== `panel-${name}`; });
}
document.querySelectorAll('.health-dashboard__nav button').forEach((b) => b.addEventListener('click', () => selectTab(b.dataset.tab)));
$('#pharmacyLogout').addEventListener('click', (e) => { e.preventDefault(); signOut(auth); });

onAuthStateChanged(auth, async (u) => {
  document.body.classList.remove('pharmacy-ready', 'pharmacy-blocked');
  if (!u) { document.body.classList.add('pharmacy-blocked'); return; }
  user = u;
  try {
    await loadFormOptions();
    await load();
    document.body.classList.add('pharmacy-ready');
  } catch (error) {
    document.body.classList.add('pharmacy-blocked');
    if (error?.code !== 'not-verified') console.error('Chargement du dashboard pharmacie impossible', error);
  }
});
