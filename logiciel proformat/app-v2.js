import { auth, authReadyPromise } from '../firebase-init.js?v=20260523-6';
import { billingApi, money, esc, dateLabel } from './api-v2.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const content = $('#content');
const modal = $('#modal');
const modalBody = $('#modalBody');
const titles = { dashboard: "Vue d'ensemble", clients: 'Clients', services: 'Services', proformas: 'Proformas', invoices: 'Factures', payments: 'Paiements', withdrawals: 'Retraits', history: 'Historique', settings: 'Paramètres' };
let currentUser = null;
let data = null;
let view = 'dashboard';

function notify(message, error = false) {
  const el = $('#notice'); el.textContent = message; el.className = `notice${error ? ' error' : ''}`; el.hidden = false;
  clearTimeout(notify.timer); notify.timer = setTimeout(() => { el.hidden = true; }, 4200);
}

async function load(showLoading = true) {
  if (showLoading) content.innerHTML = '<div class="loading">Synchronisation sécurisée…</div>';
  try { data = await billingApi('Bootstrap', { user: currentUser }); render(); }
  catch (error) { content.innerHTML = `<div class="empty"><h3>Impossible de charger l'espace</h3><p>${esc(error.message)}</p><button class="btn primary" data-action="refresh">Réessayer</button></div>`; }
}

function status(value) { return `<span class="badge ${esc(value)}">${esc(String(value || '—').replaceAll('_', ' '))}</span>`; }
function empty(title, copy, action, label) { return `<div class="empty"><h3>${esc(title)}</h3><p>${esc(copy)}</p>${action ? `<button class="btn primary" data-action="${action}">${esc(label)}</button>` : ''}</div>`; }
function buttons(id, kind, options = {}) {
  return `<div class="actions">${options.public ? `<button class="btn ghost" data-action="copy-link" data-id="${id}">Copier le lien</button>` : ''}${options.pdf ? `<button class="btn ghost" data-action="pdf-${kind}" data-id="${id}">PDF</button>` : ''}${options.edit ? `<button class="btn ghost" data-action="edit-${kind}" data-id="${id}">Modifier</button>` : ''}${options.remove ? `<button class="btn danger" data-action="delete-${kind}" data-id="${id}">Archiver</button>` : ''}</div>`;
}

function dashboard() {
  const b = data.balance || {}; const paidThisMonth = data.payments.filter((p) => sameMonth(p.paidAt)).reduce((s, p) => s + p.amountMinor, 0);
  const recent = [...data.payments.map((x) => ({ ...x, kind: 'Paiement', amount: x.amountMinor })), ...data.withdrawals.map((x) => ({ ...x, kind: 'Retrait', amount: -x.amountMinor }))].slice(0, 8);
  const alerts = (data.notifications || []).slice(0, 4);
  return `<div class="cards"><article class="card"><span>Disponible</span><strong>${money(b.availableMinor)}</strong></article><article class="card"><span>Réservé</span><strong>${money(b.reservedMinor)}</strong></article><article class="card"><span>Revenus du mois</span><strong>${money(paidThisMonth)}</strong></article><article class="card"><span>Total retiré</span><strong>${money(b.paidOutMinor)}</strong></article></div>
    <div class="quick-actions"><button class="btn primary" data-action="new-proforma">Créer une proforma</button><button class="btn ghost" data-action="new-client">Ajouter un client</button><button class="btn ghost" data-action="new-withdrawal">Demander un retrait</button></div>
    ${alerts.length ? `<section class="panel"><div class="section-head"><h2>Notifications</h2></div>${alerts.map((x) => `<article class="mobile-record" style="margin-top:8px"><strong>${esc(x.title)}</strong><p class="subtle">${esc(x.message)}</p></article>`).join('')}</section>` : ''}
    <section class="panel"><div class="section-head"><h2>Activité récente</h2><span class="subtle">${data.proformas.length} proforma(s) · ${data.invoices.length} facture(s)</span></div>${recent.length ? table(['Type','Référence','Montant','Statut'], recent.map((x) => [x.kind, x.number || x.providerTransactionId || x.id, money(Math.abs(x.amount)), status(x.status)])) : empty('Aucune activité', 'Créez votre première proforma pour commencer.')}</section>`;
}

