// Cœur partagé des dashboards Laboratoire et Imagerie — les deux métiers suivent
// exactement la même mécanique (catalogue d'examens publié, créneaux, commandes
// d'examens payées par le patient, revenus / décaissements), seuls les libellés, la
// collection Firestore et les noms de Cloud Functions diffèrent.
// Smart Cut Health NE STOCKE AUCUN résultat d'examen : le patient récupère son
// résultat en main propre au laboratoire ou au centre d'imagerie (confidentialité).
// health-laboratory-dashboard.js et health-imaging-dashboard.js n'importent que ce
// fichier avec leur propre config — aucune logique dupliquée entre les deux métiers.
import { auth, db, storage } from './firebase-init.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js';
import { collection, getDocs, query, where, doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import { ref, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-storage.js';
import mountProfilePhotoUploader from './health-profile-photo.js';

const FN = 'https://us-central1-smartcutservices-9ce54.cloudfunctions.net/';
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (v) => `${Number(v || 0).toLocaleString('fr-FR')} HTG`;
const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const PAYOUT_LABELS = { requested: 'Demandé', approved: 'Approuvé', paid: 'Payé', rejected: 'Refusé' };
const APPT_LABELS = { PAYMENT_PENDING: 'Paiement en attente', CONFIRMED: 'Nouvelle demande', PROVIDER_ACCEPTED: 'Acceptée', PROVIDER_REFUSED: 'Refusée', RESCHEDULE_REQUESTED: 'Report demandé', COMPLETED: 'Terminé', NO_SHOW: 'Absence', CANCELLED: 'Annulée' };
// Libellés « Statut de la commande » côté prestataire diagnostic (vocabulaire du propriétaire).
const ORDER_STATUS_LABELS = { PAYMENT_PENDING: 'Paiement en attente', CONFIRMED: 'Nouvelle commande', PROVIDER_ACCEPTED: 'Acceptée', PROVIDER_REFUSED: 'Refusée', RESCHEDULE_REQUESTED: 'Report demandé', COMPLETED: 'Terminée', NO_SHOW: 'Absence', CANCELLED: 'Annulée' };

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

export function bootClinicalProviderDashboard(config) {
  let user, exams = [], appointments = [], ledgerEntries = [], payoutRequests = [], balance = { availableAmount: 0 };
  let masterExamCatalog = { categories: [], exams: [] };
  const notice = (t, isError = false) => { $('#notice').textContent = t; $('#notice').className = `health-status ${isError ? 'error' : 'success'}`; };

  async function call(name, body) {
    const token = await user.getIdToken();
    const r = await fetch(FN + name, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Error(d.message || 'Action impossible');
    return d;
  }

  async function load() {
    const profileSnap = await getDoc(doc(db, 'clients', user.uid));
    const data = profileSnap.data() || {};
    if (data.role !== config.providerType || data[config.statusField] !== 'verified') throw Object.assign(new Error('not-verified'), { code: 'not-verified' });
    const p = data[config.profileField] || {};
    $('#providerName').textContent = p.businessName || user.email || config.roleLabel;
    $('#providerProfileSummary').innerHTML = `<div class="professional-grid"><div><span class="stat__label">Nom commercial</span><strong>${esc(p.businessName || 'À renseigner')}</strong></div><div><span class="stat__label">Responsable technique</span><strong>${esc(p.responsibleName || p.technicalLead || 'À renseigner')}</strong></div><div><span class="stat__label">Adresse</span><strong>${esc(p.address || 'À renseigner')}</strong></div><div><span class="stat__label">Téléphone</span><strong>${esc(p.phone || 'À renseigner')}</strong></div></div><div class="professional-note"><i class="fas fa-shield-heart"></i><span>Profil vérifié — visible par les patients lors de leurs réservations.</span></div><div class="professional-actions"><a class="btn health-btn secondary" href="./health-candidature.html">Gérer mon dossier</a></div>`;
    const providerPhotoUrl = p.photoPath ? await getDownloadURL(ref(storage, p.photoPath)).catch(() => null) : null;
    mountProfilePhotoUploader('providerProfilePhoto', config.providerType, providerPhotoUrl);

    if (config.catalogUrl && !masterExamCatalog.exams.length) {
      try {
        const response = await fetch(config.catalogUrl, { cache: 'no-store' });
        if (!response.ok) throw new Error('catalogue indisponible');
        masterExamCatalog = await response.json();
      } catch (error) {
        console.warn('Catalogue maître indisponible:', error);
      }
      initExamCatalogForm();
    }

    const [examSnap, apptSnap, ledgerSnap, payoutSnap, balanceSnap] = await Promise.all([
      getDocs(query(collection(db, config.examCollection), where(config.centerIdField, '==', user.uid))),
      getDocs(query(collection(db, 'healthAppointments'), where('providerUid', '==', user.uid))),
      getDocs(query(collection(db, 'ledgerEntries'), where('organizationId', '==', user.uid))),
      getDocs(query(collection(db, 'payoutRequests'), where('organizationId', '==', user.uid))),
      getDoc(doc(db, 'balances', user.uid))
    ]);
    exams = examSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    appointments = apptSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => String(b.startsAt || '').localeCompare(String(a.startsAt || '')));
    ledgerEntries = ledgerSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((x) => x.type === 'payment');
    payoutRequests = payoutSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    balance = balanceSnap.data() || { availableAmount: 0 };

    renderOverview();
    renderCatalog();
    renderSlots();
    renderAppointments();
    renderPatients();
    renderWallet();
    renderWithdrawals();
    renderReports();
  }

  function initExamCatalogForm() {
    const categorySelect = $('#examCategory');
    const examSelect = $('#examSelect');
    if (!categorySelect || !examSelect || !masterExamCatalog.categories?.length) return;
    categorySelect.innerHTML = '<option value="">Choisir une catégorie…</option>' + masterExamCatalog.categories
      .slice().sort((a, b) => (a.order || 0) - (b.order || 0))
      .map((category) => `<option value="${esc(category.id)}">${esc(category.label)}</option>`).join('');
    categorySelect.onchange = () => {
      const categoryId = categorySelect.value;
      const categoryItems = masterExamCatalog.exams.filter((exam) => exam.active !== false && (exam.categories || []).includes(categoryId));
      const subcategoryField = $('#examSubcategoryField');
      const subcategorySelect = $('#examSubcategory');
      const subcategories = [...new Set(categoryItems.map((exam) => exam.subcategory).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
      if (subcategoryField && subcategorySelect) {
        subcategoryField.hidden = !subcategories.length;
        subcategorySelect.innerHTML = '<option value="">Toutes les sous-catégories</option>' + subcategories.map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join('');
        subcategorySelect.onchange = () => populateExamChoices(categoryId, subcategorySelect.value);
      }
      const items = categoryItems;
      examSelect.disabled = !categoryId;
      examSelect.innerHTML = (categoryId ? '<option value="">Choisir un examen…</option>' : '<option value="">Choisir d’abord une catégorie…</option>') + items.sort((a, b) => a.name.localeCompare(b.name, 'fr')).map((exam) => `<option value="${esc(exam.id)}">${esc(exam.name)}</option>`).join('');
      $('#examName').value = '';
      $('#examSpecimen').value = '';
    };
    function populateExamChoices(categoryId, subcategory) {
      const items = masterExamCatalog.exams.filter((exam) => exam.active !== false && (exam.categories || []).includes(categoryId) && (!subcategory || exam.subcategory === subcategory));
      examSelect.innerHTML = '<option value="">Choisir un examen…</option>' + items.sort((a, b) => a.name.localeCompare(b.name, 'fr')).map((exam) => `<option value="${esc(exam.id)}">${esc(exam.name)}</option>`).join('');
      examSelect.disabled = false;
      $('#examName').value = '';
    }
    examSelect.onchange = () => {
      const exam = masterExamCatalog.exams.find((item) => item.id === examSelect.value);
      if (!exam) return;
      $('#examName').value = exam.name || '';
      $('#examSpecimen').value = exam.specimenType || '';
      $('#examDescription').value = exam.preparation ? `Préparation : ${exam.preparation}` : '';
    };
  }

  // Revenus nets (après commission Smart Cut) crédités au prestataire aujourd'hui.
  function revenueTodayAmount() {
    const todayKey = new Date().toISOString().slice(0, 10);
    return ledgerEntries
      .filter((e) => (toDate(e.createdAt)?.toISOString().slice(0, 10)) === todayKey)
      .reduce((n, e) => n + Number(e.creatorNet || 0), 0);
  }

  function renderOverview() {
    const todayKey = new Date().toISOString().slice(0, 10);
    $('#statToday').textContent = appointments.filter((a) => String(a.startsAt || '').startsWith(todayKey) && a.status === 'COMPLETED').length;
    $('#statRevenueToday').textContent = money(revenueTodayAmount());
    $('#statExams').textContent = exams.filter((e) => e.active !== false).length;
    $('#statRevenue').textContent = money(ledgerEntries.reduce((n, e) => n + Number(e.creatorNet || 0), 0));
    const upcoming = appointments.filter((a) => ['CONFIRMED', 'PROVIDER_ACCEPTED'].includes(a.status)).slice(0, 8);
    $('#overviewList').innerHTML = upcoming.length ? upcoming.map(appointmentRow).join('') : '<div class="empty">Aucun rendez-vous à venir.</div>';
    bindAppointmentActions($('#overviewList'));
  }

  // ---------- Catalogue ----------
  function renderCatalog() {
    const grouped = new Map();
    exams.forEach((e) => { const category = e.catalogCategoryId || e.catalogCategoryName || 'autres'; const subcategory = e.catalogSubcategory || e.subcategory || ''; const key = `${category}::${subcategory}`; if (!grouped.has(key)) grouped.set(key, { label: e.catalogCategoryName || 'Autres examens', subcategory, items: [] }); grouped.get(key).items.push(e); });
    $('#examsList').innerHTML = exams.length ? [...grouped.values()].map((group) => `<section class="health-exam-category"><div class="health-subheading"><div><span>Catalogue</span><h3>${esc(group.label)}</h3>${group.subcategory ? `<small class="health-exam-subcategory">${esc(group.subcategory)}</small>` : ''}</div><small>${group.items.length} examen${group.items.length > 1 ? 's' : ''}</small></div>${group.items.map((e) => `
      <div class="health-provider-row">
        <div><strong>${esc(e.name)}</strong><small>${esc([e.catalogSubcategory, e.specimen, e.delayLabel].filter(Boolean).join(' · ') || e.description || 'Aucune description')}</small></div>
        <div class="health-provider-row__meta">
          <span>${money(e.price)}</span>
          ${e.active === false ? '<span class="health-badge">Inactif</span>' : ''}
          <button class="health-icon-btn" type="button" data-edit-exam="${e.id}" aria-label="Modifier"><i class="fas fa-pen"></i></button>
        </div>
      </div>`).join('')}</section>`).join('') : '<div class="empty">Aucun examen publié. Ajoutez-en un ci-dessous.</div>';
    $('#examsList').querySelectorAll('[data-edit-exam]').forEach((b) => b.addEventListener('click', () => editExam(b.dataset.editExam)));
  }

  function editExam(id) {
    const exam = exams.find((e) => e.id === id);
    if (!exam) return;
    $('#examId').value = id;
    $('#examName').value = exam.name || '';
    const categoryId = exam.catalogCategoryId || exam.categoryId || exam.category || '';
    const catalogExamId = exam.catalogExamId || '';
    const categorySelect = $('#examCategory');
    const examSelect = $('#examSelect');
    if (categorySelect && categorySelect.options.length > 1 && categoryId) {
      categorySelect.value = categoryId;
      categorySelect.dispatchEvent(new Event('change'));
      if (catalogExamId) examSelect.value = catalogExamId;
    }
    $('#examPrice').value = exam.price ?? '';
    $('#examSpecimen').value = exam.specimen || exam.preparation || '';
    $('#examDelay').value = exam.delayLabel || '';
    $('#examDescription').value = exam.description || '';
    $('#examActive').checked = exam.active !== false;
    $('#examFormTitle').textContent = 'Modifier l’examen';
    $('#examSubmitBtn').textContent = 'Enregistrer les modifications';
    $('#cancelExamEdit').hidden = false;
    selectTab('catalog');
    document.getElementById('examForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function resetExamForm() {
    $('#examForm').reset();
    $('#examId').value = '';
    if ($('#examSelect')) { $('#examSelect').disabled = true; $('#examSelect').innerHTML = '<option value="">Choisir d’abord une catégorie…</option>'; }
    if ($('#examCategory')) $('#examCategory').value = '';
    if ($('#examSubcategoryField')) $('#examSubcategoryField').hidden = true;
    $('#examFormTitle').textContent = 'Ajouter un examen';
    $('#examSubmitBtn').textContent = 'Publier l’examen';
    $('#cancelExamEdit').hidden = true;
  }
  $('#cancelExamEdit').addEventListener('click', resetExamForm);
  $('#examForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = $('#examFormStatus');
    status.textContent = 'Enregistrement…';
    try {
      await call(config.saveExamFn, {
        examId: $('#examId').value || undefined, name: $('#examName').value.trim(), price: Number($('#examPrice').value),
        catalogExamId: $('#examSelect')?.value || '', catalogCategoryId: $('#examCategory')?.value || '',
        catalogCategoryName: $('#examCategory')?.selectedOptions?.[0]?.textContent || '',
        catalogSubcategory: $('#examSubcategory')?.value || '',
        specimen: $('#examSpecimen').value.trim(), preparation: $('#examSpecimen').value.trim(), delayLabel: $('#examDelay').value.trim(),
        description: $('#examDescription').value.trim(), active: $('#examActive').checked
      });
      status.className = 'health-status success';
      status.textContent = 'Examen enregistré.';
      resetExamForm();
      await load();
    } catch (error) { status.className = 'health-status error'; status.textContent = error.message; }
  });

  // ---------- Créneaux ----------
  function renderSlots() {
    // Slots publiés séparément par healthListAvailability côté public ; ici on les
    // dérive simplement des rendez-vous à venir déjà réservés, plus le formulaire de publication.
  }
  $('#slotForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = $('#slotFormStatus');
    try {
      await call('healthSaveAvailability', { type: config.providerType, startsAt: new Date($('#slotStartsAt').value).toISOString(), endsAt: new Date($('#slotEndsAt').value).toISOString() });
      status.className = 'health-status success'; status.textContent = 'Créneau publié.';
      event.target.reset();
    } catch (error) { status.className = 'health-status error'; status.textContent = error.message; }
  });

  // ---------- Commandes d'examens ----------
  // Une « commande » = un doc healthAppointments d'un prestataire diagnostic, présenté au
  // format demandé par le propriétaire : Numéro · Patient · Adresse · Date et heure ·
  // Nombre d'examens · lignes examen+prix · Total · Statut paiement · Statut de la commande.
  function appointmentRow(a) {
    const isDiagnostic = config.providerType === 'laboratory' || config.providerType === 'imaging';
    const canDecide = isDiagnostic && a.status === 'CONFIRMED';
    const canComplete = a.status === (isDiagnostic ? 'PROVIDER_ACCEPTED' : 'CONFIRMED');
    const orderNumber = a.orderNumber || a.orderId || a.id;
    const examLines = Array.isArray(a.exams) ? a.exams : (a.examName ? [{ name: a.examName, price: a.amount }] : []);
    const examCount = examLines.length || 1;
    const statusLabels = isDiagnostic ? ORDER_STATUS_LABELS : APPT_LABELS;
    const statusLabel = statusLabels[a.status] || a.status;
    const paymentLabel = a.paymentStatus || (a.status === 'PAYMENT_PENDING' ? 'En attente' : 'Payé');
    return `<details class="health-provider-row health-order-row">
      <summary><div><strong>${esc(orderNumber)}</strong> <span class="health-badge ${['CANCELLED','PROVIDER_REFUSED'].includes(a.status) ? 'danger' : ''}">${esc(statusLabel)}</span>
      <br><small>${esc(a.patientName || 'Patient')} · ${esc(fmt(a.createdAt || a.startsAt))} · ${examCount} examen${examCount > 1 ? 's' : ''}</small></div><div class="health-provider-row__meta"><strong>${money(a.amount)}</strong><i class="fas fa-chevron-down" aria-hidden="true"></i></div></summary>
      <div class="health-order-detail"><div><b>Nom du patient</b><span>${esc(a.patientName || 'Patient')}</span></div><div><b>Adresse du patient</b><span>${esc(a.patientAddress || a.address || 'Non renseignée')}</span></div><div><b>Date et heure de la commande</b><span>${esc(fmt(a.createdAt || a.startsAt))}</span></div><div><b>Nombre d'examens commandés</b><span>${examCount}</span></div><div><b>Examens</b><span>${examLines.length ? examLines.map((e) => `${esc(e.name || 'Examen')} — ${money(e.price)}`).join('<br>') : esc(a.examName || 'Examen')}</span></div><div><b>Total</b><span>${money(a.amount)}</span></div><div><b>Statut paiement</b><span>${esc(paymentLabel)}</span></div><div><b>Statut de la commande</b><span>${esc(statusLabel)}</span></div></div>
      <div class="health-provider-row__meta">
        <strong>${money(a.amount)}</strong>
        ${canDecide ? `<button class="health-btn primary" style="padding:.4rem .7rem;font-size:.76rem;" data-appt-action="PROVIDER_ACCEPTED" data-appt-id="${a.id}">Accepter</button><button class="health-btn danger" style="padding:.4rem .7rem;font-size:.76rem;" data-appt-action="PROVIDER_REFUSED" data-appt-id="${a.id}">Refuser</button>` : ''}
        ${canComplete ? `<button class="health-btn secondary" style="padding:.4rem .7rem;font-size:.76rem;" data-appt-action="COMPLETED" data-appt-id="${a.id}">Terminer</button><button class="health-btn danger" style="padding:.4rem .7rem;font-size:.76rem;" data-appt-action="CANCELLED" data-appt-id="${a.id}">Annuler</button>` : ''}
      </div>
    </details>`;
  }
  function bindAppointmentActions(container) {
    container.querySelectorAll('[data-appt-action]').forEach((btn) => btn.addEventListener('click', async () => {
      if (btn.dataset.apptAction === 'CANCELLED' && !confirm('Annuler cette commande ?')) return;
      if (btn.dataset.apptAction === 'PROVIDER_REFUSED' && !confirm('Refuser cette commande ? Le montant payé sera intégralement recrédité dans le portefeuille du patient.')) return;
      try { await call('healthUpdateAppointment', { appointmentId: btn.dataset.apptId, status: btn.dataset.apptAction }); notice('Commande mise à jour.'); await load(); } catch (error) { notice(error.message, true); }
    }));
  }
  function renderAppointments() {
    const pending = appointments.filter((a) => a.status === 'CONFIRMED');
    const accepted = appointments.filter((a) => ['PROVIDER_ACCEPTED', 'COMPLETED'].includes(a.status));
    const refused = appointments.filter((a) => ['PROVIDER_REFUSED', 'CANCELLED', 'NO_SHOW'].includes(a.status));
    $('#appointmentsList').innerHTML = pending.length ? pending.map(appointmentRow).join('') : '<div class="empty">Aucune nouvelle commande.</div>';
    $('#acceptedAppointmentsList').innerHTML = accepted.length ? accepted.map(appointmentRow).join('') : '<div class="empty">Aucune commande acceptée.</div>';
    $('#refusedAppointmentsList').innerHTML = refused.length ? refused.map(appointmentRow).join('') : '<div class="empty">Aucune commande refusée ou annulée.</div>';
    bindAppointmentActions($('#appointmentsList')); bindAppointmentActions($('#acceptedAppointmentsList')); bindAppointmentActions($('#refusedAppointmentsList'));
  }

  // ---------- Patients ----------
  function renderPatients() {
    const map = new Map(appointments.filter((a) => a.patientUid).map((a) => [a.patientUid, a]));
    $('#patientsList').innerHTML = map.size ? [...map.entries()].map(([id, a]) => `<div class="health-provider-row"><div><strong>${esc(a.patientName || `Patient ${id.slice(0, 8)}`)}</strong><small>Dernier passage : ${esc(fmt(a.startsAt))}</small></div><span class="health-badge">${esc(APPT_LABELS[a.status] || a.status)}</span></div>`).join('') : '<div class="empty">Aucun patient.</div>';
  }

  // ---------- Revenus / décaissements / rapports ----------
  function renderWallet() {
    const todayEl = $('#walletToday');
    if (todayEl) todayEl.textContent = money(revenueTodayAmount());
    $('#walletAvailable').textContent = money(balance.availableAmount);
    $('#walletLifetime').textContent = money(ledgerEntries.reduce((n, e) => n + Number(e.creatorNet || 0), 0));
    const paidMonths = new Set(payoutRequests.filter((p) => p.status === 'paid' && p.periodKey).map((p) => p.periodKey));
    const openMonths = new Set(payoutRequests.filter((p) => ['requested', 'approved'].includes(p.status) && p.periodKey).map((p) => p.periodKey));
    $('#walletMonthly').innerHTML = ledgerEntries.length ? groupByMonth(ledgerEntries, 'createdAt').map((g) => {
      const total = g.items.reduce((n, e) => n + Number(e.creatorNet || 0), 0);
      const alreadyPaid = paidMonths.has(g.key);
      const inProgress = openMonths.has(g.key);
      return `<div class="ph-sales-month"><h4><span>${esc(g.label)}</span><strong>${money(total)}</strong></h4><div class="health-month-actions"><span>${g.items.length} examen${g.items.length > 1 ? 's' : ''} réalisé${g.items.length > 1 ? 's' : ''}</span><button type="button" class="health-btn primary" data-payout-month="${esc(g.key)}" data-payout-amount="${total}" ${alreadyPaid || inProgress || total < 500 ? 'disabled' : ''}>${alreadyPaid ? 'Déjà décaissé' : (inProgress ? 'Décaissement en cours' : 'Décaisser')}</button></div>${g.items.map((e) => `<div class="health-provider-row"><small class="muted">${esc(fmt(e.createdAt))}</small><span>${money(e.creatorNet)}</span></div>`).join('')}</div>`;
    }).join('') : '<div class="empty">Aucun revenu enregistré pour le moment.</div>';
    $('#walletMonthly').querySelectorAll('[data-payout-month]:not([disabled])').forEach((button) => button.addEventListener('click', async () => {
      if (!confirm(`Décaisser les revenus de ${button.dataset.payoutMonth} ?`)) return;
      button.disabled = true; button.textContent = 'Envoi…';
      try { await call('healthRequestPayout', { amountRequested: Number(button.dataset.payoutAmount), periodKey: button.dataset.payoutMonth }); notice('Demande de décaissement envoyée.'); await load(); }
      catch (error) { button.disabled = false; button.textContent = 'Décaisser'; notice(error.message, true); }
    }));
  }
  function renderWithdrawals() {
    const openRequest = payoutRequests.find((p) => ['requested', 'approved'].includes(p.status));
    const available = Number(balance.availableAmount) || 0;
    const canRequest = !openRequest && available >= 500;
    const formHtml = `<div class="health-card" style="margin-bottom:1rem;">
      <h3 style="margin-top:0;">Demander un décaissement</h3>
      <p class="muted">Solde disponible : <strong>${money(available)}</strong>${openRequest ? ' — une demande est déjà en cours.' : ''}</p>
      ${canRequest ? `<form id="payoutForm" class="health-form" style="max-width:320px;"><div class="health-field"><label for="payoutAmount">Montant (HTG)</label><input id="payoutAmount" type="number" min="500" max="${available}" value="${available}" required></div><button class="health-btn primary" type="submit">Demander</button></form>` : (openRequest ? '' : '<p class="muted">Solde insuffisant (minimum 500 HTG) ou pas encore disponible.</p>')}
    </div>`;
    const historyHtml = payoutRequests.length ? `<h3>Historique</h3>${payoutRequests.slice().sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0)).map((p) => `<div class="health-provider-row"><div><strong>${money(p.amountRequested)}</strong><br><small class="muted">${esc(fmt(p.createdAt))}</small></div><span class="health-badge">${esc(PAYOUT_LABELS[p.status] || p.status)}</span></div>`).join('')}` : '<div class="empty">Aucun décaissement enregistré pour le moment.</div>';
    $('#withdrawalsHistory').innerHTML = formHtml + historyHtml;
    $('#payoutForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      try { await call('healthRequestPayout', { amountRequested: Number($('#payoutAmount').value) }); notice('Demande de décaissement envoyée.'); await load(); } catch (error) { notice(error.message, true); }
    });
  }
  function renderReports() {
    const completed = appointments.filter((a) => a.status === 'COMPLETED');
    $('#reportsMonthly').innerHTML = completed.length ? groupByMonth(completed, 'startsAt').map((g) => `<div class="ph-sales-month"><h4><span>${esc(g.label)}</span><strong>${g.items.length} examen(s)</strong></h4></div>`).join('') : '<div class="empty">Aucun examen terminé pour le moment.</div>';
  }
  $('#printReportsBtn')?.addEventListener('click', () => window.print());

  // ---------- Tabs & boot ----------
  function selectTab(name) {
    document.querySelectorAll('.health-dashboard__nav button').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === name));
    document.querySelectorAll('.health-panel').forEach((p) => { p.hidden = p.id !== `panel-${name}`; });
  }
  document.querySelectorAll('.health-dashboard__nav button').forEach((b) => b.addEventListener('click', () => selectTab(b.dataset.tab)));
  $('#providerLogout').addEventListener('click', (e) => { e.preventDefault(); signOut(auth); });

  onAuthStateChanged(auth, async (u) => {
    document.body.classList.remove('provider-ready', 'provider-blocked');
    if (!u) { document.body.classList.add('provider-blocked'); return; }
    user = u;
    try {
      await load();
      document.body.classList.add('provider-ready');
    } catch (error) {
      document.body.classList.add('provider-blocked');
      if (error?.code !== 'not-verified') console.error(`Chargement du dashboard ${config.providerType} impossible`, error);
    }
  });
}
