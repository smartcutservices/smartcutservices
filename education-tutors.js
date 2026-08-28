import { auth, authReadyPromise } from './firebase-init.js';
import { getAuthManager } from './auth.js';
import { tutorApi } from './education-tutor-api.js';

const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[char]));
const money = (value) => `${Number(value || 0).toLocaleString('fr-FR')} HTG`;

export default class EducationTutorsPage {
  constructor(rootId) {
    this.root = document.getElementById(rootId);
    this.tutors = [];
    this.services = [];
    this.query = '';
    this.subject = 'all';
    this.renderShell();
    this.bind();
    this.load();
  }

  renderShell() {
    this.root.innerHTML = `<section class="edt-hero"><div class="edu-container"><span class="edu-section-eyebrow">Cours particuliers en ligne</span><h1>Le bon tuteur, pour votre objectif.</h1><p>Choisissez une matière, comparez les offres et envoyez votre demande.</p><form class="edt-search" data-search-form><i class="fas fa-search"></i><input type="search" placeholder="Matière, niveau ou tuteur" data-search><button>Rechercher</button></form><a class="edt-become" href="./education-tuteur-pro.html"><i class="fas fa-chalkboard-user"></i> Devenir tuteur</a></div></section><section class="edt-catalog"><div class="edu-container"><div class="edt-toolbar"><div><span class="edu-section-eyebrow">Tuteurs publiés</span><h2>Accompagnement individuel</h2></div><div class="edt-subjects" data-subjects><button class="is-active" data-subject="all">Toutes</button></div></div><div class="edt-status" data-status>Chargement des tuteurs…</div><div class="edt-grid" data-grid></div></div></section><dialog class="edt-dialog" data-dialog><button class="edt-close" data-close aria-label="Fermer"><i class="fas fa-times"></i></button><div data-dialog-content></div></dialog>`;
  }

  bind() {
    this.root.querySelector('[data-search-form]').addEventListener('submit', (event) => { event.preventDefault(); this.query = this.root.querySelector('[data-search]').value.trim().toLowerCase(); this.renderCards(); });
    this.root.querySelector('[data-search]').addEventListener('input', (event) => { this.query = event.target.value.trim().toLowerCase(); this.renderCards(); });
    this.root.querySelector('[data-close]').addEventListener('click', () => this.root.querySelector('[data-dialog]').close());
  }

  async load() {
    const grid = this.root.querySelector('[data-grid]');
    try {
      const data = await tutorApi.catalog();
      this.tutors = data.tutors || [];
      this.services = data.services || [];
      this.renderSubjects();
      this.renderCards();
    } catch (error) {
      this.root.querySelector('[data-status]').textContent = '';
      grid.innerHTML = `<div class="edt-empty"><i class="fas fa-triangle-exclamation"></i><h3>Chargement impossible</h3><p>${esc(error.message)}</p><button data-retry>Réessayer</button></div>`;
      grid.querySelector('[data-retry]').onclick = () => this.load();
    }
  }

  renderSubjects() {
    const subjects = [...new Set(this.services.map((item) => item.subject).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'fr'));
    const root = this.root.querySelector('[data-subjects]');
    root.innerHTML = `<button class="is-active" data-subject="all">Toutes</button>${subjects.map((subject) => `<button data-subject="${esc(subject)}">${esc(subject)}</button>`).join('')}`;
    root.querySelectorAll('button').forEach((button) => button.onclick = () => { this.subject = button.dataset.subject; root.querySelectorAll('button').forEach((item) => item.classList.toggle('is-active', item === button)); this.renderCards(); });
  }