function table(headings, rows) {
  return `<div class="table-wrap desktop-table"><table><thead><tr>${headings.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    <div class="mobile-cards">${rows.map((row) => `<article class="mobile-record">${row.map((cell, i) => `<p><strong>${headings[i]}:</strong> ${cell}</p>`).join('')}</article>`).join('')}</div>`;
}

function clients() {
  const rows = data.clients.filter((x) => !x.archived).map((x) => [esc(x.name), esc(x.company || '—'), esc(x.email || x.phone || '—'), buttons(x.id, 'client', { edit: true, remove: true })]);
  return `<section class="panel"><div class="section-head"><div><h2>Répertoire clients</h2><p class="subtle">Réutilisez les coordonnées dans vos proformas.</p></div><button class="btn primary" data-action="new-client">Nouveau client</button></div>${rows.length ? table(['Nom','Entreprise','Contact','Actions'], rows) : empty('Aucun client', 'Ajoutez le client qui recevra votre première proforma.', 'new-client', 'Ajouter un client')}</section>`;
}

function services() {
  const rows = data.services.filter((x) => !x.archived).map((x) => [esc(x.name), esc(x.unit || 'service'), money(x.priceMinor), buttons(x.id, 'service', { edit: true, remove: true })]);
  return `<section class="panel"><div class="section-head"><div><h2>Catalogue de services</h2><p class="subtle">Tarifs privés, propres à votre compte.</p></div><button class="btn primary" data-action="new-service">Nouveau service</button></div>${rows.length ? table(['Service','Unité','Tarif','Actions'], rows) : empty('Aucun service', 'Enregistrez une prestation pour créer vos documents plus vite.', 'new-service', 'Ajouter un service')}</section>`;
}

function proformas() {
  const rows = data.proformas.map((x) => [esc(x.number), esc(x.clientSnapshot?.name || '—'), money(x.totalMinor), status(x.status), buttons(x.id, 'proforma', { public: x.status !== 'DRAFT', pdf: true })]);
  return `<section class="panel"><div class="section-head"><div><h2>Proformas</h2><p class="subtle">Les totaux et numéros sont calculés côté serveur.</p></div><button class="btn primary" data-action="new-proforma">Créer</button></div>${rows.length ? table(['Numéro','Client','Total','Statut','Actions'], rows) : empty('Aucune proforma', 'Créez, publiez puis partagez votre première proforma.', 'new-proforma', 'Créer une proforma')}</section>`;
}

function invoices() {
  const rows = data.invoices.map((x) => [esc(x.number), money(x.amountMinor), dateLabel(x.createdAt), status(x.status), buttons(x.id, 'invoice', { pdf: true })]);
  return `<section class="panel"><div class="section-head"><div><h2>Factures & reçus</h2><p class="subtle">Créés uniquement après confirmation réelle de MonCash.</p></div></div>${rows.length ? table(['Numéro','Montant','Date','Statut','Document'], rows) : empty('Aucune facture', 'Une facture payée apparaîtra après un paiement MonCash vérifié.')}</section>`;
}

function payments() {
  const rows = data.payments.map((x) => [esc(x.providerTransactionId || x.id), money(x.amountMinor), esc(x.provider), dateLabel(x.paidAt), status(x.status)]);
  return `<section class="panel"><div class="section-head"><h2>Paiements reçus</h2></div>${rows.length ? table(['Transaction','Montant','Méthode','Date','Statut'], rows) : empty('Aucun paiement', 'Les paiements vérifiés apparaîtront ici.')}</section>`;
}

function withdrawals() {
  const b = data.balance || {}; const rows = data.withdrawals.map((x) => [esc(x.number), money(x.amountMinor), esc(maskPhone(x.moncashNumberSnapshot)), dateLabel(x.createdAt), status(x.status)]);
  return `<div class="cards"><article class="card"><span>Disponible</span><strong>${money(b.availableMinor)}</strong></article><article class="card"><span>Réservé immédiatement</span><strong>${money(b.reservedMinor)}</strong></article></div><section class="panel"><div class="section-head"><div><h2>Retraits</h2><p class="subtle">Le transfert MonCash est effectué manuellement par SmartCut.</p></div><button class="btn primary" data-action="new-withdrawal">Demander un retrait</button></div>${rows.length ? table(['Numéro','Montant','MonCash','Date','Statut'], rows) : empty('Aucun retrait', 'Vos demandes et leur traitement manuel apparaîtront ici.')}</section>`;
}

