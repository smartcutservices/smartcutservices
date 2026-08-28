export function openDialog({ title, message = '', content = '', confirmLabel = 'Confirmer', cancelLabel = 'Annuler', danger = false }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'sst-modal-overlay open sst-dialog-overlay';
    overlay.innerHTML = `
      <section class="sst-modal sst-dialog" role="dialog" aria-modal="true" aria-labelledby="sstDialogTitle">
        <h2 id="sstDialogTitle">${title}</h2>
        ${message ? `<p>${message}</p>` : ''}
        ${content}
        <div class="sst-dialog-actions">
          <button class="sst-btn sst-btn-secondary" data-dialog-cancel>${cancelLabel}</button>
          <button class="sst-btn ${danger ? 'sst-btn-danger' : 'sst-btn-primary'}" data-dialog-confirm>${confirmLabel}</button>
        </div>
      </section>`;
    const finish = (value) => { overlay.remove(); resolve(value); };
    overlay.querySelector('[data-dialog-cancel]').addEventListener('click', () => finish(false));
    overlay.querySelector('[data-dialog-confirm]').addEventListener('click', () => finish(true));
    overlay.addEventListener('click', (event) => { if (event.target === overlay) finish(false); });
    document.body.appendChild(overlay);
    overlay.querySelector('[data-dialog-confirm]').focus();
  });
}

export function openPromptDialog({ title, label, value = '', confirmLabel = 'Enregistrer' }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'sst-modal-overlay open sst-dialog-overlay';
    overlay.innerHTML = `
      <form class="sst-modal sst-dialog" role="dialog" aria-modal="true">
        <h2>${title}</h2>
        <label class="sst-label" for="sstPromptValue">${label}</label>
        <input class="sst-input" id="sstPromptValue" maxlength="140" value="${String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">
        <div class="sst-dialog-actions">
          <button type="button" class="sst-btn sst-btn-secondary" data-dialog-cancel>Annuler</button>
          <button class="sst-btn sst-btn-primary">${confirmLabel}</button>
        </div>
      </form>`;
    const input = overlay.querySelector('input');
    const finish = (result) => { overlay.remove(); resolve(result); };
    overlay.querySelector('[data-dialog-cancel]').addEventListener('click', () => finish(null));
    overlay.querySelector('form').addEventListener('submit', (event) => { event.preventDefault(); finish(input.value.trim() || null); });
    document.body.appendChild(overlay);
    input.focus(); input.select();
  });
}
