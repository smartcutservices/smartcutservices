# Checklist Impression, Prix, Orthographe et Produits Vendeurs

Date: 29 mai 2026

Objectif: garder une vue claire de ce qui est deja OK, de ce qui est partiel, et de ce qui reste a faire pour le module Impression, l'affichage des prix, les corrections orthographiques et la logique d'approbation des produits vendeurs.

## Legende

- `[x] OK`: implemente ou corrige.
- `[~] Partiel`: une partie existe, mais la logique demandee n'est pas complete.
- `[ ] A faire`: pas encore implemente.
- `[?] A tester`: implemente ou prepare, mais validation manuelle necessaire.

## Resume Rapide

- `[x]` Le vendeur peut modifier un produit deja approuve sans repasser en validation admin.
- `[x]` Les nouveaux produits vendeurs restent soumis a l'approbation admin.
- `[x]` Le module Impression Photo accepte plusieurs photos.
- `[x]` Chaque photo ajoutee peut avoir son propre format/dimension.
- `[x]` Les fichiers d'impression peuvent etre supprimes depuis le Dashboard admin apres telechargement.
- `[x]` Les zones de livraison Impression existent.
- `[x]` La logique par module + intervalle est ajoutee pour POD Document, Plan CAD et Impression Photos.
- `[?]` Les regles de prix par intervalle doivent etre configurees dans le Dashboard admin et testees avec de vraies commandes.
- `[x]` Les prix peuvent etre affiches en HTG ou en USD selon le choix utilisateur.
- `[~]` Certaines corrections orthographiques/encodage ont deja ete faites, mais il faut encore auditer tout le site.

## 1. POD Document

Demande:
Pays -> Departement -> Commune -> Intervalle de pages -> Prix fixe par admin.

Intervalles demandes:

- `1-10`
- `11-20`
- `21-50`
- `51-100`
- `101-250`
- `251-500`

Checklist:

- `[x]` Le pays est limite a Haiti pour la livraison.
- `[x]` Les departements peuvent etre selectionnes depuis une liste dans le Dashboard Impression.
- `[x]` Les communes dependent du departement selectionne.
- `[x]` Ajouter une configuration specifique `POD Document`.
- `[x]` Ajouter une liste d'intervalles de pages pour POD Document.
- `[x]` Permettre a l'admin de definir un prix pour chaque combinaison Pays + Departement + Commune + Intervalle.
- `[x]` Appliquer automatiquement le prix correspondant au nombre de pages imprimees du document client.
- `[?]` Tester un document de 8 pages.
- `[?]` Tester un document de 25 pages.
- `[?]` Tester un document de 120 pages.
- `[?]` Tester une commune non configuree.

## 2. Plan CAD

Demande:
Pays -> Departement -> Commune -> Intervalle de pages -> Prix fixe par admin.

Intervalles demandes:

- `1-10`
- `11-20`
- `21-50`
- `51-100`
- `101-250`
- `251-500`

Checklist:

- `[x]` Le pays est limite a Haiti pour la livraison.
- `[x]` Les departements/communes existent deja dans la logique Impression.
- `[x]` Ajouter une configuration specifique `Plan CAD`.
- `[x]` Ajouter une liste d'intervalles de pages pour Plan CAD.
- `[x]` Permettre a l'admin de definir un prix pour chaque combinaison Pays + Departement + Commune + Intervalle.
- `[x]` Appliquer automatiquement le prix correspondant au nombre de pages imprimees du Plan CAD.
- `[?]` Tester un Plan CAD de 6 pages.
- `[?]` Tester un Plan CAD de 60 pages.
- `[?]` Tester une commune non configuree.

## 3. Impression Photos

Demande:
Pays -> Departement -> Commune -> Intervalle de quantite d'impression -> Prix fixe par admin.

Intervalles demandes:

- `1-10`
- `11-20`
- `21-50`
- `51-100`
- `101-250`
- `251-500`

Checklist:

- `[x]` Le client peut ajouter plusieurs photos.
- `[x]` Chaque photo peut avoir son propre format/dimension.
- `[x]` Ajouter une configuration specifique `Impression Photos`.
- `[x]` Ajouter une liste d'intervalles de quantite de photos.
- `[x]` Permettre a l'admin de definir un prix pour chaque combinaison Pays + Departement + Commune + Intervalle.
- `[x]` Calculer automatiquement le prix selon le nombre total de tirages photo.
- `[?]` Tester 3 photos avec formats differents.
- `[?]` Tester 15 photos avec formats differents.
- `[?]` Tester une adresse dans une commune configuree.
- `[?]` Tester une adresse dans une commune non configuree.

## 4. Exclusions

Ces regles ne doivent pas s'appliquer a:

- `[x]` Impression Grand Format.
- `[x]` Stickers.