function history() {
  const rows = data.ledger.map((x) => [esc(x.type.replaceAll('_',' ')), money(x.amountMinor), esc(x.source || 'SMARTCUT'), esc(x.referenceId || '—'), dateLabel(x.createdAt)]);
  return `<section class="panel"><div class="section-head"><div><h2>Ledger financier</h2><p class="subtle">Historique append-only des mouvements de votre compte.</p></div></div>${rows.length ? table(['Mouvement','Montant','Source','Référence','Date'], rows) : empty('Aucun mouvement', 'Le ledger sera alimenté par les paiements et retraits.')}</section>`;
}

function settings() {
  const p = data.profile || {};
  return `<section class="panel"><div class="section-head"><div><h2>Profil de facturation</h2><p class="subtle">Ces informations figurent sur vos documents.</p></div></div><form id="profileForm" class="form-grid"><label>Entreprise<input name="businessName" required value="${esc(p.businessName || '')}"></label><label>Nom du contact<input name="contactName" value="${esc(p.contactName || '')}"></label><label>Email<input name="email" type="email" value="${esc(p.email || currentUser.email || '')}"></label><label>Téléphone<input name="phone" value="${esc(p.phone || '')}"></label><label>Numéro MonCash<input name="moncashNumber" value="${esc(p.moncashNumber || '')}"></label><label>NIF / Matricule<input name="taxId" value="${esc(p.taxId || '')}"></label><label class="full">Adresse<textarea name="address" rows="3">${esc(p.address || '')}</textarea></label><div class="full"><button class="btn primary">Enregistrer</button></div></form></section>`;
}

function render() {
  $('#viewTitle').textContent = titles[view];
  content.innerHTML = ({ dashboard, clients, services, proformas, invoices, payments, withdrawals, history, settings })[view]();
}

function sameMonth(timestamp) {
  const d = timestamp?.toDate?.() || (timestamp ? new Date(timestamp) : null); const now = new Date();
  return d && d.getUTCFullYear() === now.getUTCFullYear() && d.getUTCMonth() === now.getUTCMonth();
}
function maskPhone(value = '') { const digits = value.replace(/\D/g, ''); return digits.length > 4 ? `${digits.slice(0,2)}••••${digits.slice(-2)}` : value; }
function openModal(html) { modalBody.innerHTML = html; modal.showModal(); }
function closeModal() { modal.close(); }
function formData(form) { return Object.fromEntries(new FormData(form)); }

