export default class HealthTeaser {
  constructor(rootId) {
    const root = document.getElementById(rootId);
    if (!root) return;
    root.innerHTML = `<section class="home-health-teaser"><div class="home-health-inner"><div class="home-health-copy"><span class="home-health-kicker">Smart Cut Health</span><h2>La santé, simplement.</h2><p>Pharmacies, ordonnances et rendez-vous dans un espace sécurisé.</p><a href="./health.html">Découvrir <i class="fas fa-arrow-right" aria-hidden="true"></i></a></div><figure class="home-health-visual"><img src="./assets/health/home-health-visual-v2.png" alt="Ordonnance sécurisée, pharmacie et rendez-vous accessibles depuis un téléphone" loading="lazy" decoding="async"></figure></div></section>`;
  }
}
