import { auth, googleProvider, authReadyPromise } from '../firebase-init.js';
import { signInWithPopup, signOut } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js';
import { uploadStorageFile } from '../firebase-storage.js';
import { createEducationApi, createDemoApi } from './api.js';

const root = document.getElementById('educationProApp');
const demo = new URLSearchParams(location.search).get('demo') === '1';
const views = [
  ['overview','fa-chart-line','Vue d’ensemble'],['details','fa-pen-to-square','Informations'],['content','fa-list-check','Programme'],
  ['media','fa-photo-film','Médias'],['sales','fa-tag','Prix et accès'],['page','fa-window-maximize','Page publique'],
  ['students','fa-users','Apprenants'],['analytics','fa-chart-simple','Analyses'],['settings','fa-gear','Paramètres']
];
let api; let dashboard = { schools: [], programs: [], selected: null }; let activeView = 'overview'; let saving = false;

const esc = (value) => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const money = (value) => `${Number(value || 0).toLocaleString('fr-FR')} HTG`;
const lines = (value) => Array.isArray(value) ? value.join('\n') : String(value || '');
const readLines = (value) => String(value || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
const statusLabel = (status) => ({ draft:'Brouillon',review:'En vérification',published:'Publié',archived:'Archivé' }[status] || 'Brouillon');
const selectedId = () => dashboard.selected?.id || '';

function toast(message, type = '') { document.querySelector('.edp-toast')?.remove(); const node=document.createElement('div'); node.className=`edp-toast ${type}`; node.textContent=message; document.body.appendChild(node); setTimeout(()=>node.remove(),3500); }
function setSaving(value) { saving=value; const el=document.querySelector('[data-save-state]'); if(el) el.textContent=value ? 'Enregistrement…' : 'À jour'; }

function modal({ title, content, confirm = 'Enregistrer', danger = false }) {
  return new Promise((resolve) => {
    const layer=document.createElement('div'); layer.className='edp-modal-backdrop'; layer.innerHTML=`<form class="edp-modal"><h2>${esc(title)}</h2>${content}<div class="edp-modal-actions"><button type="button" class="edp-btn" data-cancel>Annuler</button><button class="edp-btn ${danger?'danger':'primary'}">${esc(confirm)}</button></div></form>`;
    const done=(value)=>{layer.remove();resolve(value)}; layer.querySelector('[data-cancel]').onclick=()=>done(null); layer.onclick=(e)=>{if(e.target===layer)done(null)}; layer.querySelector('form').onsubmit=(e)=>{e.preventDefault();done(new FormData(e.currentTarget))}; document.body.appendChild(layer); layer.querySelector('input,textarea,select')?.focus();
  });
}

async function confirmAction(title, message, label='Confirmer') { return Boolean(await modal({ title, content:`<p style="color:#626a78;font-size:.84rem;line-height:1.5">${esc(message)}</p>`, confirm:label, danger:true })); }

function renderAuth() {
  root.innerHTML=`<main class="edp-auth"><section class="edp-auth-copy"><img src="./assets/education/smartcut-logo-mark.png" alt=""><h1>Créez. Publiez. Enseignez.</h1><p>Un espace complet pour construire vos formations et les proposer sur Smart Cut Education.</p></section><section class="edp-auth-panel"><div class="edp-auth-card"><h2>Espace professionnel</h2><p>Connectez-vous avec votre compte Smart Cut.</p><button class="edp-btn primary" data-login><i class="fab fa-google"></i> Continuer avec Google</button><a class="edp-btn" style="margin-top:8px" href="./education.html">Retour au site</a></div></section></main>`;
  root.querySelector('[data-login]').onclick=async()=>{try{await signInWithPopup(auth,googleProvider);await start()}catch(error){if(error?.code!=='auth/popup-closed-by-user')toast('Connexion impossible.','error')}};
}

function shell(content) {
  const course=dashboard.selected;
  root.innerHTML=`<div class="edp-shell"><aside class="edp-sidebar"><a class="edp-brand" href="./education.html"><img src="./assets/education/smartcut-logo-mark.png" alt=""><span><strong>Smart Cut Education</strong><small>Studio professionnel</small></span></a><nav class="edp-nav">${course?views.map(([id,icon,label])=>`<button class="${activeView===id?'active':''}" data-view="${id}"><i class="fas ${icon}"></i>${label}</button>`).join(''):'<button class="active"><i class="fas fa-book"></i>Mes cours</button>'}</nav><div class="edp-sidebar-footer"><a href="./education.html"><i class="fas fa-arrow-left"></i>Voir le site</a><a href="#" data-signout><i class="fas fa-right-from-bracket"></i>Déconnexion</a></div></aside><section class="edp-workspace"><header class="edp-topbar"><button class="edp-icon-btn edp-menu" aria-label="Menu" data-menu><i class="fas fa-bars"></i></button><select class="edp-course-select" data-course-select><option value="">Tous les cours</option>${dashboard.programs.map((item)=>`<option value="${esc(item.id)}" ${item.id===course?.id?'selected':''}>${esc(item.title)}</option>`).join('')}</select><span class="edp-save-state" data-save-state>${saving?'Enregistrement…':'À jour'}</span><div class="edp-top-actions">${course?`<a class="edp-btn" href="./education-programme.html?slug=${encodeURIComponent(course.slug||course.id)}" target="_blank"><i class="fas fa-eye"></i>Aperçu</a><button class="edp-btn primary" data-submit><i class="fas fa-paper-plane"></i><span>${course.publicationStatus==='published'?'Publié':'Soumettre'}</span></button>`:'<button class="edp-btn primary" data-new-course><i class="fas fa-plus"></i><span>Nouveau cours</span></button>'}</div></header><main class="edp-main">${content}</main></section></div>`;
  bindShell();
}

function bindShell() {
  root.querySelector('[data-menu]')?.addEventListener('click',()=>root.querySelector('.edp-shell').classList.toggle('menu-open'));
  root.querySelectorAll('[data-view]').forEach((button)=>button.onclick=()=>{activeView=button.dataset.view;renderCurrent()});
  root.querySelector('[data-course-select]')?.addEventListener('change',async(e)=>{if(e.target.value)await openProgram(e.target.value);else{dashboard.selected=null;renderList()}});
  root.querySelector('[data-new-course]')?.addEventListener('click',createCourse);
  root.querySelector('[data-signout]')?.addEventListener('click',async(e)=>{e.preventDefault();if(!demo)await signOut(auth);location.href='./education.html'});
  root.querySelector('[data-submit]')?.addEventListener('click',submitProgram);
}

async function load(programId='') { dashboard=await api.dashboard(programId); }
async function openProgram(id) { root.innerHTML='<div class="edp-boot"><i class="fas fa-circle-notch fa-spin"></i> Chargement</div>'; await load(id); activeView='overview'; renderCurrent(); }

function renderList() {
  const rows=dashboard.programs.length?`<div class="edp-course-list">${dashboard.programs.map((item)=>`<article class="edp-course-row"><div class="edp-course-thumb">${item.image?`<img src="${esc(item.image)}" alt="">`:'<i class="fas fa-book-open"></i>'}</div><div><strong>${esc(item.title)}</strong><small><span class="edp-badge ${esc(item.publicationStatus)}">${statusLabel(item.publicationStatus)}</span> · ${esc(item.modality||'online')}</small></div><button class="edp-btn" data-open="${esc(item.id)}">Ouvrir</button></article>`).join('')}</div>`:`<div class="edp-empty"><i class="fas fa-book-open"></i><h2>Votre premier cours</h2><p>Créez le cours, ajoutez le programme, puis soumettez-le.</p><button class="edp-btn primary" data-new-course>Créer un cours</button></div>`;
  shell(`<div class="edp-heading"><div><span class="edp-kicker">Studio</span><h1>Mes cours</h1><p>${dashboard.programs.length} cours</p></div><button class="edp-btn primary" data-new-course><i class="fas fa-plus"></i>Nouveau cours</button></div><section class="edp-card">${rows}</section>`);
  root.querySelectorAll('[data-open]').forEach((button)=>button.onclick=()=>openProgram(button.dataset.open)); root.querySelectorAll('[data-new-course]').forEach((button)=>button.onclick=createCourse);
}

async function ensureSchool() {
  if(dashboard.schools[0]) return dashboard.schools[0].id;
  const form=await modal({title:'Profil professionnel',content:`<div class="edp-form"><label class="edp-field wide"><span>Nom public</span><input class="edp-input" name="name" required maxlength="140"></label><label class="edp-field"><span>Commune</span><input class="edp-input" name="commune"></label><label class="edp-field"><span>Contact public</span><input class="edp-input" name="publicContact"></label></div>`,confirm:'Créer le profil'}); if(!form)return null;
  const result=await api.saveSchool({name:form.get('name'),commune:form.get('commune'),publicContact:form.get('publicContact')}); await load(); return result.schoolId;
}

async function createCourse() {
  const schoolId=await ensureSchool(); if(!schoolId)return;
  const form=await modal({title:'Nouveau cours',content:`<div class="edp-form"><label class="edp-field wide"><span>Titre</span><input class="edp-input" name="title" required maxlength="160"></label><label class="edp-field wide"><span>Résumé</span><textarea class="edp-textarea" name="shortDescription" required maxlength="500"></textarea></label><label class="edp-field"><span>Format</span><select class="edp-select" name="modality"><option value="online">En ligne</option><option value="in_person">En présentiel</option><option value="hybrid">Hybride</option></select></label><label class="edp-field"><span>Prix HTG</span><input class="edp-input" name="amount" type="number" min="0" value="0"></label></div>`,confirm:'Créer'}); if(!form)return;
  setSaving(true); try{const result=await api.saveProgram({schoolId,title:form.get('title'),shortDescription:form.get('shortDescription'),modality:form.get('modality'),price:{amount:Number(form.get('amount')),currency:'HTG',isOnRequest:false}});await openProgram(result.programId);toast('Cours créé.')}catch(error){toast(error.message,'error')}finally{setSaving(false)}
}

function renderCurrent() {
  if(!dashboard.selected){renderList();return}
  const map={overview:renderOverview,details:renderDetails,content:renderContent,media:renderMedia,sales:renderSales,page:renderPage,students:renderStudents,analytics:renderAnalytics,settings:renderSettings};
  map[activeView]?.();
}

function heading(kicker,title,subtitle='',action=''){return `<div class="edp-heading"><div><span class="edp-kicker">${esc(kicker)}</span><h1>${esc(title)}</h1>${subtitle?`<p>${esc(subtitle)}</p>`:''}</div>${action}</div>`}

function renderOverview() {
  const c=dashboard.selected; const check=c.checklist||{completed:0,total:7,items:[]}; const percent=Math.round((check.completed/check.total)*100)||0;
  shell(`${heading('Cours',c.title,statusLabel(c.publicationStatus))}<div class="edp-metrics"><div class="edp-metric"><span>Configuration</span><strong>${percent}%</strong><small>${check.completed}/${check.total} éléments</small></div><div class="edp-metric"><span>Apprenants</span><strong>${c.analytics?.enrollments||0}</strong><small>inscriptions</small></div><div class="edp-metric"><span>Vues</span><strong>${c.analytics?.pageViews||0}</strong><small>page publique</small></div><div class="edp-metric"><span>Revenu</span><strong>${money(c.analytics?.revenue)}</strong><small>paiements confirmés</small></div></div><div class="edp-grid two"><section class="edp-card"><div class="edp-card-head"><h2>À faire</h2><span>${percent}%</span></div><div class="edp-progress"><span style="width:${percent}%"></span></div><div class="edp-checklist">${check.items.map((item)=>`<div class="edp-check ${item.complete?'done':''}"><i class="fas ${item.complete?'fa-circle-check':'fa-circle'}"></i>${esc(item.label)}</div>`).join('')}</div></section><section class="edp-card"><div class="edp-card-head"><h2>Accès rapide</h2></div><div class="edp-grid"><button class="edp-btn" data-jump="content">Modifier le programme</button><button class="edp-btn" data-jump="page">Préparer la page</button><button class="edp-btn" data-jump="sales">Configurer le prix</button></div></section></div>`);
  root.querySelectorAll('[data-jump]').forEach((button)=>button.onclick=()=>{activeView=button.dataset.jump;renderCurrent()});
}

function programPayload(extra={}) { const c=dashboard.selected; return { programId:c.id,schoolId:c.schoolId,title:c.title,shortDescription:c.shortDescription,fullDescription:c.fullDescription,categoryId:c.categoryId,level:c.level,modality:c.modality,commune:c.commune,department:c.department,duration:c.duration,schedule:c.schedule,prerequisites:c.prerequisites,learningOutcomes:c.learningOutcomes,targetAudience:c.targetAudience,instructor:c.instructor,price:c.price,registration:c.registration,capacity:c.capacity,image:c.image,imagePath:c.imagePath,promoVideo:c.promoVideo,terms:c.terms,refundPolicy:c.refundPolicy,seo:c.seo,...extra}; }
async function saveProgram(extra, message='Enregistré.') { setSaving(true);try{await api.saveProgram(programPayload(extra));await load(selectedId());toast(message);renderCurrent()}catch(error){toast(error.message,'error')}finally{setSaving(false)} }

function renderDetails() {
  const c=dashboard.selected;
  const options=(items,current)=>items.map(([value,label])=>`<option value="${value}" ${current===value?'selected':''}>${label}</option>`).join('');
  shell(`${heading('Informations','Définir le cours','Le strict nécessaire.')}
    <form class="edp-card edp-form" data-details>
      <label class="edp-field wide"><span>Titre</span><input class="edp-input" name="title" value="${esc(c.title)}" required></label>
      <label class="edp-field wide"><span>Résumé</span><textarea class="edp-textarea" name="shortDescription" required>${esc(c.shortDescription)}</textarea></label>
      <label class="edp-field wide"><span>Description</span><textarea class="edp-textarea" rows="6" name="fullDescription">${esc(c.fullDescription)}</textarea></label>
      <label class="edp-field"><span>Catégorie</span><input class="edp-input" name="categoryId" value="${esc(c.categoryId)}"></label>
      <label class="edp-field"><span>Niveau</span><select class="edp-select" name="level">${options([['beginner','Débutant'],['intermediate','Intermédiaire'],['advanced','Avancé'],['all','Tous niveaux']],c.level)}</select></label>
      <label class="edp-field"><span>Format</span><select class="edp-select" name="modality">${options([['online','En ligne'],['in_person','Présentiel'],['hybrid','Hybride']],c.modality)}</select></label>
      <label class="edp-field"><span>Durée</span><input class="edp-input" name="durationValue" type="number" min="0" step="0.5" value="${c.duration?.value??''}"></label>
      <label class="edp-field"><span>Unité</span><select class="edp-select" name="durationUnit">${options([['hours','Heures'],['days','Jours'],['weeks','Semaines'],['months','Mois']],c.duration?.unit)}</select></label>
      <label class="edp-field"><span>Horaire</span><input class="edp-input" name="schedule" value="${esc(c.schedule)}" placeholder="Samedi, 9 h – 12 h"></label>
      <label class="edp-field"><span>Commune</span><input class="edp-input" name="commune" value="${esc(c.commune)}"></label>
      <label class="edp-field"><span>Département</span><input class="edp-input" name="department" value="${esc(c.department)}"></label>
      <label class="edp-field"><span>Formateur</span><input class="edp-input" name="instructorName" value="${esc(c.instructor?.name)}"></label>
      <label class="edp-field wide"><span>Bio du formateur</span><textarea class="edp-textarea" name="instructorBio">${esc(c.instructor?.bio)}</textarea></label>
      <label class="edp-field wide"><span>Résultats</span><textarea class="edp-textarea" name="outcomes">${esc(lines(c.learningOutcomes))}</textarea><small>Un résultat par ligne</small></label>
      <label class="edp-field wide"><span>Public cible</span><textarea class="edp-textarea" name="audience">${esc(lines(c.targetAudience))}</textarea></label>
      <label class="edp-field wide"><span>Prérequis</span><textarea class="edp-textarea" name="prerequisites">${esc(c.prerequisites)}</textarea></label>
      <div class="edp-form-actions"><button class="edp-btn primary">Enregistrer</button></div>
    </form>`);
  root.querySelector('[data-details]').onsubmit=(e)=>{e.preventDefault();const f=new FormData(e.currentTarget);saveProgram({title:f.get('title'),shortDescription:f.get('shortDescription'),fullDescription:f.get('fullDescription'),categoryId:f.get('categoryId'),level:f.get('level'),modality:f.get('modality'),duration:{value:Number(f.get('durationValue'))||null,unit:f.get('durationUnit')},schedule:f.get('schedule'),commune:f.get('commune'),department:f.get('department'),instructor:{...c.instructor,name:f.get('instructorName'),bio:f.get('instructorBio')},learningOutcomes:readLines(f.get('outcomes')),targetAudience:readLines(f.get('audience')),prerequisites:f.get('prerequisites')})};
}

function renderContent() {
  const c=dashboard.selected; const modules=c.modules||[]; const lessons=c.lessons||[];
  const body=modules.length?modules.map((module,index)=>{const rows=lessons.filter((lesson)=>lesson.moduleId===module.id);return `<section class="edp-module"><div class="edp-module-head"><i class="fas fa-grip-lines"></i><div><strong>${esc(module.title)}</strong><small>${rows.length} leçon${rows.length===1?'':'s'}</small></div><div class="edp-module-actions"><button class="edp-icon-btn" data-edit-module="${module.id}" aria-label="Modifier"><i class="fas fa-pen"></i></button><button class="edp-icon-btn" data-archive-module="${module.id}" aria-label="Archiver"><i class="fas fa-box-archive"></i></button></div></div><div class="edp-lessons">${rows.map((lesson)=>`<div class="edp-lesson"><i class="fas ${lesson.type==='video'?'fa-circle-play':lesson.type==='text'?'fa-file-lines':lesson.type==='audio'?'fa-headphones':'fa-paperclip'}"></i><div><strong>${esc(lesson.title)}</strong><small>${esc(lesson.type)} · ${lesson.estimatedDurationMinutes||0} min · ${esc(lesson.status)}</small></div><div class="edp-lesson-actions"><button class="edp-icon-btn" data-edit-lesson="${lesson.id}"><i class="fas fa-pen"></i></button><button class="edp-icon-btn" data-archive-lesson="${lesson.id}"><i class="fas fa-box-archive"></i></button></div></div>`).join('')}<button class="edp-btn edp-add-lesson" data-add-lesson="${module.id}"><i class="fas fa-plus"></i>Ajouter une leçon</button></div></section>`}).join(''):`<div class="edp-empty"><i class="fas fa-list-check"></i><h2>Programme vide</h2><p>Commencez par un module.</p><button class="edp-btn primary" data-add-module>Ajouter un module</button></div>`;
  shell(`${heading('Contenu','Programme',`${modules.length} module${modules.length===1?'':'s'} · ${lessons.length} leçon${lessons.length===1?'':'s'}`,`<button class="edp-btn primary" data-add-module><i class="fas fa-plus"></i>Module</button>`)}${body}`); bindContent();
}

function moduleForm(module={}) { return modal({title:module.id?'Modifier le module':'Nouveau module',content:`<div class="edp-form"><label class="edp-field wide"><span>Titre</span><input class="edp-input" name="title" value="${esc(module.title)}" required></label><label class="edp-field wide"><span>Description</span><textarea class="edp-textarea" name="description">${esc(module.description)}</textarea></label></div>`}); }
function lessonForm(moduleId,lesson={}) { return modal({title:lesson.id?'Modifier la leçon':'Nouvelle leçon',content:`<div class="edp-form"><label class="edp-field wide"><span>Titre</span><input class="edp-input" name="title" value="${esc(lesson.title)}" required></label><label class="edp-field"><span>Type</span><select class="edp-select" name="type">${[['video','Vidéo'],['text','Texte'],['pdf','PDF'],['audio','Audio'],['file','Fichier'],['live','Direct'],['quiz','Quiz'],['assignment','Devoir']].map(([v,l])=>`<option value="${v}" ${lesson.type===v?'selected':''}>${l}</option>`).join('')}</select></label><label class="edp-field"><span>Durée (min)</span><input class="edp-input" name="duration" type="number" min="0" value="${lesson.estimatedDurationMinutes||0}"></label><label class="edp-field wide"><span>Description</span><textarea class="edp-textarea" name="description">${esc(lesson.description)}</textarea></label><label class="edp-field wide"><span>Texte ou référence média</span><textarea class="edp-textarea" name="content">${esc(lesson.type==='text'?lesson.content:lesson.contentRef)}</textarea></label><label class="edp-field"><span>État</span><select class="edp-select" name="status"><option value="draft" ${lesson.status==='draft'?'selected':''}>Brouillon</option><option value="ready" ${lesson.status==='ready'?'selected':''}>Prête</option><option value="published" ${lesson.status==='published'?'selected':''}>Publiée</option></select></label><label class="edp-field"><span><input type="checkbox" name="preview" ${lesson.isFreePreview?'checked':''}> Aperçu gratuit</span></label></div>`}); }

function bindContent() {
  root.querySelectorAll('[data-add-module]').forEach((button)=>button.onclick=async()=>{const f=await moduleForm();if(!f)return;await api.saveModule({programId:selectedId(),title:f.get('title'),description:f.get('description'),order:(dashboard.selected.modules||[]).length});await openProgram(selectedId());activeView='content';renderCurrent()});
  root.querySelectorAll('[data-edit-module]').forEach((button)=>button.onclick=async()=>{const item=dashboard.selected.modules.find((m)=>m.id===button.dataset.editModule);const f=await moduleForm(item);if(!f)return;await api.saveModule({programId:selectedId(),moduleId:item.id,title:f.get('title'),description:f.get('description'),order:item.order});await openProgram(selectedId());activeView='content';renderCurrent()});
  root.querySelectorAll('[data-add-lesson]').forEach((button)=>button.onclick=async()=>{const f=await lessonForm(button.dataset.addLesson);if(!f)return;const type=f.get('type');await api.saveLesson({programId:selectedId(),moduleId:button.dataset.addLesson,title:f.get('title'),description:f.get('description'),type,estimatedDurationMinutes:Number(f.get('duration')),status:f.get('status'),isFreePreview:f.get('preview')==='on',content:type==='text'?f.get('content'):null,contentRef:type!=='text'?f.get('content'):null,order:dashboard.selected.lessons.filter((l)=>l.moduleId===button.dataset.addLesson).length});await openProgram(selectedId());activeView='content';renderCurrent()});
  root.querySelectorAll('[data-edit-lesson]').forEach((button)=>button.onclick=async()=>{const item=dashboard.selected.lessons.find((l)=>l.id===button.dataset.editLesson);const f=await lessonForm(item.moduleId,item);if(!f)return;const type=f.get('type');await api.saveLesson({programId:selectedId(),moduleId:item.moduleId,lessonId:item.id,title:f.get('title'),description:f.get('description'),type,estimatedDurationMinutes:Number(f.get('duration')),status:f.get('status'),isFreePreview:f.get('preview')==='on',content:type==='text'?f.get('content'):null,contentRef:type!=='text'?f.get('content'):null,order:item.order});await openProgram(selectedId());activeView='content';renderCurrent()});
  [['module','archiveModule'],['lesson','archiveLesson']].forEach(([type,key])=>root.querySelectorAll(`[data-archive-${type}]`).forEach((button)=>button.onclick=async()=>{if(!await confirmAction('Archiver',`Archiver ce ${type==='module'?'module':'contenu'} ?`,'Archiver'))return;await api.archive(type,button.dataset[key]);await openProgram(selectedId());activeView='content';renderCurrent()}));
}

function renderMedia() {
  const c=dashboard.selected; const assets=c.assets||[]; shell(`${heading('Bibliothèque','Médias',`${assets.length} fichier${assets.length===1?'':'s'}`,`<label class="edp-btn primary" style="cursor:pointer"><i class="fas fa-upload"></i>Téléverser<input type="file" hidden data-upload-media accept="image/*,video/*,audio/*,application/pdf"></label>`)}${assets.length?`<div class="edp-media-grid">${assets.map((asset)=>`<article class="edp-asset"><div class="edp-asset-preview"><i class="fas ${asset.contentType?.startsWith('image/')?'fa-image':asset.contentType?.startsWith('video/')?'fa-video':'fa-file'}"></i></div><div class="edp-asset-body"><strong>${esc(asset.label)}</strong><small>${Math.round((asset.size||0)/1024)} Ko</small></div></article>`).join('')}</div>`:`<div class="edp-card edp-empty"><i class="fas fa-photo-film"></i><h2>Aucun média</h2><p>Ajoutez les fichiers utilisés dans vos leçons.</p></div>`}`);
  root.querySelector('[data-upload-media]').onchange=async(e)=>{const file=e.target.files[0];if(!file)return;if(demo){await api.saveAsset({programId:selectedId(),path:`demo/${file.name}`,label:file.name,size:file.size,contentType:file.type});await openProgram(selectedId());activeView='media';renderCurrent();return}try{setSaving(true);const result=await uploadStorageFile(file,`education-content/${auth.currentUser.uid}/${selectedId()}/media`,{maxSizeMb:50,exposeDownloadUrl:false,onProgress:(p)=>{document.querySelector('[data-save-state]').textContent=`Téléversement ${p}%`}});await api.saveAsset({programId:selectedId(),path:result.path,label:file.name});await openProgram(selectedId());activeView='media';renderCurrent();toast('Média ajouté.')}catch(error){toast(error.message,'error')}finally{setSaving(false)}};
}

function renderSales() {
  const c=dashboard.selected; shell(`${heading('Vente','Prix et accès','Tarification et inscriptions.')}<form class="edp-card edp-form" data-sales><label class="edp-field"><span>Prix HTG</span><input class="edp-input" name="amount" type="number" min="0" value="${c.price?.amount??0}"></label><label class="edp-field"><span>Mode</span><select class="edp-select" name="priceMode"><option value="fixed" ${!c.price?.isOnRequest?'selected':''}>Prix fixe</option><option value="request" ${c.price?.isOnRequest?'selected':''}>Sur demande</option></select></label><label class="edp-field"><span>Inscriptions</span><select class="edp-select" name="registration"><option value="open" ${c.registration?.status==='open'?'selected':''}>Ouvertes</option><option value="upcoming" ${c.registration?.status==='upcoming'?'selected':''}>À venir</option><option value="closed" ${c.registration?.status==='closed'?'selected':''}>Fermées</option><option value="on_request" ${c.registration?.status==='on_request'?'selected':''}>Sur demande</option></select></label><label class="edp-field"><span>Places</span><input class="edp-input" name="capacity" type="number" min="1" value="${c.capacity?.total||''}"></label><label class="edp-field"><span>Ouverture</span><input class="edp-input" name="opensAt" type="datetime-local"></label><label class="edp-field"><span>Fermeture</span><input class="edp-input" name="closesAt" type="datetime-local"></label><label class="edp-field wide"><span>Conditions</span><textarea class="edp-textarea" name="terms">${esc(c.terms)}</textarea></label><label class="edp-field wide"><span>Remboursement</span><textarea class="edp-textarea" name="refund">${esc(c.refundPolicy)}</textarea></label><div class="edp-form-actions"><button class="edp-btn primary">Enregistrer</button></div></form>`);
  root.querySelector('[data-sales]').onsubmit=(e)=>{e.preventDefault();const f=new FormData(e.currentTarget);saveProgram({price:{amount:Number(f.get('amount')),currency:'HTG',isOnRequest:f.get('priceMode')==='request'},registration:{status:f.get('registration'),opensAt:f.get('opensAt')||null,closesAt:f.get('closesAt')||null},capacity:{total:Number(f.get('capacity'))||null},terms:f.get('terms'),refundPolicy:f.get('refund')})};
}

function renderPage() {
  const c=dashboard.selected; shell(`${heading('Page publique','Présentation','Aperçu et référencement.',`<a class="edp-btn" href="./education-programme.html?slug=${encodeURIComponent(c.slug||c.id)}" target="_blank"><i class="fas fa-arrow-up-right-from-square"></i>Ouvrir</a>`)}<div class="edp-grid two"><form class="edp-card edp-form" data-page><label class="edp-field wide"><span>Slug</span><input class="edp-input" name="slug" value="${esc(c.slug)}"></label><label class="edp-field wide"><span>Titre SEO</span><input class="edp-input" name="seoTitle" maxlength="70" value="${esc(c.seo?.title)}"></label><label class="edp-field wide"><span>Description SEO</span><textarea class="edp-textarea" name="seoDescription" maxlength="160">${esc(c.seo?.description)}</textarea></label><label class="edp-field wide"><span>Vidéo de présentation</span><input class="edp-input" name="promoVideo" value="${esc(c.promoVideo)}"></label><label class="edp-field wide"><span>Couverture</span><input type="file" accept="image/*" data-cover></label><div class="edp-form-actions"><button class="edp-btn primary">Enregistrer</button></div></form><aside class="edp-card"><div class="edp-course-thumb" style="width:100%;aspect-ratio:16/10">${c.image?`<img src="${esc(c.image)}" alt="">`:'<i class="fas fa-image"></i>'}</div><h2 style="margin-top:16px">${esc(c.title)}</h2><p style="color:#626a78;font-size:.8rem;line-height:1.5">${esc(c.shortDescription)}</p><strong>${c.price?.isOnRequest?'Sur demande':money(c.price?.amount)}</strong></aside></div>`);
  let cover={image:c.image,imagePath:c.imagePath}; root.querySelector('[data-cover]').onchange=async(e)=>{const file=e.target.files[0];if(!file)return;if(demo){cover.image=await new Promise((resolve)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(file)});toast('Couverture prête.');return}try{setSaving(true);const result=await uploadStorageFile(file,`education-public/${auth.currentUser.uid}/${selectedId()}/cover`,{maxSizeMb:8});cover={image:result.url,imagePath:result.path};toast('Couverture prête.')}catch(error){toast(error.message,'error')}finally{setSaving(false)}};
  root.querySelector('[data-page]').onsubmit=(e)=>{e.preventDefault();const f=new FormData(e.currentTarget);saveProgram({slug:f.get('slug'),seo:{title:f.get('seoTitle'),description:f.get('seoDescription')},promoVideo:f.get('promoVideo'),...cover})};
}