Point a verifier:

- `[?]` Confirmer que Grand Format et Stickers ne recuperent pas les intervalles POD/CAD/Photo par erreur.

## 5. Schema Technique Recommande

Pour eviter de melanger les regles, utiliser une structure claire dans Firestore:

```text
printingDeliverySettings/main
  moduleRules:
    podDocument:
      - country
      - department
      - commune
      - rangeId
      - min
      - max
      - fee
      - isActive
    cadPlan:
      - country
      - department
      - commune
      - rangeId
      - min
      - max
      - fee
      - isActive
    photoPrinting:
      - country
      - department
      - commune
      - rangeId
      - min
      - max
      - fee
      - isActive
```

Checklist:

- `[x]` Ajouter le schema dans le Dashboard admin.
- `[x]` Sauvegarder les regles sans casser les anciennes zones de livraison.
- `[x]` Adapter le site pour lire ces regles.
- `[x]` Ajouter un fallback clair si aucune regle ne correspond.

## 6. Affichage des Prix en HTG ou USD

Demande:
Afficher les prix en USD ou en HTG selon le choix du client. Les deux devises ne doivent pas s'afficher en meme temps.

Checklist:

- `[x]` Definir la source du taux de change.
- `[x]` Ajouter un reglage admin pour modifier le taux HTG/USD.
- `[x]` Ajouter un choix utilisateur dans le header: `HTG` ou `USD`.
- `[x]` Sauvegarder le choix utilisateur localement.
- `[x]` Afficher une seule devise a la fois sur les modules principaux.
- `[x]` Afficher le prix livraison dans la devise choisie.
- `[x]` Afficher les totaux checkout/paiement dans la devise choisie.
- `[x]` Afficher les prix Impression dans la devise choisie.
- `[ ]` Decider si les PDF doivent rester uniquement en HTG ou suivre le choix utilisateur.

Decision importante:

- `[x]` Confirmer si le paiement reste en HTG seulement ou si USD devient aussi une devise de paiement.
- Decision actuelle: le paiement reste en HTG; USD est uniquement une devise d'affichage.

## 7. Corrections Orthographiques et Encodage

Probleme:
Certains textes visibles ont encore des problemes d'encodage ou d'orthographe, par exemple des caracteres comme `CatÃ©gories`, `ProcÃ©der`, `GÃ©nÃ©ral`.

Checklist:

- `[x]` Correction faite sur une partie du header/menu categories.
- `[~]` Correction partielle des textes visibles.
- `[x]` Correction des textes visibles prioritaires dans les pages Impression touchees pendant cette mise a jour.
- `[x]` Correction des caracteres casses dans les modules visibles principaux: produits, modale produit, panier, profil, checkout/paiement, menus.
- `[ ]` Auditer les pages principales du site.
- `[ ]` Auditer les modales panier/checkout/profil.
- `[ ]` Auditer les pages produits.
- `[ ]` Auditer le dashboard vendeur.
- `[ ]` Auditer le dashboard admin.
- `[ ]` Corriger les apostrophes manquantes.
- `[ ]` Corriger les accents.
- `[ ]` Corriger les accords grammaticaux visibles.
- `[ ]` Verifier que les fichiers sont bien lus en UTF-8.

Pages prioritaires:

- `index.html`
- `product.html`
- `catalogue.html`
- `cart.js`
- `payment.js`
- `profile-panel.js`
- `DvendorProducts.html`
- Dashboard admin produits/commandes/impression.

## 8. Produits Vendeurs et Approbation Admin

Demande:
Admin approuve uniquement les nouveaux produits. Si un produit vendeur est deja approuve, toute modification du prix, du stock ou des autres champs doit rester approuvee automatiquement.

Checklist:

- `[x]` Nouveau produit vendeur actif: statut `pending_review`.
- `[x]` Produit vendeur deja approuve: modification conserve le statut actif.
- `[x]` Les champs de review existants sont conserves quand le produit etait deja approuve.
- `[x]` Ajout du champ `lastVendorEditAt` pour tracer la derniere modification vendeur.
- `[?]` Tester modification de stock sur produit deja approuve.
- `[?]` Tester modification de prix sur produit deja approuve.
- `[?]` Tester modification de description sur produit deja approuve.
- `[?]` Tester creation d'un nouveau produit vendeur.

## 9. Validation Manuelle Finale

Scenario POD Document:

- `[ ]` Admin configure Ouest/Delmas, intervalle `1-10`, prix X.
- `[ ]` Client upload un document de 8 pages.
- `[ ]` Systeme applique le prix X.
- `[ ]` PDF/commande affiche le bon prix.

Scenario Plan CAD:

- `[ ]` Admin configure Nord/Cap-Haitien, intervalle `21-50`, prix Y.
- `[ ]` Client upload un plan CAD de 30 pages.
- `[ ]` Systeme applique le prix Y.

