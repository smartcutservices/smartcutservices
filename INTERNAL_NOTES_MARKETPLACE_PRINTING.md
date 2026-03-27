# Notes Internes - Marketplace & Impression

## Impression

- La configuration admin des parcours impression est stockee dans la collection `printingSettings`.
- Documents utilises:
  - `documents`
  - `photo`
  - `cad`
  - `grand-format`
- Les pages publiques lisent cette configuration directement:
  - `printing-documents.html` / `printing-documents.js`
  - `printing-photo.html` / `printing-photo.js`
  - `printing-cad.html` / `printing-cad.js`
  - `printing-grand-format.html` / `printing-grand-format.js`
- Les parcours `Documents`, `Photo` et `CAD` ajoutent des lignes au panier existant.
- `Grand Format` reste sur un flux WhatsApp uniquement.

## Vendeurs

- Les candidatures publiques sont stockees dans `vendorApplications`.
- Les profils vendeurs actifs sont stockes dans `vendors`.
- Les produits vendeurs sont stockes dans `vendorProducts`.
- Les regles de commission par categorie sont stockees dans `vendorCommissionRules`.
- La revue admin vendeur se fait dans:
  - `dashboard-vendors.html`
  - `vendors-dashboard.js`
- Le back-office vendeur se fait dans:
  - `vendor-portal.html`
  - `vendor-portal.js`
- La marketplace publique separee se fait dans:
  - `vendor-marketplace.html`
  - `vendor-marketplace.js`
- La navigation publique partagee entre marketplace, candidature vendeur et impression est centralisee dans:
  - `public-service-nav.js`

## Commandes et revenus

- Les commandes restent stockees dans `clients/{clientId}/orders`.
- Le statut paiement reste `status`.
- Le statut livraison reste `fulfillmentStatus`.
- Les lignes de commande peuvent maintenant embarquer:
  - `vendorId`
  - `vendorName`
  - `commissionRule`
  - `sourceType`
  - `category`
  - `deliveryMode`
- Le calcul des ventes vendeur et de la repartition revenus est derive des commandes existantes via `vendor-analytics.js`.
- Aucun payout automatique n'est implemente dans cette phase.
