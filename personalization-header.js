export default class PersonalizationHeader {
  constructor(rootId = 'personalization-header-root') {
    const root = document.getElementById(rootId);
    if (!root) return;
    root.innerHTML = `<header class="pzh-header"><a class="pzh-brand" href="./index.html" aria-label="Retour à l’accueil Smart Cut Services"><img src="./logo.png" alt="Smart Cut Services"><span><strong>Smart Cut</strong><small>Studio de personnalisation</small></span></a><span class="pzh-context">Création produit</span><a class="pzh-home" href="./index.html">Accueil <span aria-hidden="true">→</span></a></header>`;
  }
}
