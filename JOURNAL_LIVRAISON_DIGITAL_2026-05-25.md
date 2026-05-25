# Journal livraison et produits digitaux - 2026-05-25

## Objectif

Ce document explique clairement ce qui a ete fait sur la partie livraison par produit et produit digital, pour eviter de refaire les memes erreurs plus tard.

Demande initiale:

- La section `Livraison` devait apparaitre au meme niveau que les tabs `General`, `Variations`, `Galerie`.
- Pour les anciens produits, la livraison apparaissait plus bas dans le formulaire, ce qui creait une experience differente.
- Il manquait un endroit clair pour uploader un produit digital.
- Un produit digital doit avoir une livraison gratuite et instantanee.

## Repos touches

- Site client / dashboard vendeur: `C:\Users\tleov\Music\rendu`
- Dashboard admin: `C:\Users\tleov\Music\dashboard-`

Fichiers principaux modifies:

- `DvendorProducts.html`
- `checkout.js`
- `C:\Users\tleov\Music\dashboard-\Dproducts.html`

## Ce qui existait avant

Dans le dashboard vendeur, la logique livraison par produit existait deja en partie.

Probleme:

- Le tab `Livraison` existait pour le dashboard vendeur, mais la partie digitale etait encore melangee dans `General`.
- Dans le dashboard admin `Dproducts.html`, la livraison etait dans le tab `General`, donc elle apparaissait plus bas, surtout quand on editait un ancien produit.
- Les produits digitaux pouvaient etre marques via certains champs, mais il n'y avait pas une vraie zone visible et dediee pour uploader un fichier digital.
- Le checkout pouvait encore traiter un produit digital comme un produit physique vendeur, donc sans zone livraison il risquait d'etre marque comme non livrable.

## Changements dans le dashboard vendeur

Fichier:

- `DvendorProducts.html`

Changements faits:

- Ajout d'un tab `Digital` au meme niveau que:
  `General`, `Livraison`, `Categorie & attributs`, `Variations`, `Galerie`.
- La partie digitale a ete sortie de `General`.
- Ajout d'une vraie section pour produit digital avec:
  - Checkbox `Article digital`
  - Champ `Delai de livraison`
  - Champ `Lien de telechargement digital`
  - Input fichier pour uploader un fichier digital
  - Bouton `Uploader le fichier digital`
  - Zone d'information qui affiche le fichier enregistre

Comportement ajoute:

- Quand `Article digital` est active:
  - Le delai est force a `Instantanee`
  - Le poids est force a `0 g`
  - Les champs de poids sont desactives
  - Les zones de livraison physiques ne sont plus exigees

Donnees sauvegardees pour un produit digital:

- `isDigitalProduct: true`
- `digitalDownloadLink`
- `digitalDownloadStoragePath`
- `digitalDownloadFileName`
- `deliveryDelay: "Instantanee"`
- `weightGrams: 0`
- `deliveryCoverage.mode: "digital"`
- `deliveryZones: []`
- `productDeliveryZones: []`
- `deliveryMode: "Digital - livraison instantanee"`

## Upload de fichier digital

Le dashboard vendeur utilise maintenant:

- `uploadStorageFile(...)`

Destination Firebase Storage:

- `products/{vendorUid}/digital/...`

Pourquoi ce choix:

- Les uploads d'images produit utilisent deja le dossier `products/...`.
- Les permissions Storage existantes qui permettent aux vendeurs d'uploader les images produit peuvent aussi couvrir les fichiers digitaux dans ce chemin.
- Cela evite de recreer une nouvelle zone Storage comme `vendor-kyc`, qui avait deja cause des erreurs `storage/unauthorized`.

Important:

- Si un jour l'upload digital retourne `storage/unauthorized`, il faut verifier les Storage Rules sur le path `products/{vendorUid}/digital`.
- Il ne faut pas recreer un path nouveau sans verifier les rules.

## Changements dans le checkout

Fichier:

- `checkout.js`

Probleme corrige:

- Un produit digital vendeur pouvait etre traite comme un produit physique.
- Comme un produit digital n'a pas de zone de livraison, le checkout pouvait croire que la livraison etait indisponible.

Correction ajoutee:

- Ajout d'une detection claire des produits digitaux:
  - `isDigitalProduct`
  - `deliveryCoverage.mode === "digital"`
  - `deliveryMode` contenant `digital`

Comportement maintenant:

- Un produit digital ne compte pas dans les frais Smart Cut physiques.
- Un produit digital vendeur ne rentre pas dans les groupes de livraison vendeur.
- Un produit digital n'est jamais bloque par la logique de zone livraison.
- Le label affiche:
  `Produit digital: livraison instantanee gratuite.`

Regle metier appliquee:

- Produit physique: zone livraison obligatoire.
- Produit digital: pas de zone livraison, frais 0, delai instantane.

## Changements dans le dashboard admin

Fichier:

- `C:\Users\tleov\Music\dashboard-\Dproducts.html`

Changements faits:

- Ajout du tab `Livraison` au meme niveau que:
  `General`, `Categorie & attributs`, `Variations`, `Galerie`.
- Ajout du tab `Digital`.
- La section `Livraison par produit` a ete retiree du tab `General`.
- Elle est maintenant dans son propre tab `Livraison`.
- Ajout d'une section `Produit digital` dans le dashboard admin aussi.

Champs admin ajoutes:

- Checkbox `Article digital`
- Upload fichier digital
- Lien de telechargement
- Delai de livraison

Comportement admin:

- Si le produit est digital:
  - Poids force a 0
  - Livraison gratuite
  - Livraison instantanee
  - Zones physiques non exigees
- Si le produit n'est pas digital:
  - Au moins une zone de livraison est exigee avant enregistrement.

## Details de sauvegarde importants

Pour les produits physiques:

- `deliveryCoverage`
- `deliveryZones`
- `productDeliveryZones`
- `weightGrams`

Pour les produits digitaux:

- `deliveryCoverage` devient:

```js
{
  country: "Haiti",
  mode: "digital",
  nationwide: false,
  nationwideFee: 0,
  zones: []
}
```

Cela permet au checkout de comprendre que ce produit ne doit pas passer par les calculs de livraison physique.

## Pushs effectues

Site client:

- Repo: `ssh://git@github.com/smartcutservices/smartcutservices.git`
- Commit: `542ab3aceff2be7bfb5c768d62ff9179a1715bd7`
- Message: `Add digital product tab and free instant delivery`

Dashboard admin:

- Repo: `ssh://git@github.com/smartcutservices/dashboard-.git`
- Commit: `8da85f840601dc81d48024f1f1329a95209df0e1`
- Message: `Add delivery and digital tabs to products dashboard`

## Incident pendant le push

Le premier push site a ete refuse parce que le remote `main` avait avance.

Erreur:

- `DivergedBranches`

Resolution:

- J'ai cree un clone propre et frais du repo site.
- J'ai reapplique seulement les changements necessaires sur:
  - `DvendorProducts.html`
  - `checkout.js`
- Puis j'ai pousse un nouveau commit propre sur le dernier `main`.

Important pour la prochaine fois:

- Si `DivergedBranches` apparait, ne jamais forcer le push.
- Toujours prendre un clone frais ou pull/rebase proprement.
- Ne pas ecraser les modifications qui peuvent avoir ete poussees entre temps.

## Verifications faites

Checks syntax:

- `node --check checkout.js`
- Verification du script inline de `DvendorProducts.html`
- Verification du script inline de `Dproducts.html`

Verification live site:

- `https://smartcutservices.com/DvendorProducts.html?v=1779680104`
  - Status: `200`
  - `data-tab="digital"` present
  - `uploadDigitalProductFile` present
  - `Livraison gratuite et instantanee` present

- `https://smartcutservices.com/checkout.js?v=1779680102`
  - Status: `200`
  - `isDigitalCartItem` present
  - `Produit digital: livraison instantanee gratuite.` present

Verification dashboard:

- Le repo dashboard a bien ete pousse.
- Je n'ai pas pu verifier une URL publique dashboard fiable:
  - `dashboard.smartcutservices.com` ne resolvait pas.
  - `smartcutservices.com/Dproducts.html` retournait `404`.

Conclusion:

- Le site public contient bien les changements.
- Le dashboard admin repo contient bien les changements et le push a reussi.

## Ce qu'il faut tester manuellement

Tester dashboard vendeur:

1. Ouvrir `DvendorProducts.html`.
2. Cliquer sur `+ Ajouter un produit`.
3. Verifier que les tabs affichent:
   `General`, `Livraison`, `Digital`, `Categorie & attributs`, `Variations`, `Galerie`.
4. Aller dans `Digital`.
5. Cocher `Article digital`.
6. Uploader un fichier.
7. Enregistrer le produit.
8. Verifier dans Firestore que:
   - `isDigitalProduct` est `true`
   - `weightGrams` est `0`
   - `deliveryCoverage.mode` est `digital`
   - `digitalDownloadLink` est present

Tester checkout:

1. Ajouter un produit digital au panier.
2. Ouvrir checkout.
3. Verifier que le produit n'est pas bloque par la zone livraison.
4. Verifier que la livraison affiche gratuite/instantanee.
5. Passer commande.
6. Verifier que le produit digital apparait dans les informations commande.

Tester produit physique:

1. Ajouter un produit physique vendeur.
2. Definir une zone de livraison.
3. Tester avec une adresse client dans cette zone.
4. Tester avec une adresse client hors zone.
5. Le produit hors zone doit etre bloque.

## Regles a ne pas oublier

- Un produit digital ne doit jamais demander une commune de livraison.
- Un produit digital ne doit jamais ajouter de frais livraison.
- Un produit digital ne doit jamais ajouter de poids.
- Un produit digital doit rester instantane.
- Un produit physique doit continuer a respecter la logique:
  `Pays -> Departement -> Commune -> Prix livraison`.
- Ne pas remettre la livraison dans `General`; elle doit rester dans son tab.
- Ne pas creer de nouveau path Firebase Storage sans verifier les rules.
- Ne pas forcer un push si le remote a avance.

## Correctif supplementaire - Produits Smart Cut avec livraison par produit

Date:

- 2026-05-25

Probleme constate:

- Les produits vendeurs respectaient bien les zones de livraison par produit.
- Les produits Smart Cut continuaient a utiliser l'ancienne logique globale `deliveryHomeZones`.
- Resultat: un produit Smart Cut pouvait apparaitre comme livrable partout, parfois gratuitement, meme si une zone et un prix avaient ete definis directement sur le produit.

Cause exacte:

- Dans `checkout.js`, le calcul faisait encore:

```js
baseFee = homeZone globale Smart Cut + frais vendeur
```

- Donc les produits Smart Cut, qui n'ont pas de `vendorId`, etaient exclus de la logique `productDeliveryZones`.
- Cote backend, `functions/index.js` validait seulement les details de livraison des produits vendeurs.

Correction frontend:

- Ajout d'une logique commune `getProductDeliveryGroups()`.
- Cette logique inclut maintenant tous les produits physiques:
  - Produits Smart Cut
  - Produits vendeurs
- Les produits digitaux restent exclus de cette logique.
- Le checkout cherche maintenant la zone de livraison directement dans le produit:
  - `productDeliveryCoverage`
  - `deliveryCoverage`
  - `productDeliveryZones`
  - `deliveryZones`
- Le prix de livraison est calcule par produit et par quantite.
- Si un produit Smart Cut n'a pas de zone qui correspond a l'adresse client, il est bloque comme un produit vendeur.
- Le label de livraison affiche maintenant aussi le delai quand il existe.

Correction backend:

- `functions/index.js` valide maintenant la livraison pour tous les produits physiques, pas seulement les vendeurs.
- Ajout de:
  - `productDeliveryDetails`
  - `smartCutDeliveryDetails`
  - `smartCutDeliveryFee`
  - `productDeliveryFee`