function clientModal(item = {}) {
  openModal(`<h2>${item.id ? 'Modifier' : 'Nouveau'} client</h2><form id="clientForm" class="form-grid"><input type="hidden" name="id" value="${esc(item.id || '')}"><label>Nom<input name="name" required value="${esc(item.name || '')}"></label><label>Entreprise<input name="company" value="${esc(item.company || '')}"></label><label>Email<input name="email" type="email" value="${esc(item.email || '')}"></label><label>Téléphone<input name="phone" value="${esc(item.phone || '')}"></label><label class="full">Adresse<textarea name="address">${esc(item.address || '')}</textarea></label><label class="full">Notes<textarea name="notes">${esc(item.notes || '')}</textarea></label><div class="full"><button class="btn primary">Enregistrer</button></div></form>`);
}
function serviceModal(item = {}) {
  openModal(`<h2>${item.id ? 'Modifier' : 'Nouveau'} service</h2><form id="serviceForm" class="form-grid"><input type="hidden" name="id" value="${esc(item.id || '')}"><label>Nom<input name="name" required value="${esc(item.name || '')}"></label><label>Tarif HTG<input name="price" type="number" min="0.01" step="0.01" required value="${item.priceMinor ? item.priceMinor / 100 : ''}"></label><label>Unité<input name="unit" value="${esc(item.unit || 'service')}"></label><label class="full">Description<textarea name="description">${esc(item.description || '')}</textarea></label><div class="full"><button class="btn primary">Enregistrer</button></div></form>`);
}
function withdrawalModal() {
  const p = data.profile || {}; openModal(`<h2>Demander un retrait</h2><p>Les fonds seront réservés immédiatement. SmartCut effectuera ensuite le transfert MonCash manuellement.</p><form id="withdrawalForm" class="form-grid"><label>Montant HTG<input name="amount" type="number" min="500" step="0.01" max="${(data.balance.availableMinor || 0)/100}" required></label><label>Numéro MonCash<input name="moncashNumber" required value="${esc(p.moncashNumber || '')}"></label><label class="full"><input name="confirm" type="checkbox" required> Je confirme le montant et le numéro MonCash.</label><div class="full"><button class="btn primary">Réserver les fonds</button></div></form>`);
}
function proformaModal() {
  const activeClients = data.clients.filter((x) => !x.archived); if (!activeClients.length) { notify("Ajoutez d'abord un client.", true); clientModal(); return; }
  const today = new Date().toISOString().slice(0,10); const expiry = new Date(Date.now()+30*86400000).toISOString().slice(0,10);
  openModal(`<h2>Nouvelle proforma</h2><form id="proformaForm"><div class="form-grid"><label>Client<select name="clientId" required>${activeClients.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></label><label>Date<input name="issueDate" type="date" required value="${today}"></label><label>Expiration<input name="expiryDate" type="date" required value="${expiry}"></label><label>Statut<select name="publish"><option value="true">Publier et partager</option><option value="">Brouillon</option></select></label></div><h3>Prestations</h3><div id="lines"></div><button type="button" class="btn ghost" data-action="add-line">+ Ajouter une ligne</button><div class="form-grid" style="margin-top:16px"><label>Réduction<input name="discount" type="number" min="0" step="0.01" value="0"></label><label>Taxes<input name="tax" type="number" min="0" step="0.01" value="0"></label><label>Frais<input name="fee" type="number" min="0" step="0.01" value="0"></label><label class="full">Notes<textarea name="notes"></textarea></label><label class="full">Conditions<textarea name="terms"></textarea></label></div><button class="btn primary">Créer la proforma</button></form>`); addLine();
}
function addLine(service = data.services.find((x) => !x.archived)) {
  const row = document.createElement('div'); row.className = 'line-row'; row.innerHTML = `<input class="line-name" aria-label="Prestation" required placeholder="Prestation" value="${esc(service?.name || '')}"><input class="line-qty" aria-label="Quantité" type="number" min="1" step="1" value="1"><input class="line-price" aria-label="Prix unitaire HTG" type="number" min="0.01" step="0.01" placeholder="Prix HTG" value="${service?.priceMinor ? service.priceMinor/100 : ''}"><button type="button" class="btn danger" data-action="remove-line" aria-label="Retirer">×</button>`; $('#lines').append(row);
}

async function save(endpoint, body, success, options = {}) {
  const button = modalBody.querySelector('button[type="submit"],button:not([type])'); if (button) button.disabled = true;
  try { await billingApi(endpoint, { method: 'POST', body, user: currentUser, ...options }); closeModal(); notify(success); await load(false); }
  catch (error) { notify(error.message, true); if (button) button.disabled = false; }
}

document.addEventListener('submit', async (event) => {
  const form = event.target; if (!['profileForm','clientForm','serviceForm','withdrawalForm','proformaForm'].includes(form.id)) return; event.preventDefault();
  const values = formData(form);
  if (form.id === 'profileForm') { try { await billingApi('SaveProfile', { method:'POST', body:values, user:currentUser }); notify('Profil enregistré.'); await load(false); } catch(e){notify(e.message,true);} }
  if (form.id === 'clientForm') save('SaveClient', values, 'Client enregistré.');
  if (form.id === 'serviceForm') save('SaveService', values, 'Service enregistré.');
  if (form.id === 'withdrawalForm') save('RequestWithdrawal', values, 'Demande créée et fonds réservés.', { idempotencyKey: crypto.randomUUID() });
  if (form.id === 'proformaForm') {
    values.publish = values.publish === 'true'; values.items = $$('.line-row', form).map((r) => ({ name: $('.line-name',r).value, quantity: Number($('.line-qty',r).value), unitPrice: $('.line-price',r).value }));
    save('SaveProforma', values, 'Proforma créée.');
  }
});

