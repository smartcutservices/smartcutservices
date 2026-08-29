// Départements et communes d'Haïti — source pour les listes déroulantes
// dépendantes (département -> communes). Liste de travail : l'administrateur
// peut l'affiner. Utilisée par les formulaires Smart Cut Health (candidature
// professionnelle, profils médecin / pharmacie / laboratoire, adresses).

export const HAITI_DEPARTMENTS = [
  'Ouest',
  'Sud-Est',
  'Nord',
  'Nord-Est',
  'Artibonite',
  'Centre',
  'Sud',
  "Grand'Anse",
  'Nord-Ouest',
  'Nippes',
];

export const HAITI_COMMUNES = {
  'Ouest': [
    'Port-au-Prince', 'Delmas', 'Carrefour', 'Pétion-Ville', 'Kenscoff', 'Gressier',
    'Cité Soleil', 'Tabarre', 'Croix-des-Bouquets', 'Thomazeau', 'Ganthier',
    'Fonds-Verrettes', 'Cornillon', 'Cabaret', 'Arcahaie', 'Léogâne', 'Grand-Goâve',
    'Petit-Goâve', 'Anse-à-Galets', 'Pointe-à-Raquette',
  ],
  'Sud-Est': [
    'Jacmel', 'Marigot', 'Cayes-Jacmel', 'La Vallée-de-Jacmel', 'Bainet',
    'Côtes-de-Fer', 'Belle-Anse', 'Grand-Gosier', 'Thiotte', 'Anse-à-Pitre',
  ],
  'Nord': [
    'Cap-Haïtien', 'Limonade', 'Quartier-Morin', 'Acul-du-Nord', 'Plaine-du-Nord',
    'Milot', 'Grande-Rivière-du-Nord', 'Bahon', 'Pignon', 'La Victoire',
    'Saint-Raphaël', 'Dondon', 'Ranquitte', 'Pilate', 'Plaisance', 'Borgne',
    'Port-Margot', 'Limbé', 'Bas-Limbé',
  ],
  'Nord-Est': [
    'Fort-Liberté', 'Ferrier', 'Perches', 'Ouanaminthe', 'Capotille', 'Mont-Organisé',
    'Trou-du-Nord', 'Sainte-Suzanne', 'Grand-Bassin', 'Terrier-Rouge', 'Caracol',
    'Vallières', 'Carice',
  ],
  'Artibonite': [
    'Gonaïves', 'Ennery', "L'Estère", 'Gros-Morne', 'Anse-Rouge', 'Terre-Neuve',
    'Saint-Marc', 'La Chapelle', 'Verrettes', 'Dessalines',
    "Petite-Rivière-de-l'Artibonite", 'Grande-Saline', 'Desdunes', 'Marmelade',
    "Saint-Michel-de-l'Attalaye",
  ],
  'Centre': [
    'Hinche', 'Maïssade', 'Thomonde', 'Cerca-Carvajal', 'Boucan-Carré', 'Mirebalais',
    "Saut-d'Eau", 'Lascahobas', 'Belladère', 'Savanette', 'Cerca-la-Source',
    'Thomassique',
  ],
  'Sud': [
    'Les Cayes', 'Île-à-Vache', 'Torbeck', 'Chantal', 'Camp-Perrin', 'Maniche',
    'Cavaillon', 'Saint-Louis-du-Sud', 'Aquin', 'Fond-des-Blancs', 'Saint-Jean-du-Sud',
    'Arniquet', 'Port-Salut', 'Roche-à-Bateau', 'Coteaux', 'Port-à-Piment',
    'Chardonnières', 'Les Anglais', 'Tiburon',
  ],
  "Grand'Anse": [
    'Jérémie', 'Abricots', 'Bonbon', 'Moron', 'Chambellan', 'Dame-Marie',
    "Anse-d'Hainault", 'Les Irois', 'Corail', 'Roseaux', 'Beaumont', 'Pestel',
  ],
  'Nord-Ouest': [
    'Port-de-Paix', 'Bassin-Bleu', 'Chansolme', 'La Tortue', 'Bombardopolis',
    'Baie-de-Henne', 'Môle-Saint-Nicolas', 'Jean-Rabel', 'Anse-à-Foleur',
    'Saint-Louis-du-Nord',
  ],
  'Nippes': [
    'Miragoâne', 'Fonds-des-Nègres', 'Paillant', 'Petite-Rivière-de-Nippes',
    'Petit-Trou-de-Nippes', "L'Asile", 'Anse-à-Veau', 'Arnaud', 'Plaisance-du-Sud',
    'Baradères', 'Grand-Boucan',
  ],
};

export function communesFor(department) {
  return HAITI_COMMUNES[department] || [];
}