- `vendorDeliveryDetails` reste disponible pour le dashboard vendeur.
- `createMoncashPayment` a ete redeploye pour prendre la nouvelle validation.

Commit:

- Site: `a7421be6de777895a87344cac0e2e0907e772f19`
- Message: `Apply per-product delivery to Smart Cut items`

Deploy:

- Function redeployee: `createMoncashPayment`
- Projet: `smartcutservices-9ce54`
- Resultat: deploy reussi.

Verification live:

- `https://smartcutservices.com/checkout.js`
- Status: `200`
- `getProductDeliveryGroups` present
- `smartCutDeliveryDetails` present
- Ancien message global `Livraison Smart Cut Services indisponible` absent

Nouvelle regle importante:

- Un produit Smart Cut physique doit maintenant etre configure comme un produit vendeur:
  - Zone de livraison
  - Prix de livraison
  - Delai de livraison
- Sans zone compatible avec l'adresse client, le produit Smart Cut ne doit pas passer au paiement.

## Correctif supplementaire - Commission vendeur sur produit + livraison

Date:

- 2026-05-25

Probleme constate:

- Avant, Smart Cut prenait sa commission seulement sur le prix du produit vendeur.
- Exemple ancien calcul:
  - Prix produit: `10 G`
  - Livraison vendeur: `8 G`
  - Total client: `18 G`
  - Commission calculee seulement sur `10 G`
- Cette logique avait du sens quand Smart Cut gerait la livraison.
- Maintenant que le vendeur fixe et gere son prix de livraison, la livraison fait partie du montant vendeur.

Nouvelle regle:

- Commission Smart Cut = pourcentage applique sur:

```text
Prix produit + frais livraison vendeur
```

- Net vendeur = montant total vendeur moins commission.

Exemple:

```text
Prix produit: 10 G
Livraison: 8 G
Base commission: 18 G
Commission 10%: 1.8 G
Net vendeur: 16.2 G
```

Fichier modifie:

- `functions/index.js`

Fonctions impactees:

- `getVendorDashboardAnalytics`
- `getVendorDashboardOrders`
- `requestVendorPayout`
- `createVendorPayout`

Details techniques:

- `buildVendorItemMetrics()` conserve maintenant:
  - `productGrossAmount`
  - `productCommissionAmount`
  - `productNetAmount`
  - `commissionBaseAmount`
  - `deliveryAmount`
- `getRelevantVendorOrderContext()` ajoute maintenant les frais livraison vendeur a chaque produit avant de calculer:
  - `commissionAmount`
  - `vendorNetAmount`
  - `grossAmount`
- Si une ancienne commande n'a pas encore de details livraison par produit, le systeme peut repartir le montant livraison global proportionnellement entre les produits vendeur.

Commit:

- Site: `25c75b26dc62026617767c68ded5ab8d52bea695`
- Message: `Calculate vendor commission on delivery-inclusive total`

Deploy:

- Fonctions redeployees avec succes:
  - `getVendorDashboardAnalytics`
  - `getVendorDashboardOrders`
  - `requestVendorPayout`
  - `createVendorPayout`

Important:

- `vendorDeliveryDetails` reste disponible pour le suivi livraison vendeur.
- La commission est maintenant calculee sur le total vendeur reel.
- Les montants dashboard vendeur et payout doivent maintenant refleter cette logique.

## Correctif supplementaire - Retrait upload fichier digital

Date:

- 2026-05-25

Demande:

- Dans l'onglet `Digital` du dashboard vendeur, retirer le bloc `Uploader un fichier digital`.
- Garder uniquement le champ `Lien de telechargement digital`.
- Le vendeur doit entrer manuellement un lien externe.

Raison:

- Les fichiers uploades directement dans Firebase Storage peuvent remplir le stockage rapidement.
- Il faut eviter que des vendeurs uploadent des fichiers dangereux ou infectes.
- Smart Cut ne doit pas stocker les fichiers digitaux des vendeurs.
- Le site doit seulement conserver un lien de telechargement fourni par le vendeur.

Nouvelle regle:

- Produit digital = lien manuel uniquement.
- Aucun fichier digital vendeur ne doit etre envoye vers Firebase Storage depuis l'interface produit.
- Le lien `digitalDownloadLink` est le seul champ utile pour livrer un produit digital.
- Apres paiement confirme, le client utilisera ce lien pour acceder au telechargement.

Fichiers modifies:

- Site vendeur:
  - `DvendorProducts.html`
- Dashboard admin produits:
  - `C:\Users\tleov\Music\dashboard-\Dproducts.html`

Ce qui a ete retire cote site vendeur:

- Bloc UI `Uploader un fichier digital`.
- Input fichier `digitalProductFileInput`.
- Bouton `uploadDigitalProductBtn`.
- Zone d'information `digitalFileInfo`.
- Import `uploadStorageFile`.
- Fonction `uploadDigitalProductFile()`.
- Fonction `renderDigitalFileInfo()`.
- Event listener du bouton upload.
- Usage des datasets:
  - `digitalDownloadLink.dataset.storagePath`
  - `digitalDownloadLink.dataset.fileName`

Ce qui a ete retire cote dashboard admin:

- Bloc UI `Fichier digital`.
- Input fichier `digitalProductFileInput`.
- Bouton `uploadDigitalProductBtn`.
- Zone `digitalFileInfo`.
- Import `uploadStorageFile`.
- Fonction `getDigitalStorageFolder()`.
- Fonction `uploadDigitalProductFile()`.
- Fonction `renderDigitalFileInfo()`.
- Event listener du bouton upload.
- Usage des datasets storage/file.

Ce qui reste:

- Checkbox `Article digital`.
- Champ `Lien de telechargement digital`.
- Champ `Delai de livraison`, force a `Instantanee` quand le produit est digital.
- Livraison digitale gratuite et instantanee.
- Poids force a `0 g`.
- Pas de zone de livraison pour les produits digitaux.

