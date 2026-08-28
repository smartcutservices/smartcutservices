import { auth, authReadyPromise } from '../../firebase-init.js?v=20260523-6';
import { loadWorkspace, marketplaceApi, billingApi } from './api.js?v=20260827-2';
import { esc, money, dateLabel, badge, empty, listTable } from './ui.js';

const $ = (s, r=document) => r.querySelector(s); const $$ = (s,r=document) => [...r.querySelectorAll(s)];
const content=$('#content'), dialog=$('#dialog'), dialogBody=$('#dialogBody');
let user=null, state=null, view='overview', lastDialogFocus=null;
const titles={overview:"Vue d’ensemble",services:'Mes services',requests:'Demandes',orders:'Commandes',clients:'Clients',proformas:'Proformas',invoices:'Factures',payments:'Paiements',withdrawals:'Retraits',profile:'Profil public',settings:'Paramètres'};

function notice(message,error=false){if(message==='Brouillon enregistré. Envoyez-le en validation pour le publier.')message='Service publié avec succès.';const inline=dialog?.open?dialogBody.querySelector('.service-form-feedback'):null;if(inline){inline.textContent=message;inline.className=`service-form-feedback ${error?'error':'success'}`;inline.hidden=false;if(error)inline.scrollIntoView({block:'nearest',behavior:'smooth'});return;}const n=$('#notice');n.textContent=message;n.className=`notice ${error?'error':'success'}`;n.hidden=false;clearTimeout(notice.t);notice.t=setTimeout(()=>n.hidden=true,4500);}
function showDialog(html){lastDialogFocus=document.activeElement;dialogBody.innerHTML=html;dialog.showModal();dialogBody.querySelector('input,select,textarea,button')?.focus();}
function closeDialog(){dialog.close();}
function formObject(form){const out=Object.fromEntries(new FormData(form)); for(const el of form.querySelectorAll('[type=checkbox]')) out[el.name]=el.checked; return out;}
function validateServiceForm(form){const elements=form.elements;const category=elements.categoryPreset?.value==='__custom__'?elements.categoryCustom:elements.categoryPreset;const checks=[[elements.name,'Titre du service'],[category,'Catégorie'],[elements.shortDescription,'Description courte'],[elements.fullDescription,'Description complète'],[elements.deliveryDays,'Délai de livraison'],[elements.revisionsIncluded,'Révisions incluses']];if(elements.pricingType?.value!=='CUSTOM_QUOTE')checks.push([elements.price,'Prix en HTG']);if(!elements.coverImage?.value&&!elements.coverFile?.files?.length)checks.push([elements.coverFile,'Image de présentation']);const invalid=checks.find(([field])=>!field||String(field.value??'').trim()===''||field.validity?.valid===false);if(!invalid)return true;const [field,label]=invalid;field?.classList.add('field-invalid');field?.scrollIntoView({block:'center',behavior:'smooth'});field?.focus?.();notice(`Vérifiez le champ « ${label} » avant de publier.`,true);return false;}
async function publishServiceForm(form,submitter){console.info('[SmartCut publication] clic reçu');if(!validateServiceForm(form))return;const b=formObject(form);b.categoryId=b.categoryPreset==='__custom__'?b.categoryCustom:b.categoryPreset;delete b.categoryPreset;delete b.categoryCustom;const coverFile=form.elements.coverFile?.files?.[0];submitter.disabled=true;submitter.innerHTML='<span class="service-publish-spinner" aria-hidden="true"></span> Publication…';notice(coverFile?'Envoi de l’image et publication en cours…':'Publication en cours…');try{console.info('[SmartCut publication] préparation');if(coverFile)b.coverImage=await uploadServiceCover(coverFile);delete b.coverFile;const pricing=b.pricingType;notice('Enregistrement du service…');console.info('[SmartCut publication] envoi au serveur');const saved=await marketplaceApi('SaveService',{method:'POST',requireAuth:true,body:{...b,publish:true,gallery:[],tags:[],priceMinor:pricing==='CUSTOM_QUOTE'?0:Math.round(Number(b.price)*100),extraRevisionPriceMinor:Math.round(Number(b.extraRevisionPrice||0)*100),deliveryDays:Number(b.deliveryDays),revisionsIncluded:Number(b.revisionsIncluded)}});console.info('[SmartCut publication] service publié',saved.id);const record={id:saved.id,...saved.service};const existingIndex=state.marketplace.services.findIndex(x=>x.id===record.id);if(existingIndex>=0)state.marketplace.services.splice(existingIndex,1,record);else state.marketplace.services.unshift(record);closeDialog();view='services';render();notice('Service publié avec succès.');await reload(false);}catch(err){console.error('[SmartCut publication] échec',err);notice(err?.message||'La publication a échoué. Réessayez.',true);}finally{if(dialog.open){submitter.disabled=false;submitter.innerHTML='<span aria-hidden="true">✓</span> Publier le service';}}}
async function reload(spinner=true){if(spinner)content.innerHTML='<div class="loading">Synchronisation…</div>';try{state=await loadWorkspace(user);render();}catch(e){if(spinner||!state)content.innerHTML=empty('Chargement impossible',e.message,'refresh','Réessayer');else{render();notice('Enregistré, mais la synchronisation complète sera retentée.',true);}}}

