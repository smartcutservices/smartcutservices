const admin = require('firebase-admin');
const { onRequest } = require('firebase-functions/v2/https');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');

if (!admin.apps.length) admin.initializeApp();
const COLLECTION = 'globalSearchIndex';
const REGION = process.env.FUNCTION_REGION || 'us-central1';
const db = admin.firestore();

const STATIC_ENTRIES = [
  ['ecosystem-health', 'ecosystem', 'Smart Health', 'Médecins, pharmacies, laboratoires et téléconsultations.', ['santé','médecin','docteur','pharmacie','médicament','laboratoire','ordonnance','examen','téléconsultation'], ['health','consultation médicale'], './health.html', 100],
  ['ecosystem-akademi', 'ecosystem', 'Smart Akademi', 'Cours, formations, tutorat et apprentissage en ligne.', ['cours','formation','éducation','tuteur','tutorat','apprendre','enseignant','classe','certificat'], ['education','école en ligne'], './education.html', 98],
  ['ecosystem-tutorat', 'tutor', 'Trouver un tuteur', 'Trouvez un tuteur pour vos cours en ligne.', ['tuteur','tutrice','cours particuliers','accompagnement scolaire'], ['professeur','mentor'], './education-tuteurs.html', 92],
  ['ecosystem-smartsolutiontek', 'ecosystem', 'SmartSolutionTek', 'Solutions digitales, sites web et outils pour entreprises.', ['site web','application','landing page','solution digitale','entreprise'], ['smart solution','technologie','digital'], './index.html#sierra-sst-showcase-root', 94],
  ['ecosystem-freelance', 'freelance', 'Freelance', 'Trouvez une mission ou proposez vos compétences.', ['freelancer','freelance','mission','prestataire','développeur','designer','consultant'], ['travail indépendant','indépendant'], './provider.html', 90],
  ['ecosystem-affiliate', 'affiliate', 'Smart Cut Affiliation', 'Partagez des produits et gagnez des commissions.', ['affilié','affiliation','commission','parrainage','réseau','recommandation','revenus'], ['programme ambassadeur','référencement'], './affiliate.html', 89],
  ['ecosystem-automobile', 'ecosystem', 'Auto & Pièces', 'Pièces, accessoires et services automobiles.', ['auto','voiture','automobile','pièce','accessoire','moteur','pneu','entretien'], ['garage','mécanique'], './auto-parts.html', 88],
  ['ecosystem-printing', 'ecosystem', 'Personnalisation et impression', 'Créez des tasses et produits personnalisés.', ['impression','personnalisation','tasse','mug','tumbler','création produit'], ['produit personnalisé','studio impression'], './personalization.html', 84],
  ['ecosystem-services', 'service', 'Services professionnels', 'Découvrez les services proposés par les prestataires.', ['service','prestation','professionnel','entreprise','expert'], ['prestataire'], './services.html', 82],
  ['ecosystem-shop', 'page', 'Mini-boutique', 'Découvrez les boutiques et produits disponibles.', ['boutique','magasin','commerce','acheter','catalogue'], ['mini boutique','shop'], './catalogue.html', 80]
].map(([id, type, title, description, keywords, aliases, route, priority]) => ({
  id, type, title, description, keywords, aliases, route, priority, active: true, source: 'manifest'
}));

function text(value, max = 500) { return String(value || '').trim().slice(0, max); }
function array(value) { return Array.isArray(value) ? value.filter(Boolean).map((v) => text(v, 120)).slice(0, 40) : []; }
function productEntry(id, data = {}, source = 'products') {
  const title = text(data.name || data.title || 'Produit');
  const visible = data.active !== false && data.published !== false && data.status !== 'archived' && data.status !== 'hidden';
  return {
    id: `${source}__${id}`, entityId: String(id), type: 'product', title,
    description: text(data.shortDescription || data.description || data.categoryName || ''),
    keywords: array([data.categoryName, data.brand, data.vendorName, data.shopName, ...(data.tags || []), ...(data.keywords || [])]),
    aliases: array(data.aliases), route: `./product.html?product=${encodeURIComponent(id)}`,
    image: text((Array.isArray(data.images) && data.images[0]) || data.image || ''), priority: data.vendorVerified ? 12 : 5,
    active: visible, source
  };
}