Sauvegarde des donnees:

- `digitalDownloadLink` continue d'etre sauvegarde.
- `digitalDownloadStoragePath` est force a une chaine vide.
- `digitalDownloadFileName` est force a une chaine vide.

Pourquoi vider `digitalDownloadStoragePath` et `digitalDownloadFileName`:

- Cela evite qu'un ancien produit digital continue de pointer vers un ancien fichier Firebase.
- Cela confirme que la source de verite est maintenant seulement le lien manuel.
- Cela reduit le risque de confusion entre ancien systeme upload et nouveau systeme lien externe.

Message ajoute dans l'interface:

```text
Collez ici le lien externe que le client recevra apres paiement.
Aucun fichier digital n est stocke sur Smart Cut.
```

Verification technique:

- Syntax check module du `DvendorProducts.html`: OK.
- Syntax check module du dashboard `Dproducts.html`: OK.
- Recherche dans `DvendorProducts.html`:
  - `Uploader un fichier digital`: absent.
  - `uploadDigitalProductBtn`: absent.
  - `uploadDigitalProductFile`: absent.
  - `uploadStorageFile`: absent.
  - `Lien de telechargement digital`: present.
- Recherche dans `Dproducts.html` dashboard:
  - `uploadDigitalProductBtn`: absent.
  - `uploadDigitalProductFile`: absent.
  - `uploadStorageFile`: absent.

Verification live:

- URL testee:

```text
https://smartcutservices.com/DvendorProducts.html?v=1779715973
```

- Status: `200`
- `Uploader un fichier digital`: absent
- `uploadDigitalProductBtn`: absent
- `uploadDigitalProductFile`: absent
- `Lien de telechargement digital`: present

Commits:

- Site:
  - Commit: `47d202e20bb838f1dbf59a9aff88aab439a6816b`
  - Message: `Remove digital file upload from vendor products`
- Dashboard:
  - Commit: `1395afd9f261cb6a476f571b472b43de636a433d`
  - Message: `Remove digital file upload from products dashboard`

Push:

- Site repo pousse sur `main`.
- Dashboard repo pousse sur `main`.
- Le push dashboard a d'abord echoue parce que la mauvaise cle SSH a ete utilisee.
- Correction: push relance avec la cle dashboard:

```text
C:\Users\tleov\.ssh\id_ed25519_dashboard_repo_v2
```

- Resultat final: push dashboard reussi.

Point a ne pas oublier:

- Ne pas remettre un upload direct de fichier digital dans Firebase Storage.
- Si un jour Smart Cut veut heberger des fichiers digitaux, il faudra d'abord creer une vraie politique de securite:
  - scan antivirus,
  - limite stricte de stockage,
  - verification du type MIME,
  - moderation admin,
  - regles Firebase Storage dediees,
  - nettoyage automatique des fichiers abandonnes.
- Pour le moment, la bonne logique est:

```text
Vendeur colle un lien externe -> Smart Cut sauvegarde le lien -> Client recoit le lien apres paiement.
```

## Verification checklist livraison multi-vendeurs et delai par zone

Date:

- 2026-05-25

Contexte:

- Avant de tester tout le site a fond, une verification a ete demandee sur trois points critiques:
  - Produit Smart Cut doit suivre les memes regles de livraison que les produits vendeurs.
  - Si un client achete chez plusieurs vendeurs, chaque vendeur doit recevoir sa notification et voir seulement sa partie de commande.
  - Le delai de livraison ne doit pas etre global au produit: il doit etre defini par zone de livraison.

### 1. Produit Smart Cut avec meme logique livraison que vendeur

Statut:

- OK cote code.

Ce qui existe maintenant:

- `checkout.js` utilise `getProductDeliveryGroups()` pour tous les produits physiques.
- Cette logique inclut:
  - produits Smart Cut,
  - produits vendeurs.
- Les produits digitaux sont exclus de cette validation de livraison physique.
- Un produit Smart Cut sans zone compatible avec l'adresse client est bloque comme un produit vendeur.
- Le message cote checkout utilise la meme logique:

```text
Livraison indisponible a [Commune].
```

- Le bouton de suppression checkout reste disponible via:

```text
data-remove-unavailable-item
removeUnavailableCartItem()
```

Fichiers concernes:

- `checkout.js`
- `functions/index.js`

Backend:

- `functions/index.js` utilise `buildServerProductDeliveryDetails()`.
- Cette fonction valide maintenant tous les produits physiques:
  - ownerType `smartcut`
  - ownerType `vendor`
- Si la zone ne correspond pas, `createMoncashPayment` refuse le paiement avec `product-delivery-unavailable`.

Conclusion:

- Smart Cut n'a plus une livraison gratuite/nationale automatique pour les produits physiques.
- Les produits Smart Cut doivent avoir leurs propres zones, prix et delais comme les produits vendeur.

### 2. Commandes et notifications separees par vendeur

Statut:

- OK cote code.

Ce qui existe maintenant:

- `functions/index.js` contient `buildVendorOrderNotifications()`.
- Cette fonction groupe les items par `vendorId`.
- Chaque vendeur recoit une notification separee:

```text
type: vendor-order
target: user
targetUid: vendorId
```

Exemple attendu:

- Client achete:
  - 1 produit Smart Cut
  - 1 produit Leo Store
- Leo Store recoit une notification pour ses articles seulement.
- Smart Cut garde la commande admin pour ses propres produits.
- Le dashboard vendeur filtre les commandes avec le contexte vendeur.
- Les montants vendeur/payout restent calcules par vendeur.

Fonctions importantes:

- `buildVendorOrderNotifications()`
- `getRelevantVendorOrderContext()`
- `collectVendorOutstandingOrders()`
- `getVendorDashboardOrders`
- `getVendorDashboardAnalytics`

Conclusion:

- La logique multi-vendeurs est deja en place cote code.
- Ce point reste a confirmer par un test reel complet avec deux vendeurs differents dans un meme panier.

### 3. Delai de livraison par zone