function profileIsComplete(profile){const p=profile||{};if(['ACTIVE','PENDING_REVIEW'].includes(p.status))return true;return Boolean(p.businessName&&p.professionalTitle&&p.shortBio&&p.biography&&(p.specialties||[]).length&&(p.address||p.commune));}
function requireCompleteProfile(){if(profileIsComplete(state?.marketplace?.profile))return true;showDialog(`<div class="profile-gate-compact"><button class="icon-button profile-gate-close" data-action="close-dialog" aria-label="Fermer">×</button><span class="profile-gate-mark" aria-hidden="true">!</span><span class="eyebrow">Profil requis</span><h2>Complétez votre profil public</h2><p>Enregistrez les informations de votre activité avant de proposer un service.</p><div class="profile-gate-actions"><button class="button" data-action="close-dialog">Plus tard</button><button class="button primary" data-action="go-profile">Compléter le profil</button></div></div>`);return false;}
function requireSubmittedProfile(){const profile=state?.marketplace?.profile||{};if(!requireCompleteProfile())return false;if(['PENDING_REVIEW','ACTIVE'].includes(profile.status))return true;view='profile';render();notice('Enregistrez puis envoyez votre profil public en validation avant de publier un service.',true);return false;}

function overview(){const m=state.marketplace,b=state.billing.balance||{};const published=m.services.filter(x=>x.publicationStatus==='PUBLISHED').length;const open=m.requests.filter(x=>['NEW','VIEWED'].includes(x.status)).length;const active=m.orders.filter(x=>!['COMPLETED','CANCELLED','REFUNDED'].includes(x.status)).length;const due=m.orders.filter(x=>['PAID','ACCEPTED','IN_PROGRESS','REVISION_REQUESTED'].includes(x.status)).length;const p=m.profile||{};const checklist=[['Profil complété',p.status&&p.status!=='INCOMPLETE'],['Moyen de retrait configuré',Boolean(state.billing.profile?.moncashNumber)],['Premier service créé',m.services.length>0],['Service envoyé en validation',m.services.some(x=>x.publicationStatus!=='DRAFT')],['Service publié',published>0]];return `<div class="metrics"><article><span>Services publiés</span><strong>${published}</strong></article><article><span>Nouvelles demandes</span><strong>${open}</strong></article><article><span>Commandes en cours</span><strong>${active}</strong></article><article><span>À livrer</span><strong>${due}</strong></article><article><span>Disponible</span><strong>${money(b.availableMinor)}</strong></article></div><div class="quick"><button class="button primary" data-action="new-service">Créer un service</button><button class="button" data-view="requests">Voir les demandes</button><button class="button" data-action="new-proforma">Créer une proforma</button></div>${checklist.every(x=>x[1])?'':`<section class="panel checklist"><div class="panel-head"><h2>Démarrage</h2></div>${checklist.map(([label,done])=>`<p class="check ${done?'done':''}"><span aria-hidden="true">${done?'✓':'○'}</span>${esc(label)}</p>`).join('')}</section>`}<section class="panel"><div class="panel-head"><h2>Activité récente</h2></div>${m.notifications.length?m.notifications.slice(0,6).map(x=>`<article class="activity"><strong>${esc(x.title)}</strong><span>${esc(x.message)}</span></article>`).join(''):empty('Aucune activité','Les nouvelles demandes et commandes apparaîtront ici.')}</section>`;}

function services(){const rows=state.marketplace.services.filter(x=>!x.archived).map(x=>{const status=x.publicationStatus||'DRAFT',isPublic=status==='PUBLISHED'&&x.slug,publicUrl=isPublic?`../service.html?slug=${encodeURIComponent(x.slug)}`:'';return [isPublic?`<a class="service-title-link" href="${publicUrl}">${esc(x.name)}</a>`:esc(x.name),esc(x.pricingType==='CUSTOM_QUOTE'?'Sur devis':money(x.priceMinor)),badge(status),`<div class="row-actions">${['DRAFT','REJECTED'].includes(status)?`<button class="link" data-action="edit-service" data-id="${x.id}">Modifier</button><button class="link" data-action="submit-service" data-id="${x.id}">Publier</button>`:isPublic?`<a class="link service-view-link" href="${publicUrl}">Voir le service</a>`:'—'}</div>`];});return `<section class="panel"><div class="panel-head"><div><h2>Mes services</h2><p>Gérez les offres visibles dans le catalogue public Smart Cut.</p></div><button class="button primary" data-action="new-service">Nouveau service</button></div>${rows.length?listTable(['Service','Prix','Publication','Actions'],rows):empty('Aucun service','Créez votre première offre professionnelle.','new-service','Créer un service')}</section>`;}

function requests(){const rows=state.marketplace.requests.map(x=>[esc(x.objective),esc(x.serviceSnapshot?.name||'—'),dateLabel(x.createdAt),badge(x.status),`<div class="row-actions">${['NEW','VIEWED'].includes(x.status)?`<button class="link" data-action="accept-request" data-id="${x.id}">Accepter</button><button class="link danger-text" data-action="decline-request" data-id="${x.id}">Refuser</button>`:''}${x.status==='ACCEPTED'?`<button class="link" data-action="new-proposal" data-id="${x.id}">Proposer</button>`:''}${x.status==='QUOTED'?`<button class="link" data-action="proposal-proforma" data-id="${x.proposalId}">Créer la proforma</button>`:''}</div>`]);return `<section class="panel"><div class="panel-head"><h2>Demandes reçues</h2></div>${rows.length?listTable(['Projet','Service','Date','État','Actions'],rows):empty('Aucune demande','Les besoins enregistrés par les clients apparaîtront ici.')}</section>`;}

