export default class AutoPartsTeaser {
  constructor(rootId) {
    this.root = document.getElementById(rootId);
    if (!this.root) return;
    this.root.innerHTML = `
      <section class="auto-parts-teaser" aria-labelledby="auto-parts-teaser-title">
        <div class="auto-parts-teaser__content">
          <span>Auto &amp; Parts</span>
          <h2 id="auto-parts-teaser-title">Trouvez la pièce compatible.</h2>
          <p>Voiture, moto, camion ou équipement.</p>
          <a href="./auto-parts.html">Choisir mon véhicule <span aria-hidden="true">→</span></a>
        </div>
        <div class="auto-parts-teaser__media">
          <img src="./assets/auto-parts/hero-auto-parts-v1.png" alt="Véhicule et système de freinage automobile" loading="lazy" decoding="async">
        </div>
      </section>`;
  }
}