Statut avant correction:

- Pas OK.

Probleme:

- Le delai etait global au produit via `deliveryDelay`.
- Cela ne respecte pas la vraie logique terrain, parce que chaque commune/departement peut avoir un delai different.

Correction appliquee:

- Ajout d'un champ `Delai` dans chaque ligne de zone de livraison.
- Chaque zone contient maintenant:

```text
country
department
commune
fee
deliveryDelay
```

Fichiers modifies:

- Site vendeur:
  - `DvendorProducts.html`
- Dashboard admin produits:
  - `C:\Users\tleov\Music\dashboard-\Dproducts.html`
- Checkout:
  - `checkout.js`
- Backend:
  - `functions/index.js`

Details frontend:

- Dans l'onglet `Livraison`, chaque zone affiche maintenant:
  - Pays
  - Departement
  - Commune
  - Prix HTG
  - Delai
  - Retirer
- Le checkout affiche maintenant le delai de la zone trouvee:

```text
Livraison Delmas: 500 HTG - Delai: 24-48h
```

- Si une ancienne zone n'a pas encore de delai, le systeme garde un fallback sur `product.deliveryDelay`.

Details backend:

- `normalizeDeliveryZoneList()` conserve maintenant `deliveryDelay`.
- `findProductDeliveryZoneForAddress()` retourne aussi le delai de la zone.
- `buildServerProductDeliveryDetails()` sauvegarde maintenant le delai de la zone dans `delivery.productDeliveryDetails`.

Regle finale:

- Le delai exact vient de la zone qui correspond a l'adresse client.
- Le delai global produit est seulement un fallback legacy.

Verification technique:

- `node --check checkout.js`: OK.
- `node --check functions/index.js`: OK.
- Syntax check script module `DvendorProducts.html`: OK.
- Syntax check script module dashboard `Dproducts.html`: OK.

Commits:

- Site:
  - Commit: `ba35b09c73fd51a73a70859f1bb65db949cb21ef`
  - Message: `Add per-zone delivery delays`
- Dashboard:
  - Commit: `9976485aa557630cdcae1bedf3cf4181e28a7113`
  - Message: `Add per-zone delivery delays to products dashboard`

Push:

- Site repo pousse sur `main`: OK.
- Dashboard repo pousse sur `main`: OK.

Verification live statique:

- `https://smartcutservices.com/DvendorProducts.html`
  - Status: `200`
  - Champ `data-product-zone-field="deliveryDelay"` present.
- `https://smartcutservices.com/checkout.js`
  - Status: `200`
  - Logique `zone.deliveryDelay` presente.

Deploy backend - premiere tentative:

- Tentative de deploy:

```text
firebase deploy --only functions:createMoncashPayment --project smartcutservices-9ce54
```

- Resultat: bloque.
- Cause:

```text
Authentication Error: Your credentials are no longer valid.
Please run firebase login --reauth
```

Impact premiere tentative:

- Les fichiers statiques du site et du dashboard sont deja a jour.
- Le frontend peut deja afficher/sauvegarder le delai par zone.
- Le checkout frontend peut deja lire le delai de la zone.
- Par contre, `createMoncashPayment` doit etre redeploye apres re-auth Firebase pour que le backend conserve aussi officiellement `deliveryDelay` depuis la zone dans `delivery.productDeliveryDetails`.

Action restante:

- Reconnecter Firebase sur la machine:

```text
firebase login --reauth
```

- Puis redeployer:

```text
firebase deploy --only functions:createMoncashPayment --project smartcutservices-9ce54
```

Deploy backend - deuxieme tentative:

- Reessai effectue apres reconnexion.
- Resultat: deploy reussi.
- Function mise a jour:

```text
createMoncashPayment(us-central1)
```

- URL Cloud Run retournee par Firebase:

```text
https://createmoncashpayment-accv2sw5iq-uc.a.run.app
```

- Message Firebase:

```text
Deploy complete!
```

Conclusion backend:

- Le backend `createMoncashPayment` connait maintenant la logique `deliveryDelay` par zone.
- Le paiement MonCash valide toujours les zones physiques avant de lancer le paiement.
- Les details livraison sauvegardes peuvent maintenant inclure le delai exact de la zone matchant l'adresse client.

## Correctif supplementaire - Produit digital ne demande jamais de zone

Date:

- 2026-05-25

Probleme constate:

- Lors de la creation d'un produit digital, l'interface pouvait encore demander:

```text
Ajoutez au moins une zone de livraison pour ce produit.
```

- Cela arrivait si le vendeur/admin allait dans l'onglet `Digital` ou collait un lien digital, mais que la checkbox `Article digital` n'etait pas encore cochee.
- Le systeme considerait alors encore le produit comme un produit physique.

Regle corrigee:

- Un produit digital ne doit jamais demander de zone de livraison.
- Un produit digital est:
  - disponible partout,
  - livraison gratuite,
  - livraison instantanee,
  - poids `0 g`,
  - sans zone physique.

Correction appliquee:

- Quand l'utilisateur ouvre l'onglet `Digital`, la checkbox `Article digital` s'active automatiquement.
- Quand un lien digital est renseigne, le produit est considere digital au moment de sauvegarder, meme si la checkbox n'avait pas ete cochee manuellement.
- Si le produit est digital mais sans lien, l'interface demande le lien de telechargement, pas une zone de livraison.

Fichiers modifies:

- `DvendorProducts.html`
- `C:\Users\tleov\Music\dashboard-\Dproducts.html`

Details techniques:

- Calcul de `isDigitalProduct` mis a jour:

```text
checkbox Article digital cochee OU lien digital present
```

- Ouverture de l'onglet `Digital`:

```text
isDigitalProduct.checked = true
updateDigitalProductUi()
```

- Validation finale:
  - Si digital et pas de lien: demander le lien.
  - Si digital et lien present: sauvegarder sans zone.
  - Si physique et pas de zone: demander zone de livraison.

Verification technique:

- Syntax check script module `DvendorProducts.html`: OK.

