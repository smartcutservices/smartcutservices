// Bibliotheque d'illustrations integree pour le Studio de personnalisation.
// Formes vectorielles simples dessinees pour ce projet (pas de fichiers externes,
// donc aucune question de licence) afin de fournir un premier jeu utilisable des
// la V1. Pour ajouter une illustration: ajouter une entree { id, label, svg }.
// `svg` est un balisage <svg> autonome (viewBox 0 0 100 100), remplace directement
// par currentColor pour pouvoir etre teinte a la volee.

export const ILLUSTRATION_LIBRARY = [
  {
    id: 'star',
    label: 'Etoile',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="currentColor" d="M50 4l12.9 26.1 28.8 4.2-20.9 20.3 4.9 28.7L50 69l-25.7 13.5 4.9-28.7L8.3 34.3l28.8-4.2z"/></svg>'
  },
  {
    id: 'heart',
    label: 'Coeur',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="currentColor" d="M50 88S10 62 10 34a20 20 0 0 1 40-4 20 20 0 0 1 40 4c0 28-40 54-40 54z"/></svg>'
  },
  {
    id: 'flame',
    label: 'Flamme',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="currentColor" d="M50 6c6 18-16 22-16 40a16 16 0 0 0 32 0c0-8-6-10-6-18 10 6 16 18 16 30a26 26 0 0 1-52 0C24 40 42 30 50 6z"/></svg>'
  },
  {
    id: 'leaf',
    label: 'Feuille',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="currentColor" d="M88 12C50 12 16 40 16 78c0 4 4 6 7 3 20-20 40-30 62-46 4-3 6-15 3-23zM20 84c10-24 30-40 52-50-14 22-26 38-52 50z"/></svg>'
  },
  {
    id: 'bolt',
    label: 'Eclair',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="currentColor" d="M56 4 20 56h22l-8 40 44-58H56z"/></svg>'
  },
  {
    id: 'crown',
    label: 'Couronne',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="currentColor" d="M10 34l20 16 20-26 20 26 20-16-8 46H18zM18 88h64v8H18z"/></svg>'
  },
  {
    id: 'circle-badge',
    label: 'Badge rond',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" stroke-width="8"/><circle cx="50" cy="50" r="20" fill="currentColor"/></svg>'
  },
  {
    id: 'wave',
    label: 'Vague',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" d="M6 40c12-16 24 16 36 0s24-16 36 0 12 16 16 0M6 66c12-16 24 16 36 0s24-16 36 0 12 16 16 0"/></svg>'
  },
  {
    id: 'palm',
    label: 'Palmier',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="currentColor" d="M48 40v54h4V40zM50 40c-10-14-30-16-40-6 10 6 24 6 34 10-8-6-20-4-28-14 12-4 26 2 34 10zm0 0c10-14 30-16 40-6-10 6-24 6-34 10 8-6 20-4 28-14-12-4-26 2-34 10z"/></svg>'
  },
  {
    id: 'diamond',
    label: 'Diamant',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="currentColor" d="M20 36 50 8l30 28-30 56z"/></svg>'
  }
];

export function getIllustration(id) {
  return ILLUSTRATION_LIBRARY.find((item) => item.id === id) || null;
}

export function svgToDataUrl(svgMarkup, colorHex = '#0f1111') {
  const colored = svgMarkup.replace(/currentColor/g, colorHex);
  return `data:image/svg+xml;utf8,${encodeURIComponent(colored)}`;
}