function serviceEntry(id, data = {}, source = 'services') {
  const title = text(data.name || data.title || 'Service professionnel');
  return { id: `${source}__${id}`, entityId: String(id), type: 'service', title,
    description: text(data.summary || data.shortDescription || data.description || ''),
    keywords: array([data.categoryId, ...(data.keywords || [])]), aliases: array(data.aliases),
    route: data.slug ? `./service.html?slug=${encodeURIComponent(data.slug)}` : './services.html',
    priority: 10, active: data.active !== false && data.published !== false, source };
}
function categoryEntry(id, name) {
  const safeId = text(id || name, 160);
  const title = text(name || id || 'Catégorie');
  return { id: `category__${safeId}`, entityId: safeId, type: 'category', title,
    description: `Produits de la catégorie ${title}.`, keywords: [title], aliases: [],
    route: `./catalogue.html?category=${encodeURIComponent(safeId)}`, priority: 30,
    active: true, source: 'categories' };
}

function setCors(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}
async function verifyAdmin(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return false;
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    const [client, vendor] = await Promise.all([
      db.collection('clients').doc(decoded.uid).get(), db.collection('vendors').doc(decoded.uid).get()
    ]);
    return decoded.admin === true || client.data()?.role === 'admin' || vendor.data()?.role === 'admin';
  } catch (_) { return false; }
}

exports.getPublicSearchIndex = onRequest({ region: REGION }, async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).send('');
  try {
    const snapshot = await db.collection(COLLECTION).where('active', '==', true).limit(2500).get();
    return res.json({ ok: true, entries: snapshot.docs.map((doc) => doc.data()) });
  } catch (error) {
    return res.status(500).json({ ok: false, entries: [], error: 'search-index-unavailable' });
  }
});

exports.rebuildPublicSearchIndex = onRequest({ region: REGION }, async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (!(await verifyAdmin(req))) return res.status(403).json({ ok: false, error: 'admin-required' });
  const rows = [...STATIC_ENTRIES];
  const categories = new Map();
  for (const collection of ['products', 'vendorProducts']) {
    const snapshot = await db.collection(collection).limit(2000).get();
    snapshot.forEach((doc) => {
      const data = doc.data();
      rows.push(productEntry(doc.id, data, collection));
      const categoryId = data.categoryId || data.categoryName || data.category;
      const categoryName = data.categoryName || data.category || categoryId;
      if (categoryId || categoryName) categories.set(String(categoryId || categoryName), String(categoryName || categoryId));
    });
  }
  categories.forEach((name, id) => rows.push(categoryEntry(id, name)));
  for (const collection of ['services', 'professionalServices', 'marketplaceServices']) {
    try {
      const snapshot = await db.collection(collection).limit(1000).get();
      snapshot.forEach((doc) => rows.push(serviceEntry(doc.id, doc.data(), collection)));
    } catch (_) {}
  }
  const existing = await db.collection(COLLECTION).get();
  let batch = db.batch(); let count = 0;
  for (const doc of existing.docs) { batch.delete(doc.ref); if (++count === 400) { await batch.commit(); batch = db.batch(); count = 0; } }
  for (const row of rows) { batch.set(db.collection(COLLECTION).doc(row.id), { ...row, updatedAt: admin.firestore.FieldValue.serverTimestamp() }); if (++count === 400) { await batch.commit(); batch = db.batch(); count = 0; } }
  if (count) await batch.commit();
  return res.json({ ok: true, indexed: rows.length });
});

exports.syncSearchProduct = onDocumentWritten({ region: REGION, document: 'products/{productId}' }, async (event) => {
  const ref = db.collection(COLLECTION).doc(`products__${event.params.productId}`);
  if (!event.data?.after?.exists) return ref.delete();
  return ref.set({ ...productEntry(event.params.productId, event.data.after.data(), 'products'), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
});

exports.syncSearchVendorProduct = onDocumentWritten({ region: REGION, document: 'vendorProducts/{productId}' }, async (event) => {
  const ref = db.collection(COLLECTION).doc(`vendorProducts__${event.params.productId}`);
  if (!event.data?.after?.exists) return ref.delete();
  return ref.set({ ...productEntry(event.params.productId, event.data.after.data(), 'vendorProducts'), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
});

function serviceTrigger(document, source) {
  return onDocumentWritten({ region: REGION, document }, async (event) => {
    const ref = db.collection(COLLECTION).doc(`${source}__${event.params.serviceId}`);
    if (!event.data?.after?.exists) return ref.delete();
    return ref.set({ ...serviceEntry(event.params.serviceId, event.data.after.data(), source), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  });
}

exports.syncSearchService = serviceTrigger('services/{serviceId}', 'services');
exports.syncSearchProfessionalService = serviceTrigger('professionalServices/{serviceId}', 'professionalServices');