## 2026-05-25 - Commandes multi-vendeurs et notifications vendeur

Objectif:

- Quand un client achete des produits de plusieurs vendeurs dans une meme commande, chaque vendeur doit voir uniquement la partie de commande qui le concerne.
- Chaque vendeur doit recevoir une notification quand une commande contient ses produits.
- Smart Cut et les vendeurs externes doivent pouvoir gerer leur livraison separement, sans melanger les produits ni les suivis.

Ce qui existe cote backend:

- `functions/index.js` contient deja `buildVendorOrderNotifications(order, sessionId)`.
- Cette fonction groupe les articles par `vendorId`.
- Pour chaque vendeur trouve dans la commande, elle cree une notification separee dans `notificationBroadcasts`.
- Chaque notification contient:
  - `type: vendor-order`,
  - `target: user`,
  - `targetUid: vendorId`,
  - les informations de commande,
  - les articles appartenant uniquement a ce vendeur,
  - l'URL du dashboard vendeur.

Ce qui existe cote dashboard vendeur:

- `getVendorDashboardOrders` filtre les commandes par vendeur connecte.
- `getRelevantVendorOrderContext` reconstruit la partie de commande propre au vendeur:
  - articles du vendeur,
  - livraison du vendeur,
  - commission du vendeur,
  - net vendeur.
- Le dashboard vendeur ne doit donc pas afficher les articles d'un autre store.

Correction appliquee cote notification:

- Ajout d'une carte dans `DvendorProducts.html`:

```text
Notifications commandes vendeur
Activer les notifications
```

- Le vendeur doit cliquer sur ce bouton depuis son telephone ou son navigateur.
- Le navigateur demande alors la permission de notification.
- Si le vendeur accepte, on sauvegarde:

```text
smartcut_vendor_order_notif_enabled = 1
```

- Les notifications vendeur utilisent maintenant uniquement les broadcasts de type commande vendeur.
- Les notifications de nouveaux produits sont desactivees dans le dashboard vendeur pour eviter de melanger les alertes.

Fichiers modifies:

- `DvendorProducts.html`
- `notification.js`
- `dashboard-/DvendorProducts.html`
- `dashboard-/notification.js`

Important:

- Sur telephone, une notification navigateur/PWA ne peut pas etre forcee sans action utilisateur.
- Le vendeur doit donc ouvrir son dashboard vendeur une fois, cliquer sur `Activer les notifications`, puis accepter la permission du navigateur.
- Ensuite, quand une commande payee contient ses produits, il recoit une notification vendeur.

Verification technique:

- Syntax check `notification.js`: OK.
- Syntax check `dashboard-/notification.js`: OK.
- Syntax check script module `DvendorProducts.html`: OK.
- Syntax check script module `dashboard-/DvendorProducts.html`: OK.
- Syntax check `functions/index.js`: OK.

## Correctif UX - Produit digital sans stock + bouton Smart Cut

Date:

- 2026-05-25

Demande:

- Retirer la notion de stock pour les produits digitaux.
- Garder le module `Upload Produit Digital` separe pour les vendeurs.
- Ajouter le meme principe dans le dashboard Smart Cut admin, dans la zone sidebar du module produits.

Pourquoi:

- Un produit digital est un lien de telechargement, pas un article physique.
- Il ne doit pas avoir de stock.
- Le flow digital doit rester separe du flow produit physique pour eviter les conflits avec livraison, variations et stock.

Correction appliquee cote vendeur:

- Dans `DvendorProducts.html`, quand le produit est digital, le champ `Stock total` est masque.
- Dans la liste des produits vendeur, un produit digital affiche `Produit digital` a la place de `Stock: X`.
- Le flow vendeur garde le bouton dedie `Upload Produit Digital`.

Correction appliquee cote Smart Cut admin:

- Dans `Dproducts.html` du dashboard admin, le bouton sidebar `Upload Produit Digital` ouvre maintenant un vrai flow digital dedie.
- Le bouton `+ Nouveau produit` reste reserve au produit physique.
- Flow Smart Cut physique:
  - General,
  - Livraison,
  - Categorie & attributs,
  - Variations,
  - Galerie.
- Flow Smart Cut digital:
  - General,
  - Digital,
  - Galerie.
- Les tabs Livraison, Categorie & attributs et Variations sont caches dans le flow digital.
- Lorsqu'un ancien produit digital Smart Cut est modifie, il rouvre automatiquement dans le flow digital.
- Lorsqu'un produit physique Smart Cut est modifie, il rouvre automatiquement dans le flow physique.
- Dans le dashboard Smart Cut, le champ `Stock total` est masque pour les produits digitaux.
- Dans la liste des produits Smart Cut, un produit digital affiche `Produit digital` a la place de `Stock: X`.

Verification technique:

- Syntax check script module `DvendorProducts.html`: OK.
- Syntax check script module dashboard `Dproducts.html`: OK.
- Aucun deploiement Firebase requis, car il s'agit d'une correction frontend/dashboard.

## Correctif panier - Produit digital bloque par stock 0

Date:

- 2026-05-25

Probleme observe:

- Un produit digital ajoute depuis le dashboard vendeur apparaissait correctement comme `Article digital - livraison instantanee`.
- Mais dans la modal produit, la quantite restait a `0`.
- Le message affiche etait:

```text
Stock deja atteint dans le panier
```

- Le bouton `Ajouter au panier` etait desactive.

Cause exacte:

- Pour un produit digital, le dashboard sauvegarde volontairement `stock: null`.
- Dans la modal produit, la fonction de calcul de stock faisait `Number(null)`, ce qui donne `0`.
- Le systeme croyait donc que le produit digital avait un stock de zero.
- Cela appliquait une regle de produit physique sur un produit numerique.

Correction appliquee:

- Dans `product-modal.js`, si `product.isDigitalProduct === true`, le stock disponible est considere comme illimite.
- Dans `cart.js`, si `item.isDigitalProduct === true`, le panier ignore la limite de stock.
- Dans `products.js`, le quick-add transmet maintenant les informations digitales:
  - `isDigitalProduct`,
  - `digitalDownloadLink`,
  - `deliveryDelay`.