function renderStudents() { const rows=dashboard.selected.students||[]; shell(`${heading('Audience','Apprenants',`${rows.length} inscription${rows.length===1?'':'s'}`)}${rows.length?`<div class="edp-table-wrap"><table class="edp-table"><thead><tr><th>Apprenant</th><th>Statut</th><th>Paiement</th><th>Progression</th><th>Dernière activité</th></tr></thead><tbody>${rows.map((item)=>`<tr><td>${esc(item.name||item.email||'Apprenant')}</td><td>${esc(item.status||'active')}</td><td>${esc(item.paymentStatus||'—')}</td><td>${Number(item.progress)||0}%</td><td>${esc(item.lastActivity||'—')}</td></tr>`).join('')}</tbody></table></div>`:`<div class="edp-card edp-empty"><i class="fas fa-users"></i><h2>Aucun apprenant</h2><p>Les inscriptions confirmées apparaîtront ici.</p></div>`}`); }

function renderAnalytics() { const a=dashboard.selected.analytics||{}; shell(`${heading('Performance','Analyses','Mesures disponibles uniquement.')}<div class="edp-metrics"><div class="edp-metric"><span>Vues</span><strong>${a.pageViews||0}</strong></div><div class="edp-metric"><span>Demandes</span><strong>${a.inquiries||0}</strong></div><div class="edp-metric"><span>Inscriptions</span><strong>${a.enrollments||0}</strong></div><div class="edp-metric"><span>Revenu</span><strong>${money(a.revenue)}</strong></div></div><section class="edp-card edp-empty"><i class="fas fa-chart-line"></i><h2>Pas encore de tendance</h2><p>Les graphiques apparaîtront avec les premières visites.</p></section>`); }

