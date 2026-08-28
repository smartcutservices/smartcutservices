export default class HealthTeaser {
  constructor(rootId) {
    const root = document.getElementById(rootId);
    if (!root) return;
    root.innerHTML = `<section class="home-health-teaser"><div class="home-health-inner"><div><span class="home-health-kicker"><i class="fas fa-shield-heart"></i> Smart Cut Health</span><h2>Votre santé, plus accessible.</h2><p>Recherchez une pharmacie vérifiée, envoyez une ordonnance privée ou trouvez un professionnel de santé partenaire.</p><a href="./health.html">Découvrir Smart Cut Health <i class="fas fa-arrow-right"></i></a></div><div class="home-health-points" aria-label="Services Smart Cut Health"><span><i class="fas fa-prescription-bottle-medical"></i> Pharmacies</span><span><i class="fas fa-file-shield"></i> Ordonnances privées</span><span><i class="fas fa-user-doctor"></i> Rendez-vous</span></div></div></section>`;
  }
}