- Les produits digitaux ne sont donc plus bloques par `stock: null` ou `stock: 0`.

Cache/version:

- `ASSET_VERSION` du site passe a `20260525-2`.
- Les imports internes de `cart.js` et `product-modal.js` passent a `20260525-2`.
- Objectif: forcer les navigateurs a prendre la nouvelle logique au lieu d'une ancienne version en cache.

Verification technique:

- `node --check product-modal.js`: OK.
- `node --check cart.js`: OK.
- `node --check products.js`: OK.
- `node --check product-page.js`: OK.
- `node --check header.js`: OK.
- `node --check profile-panel.js`: OK.

## Correctif commission - Categorie obligatoire pour produit digital

Date:

- 2026-05-25

Probleme observe:

- Un produit digital vendeur arrivait dans le dashboard admin avec:
  - `Categorie non definie`,
  - `Stock 0`,
  - commission `A definir`,
  - source commission: `Aucune regle de categorie trouvee`.

Cause exacte:

- On avait separe le flow `Upload Produit Digital` pour eviter les conflits avec livraison, stock et variations.
- Mais on avait aussi cache le tab `Categorie & attributs`.
- Sans categorie, le dashboard admin ne pouvait pas retrouver la regle de commission liee a la categorie du produit.

Correction appliquee:

- Le flow digital vendeur affiche maintenant:
  - General,
  - Digital,
  - Categorie & attributs,
  - Galerie.
- Le flow digital Smart Cut admin affiche aussi:
  - General,
  - Digital,
  - Categorie & attributs,
  - Galerie.
- Les tabs qui restent caches pour digital:
  - Livraison,
  - Variations.
- A l'enregistrement d'un produit digital vendeur, si aucune categorie n'est choisie, le systeme bloque la sauvegarde et renvoie vers `Categorie & attributs`.
- A l'enregistrement d'un produit digital Smart Cut, si aucune categorie n'est choisie, le systeme bloque la sauvegarde et renvoie vers `Categorie & attributs`.
- Dans le dashboard admin de revue vendeur, le stock des produits digitaux affiche maintenant `Produit digital` au lieu de `0`.
- `dashboard-vendors.html` importe maintenant `vendors-dashboard.js?v=20260525-1` pour eviter que le navigateur garde l'ancien JS en cache.

Verification technique:

- Syntax check script module `DvendorProducts.html`: OK.
- Syntax check script module dashboard `Dproducts.html`: OK.
- `node --check vendors-dashboard.js`: OK.

## Correctif orthographe/encoding - Panier et profil

Date:

- 2026-05-25

Probleme observe:

- Dans le panier mobile, le bouton checkout affichait:

```text
ProcÃ©der au paiement
```

- Ce texte devait afficher:

```text
Procéder au paiement
```

Cause:

- Certains textes du site avaient ete sauvegardes avec un mauvais encodage ou etaient deja en mojibake dans les fichiers JS.
- Le navigateur affichait donc les accents sous forme `Ã©`, `Ã¨`, etc.

Correction appliquee:

- Correction des textes visibles du panier dans `cart.js`, notamment:
  - `Procéder au paiement`,
  - `Paiement confirmé`,
  - `Télécharger le reçu`,
  - `Continuer comme invité`,
  - `Panier vidé`,
  - `Découvrir les produits`,
  - statuts de suivi: `Commandé`, `Expédié`, `Livré`.
- Correction de plusieurs textes visibles dans `profile-panel.js`, notamment:
  - `invité`,
  - `déjà`,
  - `passées`,
  - `Déconnexion`,
  - `Vérification`.
- Correction du message stock dans `product-modal.js`:
  - `Stock déjà atteint dans le panier`.

Cache/version:

- `ASSET_VERSION` passe a `20260525-3`.
- Les imports vers `cart.js` passent a `cart.js?v=20260525-3`.
- Objectif: forcer les navigateurs mobiles a charger la nouvelle version.

Verification technique:

- `node --check cart.js`: OK.
- `node --check header.js`: OK.
- `node --check profile-panel.js`: OK.
- `node --check product-modal.js`: OK.
- `node --check products.js`: OK.
- Syntax check script module dashboard `Dproducts.html`: OK.

Tests manuels a faire:

- Creer/modifier un produit Smart Cut avec:
  - Ouest / Delmas / 500 G / 24-48h
  - Nord / Cap-Haitien / 800 G / 3-5 jours
- Creer/modifier un produit vendeur avec deux zones differentes et deux delais differents.
- Se connecter comme client avec adresse `Ouest / Delmas`.
- Verifier que le checkout affiche le prix et le delai de Delmas.
- Changer adresse client vers une commune non couverte.
- Verifier:
  - message `Livraison indisponible a [Commune]`,
  - bouton `Supprimer ce produit`,
  - paiement bloque tant que le produit incompatible reste dans le panier.
- Tester un panier avec deux vendeurs differents pour confirmer:
  - notification vendeur separee,
  - dashboard vendeur separe,
  - montant/payout par vendeur correct.

## Correctif supplementaire - Smart Cut items dans panier sans zones

Date:

- 2026-05-25

Probleme constate:

- Certains produits Smart Cut continuaient a apparaitre comme livrables partout et gratuitement.
- Pourtant la logique checkout/backend exige deja que les produits Smart Cut physiques respectent `deliveryZones/productDeliveryZones`.

Cause probable:

- Des items Smart Cut deja presents dans le panier/localStorage pouvaient ne pas contenir:
  - `deliveryCoverage`
  - `productDeliveryCoverage`
  - `deliveryZones`
  - `productDeliveryZones`
- Le checkout recevait donc un item incomplet.
- Autre facteur important: `cart.js` importait encore `checkout.js` avec un ancien cache key:

```text
checkout.js?v=20260524-7
```

