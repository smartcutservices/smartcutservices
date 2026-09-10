// Pages and ecosystems that are always public and should be discoverable.
// Dynamic entities (products, services, profiles and courses) are supplied by
// the Firebase globalSearchIndex endpoint and merged by search.js.
export const SMARTCUT_SEARCH_MANIFEST = Object.freeze([
  {
    id: 'ecosystem-health', type: 'ecosystem', title: 'Smart Health',
    description: 'Médecins, pharmacies, laboratoires et téléconsultations.',
    keywords: ['santé', 'médecin', 'docteur', 'pharmacie', 'médicament', 'laboratoire', 'ordonnance', 'examen', 'téléconsultation', 'rendez-vous'],
    aliases: ['health', 'consultation médicale'], route: './health.html', priority: 100,
    icon: 'fa-heart-pulse'
  },
  {
    id: 'ecosystem-akademi', type: 'ecosystem', title: 'Smart Akademi',
    description: 'Cours, formations, tutorat et apprentissage en ligne.',
    keywords: ['cours', 'formation', 'éducation', 'tuteur', 'tutorat', 'apprendre', 'enseignant', 'classe', 'certificat', 'académie'],
    aliases: ['education', 'école en ligne'], route: './education.html', priority: 98,
    icon: 'fa-graduation-cap'
  },
  {
    id: 'ecosystem-tutorat', type: 'tutor', title: 'Trouver un tuteur',
    description: 'Trouvez un tuteur pour vos cours en ligne.',
    keywords: ['tuteur', 'tutrice', 'cours particuliers', 'accompagnement scolaire'],
    aliases: ['professeur', 'mentor'], route: './education-tuteurs.html', priority: 92,
    icon: 'fa-chalkboard-user'
  },
  {
    id: 'ecosystem-smartsolutiontek', type: 'ecosystem', title: 'SmartSolutionTek',
    description: 'Solutions digitales, sites web et outils pour entreprises.',
    keywords: ['site web', 'application', 'landing page', 'inscription', 'solution digitale', 'entreprise'],
    aliases: ['smart solution', 'technologie', 'digital'], route: './index.html#sierra-sst-showcase-root', priority: 94,
    icon: 'fa-laptop-code'
  },
  {
    id: 'ecosystem-freelance', type: 'freelance', title: 'Freelance',
    description: 'Trouvez une mission ou proposez vos compétences.',
    keywords: ['freelancer', 'freelance', 'mission', 'prestataire', 'développeur', 'designer', 'consultant'],
    aliases: ['travail indépendant', 'indépendant'], route: './provider.html', priority: 90,
    icon: 'fa-briefcase'
  },
  {
    id: 'ecosystem-affiliate', type: 'affiliate', title: 'Smart Cut Affiliation',
    description: 'Partagez des produits et gagnez des commissions.',
    keywords: ['affilié', 'affiliation', 'commission', 'parrainage', 'réseau', 'recommandation', 'revenus'],
    aliases: ['programme ambassadeur', 'référencement'], route: './affiliate.html', priority: 89,
    icon: 'fa-share-nodes'
  },
  {
    id: 'ecosystem-automobile', type: 'ecosystem', title: 'Auto & Pièces',
    description: 'Pièces, accessoires et services automobiles.',
    keywords: ['auto', 'voiture', 'automobile', 'pièce', 'accessoire', 'moteur', 'pneu', 'entretien'],
    aliases: ['garage', 'mécanique'], route: './auto-parts.html', priority: 88,
    icon: 'fa-car'
  },
  {
    id: 'ecosystem-printing', type: 'ecosystem', title: 'Personnalisation et impression',
    description: 'Créez des tasses et produits personnalisés.',
    keywords: ['impression', 'personnalisation', 'tasse', 'mug', 'tumbler', 'création produit'],
    aliases: ['produit personnalisé', 'studio impression'], route: './personalization.html', priority: 84,
    icon: 'fa-print'
  },
  {
    id: 'ecosystem-services', type: 'service', title: 'Services professionnels',
    description: 'Découvrez les services proposés par les prestataires.',
    keywords: ['service', 'prestation', 'professionnel', 'entreprise', 'expert'],
    aliases: ['prestataire'], route: './services.html', priority: 82,
    icon: 'fa-briefcase'
  },
  {
    id: 'ecosystem-shop', type: 'page', title: 'Mini-boutique',
    description: 'Découvrez les boutiques et produits disponibles.',
    keywords: ['boutique', 'magasin', 'commerce', 'acheter', 'catalogue'],
    aliases: ['mini boutique', 'shop'], route: './catalogue.html', priority: 80,
    icon: 'fa-store'
  }
]);

export default SMARTCUT_SEARCH_MANIFEST;