document.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action]'); if (!target) return; const action = target.dataset.action; const id = target.dataset.id;
  if (action === 'refresh') load(); if (action === 'new-client') clientModal(); if (action === 'new-service') serviceModal(); if (action === 'new-withdrawal') withdrawalModal(); if (action === 'new-proforma') proformaModal(); if (action === 'add-line') addLine(); if (action === 'remove-line') target.closest('.line-row').remove();
  if (action === 'edit-client') clientModal(data.clients.find((x) => x.id === id)); if (action === 'edit-service') serviceModal(data.services.find((x) => x.id === id));
  if (action.startsWith('delete-') && confirm('Archiver cet élément ?')) { const kind = action.endsWith('client') ? 'Client' : 'Service'; try { await billingApi(`Save${kind}`, { method:'POST', body:{ action:'delete', id }, user:currentUser }); notify('Élément archivé.'); await load(false); } catch(e){notify(e.message,true);} }
  if (action === 'copy-link') { const item = data.proformas.find((x) => x.id === id); await navigator.clipboard.writeText(`${location.origin}/facture.html?t=${item.publicToken}`); notify('Lien public copié.'); }
  if (action === 'pdf-proforma') generateProformaPdf(data.proformas.find((x) => x.id === id));
  if (action === 'pdf-invoice') generateInvoicePdf(data.invoices.find((x) => x.id === id));
});

$('#nav').addEventListener('click', (event) => { const button = event.target.closest('[data-view]'); if (!button) return; view = button.dataset.view; $$('#nav button').forEach((x) => x.classList.toggle('active', x === button)); render(); window.scrollTo(0,0); });
$('#refreshBtn').addEventListener('click', () => load());

function pdfBase(title, number) {
  if (!window.jspdf?.jsPDF) throw new Error('Le générateur PDF est encore en chargement.');
  const doc = new window.jspdf.jsPDF(); doc.setFillColor(17,24,39); doc.rect(0,0,210,34,'F'); doc.setTextColor(255); doc.setFontSize(20); doc.text(data.profile?.businessName || 'SmartCut Prestataire', 15, 21); doc.setTextColor(17,24,39); doc.setFontSize(18); doc.text(title, 15, 49); doc.setFontSize(11); doc.text(number || '', 195,49,{align:'right'}); return doc;
}
function generateProformaPdf(item) {
  try { const doc = pdfBase('PROFORMA', item.number); let y=62; doc.setFontSize(10); doc.text(`Client : ${item.clientSnapshot?.name || ''}`,15,y); doc.text(`Émise : ${item.issueDate}   Expire : ${item.expiryDate}`,15,y+7); y+=20; item.items.forEach((line) => { doc.text(`${line.quantity} × ${line.name}`,15,y); doc.text(money(line.lineTotalMinor),195,y,{align:'right'}); y+=8; }); doc.line(15,y,195,y); doc.setFontSize(15); doc.text(`TOTAL : ${money(item.totalMinor)}`,195,y+12,{align:'right'}); doc.setFontSize(9); doc.text('Vérifiez et payez ce document via son lien sécurisé SmartCut Services.',15,282); doc.save(`${item.number}.pdf`); } catch(e){notify(e.message,true);}
}
function generateInvoicePdf(invoice) {
  try { const proforma = data.proformas.find((x) => x.id === invoice.proformaId); const doc = pdfBase('FACTURE PAYÉE', invoice.number); doc.setFontSize(10); doc.text(`Proforma : ${proforma?.number || invoice.proformaId}`,15,65); doc.text(`Client : ${proforma?.clientSnapshot?.name || ''}`,15,73); doc.text(`Mode de paiement : MonCash`,15,81); doc.text(`Transaction : ${invoice.providerTransactionId || ''}`,15,89); doc.setFontSize(17); doc.text(`PAYÉ : ${money(invoice.amountMinor)}`,195,110,{align:'right'}); doc.setFontSize(9); doc.text(`Code de vérification : ${invoice.verificationCode}`,15,275); doc.save(`${invoice.number}.pdf`); } catch(e){notify(e.message,true);}
}

currentUser = await authReadyPromise.catch(() => auth.currentUser);
if (!currentUser) { $('#authGate').hidden = false; }
else { $('#app').hidden = false; await load(); }