- Sur certains navigateurs, cela peut garder une ancienne version du checkout en cache.

Correction appliquee:

- Ajout d'une rehydratation dans `checkout.js`.
- Avant de charger/calcule la livraison, checkout inspecte les items physiques du panier.
- Si un item n'a pas ses zones de livraison, checkout recharge le produit depuis Firestore:
  - collection `products` pour Smart Cut,
  - collection `vendorProducts` pour vendeur.
- Les champs recharges sont reinjectes dans l'item du checkout:

```text
deliveryCoverage
productDeliveryCoverage
deliveryZones
productDeliveryZones
vendorDeliveryCoverage
vendorDeliveryZones
weightGrams
deliveryDelay
isDigitalProduct
digitalDownloadLink
```

Fichiers modifies:

- `checkout.js`
- `cart.js`
- `product-modal.js`
- `products.js`

Nouvelles fonctions dans `checkout.js`:

- `getCartProductCollection(item)`
- `needsDeliveryHydration(item)`
- `enrichCartDeliveryData()`

Cache busting:

- `cart.js` importe maintenant:

```text
checkout.js?v=20260525-1
```

- `product-modal.js` et `products.js` importent maintenant:

```text
cart.js?v=20260525-1
```

- `cart.js` importe maintenant:

```text
product-modal.js?v=20260525-1
```

Resultat attendu:

- Meme si le panier contient un ancien produit Smart Cut sans zones, checkout va recharger les zones depuis Firestore.
- Si le produit Smart Cut a une zone correspondant a l'adresse client:
  - le prix de livraison et le delai de cette zone s'appliquent.
- Si le produit Smart Cut n'a pas de zone correspondant a l'adresse client:
  - message `Livraison indisponible a [Commune]`,
  - bouton `Retirer ce produit`,
  - paiement bloque tant que l'item incompatible reste dans le panier.

Verification technique:

- `node --check checkout.js`: OK.
- `node --check cart.js`: OK.
- `node --check product-modal.js`: OK.
- `node --check products.js`: OK.

## Correctif supplementaire - Regles finales pour produits digitaux

Date:

- 2026-05-25

Demande:

- Lorsqu'un vendeur/admin cree un produit digital, il doit pouvoir renseigner:
  - Photos,
  - Description,
  - Lien de telechargement,
  - Prix,
  - Prix barre,
  - Discount,
  - Delai de livraison instantane.

Regles produit digital:

- Pas de stock.
- Pas de decrement de stock apres achat.
- Pas de zone de livraison.
- Livraison gratuite.
- Livraison instantanee.
- Disponible partout, peu importe l'adresse du client.
- Le client recoit le lien manuel `digitalDownloadLink` apres paiement confirme.
- Aucun fichier digital n'est stocke dans Firebase Storage.

Regles photo:

- Les photos se gerent dans l'onglet `Galerie`.
- Maximum 3 photos pour un produit digital.
- Chaque photo uploadée ne doit pas depasser 1 Mo.
- Les URLs manuelles restent possibles, mais le total reste limite a 3 images.

Fichiers modifies:

- Site vendeur:
  - `DvendorProducts.html`
- Dashboard admin:
  - `C:\Users\tleov\Music\dashboard-\Dproducts.html`
- Backend:
  - `functions/index.js`

Details frontend:

- Ajout d'une note dans l'onglet Digital:

```text
Photos du produit digital
Ajoutez les photos dans l'onglet Galerie. Maximum 3 photos, 1 Mo par photo.
```

- Ajout de la validation:

```text
Produit digital: maximum 3 photos.
Produit digital: "[nom fichier]" depasse 1 Mo.
```

- Lors de la sauvegarde d'un produit digital:
  - `stock` est mis a `null`,
  - `variations` est vide,
  - `images` est limite a 3,
  - `weightGrams` est `0`,
  - `deliveryCoverage.mode` est `digital`,
  - `deliveryZones` et `productDeliveryZones` sont vides,
  - `deliveryDelay` est `Instantanee`.

Details backend:

- `decrementInventoryForItems()` ignore maintenant les produits digitaux.
- Cela evite de retirer du stock sur un produit numerique.

Verification technique:

- Syntax check `DvendorProducts.html`: OK.
- Syntax check dashboard `Dproducts.html`: OK.
- `node --check functions/index.js`: OK.
- `node --check checkout.js`: OK.

## Correctif UX - Bouton dedie Upload Produit Digital

Date:

- 2026-05-25

Demande:

- Retirer la logique produit digital du flow normal `Ajouter un produit`.
- Ajouter une entree separee dans la sidebar vendeur:

```text
Upload Produit Digital
```

Raison:

- Le produit digital a une logique differente du produit physique.
- Il ne doit pas influencer les tabs livraison/variations/stock des produits physiques.
- Le vendeur doit comprendre clairement qu'il est dans un mode digital uniquement.

Correction appliquee:

- Ajout d'un bouton sidebar dans `DvendorProducts.html`:

```text
Upload Produit Digital
```

- Le bouton ouvre un formulaire dedie avec le titre:

```text
Upload Produit Digital
```

- Flow produit physique:
  - bouton `Ajouter un produit`,
  - tabs visibles:
    - General,
    - Livraison,
    - Categorie & attributs,
    - Variations,
    - Galerie,
  - tab `Digital` cache.

- Flow produit digital:
  - bouton sidebar `Upload Produit Digital`,
  - tabs visibles:
    - General,
    - Digital,
    - Galerie,
  - tabs caches:
    - Livraison,
    - Categorie & attributs,
    - Variations.

- Lorsqu'un produit digital existant est modifie, il rouvre automatiquement dans le flow digital.
- Lorsqu'un produit physique existant est modifie, il rouvre automatiquement dans le flow physique.

Fonctions ajoutees/modifiees:

- `newDigitalProduct()`
- `setEditorMode(mode)`
- `switchEditorTab(tabName)`
- `editProduct(id)`

Verification technique:

- Syntax check script module `DvendorProducts.html`: OK.
