import { auth, db, storage } from './firebase-init.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js';
import { collection, getDocs, query, where, doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import { ref, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-storage.js';
import mountProfilePhotoUploader from './health-profile-photo.js';

const FN = 'https://us-central1-smartcutservices-9ce54.cloudfunctions.net/';
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (d) => (d ? new Date(d).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const money = (v) => `${Number(v || 0).toLocaleString('fr-FR')} HTG`;
const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const ORDER_STATUS_LABELS = { requested: 'Demandé', approved: 'Approuvé', paid: 'Payé', rejected: 'Refusé' };

let user, appointments = [], slots = [], prescriptions = [], ledgerEntries = [], payoutRequests = [], balance = { availableAmount: 0, pendingAmount: 0 };
const notice = (t, e = false) => { $('#notice').textContent = t; $('#notice').style.color = e ? '#a33a32' : '#0d7665'; };

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
  const headers = {};
  if (user) headers.Authorization = `Bearer ${await user.getIdToken()}`;
  const r = await fetch(url, { headers });
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

/** Groups a list of docs by calendar month/year of `dateField`, most recent first — the
 * "classé par mois et année, 0 si aucune activité ce mois-là" pattern used throughout
 * the doctor dashboard. Months with zero activity are never fabricated as empty rows —
 * only months that actually have at least one item appear. */
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
  if (data.role !== 'doctor' || data.doctorStatus !== 'verified') throw Object.assign(new Error('L’accès est réservé aux médecins vérifiés.'), { code: 'not-verified' });
  const p = data.doctorProfile || {};
  $('#doctorName').textContent = p.professionalName || user.email || 'Médecin';
  $('#profileSummary').innerHTML = `<p><strong>${esc(p.professionalName || 'Médecin')}</strong></p><p class="muted">${esc(p.specialty || 'Spécialité non renseignée')} · ${esc(p.address || 'Adresse non renseignée')}</p><p class="muted">${esc(p.phone || 'Téléphone non renseigné')} · Profil vérifié</p>`;
  $('#professionalStatus').textContent = 'Profil vérifié';
  $('#professionalSummary').innerHTML = `<div class="professional-grid"><div><span class="stat__label">Nom professionnel</span><strong>${esc(p.professionalName || 'À renseigner')}</strong></div><div><span class="stat__label">Spécialité</span><strong>${esc(p.specialty || 'À renseigner')}</strong></div><div><span class="stat__label">Adresse</span><strong>${esc(p.address || 'À renseigner')}</strong></div><div><span class="stat__label">Téléphone</span><strong>${esc(p.phone || 'À renseigner')}</strong></div></div><div class="professional-note"><i class="fas fa-shield-heart"></i><span>Votre profil est vérifié et peut être présenté aux patients lors de la réservation.</span></div>`;
  const doctorPhotoUrl = p.photoPath ? await getDownloadURL(ref(storage, p.photoPath)).catch(() => null) : null;
  mountProfilePhotoUploader('doctorProfilePhoto', 'doctor', doctorPhotoUrl);

  const [apptSnap, slotSnap, rxSnap, ledgerSnap, payoutSnap, balanceSnap] = await Promise.all([
    getDocs(query(collection(db, 'healthAppointments'), where('providerUid', '==', user.uid))),
    getDocs(query(collection(db, 'healthAvailabilitySlots'), where('providerUid', '==', user.uid))),
    getDocs(query(collection(db, 'healthClinicalPrescriptions'), where('providerUid', '==', user.uid))),
    getDocs(query(collection(db, 'ledgerEntries'), where('organizationId', '==', user.uid))),
    getDocs(query(collection(db, 'payoutRequests'), where('organizationId', '==', user.uid))),
    getDoc(doc(db, 'balances', user.uid))
  ]);
  appointments = apptSnap.docs.map((x) => ({ id: x.id, ...x.data() })).sort((a, b) => String(a.startsAt || '').localeCompare(String(b.startsAt || '')));
  slots = slotSnap.docs.map((x) => ({ ...x.data(), id: x.id })).filter((x) => x.status === 'AVAILABLE').sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)));
  prescriptions = rxSnap.docs.map((x) => ({ id: x.id, ...x.data() }));
  ledgerEntries = ledgerSnap.docs.map((x) => ({ id: x.id, ...x.data() })).filter((x) => x.type === 'payment');
  payoutRequests = payoutSnap.docs.map((x) => ({ id: x.id, ...x.data() }));
  balance = balanceSnap.data() || { availableAmount: 0, pendingAmount: 0 };

  render();
  renderHistory();
  renderExams();
  renderWallet();
  renderWithdrawals();
  renderMessages();
  await populateRendezvousForm();
}