function orders(){const rows=state.marketplace.orders.map(x=>[esc(x.serviceSnapshot?.name||x.serviceId),money(x.grossMinor),dateLabel(x.dueAt),badge(x.status),orderActions(x)]);return `<section class="panel"><div class="panel-head"><h2>Commandes</h2></div>${rows.length?listTable(['Service','Montant','Échéance','État','Actions'],rows):empty('Aucune commande','Une commande est créée après un paiement vérifié.')}</section>`;}
function orderActions(x){let primary='';if(x.status==='PAID')primary=`<button class="link" data-action="order-status" data-status="ACCEPTED" data-id="${x.id}">Accepter</button>`;if(x.status==='ACCEPTED')primary=`<button class="link" data-action="order-status" data-status="IN_PROGRESS" data-id="${x.id}">Démarrer</button>`;if(['IN_PROGRESS','REVISION_REQUESTED'].includes(x.status))primary=`<button class="link" data-action="deliver" data-id="${x.id}">Livrer</button>`;return `${primary}<button class="link" data-action="message-order" data-id="${x.id}">Message</button>`;}

function profile(){
  const p=state.marketplace.profile||{};
  const complete=profileIsComplete(p);
  return `<section class="panel narrow provider-profile-panel">
    <div class="panel-head"><div><h2>Profil public</h2><p>Ces informations présentent votre activité aux clients Smart Cut.</p></div>${badge(p.status||'INCOMPLETE')}</div>
    ${complete?'':'<div class="profile-required-note"><strong>Profil requis</strong><span>Complétez les champs obligatoires avant de créer et publier un service.</span></div>'}
    <form id="profileForm" class="form-grid">
      <label class="full profile-logo-upload">
        <span class="profile-logo-preview" aria-hidden="true">${p.logoUrl?`<img src="${esc(p.logoUrl)}" alt="">`:'<span><strong>+</strong> Logo</span>'}</span>
        <span class="profile-logo-copy"><strong>${p.logoUrl?'Remplacer le logo':'Ajouter un logo'}</strong><small>Facultatif · JPG, PNG ou WebP · 8 Mo maximum</small></span>
        <span class="button">Choisir une image</span>
        <input class="profile-logo-input" type="file" name="logoFile" accept="image/jpeg,image/png,image/webp">
      </label>
      <input type="hidden" name="logoUrl" value="${esc(p.logoUrl||'')}">
      <label>Nom professionnel<input name="businessName" required maxlength="140" value="${esc(p.businessName||'')}"></label>
      <label>Titre professionnel<input name="professionalTitle" required maxlength="160" value="${esc(p.professionalTitle||'')}"></label>
      <label class="full">Présentation courte<textarea name="shortBio" maxlength="260" required>${esc(p.shortBio||'')}</textarea></label>
      <label class="full">Biographie<textarea name="biography" rows="5" required>${esc(p.biography||'')}</textarea></label>
      <label>Spécialités<input name="specialties" required placeholder="Design, développement, conseil" value="${esc((p.specialties||[]).join(', '))}"></label>
      <label class="full">Adresse professionnelle<input name="address" required maxlength="220" placeholder="Rue, quartier, ville" value="${esc(p.address||p.commune||'')}"></label>
      <label class="full">Expérience <small>Facultatif</small><textarea name="experience">${esc(p.experience||'')}</textarea></label>
      <label class="full">Disponibilité <small>Facultatif</small><textarea name="availability">${esc(p.availability||'')}</textarea></label>
      <label class="full">Conditions générales <small>Facultatif</small><textarea name="terms">${esc(p.terms||'')}</textarea></label>
      <label class="full">Politique de révision <small>Facultatif</small><textarea name="revisionPolicy">${esc(p.revisionPolicy||'')}</textarea></label>
      <div class="full form-actions"><button class="button" name="intent" value="save">Enregistrer</button><button class="button primary" name="intent" value="submit">Enregistrer et envoyer en validation</button></div>
    </form>
  </section>`;
}

