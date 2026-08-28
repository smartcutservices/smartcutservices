import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import { openDialog } from '../shared/dialog.js';

export async function openLessonEditor(context, { moduleId, lessonId = null, modules = [], duplicate = false }) {
  let lesson = { title: '', description: '', type: 'video', content: '', contentRef: '', estimatedDurationMinutes: 0, isFreePreview: false, allowDownload: false, status: 'draft', order: Date.now() };
  if (lessonId) {
    const snapshot = await getDoc(doc(context.db, 'lessons', lessonId));
    if (!snapshot.exists()) throw new Error('Leçon introuvable.');
    lesson = { ...lesson, ...snapshot.data() };
    if (duplicate) { lessonId = null; lesson.title = `${lesson.title} — copie`; lesson.order = Date.now(); }
  }
  let assets = [];
  try { assets = (await context.api.assets(context.organization.id, context.state.course.id)).assets || []; } catch (_) { assets = []; }
  let contentRef = lesson.contentRef || '';
  const overlay = document.createElement('div');
  overlay.className = 'sst-drawer-overlay open';
  overlay.innerHTML = `<aside class="sst-course-drawer" role="dialog" aria-modal="true" aria-labelledby="lessonEditorTitle">
    <header><div><span>Éditeur de leçon</span><h2 id="lessonEditorTitle">${lessonId ? 'Modifier la leçon' : 'Nouvelle leçon'}</h2></div><button data-close aria-label="Fermer"><i class="fas fa-xmark"></i></button></header>
    <div class="sst-course-drawer-body">
      <label>Titre *<input class="sst-input" data-lesson-field="title" value="${context.escapeHtml(lesson.title)}" maxlength="140"></label>
      <label>Description<textarea class="sst-textarea" data-lesson-field="description" rows="3">${context.escapeHtml(lesson.description || '')}</textarea></label>
      <div class="sst-course-form-grid">
        <label>Type<select class="sst-select" data-lesson-field="type">${[['video','Vidéo'],['text','Texte'],['pdf','PDF'],['file','Ressource'],['audio','Audio']].map(([value,label]) => `<option value="${value}" ${lesson.type === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        <label>Module<select class="sst-select" data-lesson-field="moduleId">${modules.map((module) => `<option value="${module.id}" ${module.id === (lesson.moduleId || moduleId) ? 'selected' : ''}>${context.escapeHtml(module.title)}</option>`).join('')}</select></label>
        <label>Durée estimée (minutes)<input class="sst-input" type="number" min="0" data-lesson-field="duration" value="${Number(lesson.estimatedDurationMinutes) || 0}"></label>
        <label>État<select class="sst-select" data-lesson-field="status"><option value="draft" ${lesson.status === 'draft' ? 'selected' : ''}>Brouillon</option><option value="ready" ${lesson.status === 'ready' ? 'selected' : ''}>Prête</option><option value="published" ${lesson.status === 'published' || !lesson.status ? 'selected' : ''}>Publiée</option></select></label>
      </div>
      <div data-text-content><label>Contenu texte<textarea class="sst-textarea" rows="12" data-lesson-field="content">${context.escapeHtml(lesson.type === 'text' ? lesson.content || '' : '')}</textarea><small>Le MVP stocke du texte brut assaini. Aucun HTML arbitraire n’est accepté.</small></label></div>
      <div class="sst-course-private-upload" data-file-content><i class="fas fa-shield-halved"></i><div><strong>Média privé</strong><p>Le fichier reste privé et sera livré par une URL signée de 15 minutes.</p><input type="file" data-lesson-file><button type="button" class="sst-btn sst-btn-secondary" data-cancel-upload hidden>Annuler le téléversement</button><div role="status" data-file-status>${contentRef || lesson.content ? 'Un média est déjà associé.' : 'Aucun média sélectionné.'}</div></div></div>
      <div class="sst-course-media-library" data-file-content><div class="sst-course-panel-heading"><div><strong>Médiathèque du cours</strong><small>Réutilisez un média privé déjà téléversé.</small></div><span>${assets.length} média${assets.length === 1 ? '' : 's'}</span></div><div data-asset-list>${renderAssets(assets, contentRef, context)}</div></div>
      <label class="sst-checkbox-row"><input type="checkbox" data-lesson-field="preview" ${lesson.isFreePreview ? 'checked' : ''}><span>Autoriser un aperçu gratuit</span></label>
      <label class="sst-checkbox-row"><input type="checkbox" data-lesson-field="download" ${lesson.allowDownload ? 'checked' : ''}><span>Autoriser le téléchargement de la ressource</span></label>
      <div class="sst-info-banner"><i class="fas fa-clock"></i> La disponibilité progressive est prévue dans le modèle, mais non activée dans ce MVP.</div>
    </div>
    <footer><span data-save-state>Aucune modification enregistrée</span><button class="sst-btn sst-btn-secondary" data-close>Annuler</button><button class="sst-btn sst-btn-primary" data-save-lesson>Enregistrer la leçon</button></footer>
  </aside>`;
  document.body.appendChild(overlay);
  const typeInput = overlay.querySelector('[data-lesson-field="type"]');
  const updateType = () => { const text = typeInput.value === 'text'; overlay.querySelector('[data-text-content]').hidden = !text; overlay.querySelectorAll('[data-file-content]').forEach((item) => { item.hidden = text; }); };
  typeInput.addEventListener('change', updateType); updateType();
  overlay.querySelector('[data-lesson-file]').addEventListener('change', async (event) => {
    const file = event.target.files[0]; if (!file) return;
    const status = overlay.querySelector('[data-file-status]'); const cancel = overlay.querySelector('[data-cancel-upload]'); let task = null; cancel.hidden = false; cancel.onclick = () => task?.cancel(); status.textContent = 'Téléversement privé en cours…';
    try { const result = await context.uploadStorageFile(file, `sst-courses/${context.state.course.id}/lessons`, { maxSizeMb: 50, exposeDownloadUrl: false, onTask: (value) => { task = value; }, onProgress: (percentage) => { status.textContent = `Téléversement privé : ${percentage}%`; } }); contentRef = result.path; status.textContent = `${file.name} est prêt.`; const saved = await context.api.saveAsset({ organizationId: context.organization.id, courseId: context.state.course.id, storagePath: result.path, label: file.name, originalName: file.name }); assets.push({ id: saved.assetId, storagePath: result.path, label: file.name, originalName: file.name, contentType: file.type, sizeBytes: file.size, usedBy: [] }); refreshAssets(); }
    catch (error) { status.textContent = error?.code === 'storage/canceled' ? 'Téléversement annulé.' : error.message; }
    finally { cancel.hidden = true; task = null; }
  });
  const refreshAssets = () => { overlay.querySelector('[data-asset-list]').innerHTML = renderAssets(assets, contentRef, context); bindAssets(); };
  const bindAssets = () => {
    overlay.querySelectorAll('[data-select-asset]').forEach((button) => button.addEventListener('click', () => { const asset = assets.find((item) => item.id === button.dataset.selectAsset); if (!asset) return; contentRef = asset.storagePath; overlay.querySelector('[data-file-status]').textContent = `${asset.label || asset.originalName || 'Média'} est associé.`; refreshAssets(); }));
    overlay.querySelectorAll('[data-rename-asset]').forEach((button) => button.addEventListener('click', async () => { const asset = assets.find((item) => item.id === button.dataset.renameAsset); const input = button.closest('[data-asset-row]').querySelector('input'); const label = input.value.trim(); if (!asset || !label) return; try { await context.api.saveAsset({ organizationId: context.organization.id, courseId: context.state.course.id, assetId: asset.id, label }); asset.label = label; context.toast('Libellé du média enregistré.'); refreshAssets(); } catch (error) { context.toast(error.message, 'error'); } }));
    overlay.querySelectorAll('[data-delete-asset]').forEach((button) => button.addEventListener('click', async () => { const asset = assets.find((item) => item.id === button.dataset.deleteAsset); if (!asset || asset.usedBy?.length) return; if (!await openDialog({ title: 'Supprimer ce média inutilisé ?', message: 'Le fichier privé sera supprimé définitivement du stockage. Cette action est disponible uniquement parce qu’aucune leçon ne l’utilise.', confirmLabel: 'Supprimer', danger: true })) return; try { await context.api.deleteAsset({ organizationId: context.organization.id, assetId: asset.id }); assets = assets.filter((item) => item.id !== asset.id); if (contentRef === asset.storagePath) contentRef = ''; context.toast('Média supprimé.'); refreshAssets(); } catch (error) { context.toast(error.message, 'error'); } }));
  };
  bindAssets();
  const close = () => overlay.remove();
  overlay.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', close));
  overlay.querySelector('[data-save-lesson]').addEventListener('click', async () => {
    const read = (name) => overlay.querySelector(`[data-lesson-field="${name}"]`);
    const type = read('type').value;
    const title = read('title').value.trim();
    if (!title || (type === 'text' ? !read('content').value.trim() : !contentRef && !lesson.content)) { context.toast('Ajoutez un titre et un contenu.', 'error'); return; }
    overlay.querySelector('[data-save-state]').textContent = 'Enregistrement…';
    try {
      await context.api.saveLesson({
        organizationId: context.organization.id, moduleId: read('moduleId').value,
        lessonId: lessonId || undefined, title, description: read('description').value.trim(), type,
        content: type === 'text' ? read('content').value : '', contentRef,
        estimatedDurationMinutes: Number(read('duration').value) || 0,
        isFreePreview: read('preview').checked, allowDownload: read('download').checked,
        status: read('status').value, order: lesson.order
      });
      context.toast('Leçon enregistrée.'); close(); await context.onSaved();
    } catch (error) { overlay.querySelector('[data-save-state]').textContent = error.message; context.toast(error.message, 'error'); }
  });
}

function renderAssets(assets, selectedPath, context) {
  if (!assets.length) return '<div class="sst-course-empty-inline">Aucun média réutilisable. Téléversez votre premier fichier ci-dessus.</div>';
  return assets.map((asset) => `<div class="sst-course-asset-row ${asset.storagePath === selectedPath ? 'selected' : ''}" data-asset-row><i class="fas ${assetIcon(asset.contentType)}"></i><div><input class="sst-input" value="${context.escapeHtml(asset.label || asset.originalName || 'Média')}" maxlength="160"><small>${formatBytes(asset.sizeBytes)} · ${asset.usedBy?.length ? `Utilisé par ${asset.usedBy.length} leçon${asset.usedBy.length === 1 ? '' : 's'}` : 'Inutilisé'}</small></div><span><button type="button" data-select-asset="${context.escapeHtml(asset.id)}" title="Utiliser"><i class="fas fa-check"></i></button><button type="button" data-rename-asset="${context.escapeHtml(asset.id)}" title="Renommer"><i class="fas fa-floppy-disk"></i></button><button type="button" data-delete-asset="${context.escapeHtml(asset.id)}" title="Supprimer" ${asset.usedBy?.length ? 'disabled' : ''}><i class="fas fa-trash"></i></button></span></div>`).join('');
}

function assetIcon(type) { if (String(type).startsWith('video/')) return 'fa-circle-play'; if (String(type).startsWith('audio/')) return 'fa-headphones'; if (type === 'application/pdf') return 'fa-file-pdf'; return 'fa-paperclip'; }
function formatBytes(value) { const bytes = Number(value) || 0; if (bytes < 1024) return `${bytes} o`; if (bytes < 1048576) return `${Math.round(bytes / 1024)} Ko`; return `${(bytes / 1048576).toFixed(1)} Mo`; }