function render() {
  const pending = appointments.filter((x) => ['CONFIRMED', 'DOCTOR_ACCEPTED'].includes(x.status));
  const todayKey = new Date().toISOString().slice(0, 10);
  const completed = appointments.filter((x) => x.status === 'COMPLETED');
  const patientMap = new Map(appointments.filter((x) => x.patientUid).map((x) => [x.patientUid, x]));
  $('#pending').textContent = pending.length;
  $('#today').textContent = appointments.filter((x) => String(x.startsAt || '').startsWith(todayKey)).length;
  $('#patientsCount').textContent = patientMap.size;
  $('#revenue').textContent = money(completed.reduce((n, x) => n + Number(x.professionalAmount || x.amount || 0), 0));

  const rows = appointments.length ? appointments.map((x) => `<div class="appointment"><div><strong>${esc(x.specialtyName || x.planName || 'Consultation')}</strong><br><small class="muted">${esc(fmt(x.startsAt))} · ${esc(x.patientName || 'Patient')} · ${esc(x.status)}</small></div><div class="actions">
    ${x.status === 'CONFIRMED' ? `<button class="btn primary" data-action="DOCTOR_ACCEPTED" data-id="${x.id}">Accepter</button><button class="btn danger" data-action="DOCTOR_REFUSED" data-id="${x.id}">Refuser</button>` : ''}
    ${['CONFIRMED', 'DOCTOR_ACCEPTED', 'IN_PROGRESS'].includes(x.status) ? `<a class="btn" href="./health-session.html?appointment=${x.id}">Ouvrir</a>` : ''}
    ${x.status === 'DOCTOR_ACCEPTED' ? `<button class="btn" data-action="PATIENT_NO_SHOW" data-id="${x.id}">Absent</button>` : ''}
  </div></div>`).join('') : '<div class="empty">Aucune consultation.</div>';
  $('#appointments').innerHTML = rows;
  $('#overviewList').innerHTML = rows;
  $('#slots').innerHTML = slots.length ? slots.slice(0, 8).map((x) => `<div class="slot"><span>${esc(fmt(x.startsAt))}</span><span class="badge">Disponible</span></div>`).join('') : '<div class="empty">Aucun créneau.</div>';
  $('#patientsList').innerHTML = patientMap.size ? [...patientMap.entries()].map(([id, x]) => `<div class="patient"><div><strong>${esc(x.patientName || `Patient ${id.slice(0, 8)}`)}</strong><br><small class="muted">Dernière consultation : ${esc(fmt(x.startsAt))}</small></div><span class="badge">${esc(x.status)}</span></div>`).join('') : '<div class="empty">Aucun patient.</div>';
}

function renderHistory() {
  const completed = appointments.filter((x) => x.status === 'COMPLETED');
  const refused = appointments.filter((x) => x.status === 'DOCTOR_REFUSED');
  $('#historyCompleted').innerHTML = completed.length
    ? groupByMonth(completed, 'completedAt').map((g) => `<div class="patient"><div><strong>${esc(g.label)}</strong><br><small class="muted">${g.items.length} consultation(s) terminée(s)</small></div><span class="badge">${g.items.length}</span></div>`).join('')
    : '<div class="empty">Aucune consultation terminée.</div>';
  $('#historyRefused').innerHTML = refused.length
    ? groupByMonth(refused, 'refusedAt').map((g) => `<div class="patient"><div><strong>${esc(g.label)}</strong><br><small class="muted">${g.items.length} refus</small></div><span class="badge">${g.items.length}</span></div>`).join('')
    : '<div class="empty">Aucune consultation refusée.</div>';
}

