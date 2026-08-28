import { escapeHtml, money, dateLabel } from '../../marketplace-api.js';
export { escapeHtml as esc, money, dateLabel };
export const badge = (value) => `<span class="badge badge-${escapeHtml(String(value || '').toLowerCase())}">${escapeHtml(String(value || '—').replaceAll('_',' '))}</span>`;
export const empty = (title, copy, action = '', label = '') => `<div class="empty"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(copy)}</p>${action ? `<button class="button primary" data-action="${action}">${escapeHtml(label)}</button>` : ''}</div>`;
export function listTable(headings, rows) {
  if (!rows.length) return '';
  return `<div class="table-wrap"><table><thead><tr>${headings.map((x)=>`<th>${escapeHtml(x)}</th>`).join('')}</tr></thead><tbody>${rows.map((row)=>`<tr>${row.map((cell)=>`<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div><div class="record-list">${rows.map((row)=>`<article class="record">${row.map((cell,i)=>`<p><strong>${escapeHtml(headings[i])}</strong>${cell}</p>`).join('')}</article>`).join('')}</div>`;
}