function finance(kind){const b=state.billing;const map={clients:['Clients',b.clients,['Nom','Contact'],x=>[esc(x.name),esc(x.email||x.phone||'—')]],proformas:['Proformas',b.proformas,['Numéro','Client','Total','État'],x=>[esc(x.number),esc(x.clientSnapshot?.name||'—'),money(x.totalMinor),badge(x.status)]],invoices:['Factures',b.invoices,['Numéro','Montant','État'],x=>[esc(x.number),money(x.amountMinor),badge(x.status)]],payments:['Paiements',b.payments,['Transaction','Montant','État'],x=>[esc(x.providerTransactionId||x.id),money(x.amountMinor),badge(x.status)]],withdrawals:['Retraits',b.withdrawals,['Numéro','Montant','État'],x=>[esc(x.number),money(x.amountMinor),badge(x.status)]],settings:['Paramètres',[],[],()=>[]]};if(kind==='settings')return billingSettings();const [title,items,heads,mapper]=map[kind];const action=kind==='proformas'?'<button class="button primary" data-action="new-proforma">Créer</button>':kind==='clients'?'<button class="button primary" data-action="new-client">Ajouter</button>':kind==='withdrawals'?'<button class="button primary" data-action="new-withdrawal">Demander un retrait</button>':'';return `<section class="panel"><div class="panel-head"><h2>${title}</h2>${action}</div>${items.length?listTable(heads,items.map(mapper)):empty(`Aucun ${title.toLowerCase()}`,'Les éléments vérifiés apparaîtront ici.')}</section>`;}
function billingSettings(){const p=state.billing.profile||{};return `<section class="panel narrow"><div class="panel-head"><h2>Factures & Paiements</h2></div><form id="billingProfileForm" class="form-grid"><label>Entreprise<input name="businessName" required value="${esc(p.businessName||'')}"></label><label>Contact<input name="contactName" value="${esc(p.contactName||'')}"></label><label>Email<input type="email" name="email" value="${esc(p.email||user.email||'')}"></label><label>Téléphone<input name="phone" value="${esc(p.phone||'')}"></label><label>Numéro MonCash<input name="moncashNumber" value="${esc(p.moncashNumber||'')}"></label><label>NIF / Matricule<input name="taxId" value="${esc(p.taxId||'')}"></label><label class="full">Adresse<textarea name="address">${esc(p.address||'')}</textarea></label><div class="full"><button class="button primary">Enregistrer</button></div></form></section>`;}

function render(){$('#viewTitle').textContent=titles[view];content.innerHTML=view==='overview'?overview():view==='services'?services():view==='requests'?requests():view==='orders'?orders():view==='profile'?profile():finance(view);$$('[data-view]').forEach(x=>x.classList.toggle('active',x.dataset.view===view));}