function renderSettings() {
  const c=dashboard.selected; const school=dashboard.schools.find((item)=>item.id===c.schoolId)||{};
  shell(`${heading('Réglages','Paramètres','Profil et publication.')}
    <div class="edp-grid two">
      <form class="edp-card edp-form" data-school>
        <div class="edp-card-head wide"><h2>Profil professionnel</h2><span class="edp-badge">${esc(school.verification?.label||'À vérifier')}</span></div>
        <label class="edp-field wide"><span>Nom public</span><input class="edp-input" name="name" value="${esc(school.name)}" required></label>
        <label class="edp-field wide"><span>Résumé</span><textarea class="edp-textarea" name="shortDescription">${esc(school.shortDescription)}</textarea></label>
        <label class="edp-field"><span>Commune</span><input class="edp-input" name="commune" value="${esc(school.commune)}"></label>
        <label class="edp-field"><span>Département</span><input class="edp-input" name="department" value="${esc(school.department)}"></label>
        <label class="edp-field wide"><span>Contact public</span><input class="edp-input" name="publicContact" value="${esc(school.publicContact)}"></label>
        <label class="edp-field wide"><span>Domaines</span><input class="edp-input" name="domains" value="${esc((school.domains||[]).join(', '))}" placeholder="Gestion, Numérique"></label>
        <div class="edp-form-actions"><button class="edp-btn primary">Enregistrer</button></div>
      </form>
      <div>
        <section class="edp-card"><div class="edp-card-head"><h2>Publication</h2><span class="edp-badge ${c.publicationStatus}">${statusLabel(c.publicationStatus)}</span></div><button class="edp-btn" data-draft>Repasser en brouillon</button></section>
        <section class="edp-card" style="margin-top:16px"><div class="edp-card-head"><h2>Zone sensible</h2></div><button class="edp-btn danger" data-archive-program><i class="fas fa-box-archive"></i>Archiver le cours</button></section>
      </div>
    </div>`);
  root.querySelector('[data-school]').onsubmit=async(e)=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await api.saveSchool({schoolId:school.id,name:f.get('name'),shortDescription:f.get('shortDescription'),commune:f.get('commune'),department:f.get('department'),publicContact:f.get('publicContact'),domains:String(f.get('domains')).split(',').map((item)=>item.trim()).filter(Boolean)});await load(c.id);toast('Profil enregistré.');renderSettings()}catch(error){toast(error.message,'error')}};
  root.querySelector('[data-draft]').onclick=async()=>{await api.setStatus(c.id,'draft');await openProgram(c.id)};
  root.querySelector('[data-archive-program]').onclick=async()=>{if(!await confirmAction('Archiver le cours','Le cours disparaîtra de votre liste active.','Archiver'))return;await api.archive('program',c.id);await load();dashboard.selected=null;renderList()};
}

async function submitProgram() { const c=dashboard.selected;if(c.publicationStatus==='published'){toast('Le cours est publié.');return}if(!c.checklist?.complete){toast('Complétez la checklist.','error');activeView='overview';renderCurrent();return}try{await api.setStatus(c.id,'review');await openProgram(c.id);toast('Cours envoyé en vérification.')}catch(error){toast(error.message,'error')} }

async function start() {
  await authReadyPromise;
  if(!demo&&!auth.currentUser){renderAuth();return}
  api=demo?createDemoApi():createEducationApi(auth.currentUser);
  try{await load();renderList()}catch(error){root.innerHTML=`<div class="edp-boot"><div><strong>Chargement impossible</strong><p>${esc(error.message)}</p><a class="edp-btn" href="?demo=1">Voir la démo</a></div></div>`}
}

start();
