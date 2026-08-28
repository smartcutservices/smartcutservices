// Shared rendering module for the Services app (Application 4) — booking/agenda theme.
// Pure presentation, no Firestore/network. Mirrors field-renderer.js / shop-renderer.js.

import { escapeHtml } from './api.js';

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const MONTH_NAMES = ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'];
const WEEKDAY_LABELS = ['Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa', 'Di'];

export function renderServiceHero(service) {
  const title = escapeHtml(service.heroTitle || service.title || '');
  const subtitle = service.heroSubtitle || service.description || '';
  const photo = service.photoUrl ? `<div class="sst-service-hero-media"><img src="${escapeHtml(service.photoUrl)}" alt="Aperçu du service"></div>` : '<div class="sst-service-hero-media sst-service-hero-placeholder"><i class="fas fa-calendar-check"></i></div>';
  return `<header class="sst-service-hero"><div class="sst-service-hero-content"><span class="sst-public-eyebrow">Réservation en ligne</span><h1>${title}</h1>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}<a href="#serviceCalendar">Voir les disponibilités</a></div>${photo}</header>`;
}

function isoDateKey(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Renders a month calendar grid. `availableDaysOfWeek` (0=Sunday..6=Saturday, matching
 * Date#getDay) marks which weekdays generally have availability rules — a day is only
 * made clickable if its weekday is in that set AND it isn't in the past. Clicking still
 * always fetches the real remaining slots for that exact date; this is only an honest
 * hint, never a guarantee a given day still has open slots.
 */
export function renderCalendar(displayYear, displayMonth, availableDaysOfWeek, selectedDateKey) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const firstOfMonth = new Date(displayYear, displayMonth, 1);
  const daysInMonth = new Date(displayYear, displayMonth + 1, 0).getDate();
  const startWeekday = (firstOfMonth.getDay() + 6) % 7; // convert Sun=0..Sat=6 to Mon=0..Sun=6

  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push('<div class="sst-service-cal-cell empty"></div>');
  for (let day = 1; day <= daysInMonth; day++) {
    const cellDate = new Date(displayYear, displayMonth, day);
    const key = isoDateKey(cellDate);
    const isPast = cellDate < today;
    const isAvailable = !isPast && (!availableDaysOfWeek?.length || availableDaysOfWeek.includes(cellDate.getDay()));
    const isSelected = key === selectedDateKey;
    cells.push(`
      <button class="sst-service-cal-cell ${isAvailable ? 'available' : 'disabled'} ${isSelected ? 'selected' : ''}" ${isAvailable ? `data-cal-date="${key}"` : 'disabled'}>
        ${day}
      </button>
    `);
  }

  return `
    <div class="sst-service-calendar">
      <div class="sst-service-cal-header">
        <button class="sst-builder-icon-btn" id="calPrevMonth" ${displayYear === today.getFullYear() && displayMonth === today.getMonth() ? 'disabled' : ''}><i class="fas fa-chevron-left"></i></button>
        <strong>${MONTH_NAMES[displayMonth]} ${displayYear}</strong>
        <button class="sst-builder-icon-btn" id="calNextMonth"><i class="fas fa-chevron-right"></i></button>
      </div>
      <div class="sst-service-cal-weekdays">${WEEKDAY_LABELS.map((d) => `<span>${d}</span>`).join('')}</div>
      <div class="sst-service-cal-grid">${cells.join('')}</div>
    </div>
  `;
}

function timeOfDayLabel(hour) {
  if (hour < 12) return 'Matin';
  if (hour < 17) return 'Après-midi';
  return 'Soir';
}

/** Groups ISO slot timestamps into Matin/Après-midi/Soir chip rows. */
export function renderSlotGroups(isoSlots) {
  if (!isoSlots.length) return '<div class="sst-empty">Aucun creneau disponible ce jour-la.</div>';
  const groups = { Matin: [], 'Après-midi': [], Soir: [] };
  isoSlots.forEach((iso) => {
    const d = new Date(iso);
    groups[timeOfDayLabel(d.getHours())].push({ iso, label: d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) });
  });
  return Object.entries(groups).filter(([, slots]) => slots.length).map(([label, slots]) => `
    <div class="sst-service-slot-group">
      <div class="sst-service-slot-group-label">${label}</div>
      <div class="sst-service-slot-chips">
        ${slots.map((s) => `<button class="sst-service-slot-chip" data-slot="${escapeHtml(s.iso)}">${s.label}</button>`).join('')}
      </div>
    </div>
  `).join('');
}

export function applyServiceTheme(rootEl, service) {
  const colors = service.colors || {};
  const primary = HEX_COLOR_PATTERN.test(colors.primary) ? colors.primary : '#0F172A';
  const accent = HEX_COLOR_PATTERN.test(colors.buttonColor)
    ? colors.buttonColor
    : (HEX_COLOR_PATTERN.test(colors.accent) ? colors.accent : '#0D9488');
  const background = HEX_COLOR_PATTERN.test(colors.backgroundColor) ? colors.backgroundColor : '#F0FDFA';
  rootEl.style.setProperty('--service-primary', primary);
  rootEl.style.setProperty('--service-accent', accent);
  rootEl.style.setProperty('--service-bg', background);
}
