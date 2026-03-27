const SERVICE_LINKS = [
  {
    id: 'marketplace',
    href: './vendor-marketplace.html',
    icon: 'fas fa-store',
    eyebrow: 'Marketplace',
    title: 'Produits vendeurs',
    description: 'Parcourez les produits approuves publies par les boutiques partenaires.'
  },
  {
    id: 'vendor-application',
    href: './vendor-application.html',
    icon: 'fas fa-user-plus',
    eyebrow: 'Vendeur',
    title: 'Devenir vendeur',
    description: 'Deposez votre candidature pour rejoindre la marketplace Smart Cut Services.'
  },
  {
    id: 'documents',
    href: './printing-documents.html',
    icon: 'fas fa-file-pdf',
    eyebrow: 'Impression',
    title: 'Documents PDF',
    description: 'Chargez un PDF, choisissez le format et ajoutez la commande au panier.'
  },
  {
    id: 'photo',
    href: './printing-photo.html',
    icon: 'fas fa-image',
    eyebrow: 'Impression',
    title: 'Impression photo',
    description: 'Formats photo, papiers premium et devis instantane.'
  },
  {
    id: 'cad',
    href: './printing-cad.html',
    icon: 'fas fa-ruler-combined',
    eyebrow: 'Impression',
    title: 'Plans CAD',
    description: 'Chargez vos plans PDF et laissez le systeme suggerer la bonne dimension.'
  },
  {
    id: 'grand-format',
    href: './printing-grand-format.html',
    icon: 'fab fa-whatsapp',
    eyebrow: 'Atelier',
    title: 'Grand format',
    description: 'Stickers, bannieres et demandes speciales via WhatsApp.'
  }
];

export function renderPublicServiceNav(activeId = '') {
  return `
    <style>
      .public-service-nav {
        border: 1px solid rgba(31, 30, 28, 0.08);
        border-radius: 1.8rem;
        background: rgba(255, 255, 255, 0.88);
        box-shadow: 0 18px 40px rgba(31, 30, 28, 0.06);
        padding: 1.1rem;
      }

      .public-service-nav__header {
        display: flex;
        justify-content: space-between;
        gap: 1rem;
        align-items: end;
        margin-bottom: 1rem;
      }

      .public-service-nav__eyebrow {
        display: inline-block;
        color: #c6a75e;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        font-size: 0.72rem;
        font-weight: 800;
      }

      .public-service-nav__title {
        margin-top: 0.25rem;
        font-family: 'Cormorant Garamond', serif;
        font-size: 2rem;
        color: #1f1e1c;
      }

      .public-service-nav__hint {
        color: #6e6557;
        font-size: 0.95rem;
        line-height: 1.7;
        max-width: 34rem;
      }

      .public-service-nav__grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
        gap: 0.85rem;
      }

      .public-service-nav__card {
        display: grid;
        gap: 0.65rem;
        text-decoration: none;
        color: inherit;
        border: 1px solid rgba(31, 30, 28, 0.08);
        border-radius: 1.3rem;
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(246, 239, 226, 0.9));
        padding: 1rem;
        transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
      }

      .public-service-nav__card:hover {
        transform: translateY(-2px);
        border-color: rgba(198, 167, 94, 0.35);
        box-shadow: 0 14px 28px rgba(31, 30, 28, 0.08);
      }

      .public-service-nav__card[data-active="true"] {
        background: linear-gradient(135deg, rgba(31, 30, 28, 0.96), rgba(61, 57, 50, 0.96));
        color: #f8f5ef;
        border-color: rgba(198, 167, 94, 0.42);
      }

      .public-service-nav__icon {
        width: 42px;
        height: 42px;
        border-radius: 999px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: rgba(198, 167, 94, 0.14);
        color: #9b7c38;
        font-size: 1rem;
      }

      .public-service-nav__card[data-active="true"] .public-service-nav__icon {
        background: rgba(198, 167, 94, 0.16);
        color: #f3d796;
      }

      .public-service-nav__card small {
        color: #8a7450;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        font-size: 0.68rem;
        font-weight: 800;
      }

      .public-service-nav__card[data-active="true"] small {
        color: rgba(243, 215, 150, 0.92);
      }

      .public-service-nav__card strong {
        font-size: 1rem;
        line-height: 1.3;
      }

      .public-service-nav__card p {
        color: #6e6557;
        font-size: 0.86rem;
        line-height: 1.65;
      }

      .public-service-nav__card[data-active="true"] p {
        color: rgba(248, 245, 239, 0.84);
      }

      @media (max-width: 760px) {
        .public-service-nav {
          padding: 1rem;
          border-radius: 1.4rem;
        }

        .public-service-nav__header {
          align-items: start;
          flex-direction: column;
        }

        .public-service-nav__title {
          font-size: 1.7rem;
        }
      }
    </style>
    <section class="public-service-nav" aria-label="Navigation des services Smart Cut">
      <div class="public-service-nav__header">
        <div>
          <span class="public-service-nav__eyebrow">Parcours public</span>
          <h2 class="public-service-nav__title">Choisissez votre espace</h2>
        </div>
        <p class="public-service-nav__hint">Retrouvez au meme endroit la marketplace vendeurs, la candidature vendeur et les differents services d'impression du site.</p>
      </div>
      <div class="public-service-nav__grid">
        ${SERVICE_LINKS.map((item) => `
          <a href="${item.href}" class="public-service-nav__card" data-active="${item.id === activeId ? 'true' : 'false'}">
            <span class="public-service-nav__icon"><i class="${item.icon}"></i></span>
            <small>${item.eyebrow}</small>
            <strong>${item.title}</strong>
            <p>${item.description}</p>
          </a>
        `).join('')}
      </div>
    </section>
  `;
}