function serviceEditor(item={}){
  const categoryGroups=[
    ['Création & médias', [['design','Graphisme & design'],['branding','Logo & identité visuelle'],['ui-ux','UI/UX design'],['photo','Photographie & retouche'],['video','Vidéo & montage'],['animation','Animation & motion design'],['audio','Audio, voix & musique']]],
    ['Web & technologie', [['development','Développement web'],['mobile-apps','Applications mobiles'],['e-commerce','E-commerce'],['no-code','No-code & automatisation'],['data','Données & analyse'],['cybersecurity','Cybersécurité'],['it-support','Support informatique']]],
    ['Marketing & contenu', [['marketing','Marketing digital'],['social-media','Réseaux sociaux'],['seo','SEO & visibilité'],['advertising','Publicité en ligne'],['writing','Rédaction'],['translation','Traduction'],['virtual-assistance','Assistance virtuelle']]],
    ['Entreprise & accompagnement', [['consulting','Conseil aux entreprises'],['accounting','Comptabilité & finance'],['legal','Juridique & administratif'],['human-resources','Ressources humaines'],['sales','Vente & relation client'],['project-management','Gestion de projet']]],
    ['Formation & services locaux', [['education','Cours & formation'],['events','Événementiel'],['printing','Impression & personnalisation'],['food','Cuisine & traiteur'],['beauty','Beauté & bien-être'],['maintenance','Réparation & maintenance'],['logistics','Livraison & logistique']]]
  ];
  const currentCategory=item.categoryId||'';
  const knownCategories=new Set(categoryGroups.flatMap(([,categories])=>categories.map(([value])=>value)));
  const customCategory=Boolean(currentCategory)&&!knownCategories.has(currentCategory);
  const categoryOptions=categoryGroups.map(([group,categories])=>`<optgroup label="${esc(group)}">${categories.map(([value,label])=>`<option value="${value}" ${currentCategory===value?'selected':''}>${esc(label)}</option>`).join('')}</optgroup>`).join('');
  showDialog(`
    <div class="dialog-head service-editor-head">
      <div><span class="eyebrow">Catalogue professionnel</span><h2>${item.id?'Modifier le service':'Créer un service'}</h2><p>Présentez une offre claire, prête à être publiée sur Smart Cut.</p></div>
      <button class="icon-button service-editor-close" data-action="close-dialog" aria-label="Fermer">×</button>
    </div>
    <form id="serviceForm" class="editor service-editor" novalidate>
      <input type="hidden" name="id" value="${esc(item.id||'')}">
      <input type="hidden" name="publish" value="true">
      <fieldset><legend><span>1</span> Informations générales</legend>
        <label>Titre du service<input name="name" required maxlength="160" placeholder="Ex. Création d’un site web professionnel" value="${esc(item.name||'')}"></label>
        <label>Catégorie<select name="categoryPreset" required><option value="" disabled ${currentCategory?'':'selected'}>Choisir une catégorie</option>${categoryOptions}<option value="__custom__" ${customCategory?'selected':''}>Autre catégorie…</option></select><small>Plus de 30 catégories professionnelles disponibles.</small></label>
        <label class="full service-custom-category" ${customCategory?'':'hidden'}>Votre catégorie<input name="categoryCustom" maxlength="80" autocomplete="off" placeholder="Ex. Décoration florale" value="${customCategory?esc(currentCategory):''}" ${customCategory?'required':''}><small>Écrivez une catégorie claire et précise.</small></label>
        <label class="full">Description courte<small>Une phrase claire visible sur la carte du service.</small><textarea name="shortDescription" rows="3" maxlength="220" placeholder="Résumez le résultat proposé au client." required>${esc(item.shortDescription||'')}</textarea></label>
        <label class="full">Description complète<textarea name="fullDescription" rows="5" placeholder="Décrivez votre méthode, le résultat et ce qui est inclus." required>${esc(item.fullDescription||item.description||'')}</textarea></label>
      </fieldset>
      <fieldset><legend><span>2</span> Prix et conditions</legend>
        <label>Type de prix<select name="pricingType"><option value="FIXED" ${item.pricingType==='FIXED'?'selected':''}>Prix fixe</option><option value="STARTING_AT" ${item.pricingType==='STARTING_AT'?'selected':''}>À partir de</option><option value="CUSTOM_QUOTE" ${item.pricingType==='CUSTOM_QUOTE'?'selected':''}>Sur devis</option></select></label>
        <label>Prix en HTG<input name="price" type="number" min="1" step="0.01" inputmode="decimal" placeholder="5000" value="${item.priceMinor?item.priceMinor/100:''}"></label>
        <label class="full">Conditions particulières <small>Facultatif</small><textarea name="terms" rows="4" placeholder="Ajoutez uniquement les conditions utiles à ce service.">${esc(item.terms||'')}</textarea></label>
      </fieldset>
      <fieldset><legend><span>3</span> Livraison et révisions</legend>
        <label>Délai de livraison<input name="deliveryDays" type="number" min="1" max="365" inputmode="numeric" placeholder="7" required value="${item.deliveryDays||''}"><small>Nombre de jours estimé.</small></label>
        <label>Révisions incluses<input name="revisionsIncluded" type="number" min="0" max="50" inputmode="numeric" required value="${item.revisionsIncluded??0}"></label>
        <label>Révision supplémentaire HTG<input name="extraRevisionPrice" type="number" min="0" step="0.01" inputmode="decimal" value="${item.extraRevisionPriceMinor?item.extraRevisionPriceMinor/100:0}"></label>
      </fieldset>
      <fieldset><legend><span>4</span> Image de présentation</legend>
        <label class="full service-cover-upload">
          <span class="service-cover-preview" aria-hidden="true">
            ${item.coverImage
              ? `<img src="${esc(item.coverImage)}" alt="">`
              : '<span class="service-cover-placeholder"><strong>+</strong><span>Image</span></span>'}
          </span>
          <span class="service-cover-copy"><strong>${item.coverImage?'Remplacer l’image':'Ajouter une image'}</strong><small>JPG, PNG ou WebP · 8 Mo maximum</small></span>
          <span class="button service-cover-button">Choisir un fichier</span>
          <input class="service-cover-input" type="file" name="coverFile" accept="image/jpeg,image/png,image/webp" ${item.coverImage?'':'required'}>
        </label>
        <input type="hidden" name="coverImage" value="${esc(item.coverImage||'')}">
      </fieldset>
      <div class="dialog-actions service-editor-actions"><p class="service-form-feedback" role="status" aria-live="assertive" hidden></p><button type="button" class="button" data-action="close-dialog">Annuler</button><button id="publishServiceButton" type="button" class="button primary"><span aria-hidden="true">✓</span> Publier le service</button></div>
    </form>`);
  const form=dialogBody.querySelector('#serviceForm'),publishButton=dialogBody.querySelector('#publishServiceButton');
  publishButton.addEventListener('click',()=>publishServiceForm(form,publishButton));
  form.addEventListener('submit',event=>{event.preventDefault();event.stopPropagation();publishServiceForm(form,publishButton);});
}

function proposalEditor(request){const service=request.serviceSnapshot||{};const expiry=new Date(Date.now()+7*86400000).toISOString().slice(0,10);showDialog(`<div class="dialog-head"><h2>Nouvelle proposition</h2><button class="icon-button" data-action="close-dialog" aria-label="Fermer">×</button></div><form id="proposalForm" class="form-grid"><input type="hidden" name="requestId" value="${request.id}"><label class="full">Résumé<textarea name="summary" required>${esc(request.objective)}</textarea></label><label>Prix total HTG<input name="price" type="number" min="1" required value="${service.priceMinor?service.priceMinor/100:''}"></label><label>Délai en jours<input name="deliveryDays" type="number" min="1" value="${service.deliveryDays||1}"></label><label>Révisions incluses<input name="revisionsIncluded" type="number" min="0" value="${service.revisionsIncluded||0}"></label><label>Expiration<input name="expiresOn" type="date" required value="${expiry}"></label><label class="full">Livrables<textarea name="deliverables" required></textarea></label><label class="full">Conditions<textarea name="terms" required></textarea></label><div class="full"><button class="button primary">Envoyer la proposition</button></div></form>`);}