  renderCards() {
    const filtered = this.tutors.filter((tutor) => {
      const offers = this.services.filter((service) => service.tutorUid === tutor.id);
      const subjectMatch = this.subject === 'all' || offers.some((service) => service.subject === this.subject);
      const search = [tutor.displayName, tutor.headline, ...(tutor.subjects || []), ...offers.flatMap((service) => [service.title, service.subject, service.level])].join(' ').toLowerCase();
      return subjectMatch && (!this.query || search.includes(this.query));
    });
    this.root.querySelector('[data-status]').textContent = `${filtered.length} tuteur${filtered.length === 1 ? '' : 's'}`;
    const grid = this.root.querySelector('[data-grid]');
    if (!filtered.length) { grid.innerHTML = `<div class="edt-empty"><i class="fas fa-user-group"></i><h3>Aucun tuteur disponible</h3><p>Modifiez vos filtres ou revenez prochainement.</p></div>`; return; }
    grid.innerHTML = filtered.map((tutor) => {
      const offers = this.services.filter((service) => service.tutorUid === tutor.id);
      const min = Math.min(...offers.map((service) => Number(service.price) || 0));
      return `<article class="edt-card"><div class="edt-card-top">${tutor.photoUrl ? `<img src="${esc(tutor.photoUrl)}" alt="${esc(tutor.displayName)}">` : `<span class="edt-avatar">${esc(tutor.displayName?.slice(0,1) || 'T')}</span>`}<div><span class="edt-available"><i></i> Disponible en ligne</span><h3>${esc(tutor.displayName)}</h3><p>${esc(tutor.headline)}</p></div></div><div class="edt-tags">${(tutor.subjects || []).slice(0,3).map((subject) => `<span>${esc(subject)}</span>`).join('')}</div><div class="edt-card-meta"><span><strong>${tutor.experienceYears || 0}</strong> ans d’expérience</span><span><strong>${offers.length}</strong> offre${offers.length === 1 ? '' : 's'}</span></div><div class="edt-card-foot"><span>Dès <strong>${money(min)}</strong></span><button data-tutor="${esc(tutor.id)}">Voir le profil <i class="fas fa-arrow-right"></i></button></div></article>`;
    }).join('');
    grid.querySelectorAll('[data-tutor]').forEach((button) => button.onclick = () => this.openTutor(button.dataset.tutor));
  }

  openTutor(id) {
    const tutor = this.tutors.find((item) => item.id === id);
    const offers = this.services.filter((service) => service.tutorUid === id);
    const box = this.root.querySelector('[data-dialog-content]');
    box.innerHTML = `<div class="edt-profile-head">${tutor.photoUrl ? `<img src="${esc(tutor.photoUrl)}" alt="${esc(tutor.displayName)}">` : `<span class="edt-avatar">${esc(tutor.displayName?.slice(0,1) || 'T')}</span>`}<div><span class="edu-section-eyebrow">Tuteur en ligne</span><h2>${esc(tutor.displayName)}</h2><p>${esc(tutor.headline)}</p></div></div><p class="edt-bio">${esc(tutor.bio)}</p><div class="edt-profile-facts"><span><i class="fas fa-language"></i>${esc((tutor.languages || []).join(', ') || 'Langue à confirmer')}</span><span><i class="fas fa-clock"></i>Réponse sous ${Number(tutor.responseTimeHours) || 24} h</span><span><i class="fas fa-location-dot"></i>${esc(tutor.city || 'En ligne')}</span></div><h3 class="edt-offers-title">Cours proposés</h3><div class="edt-offers">${offers.map((service) => `<article><div><span>${esc(service.subject)} · ${esc(service.level)}</span><h4>${esc(service.title)}</h4><p>${esc(service.summary)}</p></div><div class="edt-offer-price"><strong>${money(service.price)}</strong><small>${service.durationMinutes} min</small><button data-request="${esc(service.id)}">Demander ce cours</button></div></article>`).join('')}</div>`;
    box.querySelectorAll('[data-request]').forEach((button) => button.onclick = () => this.requestService(button.dataset.request));
    this.root.querySelector('[data-dialog]').showModal();
  }

  async requestService(serviceId) {
    await authReadyPromise;
    if (!auth.currentUser) { getAuthManager().openAuthModal('login'); return; }
    const service = this.services.find((item) => item.id === serviceId);
    const box = this.root.querySelector('[data-dialog-content]');
    box.innerHTML = `<div class="edt-request"><span class="edu-section-eyebrow">Votre demande</span><h2>${esc(service.title)}</h2><p>Expliquez brièvement le résultat attendu. Le tuteur pourra ensuite accepter et proposer le lien du cours.</p><form data-request-form><label>Votre objectif<textarea name="goal" required maxlength="1000" placeholder="Ex. préparer un examen, comprendre un chapitre…"></textarea></label><label>Moment souhaité<input name="preferredSlot" maxlength="160" placeholder="Ex. samedi matin"></label><button>Envoyer la demande</button><span data-request-status></span></form></div>`;
    box.querySelector('form').onsubmit = async (event) => { event.preventDefault(); const status = box.querySelector('[data-request-status]'); const button = event.currentTarget.querySelector('button'); button.disabled = true; status.textContent = 'Envoi…'; try { const form = new FormData(event.currentTarget); await tutorApi.createRequest({ serviceId, goal: form.get('goal'), preferredSlot: form.get('preferredSlot') }); box.innerHTML = `<div class="edt-success"><i class="fas fa-circle-check"></i><h2>Demande envoyée</h2><p>Vous serez informé lorsque le tuteur répondra.</p><button data-done>Fermer</button></div>`; box.querySelector('[data-done]').onclick = () => this.root.querySelector('[data-dialog]').close(); } catch (error) { status.textContent = error.message; button.disabled = false; } };
  }
}