function renderExams() {
  if (!prescriptions.length) {
    $('#prescriptionsEmises').innerHTML = '<div class="empty">Aucune prescription émise.</div>';
    $('#examensPrescrits').innerHTML = '<div class="empty">Aucun examen prescrit.</div>';
    return;
  }
  const groups = groupByMonth(prescriptions, 'createdAt');
  $('#prescriptionsEmises').innerHTML = groups.map((g) => {
    const medCount = g.items.reduce((n, p) => n + (p.medications?.length || 0), 0);
    return `<div class="patient"><div><strong>${esc(g.label)}</strong><br><small class="muted">${medCount} médicament(s) prescrit(s)</small></div><span class="badge">${g.items.length} ordonnance(s)</span></div>`;
  }).join('');
  $('#examensPrescrits').innerHTML = groups.map((g) => {
    const examCount = g.items.reduce((n, p) => n + (p.labExams?.length || 0) + (p.imagingExams?.length || 0), 0);
    return examCount ? `<div class="patient"><div><strong>${esc(g.label)}</strong><br><small class="muted">Laboratoire + imagerie</small></div><span class="badge">${examCount} examen(s)</span></div>` : '';
  }).filter(Boolean).join('') || '<div class="empty">Aucun examen prescrit.</div>';
}

function renderWallet() {
  $('#walletAvailable').textContent = money(balance.availableAmount);
  $('#walletLifetime').textContent = money(ledgerEntries.reduce((n, e) => n + Number(e.creatorNet || 0), 0));
  if (!ledgerEntries.length) { $('#walletSummary').innerHTML = '<div class="empty">Aucun revenu enregistré pour le moment.</div>'; return; }
  const groups = groupByMonth(ledgerEntries, 'createdAt');
  $('#walletSummary').innerHTML = groups.map((g) => {
    const total = g.items.reduce((n, e) => n + Number(e.creatorNet || 0), 0);
    return `<div class="card" style="margin-bottom:.8rem;">
      <div class="card__head"><h3 style="margin:0;">${esc(g.label)}</h3><strong>${money(total)}</strong></div>
      ${g.items.map((e) => `<div class="appointment"><div><small class="muted">${esc(fmt(toDate(e.createdAt)))} · ${esc({ 'health-doctor': 'Consultation', 'health-laboratory': 'Examen laboratoire', 'health-imaging': 'Examen imagerie' }[e.applicationId] || e.applicationId || '')}</small></div><span>${money(e.creatorNet)}</span></div>`).join('')}
    </div>`;
  }).join('');
}

function renderWithdrawals() {
  const openRequest = payoutRequests.find((p) => ['requested', 'approved'].includes(p.status));
  const available = Number(balance.availableAmount) || 0;
  const canRequest = !openRequest && available >= 500;
  const formHtml = `<div class="card" style="margin-bottom:1rem;">
    <h3 style="margin-top:0;">Demander un décaissement</h3>
    <p class="muted">Solde disponible : <strong>${money(available)}</strong>${openRequest ? ' — une demande est déjà en cours.' : ''}</p>
    ${canRequest ? `<form id="payoutForm" class="form" style="max-width:320px;"><label>Montant (HTG)<input id="payoutAmount" type="number" min="500" max="${available}" value="${available}" required></label><button class="btn primary" type="submit">Demander</button></form>` : (openRequest ? '' : '<p class="muted">Solde insuffisant (minimum 500 HTG) — les revenus deviennent disponibles au retrait après la période de validation de la plateforme.</p>')}
  </div>`;
  const historyHtml = payoutRequests.length
    ? `<h3>Historique</h3>${payoutRequests.slice().sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0)).map((p) => `<div class="appointment"><div><strong>${money(p.amountRequested)}</strong><br><small class="muted">${esc(fmt(toDate(p.createdAt)))}</small></div><span class="badge">${esc(ORDER_STATUS_LABELS[p.status] || p.status)}</span></div>`).join('')}`
    : '<div class="empty">Aucun décaissement enregistré pour le moment.</div>';
  $('#withdrawalsHistory').innerHTML = formHtml + historyHtml;
  $('#payoutForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await call('healthRequestPayout', { amountRequested: Number($('#payoutAmount').value) });
      notice('Demande de décaissement envoyée.');
      await load();
    } catch (error) { notice(error.message, true); }
  });
}

function renderMessages() {
  const sessions = appointments.filter((x) => ['DOCTOR_ACCEPTED', 'IN_PROGRESS', 'COMPLETED'].includes(x.status)).slice().sort((a, b) => String(b.startsAt || '').localeCompare(String(a.startsAt || '')));
  const statusLabels = { DOCTOR_ACCEPTED: 'En attente de démarrage', IN_PROGRESS: 'En cours', COMPLETED: 'Terminée' };
  $('#messagesSessions').innerHTML = sessions.length
    ? sessions.map((x) => `<div class="appointment"><div><strong>${esc(x.patientName || 'Patient')}</strong><br><small class="muted">${esc(fmt(x.startsAt))} · ${esc(statusLabels[x.status])}</small></div><a class="btn" href="./health-session.html?appointment=${x.id}">Ouvrir</a></div>`).join('')
    : '<div class="empty">Aucune séance à afficher.</div>';
}