function clientEditor(){showDialog(`<div class="dialog-head"><h2>Nouveau client</h2><button class="icon-button" data-action="close-dialog" aria-label="Fermer">×</button></div><form id="clientForm" class="form-grid"><label>Nom<input name="name" required></label><label>Entreprise<input name="company"></label><label>Email<input name="email" type="email"></label><label>Téléphone<input name="phone"></label><label class="full">Adresse<textarea name="address"></textarea></label><button class="button primary">Enregistrer</button></form>`);}
function proformaEditor(){const clients=state.billing.clients.filter(x=>!x.archived);if(!clients.length){notice('Ajoutez d’abord un client.',true);clientEditor();return;}const expiry=new Date(Date.now()+30*86400000).toISOString().slice(0,10);showDialog(`<div class="dialog-head"><h2>Créer une proforma</h2><button class="icon-button" data-action="close-dialog" aria-label="Fermer">×</button></div><form id="proformaForm" class="form-grid"><label>Client<select name="clientId">${clients.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></label><label>Expiration<input name="expiryDate" type="date" value="${expiry}" required></label><label class="full">Prestation<input name="itemName" required></label><label>Quantité<input name="quantity" type="number" min="1" value="1" required></label><label>Prix unitaire HTG<input name="unitPrice" type="number" min=".01" step=".01" required></label><label>Réduction HTG<input name="discount" type="number" min="0" step=".01" value="0"></label><label>Taxes HTG<input name="tax" type="number" min="0" step=".01" value="0"></label><label class="full">Conditions<textarea name="terms"></textarea></label><label class="choice full"><input name="publish" type="checkbox" checked> Publier et créer un lien sécurisé</label><button class="button primary">Créer</button></form>`);}
function withdrawalEditor(){const available=(state.billing.balance?.availableMinor||0)/100;showDialog(`<div class="dialog-head"><h2>Demander un retrait</h2><button class="icon-button" data-action="close-dialog" aria-label="Fermer">×</button></div><form id="withdrawalForm" class="form-grid"><label>Montant HTG<input name="amount" type="number" min="500" max="${available}" step=".01" required></label><label>Numéro MonCash<input name="moncashNumber" required value="${esc(state.billing.profile?.moncashNumber||'')}"></label><label class="choice full"><input type="checkbox" required> Je confirme le montant et le numéro.</label><button class="button primary">Réserver les fonds</button></form>`);}
async function uploadPrivate(type,id,fileList){const selected=[...fileList].slice(0,8);if(!selected.length)return[];const { storage }=await import('../../firebase-init.js?v=20260523-6');const { ref,uploadBytes }=await import('https://www.gstatic.com/firebasejs/10.7.0/firebase-storage.js');const files=[];for(const file of selected){if(file.size>20*1024*1024)throw new Error(`${file.name} dépasse 20 Mo.`);if(!/^(image\/(jpeg|png|webp)|application\/(pdf|zip))$/.test(file.type))throw new Error(`${file.name} n’est pas autorisé.`);const path=`marketplace-private/${type}/${id}/${user.uid}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;await uploadBytes(ref(storage,path),file,{contentType:file.type});files.push({path,name:file.name,contentType:file.type,size:file.size});}return files;}

function validateServiceCover(file){
  if(!file)return;
  if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Utilisez une image JPG, PNG ou WebP.');
  if(file.size>8*1024*1024)throw new Error('L’image ne doit pas dépasser 8 Mo.');
}

async function uploadServiceCover(file){
  validateServiceCover(file);
  const { storage }=await import('../../firebase-init.js?v=20260523-6');
  const { ref,uploadBytes,getDownloadURL }=await import('https://www.gstatic.com/firebasejs/10.7.0/firebase-storage.js');
  const safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,'_');
  const path=`marketplace-public/${user.uid}/services/${crypto.randomUUID()}-${safeName}`;
  const storageRef=ref(storage,path);
  await uploadBytes(storageRef,file,{contentType:file.type,cacheControl:'public,max-age=31536000,immutable'});
  return getDownloadURL(storageRef);
}

async function uploadProfileLogo(file){
  validateServiceCover(file);
  const { storage }=await import('../../firebase-init.js?v=20260523-6');
  const { ref,uploadBytes,getDownloadURL }=await import('https://www.gstatic.com/firebasejs/10.7.0/firebase-storage.js');
  const safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,'_');
  const path=`marketplace-public/${user.uid}/profile/${crypto.randomUUID()}-${safeName}`;
  const storageRef=ref(storage,path);
  await uploadBytes(storageRef,file,{contentType:file.type,cacheControl:'public,max-age=31536000,immutable'});
  return getDownloadURL(storageRef);
}

document.addEventListener('click',e=>{const button=e.target.closest('[data-action="go-profile"]');if(!button)return;closeDialog();view='profile';render();});
document.addEventListener('click',async e=>{const t=e.target.closest('button,[data-view]');if(!t)return;if(t.dataset.view){view=t.dataset.view;render();$('#sidebar').classList.remove('open');return;}const a=t.dataset.action,id=t.dataset.id;try{if(a==='close-dialog'){closeDialog();return;}if(a==='refresh'){await reload();return;}if(a==='new-service'){if(!requireCompleteProfile())return;serviceEditor();return;}if(a==='new-client'){clientEditor();return;}if(a==='new-proforma'){proformaEditor();return;}if(a==='new-withdrawal'){withdrawalEditor();return;}if(a==='edit-service'){serviceEditor(state.marketplace.services.find(x=>x.id===id));return;}if(a==='submit-service'){if(!requireSubmittedProfile())return;await marketplaceApi('ServiceAction',{method:'POST',body:{id,action:'submit'},requireAuth:true});notice('Service envoyé en validation.');await reload(false);return;}if(a==='accept-request'||a==='decline-request'){await marketplaceApi('RequestAction',{method:'POST',body:{id,action:a==='accept-request'?'ACCEPT':'DECLINE'},requireAuth:true});notice('Demande mise à jour.');await reload(false);return;}if(a==='new-proposal'){proposalEditor(state.marketplace.requests.find(x=>x.id===id));return;}if(a==='proposal-proforma'){const result=await marketplaceApi('ProposalToProforma',{method:'POST',body:{proposalId:id},requireAuth:true});notice('Proforma créée. Le lien est disponible côté client.');await navigator.clipboard?.writeText(result.publicUrl).catch(()=>{});await reload(false);return;}if(a==='order-status'){await marketplaceApi('TransitionOrder',{method:'POST',body:{orderId:id,status:t.dataset.status},requireAuth:true});notice('Commande mise à jour.');await reload(false);return;}if(a==='message-order'){showDialog(`<div class="dialog-head"><h2>Nouveau message</h2><button class="icon-button" data-action="close-dialog">×</button></div><form id="messageForm"><input type="hidden" name="orderId" value="${id}"><label>Message<textarea name="message" required maxlength="2000"></textarea></label><label>Pièce jointe<input name="files" type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf,application/zip"></label><button class="button primary">Envoyer</button></form>`);return;}if(a==='deliver'){showDialog(`<div class="dialog-head"><h2>Livrer la commande</h2><button class="icon-button" data-action="close-dialog">×</button></div><form id="deliveryForm"><input type="hidden" name="orderId" value="${id}"><label>Fichiers<input name="files" type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf,application/zip"></label><label>Liens de livraison, un par ligne<textarea name="links"></textarea></label><label>Message<textarea name="message"></textarea></label><button class="button primary">Envoyer la livraison</button></form>`);return;}}catch(err){notice(err.message,true);}});

document.addEventListener('change',e=>{
  const logoInput=e.target.closest('#profileForm .profile-logo-input');
  if(logoInput){
    const file=logoInput.files?.[0];
    try{
      validateServiceCover(file);
      const preview=logoInput.closest('.profile-logo-upload')?.querySelector('.profile-logo-preview');
      const copy=logoInput.closest('.profile-logo-upload')?.querySelector('.profile-logo-copy strong');
      if(preview&&file){const objectUrl=URL.createObjectURL(file);preview.innerHTML=`<img src="${objectUrl}" alt="Aperçu du logo sélectionné">`;}
      if(copy)copy.textContent=file?.name||'Ajouter votre logo';
    }catch(err){logoInput.value='';notice(err.message,true);}
    return;
  }
  const categorySelect=e.target.closest('#serviceForm [name="categoryPreset"]');
  if(categorySelect){
    const customField=categorySelect.form.querySelector('.service-custom-category');
    const customInput=categorySelect.form.elements.categoryCustom;
    const isCustom=categorySelect.value==='__custom__';
    customField.hidden=!isCustom;
    customInput.required=isCustom;
    if(isCustom)customInput.focus();
    else customInput.value='';
    return;
  }
  const input=e.target.closest('#serviceForm .service-cover-input');
  if(!input)return;
  const file=input.files?.[0];
  try{
    validateServiceCover(file);
    const preview=input.closest('.service-cover-upload')?.querySelector('.service-cover-preview');
    const copy=input.closest('.service-cover-upload')?.querySelector('.service-cover-copy strong');
    if(preview&&file){
      const previous=preview.dataset.objectUrl;
      if(previous)URL.revokeObjectURL(previous);
      const objectUrl=URL.createObjectURL(file);
      preview.dataset.objectUrl=objectUrl;
      preview.innerHTML=`<img src="${objectUrl}" alt="Aperçu de l’image sélectionnée">`;
    }
    if(copy)copy.textContent=file?.name||'Ajouter une image';
  }catch(err){
    input.value='';
    notice(err.message,true);
  }
});

document.addEventListener('submit',async e=>{e.preventDefault();const form=e.target,b=formObject(form);try{if(form.id==='serviceForm'){b.categoryId=b.categoryPreset==='__custom__'?b.categoryCustom:b.categoryPreset;delete b.categoryPreset;delete b.categoryCustom;const coverFile=form.elements.coverFile?.files?.[0];const submitter=e.submitter;if(submitter){submitter.disabled=true;submitter.textContent=coverFile?'Envoi de l’image…':'Publication…';}try{if(coverFile)b.coverImage=await uploadServiceCover(coverFile);delete b.coverFile;const pricing=b.pricingType;const saved=await marketplaceApi('SaveService',{method:'POST',requireAuth:true,body:{...b,gallery:[],tags:[],priceMinor:pricing==='CUSTOM_QUOTE'?0:Math.round(Number(b.price)*100),extraRevisionPriceMinor:Math.round(Number(b.extraRevisionPrice||0)*100),deliveryDays:Number(b.deliveryDays),revisionsIncluded:Number(b.revisionsIncluded)}});const record={id:saved.id,...saved.service};const existingIndex=state.marketplace.services.findIndex(x=>x.id===record.id);if(existingIndex>=0)state.marketplace.services.splice(existingIndex,1,record);else state.marketplace.services.unshift(record);closeDialog();view='services';render();notice('Brouillon enregistré. Envoyez-le en validation pour le publier.');await reload(false);}finally{if(submitter&&dialog.open){submitter.disabled=false;submitter.innerHTML='<span aria-hidden="true">✓</span> Publier le service';}}}if(form.id==='profileForm'){const submitter=e.submitter;const submitForReview=submitter?.value==='submit';const logoFile=form.elements.logoFile?.files?.[0];if(submitter){submitter.disabled=true;submitter.textContent=logoFile?'Envoi du logo…':'Enregistrement…';}try{if(logoFile)b.logoUrl=await uploadProfileLogo(logoFile);delete b.logoFile;const saved=await marketplaceApi('SaveProfile',{method:'POST',requireAuth:true,body:{...b,submit:submitForReview}});state.marketplace.profile=saved.profile;render();notice(submitForReview?'Profil enregistré et envoyé en validation.':'Profil enregistré.');await reload(false);}finally{if(submitter){submitter.disabled=false;submitter.textContent=submitForReview?'Enregistrer et envoyer en validation':'Enregistrer';}}}if(form.id==='billingProfileForm'){await billingApi('SaveProfile',{method:'POST',user,body:b});notice('Paramètres enregistrés.');await reload(false);}if(form.id==='clientForm'){await billingApi('SaveClient',{method:'POST',user,body:b});closeDialog();notice('Client ajouté.');await reload(false);}if(form.id==='proformaForm'){const result=await billingApi('SaveProforma',{method:'POST',user,body:{clientId:b.clientId,issueDate:new Date().toISOString().slice(0,10),expiryDate:b.expiryDate,publish:b.publish,items:[{name:b.itemName,quantity:Number(b.quantity),unitPrice:b.unitPrice}],discount:b.discount,tax:b.tax,fee:'0',terms:b.terms}});closeDialog();notice(result.publicUrl?'Proforma créée et prête à partager.':'Brouillon créé.');await reload(false);}if(form.id==='withdrawalForm'){const key=crypto.randomUUID();await billingApi('RequestWithdrawal',{method:'POST',user,idempotencyKey:key,body:{amount:b.amount,moncashNumber:b.moncashNumber,idempotencyKey:key}});closeDialog();notice('Retrait réservé.');await reload(false);}if(form.id==='proposalForm'){const priceMinor=Math.round(Number(b.price)*100);await marketplaceApi('CreateProposal',{method:'POST',requireAuth:true,body:{...b,priceMinor,depositMinor:priceMinor,deliveryDays:Number(b.deliveryDays),revisionsIncluded:Number(b.revisionsIncluded)}});closeDialog();notice('Proposition envoyée.');await reload(false);}if(form.id==='messageForm'){const files=await uploadPrivate('orders',b.orderId,form.files.files);await marketplaceApi('SendMessage',{method:'POST',requireAuth:true,body:{orderId:b.orderId,message:b.message,files}});closeDialog();notice('Message envoyé.');await reload(false);}if(form.id==='deliveryForm'){const files=await uploadPrivate('orders',b.orderId,form.files.files);await marketplaceApi('Deliver',{method:'POST',requireAuth:true,body:{orderId:b.orderId,links:b.links.split('\n').filter(Boolean),message:b.message,files}});closeDialog();notice('Livraison envoyée.');await reload(false);}}catch(err){notice(err.message,true);}});

document.addEventListener('submit',e=>{if(e.target.id!=='serviceForm'||validateServiceForm(e.target))return;e.preventDefault();e.stopImmediatePropagation();},true);
document.addEventListener('invalid',e=>{const form=e.target.closest?.('#serviceForm');if(!form||e.target!==form.querySelector(':invalid'))return;const label=e.target.closest('label');const fieldName=label?.childNodes?.[0]?.textContent?.trim()||'champ obligatoire';e.target.classList.add('field-invalid');e.target.scrollIntoView({block:'center',behavior:'smooth'});notice(`Vérifiez le champ « ${fieldName} » avant de publier.`,true);},true);
document.addEventListener('input',e=>{if(!e.target.matches?.('#serviceForm input, #serviceForm select, #serviceForm textarea'))return;e.target.classList.remove('field-invalid');const feedback=e.target.form?.querySelector('.service-form-feedback');if(feedback)feedback.hidden=true;});

dialog.addEventListener('cancel',(event)=>{event.preventDefault();closeDialog();});dialog.addEventListener('close',()=>{dialogBody.innerHTML='';lastDialogFocus?.focus?.();lastDialogFocus=null;});$('#menuBtn').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));
document.addEventListener('keydown',(event)=>{if(event.key==='Escape'&&dialog.open){event.preventDefault();closeDialog();}});
await authReadyPromise;user=auth.currentUser;if(!user&&new URLSearchParams(location.search).get('useMarketplaceFixtures')==='1')user={uid:'provider-demo',email:'demo@smartcut.local'};if(!user){$('#authGate').hidden=false;}else{$('#app').hidden=false;await reload();}