Scenario Impression Photos:

- `[ ]` Client upload 12 photos.
- `[ ]` Client choisit un format pour chaque photo.
- `[ ]` Systeme applique l'intervalle `11-20`.
- `[ ]` Systeme applique le prix de la zone de livraison.

Scenario Vendeur:

- `[ ]` Vendeur cree un nouveau produit.
- `[ ]` Produit arrive en validation admin.
- `[ ]` Admin approuve le produit.
- `[ ]` Vendeur modifie le stock.
- `[ ]` Produit reste actif sans nouvelle validation admin.

## 10. Ce Qui Reste a Faire en Priorite

1. Configurer et tester les regles de prix par intervalle dans le Dashboard admin.
2. Ajouter l'affichage HTG + USD avec un taux configurable.
3. Faire un audit orthographique global des textes visibles.
4. Tester la logique vendeur deja approuve sur site live.

## 11. Mise a Jour du 29 Mai 2026

Changements appliques:

- Ajout du schema `moduleRules` dans `printingDeliverySettings/main`.
- Ajout des regles par module dans le Dashboard Impression: POD Documents, Plan CAD, Impression Photos.
- Ajout des intervalles fixes: `1-10`, `11-20`, `21-50`, `51-100`, `101-250`, `251-500`.
- Ajout du calcul site cote client: POD/CAD utilisent les pages imprimees; Photo utilise le nombre total de tirages.
- La livraison domicile Impression est bloquee si une zone existe mais qu'aucune regle de prix ne correspond a l'intervalle.
- Les anciennes zones `homeZones` restent compatibles comme fallback si aucune regle par module n'est encore configuree.
- Correction de plusieurs textes visibles dans les modules Impression.

Verification technique:

- `node --check printing-delivery-utils.js`: OK.
- `node --check printing-documents.js`: OK.
- `node --check printing-cad.js`: OK.
- `node --check printing-photo.js`: OK.
- `node --check dashboard-printing.js`: OK.

## 12. Mise a Jour Devise du 29 Mai 2026

Changements appliques:

- Ajout du helper central `currency-utils.js`.
- Le site lit `settings/currency` pour recuperer le taux HTG/USD.
- Fallback local si Firebase est indisponible: `1 USD = 132 HTG`.
- Ajout d'un module Dashboard admin `Devise`.
- Le module Dashboard permet de modifier le taux HTG/USD.
- Le header du site permet au client de choisir l'affichage `HTG` ou `USD`.
- Les deux devises ne s'affichent pas en meme temps.
- La devise de paiement reste `HTG`.

Pages/modules branches:

- Produits accueil.
- Catalogue.
- Modale produit.
- Panier.
- Checkout.
- Paiement.
- Marketplace vendeur.
- Mega menu.
- Menu mobile.
- Impression Documents.
- Impression CAD.
- Impression Photos.

Verification technique:

- `node --check currency-utils.js`: OK.
- `node --check products.js`: OK.
- `node --check product-modal.js`: OK.
- `node --check cart.js`: OK.
- `node --check checkout.js`: OK.
- `node --check payment.js`: OK.
- `node --check categories-section.js`: OK.
- `node --check vendor-marketplace.js`: OK.
- `node --check mega-menu.js`: OK.
- `node --check mobile-menu.js`: OK.
- `node --check dashboard-currency.js`: OK.

Correction importante:

- La premiere version affichait `HTG (env. USD)`.
- La version corrigee affiche maintenant uniquement la devise choisie par l'utilisateur.
- Choix sauvegarde dans `localStorage` avec la cle `smartcut_display_currency`.

## 13. Mise a Jour Orthographe/Encodage du 29 Mai 2026

Changements appliques:

- Correction des sequences cassees de type `Ã©`, `Ã¨`, `Ã `, `Â·`, `âŒ`.
- Correction des labels visibles dans l'espace profil: prenom, telephone, departement, adresses sauvegardees, messages de reset password.
- Correction du separateur de variations produit.
- Correction des textes visibles dans les modules principaux touches par cette passe.

Fichiers verifies:

- `products.js`
- `product-modal.js`
- `cart.js`
- `profile-panel.js`
- `payment.js`
- `checkout.js`
- `categories-section.js`
- `mega-menu.js`
- `mobile-menu.js`
- `index.html`

Verification technique:

- `node --check products.js`: OK.
- `node --check product-modal.js`: OK.
- `node --check cart.js`: OK.
- `node --check profile-panel.js`: OK.
- `node --check checkout.js`: OK.
- `node --check payment.js`: OK.
- `node --check categories-section.js`: OK.
- `node --check mega-menu.js`: OK.
- `node --check mobile-menu.js`: OK.