async function populateRendezvousForm() {
  const patientSelect = $('#rvPatient');
  const patientMap = new Map(appointments.filter((x) => x.patientUid).map((x) => [x.patientUid, x.patientName || `Patient ${x.patientUid.slice(0, 8)}`]));
  patientSelect.innerHTML = '<option value="">Choisir un patient…</option>' + [...patientMap.entries()].map(([uid, name]) => `<option value="${uid}">${esc(name)}</option>`).join('');
  try {
    const catalog = await callGet('healthGetRendezvousCatalog');
    $('#rvSpecialty').innerHTML = '<option value="">Choisir…</option>' + catalog.specialties.map((s) => `<option value="${s.code}">${esc(s.name)} — ${money(s.price)}</option>`).join('');
  } catch (_) { $('#rvSpecialty').innerHTML = '<option value="">Indisponible</option>'; }
}

$('#slotForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await call('healthSaveAvailability', { type: 'doctor', startsAt: new Date($('#startsAt').value).toISOString(), endsAt: new Date($('#endsAt').value).toISOString() });
    notice('Créneau publié.');
    e.target.reset();
    await load();
  } catch (x) { notice(x.message, true); }
});

$('#rendezvousForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const patientUid = $('#rvPatient').value;
  const specialtyCode = $('#rvSpecialty').value;
  if (!patientUid || !specialtyCode) { notice('Choisissez un patient et une spécialité.', true); return; }
  try {
    await call('healthDoctorScheduleAppointment', { patientUid, specialtyCode, startsAt: new Date($('#rvStartsAt').value).toISOString(), note: $('#rvNote').value.trim() });
    notice('Rendez-vous proposé au patient.');
    e.target.reset();
    await load();
  } catch (error) { notice(error.message, true); }
});

document.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => {
  document.querySelectorAll('.panel').forEach((p) => { p.hidden = p.id !== b.dataset.tab; });
  document.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('active', x === b));
});

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-action]');
  if (!b) return;
  if (b.dataset.action === 'PATIENT_NO_SHOW' && !confirm('Marquer ce patient absent ? Aucun remboursement ne sera émis.')) return;
  try {
    await call('healthDoctorUpdateConsultation', { appointmentId: b.dataset.id, status: b.dataset.action });
    notice('Consultation mise à jour.');
    await load();
  } catch (x) { notice(x.message, true); }
});
$('#logout').onclick = () => signOut(auth);

// Un compte connecté sans profil médecin est orienté directement vers le module professionnel.
function showProfessionalOnboarding() {
  document.body.classList.remove('doctor-blocked');
  document.body.classList.add('doctor-ready');
  const accountName = $('#doctorName');
  if (accountName) accountName.textContent = user?.email || 'Nouveau médecin';
  document.querySelectorAll('.panel').forEach((panel) => { panel.hidden = panel.id !== 'professional'; });
  document.querySelectorAll('[data-tab]').forEach((button) => button.classList.toggle('active', button.dataset.tab === 'professional'));
  const status = $('#professionalStatus');
  const summary = $('#professionalSummary');
  if (status) status.textContent = 'Profil requis';
  if (summary) summary.innerHTML = '<div class="professional-note"><i class="fas fa-user-doctor"></i><span>Créez votre profil médecin pour publier vos disponibilités et recevoir des patients.</span></div><div class="professional-actions"><a class="btn primary" href="./health-candidature.html?type=doctor">Créer mon profil médecin</a></div>';
}

// Un seul listener d'authentification — évite la course entre chargement du profil et
// bascule vers l'onboarding qui existait auparavant (deux listeners séparés + délai fixe).
onAuthStateChanged(auth, async (u) => {
  document.body.classList.remove('doctor-ready', 'doctor-blocked');
  if (!u) { document.body.classList.add('doctor-blocked'); return; }
  user = u;
  try {
    await load();
    document.body.classList.add('doctor-ready');
  } catch (error) {
    if (error?.code === 'not-verified') {
      showProfessionalOnboarding();
    } else {
      document.body.classList.add('doctor-blocked');
      console.error('Chargement du dashboard médecin impossible', error);
    }
  }
});
