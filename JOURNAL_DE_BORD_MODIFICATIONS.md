# Journal de bord des modifications

Date: 18 mai 2026

Ce fichier documente les modifications faites localement sur le site Smart Cut Services. Rien n'a ete pousse sur GitHub pour le moment, afin de permettre un test complet avant publication.

## Contexte

L'objectif de cette intervention etait de remplacer l'ancien champ `age` du formulaire de creation de compte par une vraie `date de naissance`, puis d'ajouter une gestion plus complete des informations client et des adresses de livraison.

Les fichiers modifies sont:

- `auth.js`
- `checkout.js`
- `.tmp-main-cleancopy/auth.js`
- `.tmp-main-cleancopy/checkout.js`

Les fichiers racine et les fichiers dans `.tmp-main-cleancopy` ont ete synchronises pour que le test local utilise le meme code.

## Modification du formulaire de creation de compte

L'ancien formulaire demandait notamment:

- Nom complet
- Age
- Numero telephone
- Sexe
- Email
- Mot de passe

Le nouveau formulaire demande maintenant:

- Nom obligatoire
- Prenom obligatoire
- Date de naissance obligatoire
- Telephone obligatoire
- Email obligatoire
- Mot de passe obligatoire
- Confirmation du mot de passe obligatoire

Le champ `age` n'est plus utilise pour les nouveaux comptes. La date de naissance est sauvegardee dans le profil client avec la propriete `birthDate`.

Le champ `sexe` n'est plus requis dans le nouveau parcours de creation de compte.

## Validation du mot de passe

Un champ de confirmation de mot de passe a ete ajoute.

Avant de creer le compte Firebase, le site verifie maintenant que:

- Le mot de passe est rempli.
- La confirmation est remplie.
- Les deux valeurs correspondent.

Si les mots de passe ne correspondent pas, la creation du compte est bloquee et un message d'erreur est affiche a l'utilisateur.

## Nouvelles informations client sauvegardees

Lorsqu'un client cree un compte, les informations suivantes sont maintenant sauvegardees dans Firestore, dans le document `clients/{uid}`:

- `uid`
- `firstName`
- `lastName`
- `name`
- `email`
- `birthDate`
- `phone`
- `addresses`
- `defaultDeliveryAddressId`
- `address`
- `country`
- `department`
- `commune`
- `city`
- `createdAt`
- `updatedAt`

La propriete `name` reste presente pour garder la compatibilite avec les parties du site ou du dashboard qui utilisent encore le nom complet.

Les anciennes proprietes `address` et `city` restent aussi alimentees a partir de l'adresse principale, afin d'eviter de casser les anciennes logiques qui lisent encore ces champs.

## Gestion des adresses au moment de l'inscription

Un bloc `Adresse` a ete ajoute dans le formulaire de creation de compte.

Il contient:

- Adresse obligatoire
- Pays obligatoire
- Departement obligatoire
- Commune obligatoire
- Case a cocher: `Utiliser cette adresse comme adresse de livraison`

Pour le moment, le pays est limite a `Haiti`, comme demande.

La liste des departements d'Haiti a ete ajoutee directement dans `auth.js`.

Quand l'utilisateur choisit un departement, la liste des communes est mise a jour automatiquement selon le departement choisi.

## Structure des adresses sauvegardees

Les adresses sont sauvegardees dans un tableau `addresses`.

Chaque adresse contient:

- `id`
- `label`
- `address`
- `country`
- `department`
- `commune`
- `isDelivery`
- `createdAt`

Exemple de structure:

```js
{
  id: "addr_xxxxx",
  label: "Adresse principale",
  address: "Rue exemple",
  country: "Haiti",
  department: "Ouest",
  commune: "Delmas",
  isDelivery: true,
  createdAt: "2026-05-18T..."
}
```

## Compatibilite avec les comptes Google

Le parcours Google a aussi ete ajuste.

Avant, le site demandait:

- Age
- Sexe
- Telephone

Maintenant, si un profil Google est incomplet, le site demande:

- Nom
- Prenom
- Date de naissance
- Telephone
- Adresse
- Pays
- Departement
- Commune
- Option pour utiliser cette adresse comme adresse de livraison

Cela evite d'avoir des profils Google sans les informations necessaires pour livrer une commande.

## Gestion des adresses dans le checkout

Le checkout a ete modifie pour lire les adresses deja sauvegardees sur le compte client.

Si le client possede deja une ou plusieurs adresses dans `client.addresses`, le checkout affiche un select `Adresse enregistree`.

Le client peut alors:

- Choisir une adresse deja sauvegardee.
- Choisir `Ajouter une nouvelle adresse`.

Quand une adresse sauvegardee est choisie, le checkout remplit automatiquement:

- L'adresse
- Le departement
- La commune
- Le telephone si disponible
- Le WhatsApp si disponible

## Ajout d'une nouvelle adresse pendant l'achat

Si le client ajoute une nouvelle adresse pendant l'achat, le site sauvegarde cette adresse dans le document `clients/{uid}` avant d'ouvrir la modal de paiement.

La nouvelle adresse est ajoutee au tableau `addresses`.

Le site evite aussi de sauvegarder deux fois la meme adresse si elle existe deja avec la meme adresse, le meme departement et la meme commune.

## Donnees de livraison envoyees au paiement

Le payload de livraison contient maintenant plus d'informations.

Avant, il envoyait principalement:

- Methode de livraison
- Adresse
- Telephone
- WhatsApp
- Zone
- Frais

Maintenant, il inclut aussi:

- `savedAddressId`
- `country`
- `department`
- `commune`

Cela permettra au paiement, aux commandes, au dashboard et aux PDF d'avoir une adresse plus propre et plus structuree.

## Validation du checkout

Pour une livraison a domicile, le checkout verifie maintenant:

- Qu'une zone de livraison est selectionnee.
- Qu'une adresse est saisie.
- Qu'un departement est choisi.
- Qu'une commune est choisie.
- Que le numero de telephone est valide.
- Que le numero WhatsApp est valide.

Si une de ces informations manque, le paiement ne s'ouvre pas.

## Synchronisation des fichiers

Les modifications ont d'abord ete faites dans:

- `.tmp-main-cleancopy/auth.js`
- `.tmp-main-cleancopy/checkout.js`

Ensuite, les fichiers ont ete copies vers la racine:

- `auth.js`
- `checkout.js`

Cela garantit que le test local depuis `C:\Users\tleov\Music\rendu` utilise les nouvelles modifications.

## Verification technique effectuee

Les commandes suivantes ont ete executees pour verifier que les fichiers JavaScript n'ont pas d'erreur de syntaxe:

```powershell
node --check auth.js
node --check checkout.js
```

Resultat:

- `auth.js` passe sans erreur de syntaxe.
- `checkout.js` passe sans erreur de syntaxe.

## Etat GitHub

Aucun push GitHub n'a ete fait.

Le but est que les modifications soient testees localement avant publication.

## Points importants a tester

Avant push ou deploiement, il faut tester:

- Creation d'un compte avec email et mot de passe.
- Verification que `Nom`, `Prenom`, `Date de naissance`, `Telephone` sont bien sauvegardes dans Firestore.
- Verification que l'adresse est sauvegardee dans `addresses`.
- Verification que `address`, `city`, `department`, `commune` sont aussi bien remplis.
- Connexion avec Google pour un profil incomplet.
- Affichage des adresses sauvegardees dans le checkout.
- Selection d'une adresse sauvegardee dans le checkout.
- Ajout d'une nouvelle adresse pendant l'achat.
- Verification que la nouvelle adresse est sauvegardee sur le compte client.
- Passage au paiement avec une adresse sauvegardee.
- Passage au paiement avec une nouvelle adresse.

## Note

Cette intervention concerne uniquement la partie locale du site. Elle ne modifie pas encore les rules Firebase, les fonctions cloud, ni le dashboard.

## Mise a jour livraison vendeurs

Date: 18 mai 2026

Une nouvelle intervention a ete ajoutee pour changer la responsabilite de livraison des vendeurs.

Objectif business:

- Smart Cut Services ne prend plus la responsabilite de livrer les produits vendeurs.
- Un vendeur gere lui-meme ses livraisons.
- Un vendeur choisit les zones ou il accepte de livrer.
- Un vendeur definit lui-meme les frais de livraison pour ces zones.
- Le client paie ces frais directement au checkout.
- Les frais de poids restent additionnes au prix de livraison.

Fichiers modifies:

- `vendor-application.js`
- `vendor-marketplace.js`
- `checkout.js`
- `cart.js`
- `DvendorProducts.html`
- `.tmp-main-cleancopy/vendor-application.js`
- `.tmp-main-cleancopy/vendor-marketplace.js`
- `.tmp-main-cleancopy/checkout.js`
- `.tmp-main-cleancopy/cart.js`
- `.tmp-main-cleancopy/DvendorProducts.html`
- `.tmp-dashboard-sync/vendors-dashboard.js`
- `.tmp-dashboard-sync/DvendorProducts.html`

### Formulaire de candidature vendeur

Dans le formulaire de candidature vendeur, les options suivantes ont ete retirees:

- `Smart Cut gere la livraison`
- `A definir`

Il reste uniquement:

- `Le vendeur gere la livraison`

Le code force aussi cette valeur dans le payload, meme si une ancienne configuration Firestore contenait encore les anciennes options.

### Zones de livraison vendeur

Le formulaire vendeur contient maintenant une section `Zones et prix de livraison`.

Le vendeur peut choisir:

- `Je veux livrer mes produits sur tout le territoire national`
- Ou ajouter des zones specifiques

Si le vendeur choisit tout le territoire national, il doit aussi indiquer un prix de livraison nationale.

Pour chaque zone specifique, le vendeur doit definir:

- Pays
- Departement
- Commune
- Prix de livraison

Pour le moment, le pays est limite a `Haiti`.

Le vendeur peut ajouter plusieurs zones de livraison.

Exemple:

```text
Pays: Haiti
Departement: Ouest
Commune: Delmas
Livraison: 500 HTG
```

Les donnees sont sauvegardees dans la candidature avec:

- `deliveryCoverage`
- `deliveryZones`
- `nationwideFee` lorsque le vendeur livre sur tout le territoire national

### Dashboard admin vendeurs

Dans `.tmp-dashboard-sync/vendors-dashboard.js`, le formulaire admin vendeur a ete ajuste pour ne garder que `Le vendeur gere la livraison`.

Quand une candidature vendeur est approuvee, le profil vendeur cree dans `vendors/{vendorId}` garde maintenant:

- `deliveryMode`
- `deliveryCoverage`
- `deliveryZones`

Cela permet au site et au checkout de connaitre les zones et prix de livraison du vendeur.

### Dashboard vendeur produits

Quand un vendeur cree ou modifie un produit dans `DvendorProducts.html`, le produit sauvegarde maintenant aussi:

- `deliveryCoverage`
- `deliveryZones`

Cela permet aux produits vendeurs dans la marketplace de transporter les informations de livraison jusqu'au panier.

### Marketplace vendeur

Quand un produit vendeur est ajoute au panier depuis `vendor-marketplace.js`, le panier recoit maintenant:

- `vendorDeliveryCoverage`
- `vendorDeliveryZones`

Ces donnees restent avec l'article dans le panier et dans la commande.

### Panier et commande

Dans `cart.js`, les items de commande gardent maintenant:

- `vendorDeliveryCoverage`
- `vendorDeliveryZones`

Cela evite de perdre les informations de livraison vendeur entre le panier, le checkout et la sauvegarde de commande.

### Checkout

Le checkout detecte maintenant s'il y a des produits vendeurs dans le panier.

Si le panier contient au moins un produit vendeur:

- Le client ne peut utiliser que `Livraison a domicile`.
- Les options `Retrait en point de vente` et `Par rencontre` ne sont pas disponibles.
- Le vendeur doit livrer dans le departement et la commune choisis par le client.
- Si un vendeur ne livre pas dans cette commune, le paiement est bloque avec un message d'erreur.

Si le panier ne contient que des produits Smart Cut Services:

- Les options Smart Cut restent disponibles selon les reglages existants:
- Livraison a domicile
- Point de livraison
- Rencontre avec livreur

La fonctionnalite `Proposer un lieu` a ete retiree du checkout.

### Calcul des frais de livraison

Pour une livraison a domicile, le checkout calcule maintenant:

- Frais Smart Cut, seulement s'il y a des produits Smart Cut dans le panier.
- Frais vendeur, selon les zones configurees par chaque vendeur.
- Frais de poids, comme avant.

Le total livraison devient donc:

```text
Frais livraison total = frais Smart Cut + frais vendeurs + frais poids
```

Si plusieurs vendeurs sont dans le panier, le checkout additionne le prix de livraison de chaque vendeur concerne.

### Verification technique effectuee

Les fichiers JavaScript suivants ont ete verifies avec `node --check`:

```powershell
node --check vendor-application.js
node --check vendor-marketplace.js
node --check checkout.js
node --check cart.js
node --check .tmp-main-cleancopy/vendor-application.js
node --check .tmp-main-cleancopy/checkout.js
node --check .tmp-dashboard-sync/vendors-dashboard.js
```

Resultat:

- Tous les checks passent sans erreur de syntaxe.

### Etat GitHub

Aucun push GitHub n'a ete fait pour cette mise a jour.

Les modifications sont locales pour test.

## Correctif PDF Dashboard admin coupe en bas

Date: 18 mai 2026

Probleme signale:

- Le PDF de commande telecharge depuis le Dashboard admin etait coupe en bas.
- Le PDF recu par le client etait correct.

Cause identifiee:

- Dans `Dpayment.html`, le PDF admin ecrivait le pied de page a des positions fixes en bas de page.
- Certaines sections, comme les produits, la preuve de paiement ou le message final, pouvaient descendre trop bas avant que le code ajoute une nouvelle page.
- Resultat: le bas du PDF pouvait etre coupe selon la longueur de la commande.

Correctif applique:

- Ajout d'une fonction interne `ensurePdfSpace`.
- Reservation d'une zone de footer en bas de chaque page.
- Ajout automatique d'une nouvelle page avant les sections qui risquent de depasser.
- Le pied de page est maintenant ajoute proprement sur toutes les pages.
- Si le PDF a plusieurs pages, un compteur `Page X/Y` est affiche.

Fichiers mis a jour:

- `.tmp-dashboard-sync/Dpayment.html`
- `C:\Users\tleov\Music\dashboard-\Dpayment.html`

Etat GitHub:

- Aucun push n'a ete fait.

## Mise a jour modal Espace profil

Date: 19 mai 2026

Objectif:

- Ajouter un bouton `Informations personnelles` dans la modal `Espace profil`.
- Quand l'utilisateur clique dessus, cacher le contenu habituel du compte.
- Afficher une vue dediee avec les informations personnelles du client.
- Ajouter une fleche retour en haut pour revenir a la vue normale de l'espace compte.
- Ajouter un bouton pour changer le mot de passe.

Fichier modifie:

- `profile-panel.js`
- `.tmp-main-cleancopy/profile-panel.js`

Informations affichees dans la nouvelle vue:

- Username
- Nom
- Prenom
- Date de naissance
- Email
- Telephone
- Adresse principale
- Nombre d'adresses sauvegardees

Comportement ajoute:

- Le bouton `Informations personnelles` passe la modal en vue personnelle.
- La fleche gauche `Retour` ramene la modal vers la vue compte normale.
- Le bouton `Changer mon mot de passe` envoie un email Firebase de reinitialisation/changement de mot de passe a l'adresse email du compte connecte.

Verification:

```powershell
node --check profile-panel.js
node --check .tmp-main-cleancopy\profile-panel.js
```

Resultat:

- Les deux checks passent sans erreur de syntaxe.

Etat GitHub:

- Aucun push n'a encore ete fait pour cette modification.

## Correctifs et edition des informations personnelles

Date: 19 mai 2026

Probleme signale:

- Dans la vue `Informations personnelles`, les champs `Nom`, `Prenom`, `Date de naissance` ne s'affichaient pas.
- Le nombre d'adresses sauvegardees affichait `0`.

Cause identifiee:

- `profile-panel.js` lisait principalement les donnees depuis `cartManager.currentClient`.
- Dans `cart.js`, quand le client etait recharge depuis Firestore, l'objet `currentClient` etait reconstruit avec seulement quelques champs:
- `name`
- `email`
- `phone`
- `address`
- `city`

Consequence:

- Les champs plus recents comme `firstName`, `lastName`, `birthDate`, `addresses`, `department`, `commune` etaient perdus localement meme s'ils existaient dans Firestore.

Correctifs appliques:

- `cart.js` conserve maintenant tous les champs existants du document client Firestore grace a la preservation de `...existing`.
- `profile-panel.js` charge directement le document `clients/{uid}` depuis Firestore avec `ensureProfileClientLoaded`.
- Quand les informations personnelles sont ouvertes, la vue se recharge apres lecture Firestore pour afficher les donnees les plus completes.
- `profile-panel.js` synchronise aussi `cartManager.currentClient` avec les donnees completes chargees depuis Firestore.

Nouvelle fonctionnalite ajoutee:

- L'utilisateur peut maintenant modifier ses informations personnelles depuis la modal.

Champs modifiables:

- Username
- Nom
- Prenom
- Numero de telephone
- Adresse principale
- Departement
- Commune

Comportement de sauvegarde:

- Les modifications sont sauvegardees dans Firestore dans `clients/{uid}`.
- Le `displayName` Firebase est mis a jour avec le username.
- L'adresse principale est mise a jour dans:
- `address`
- `country`
- `department`
- `commune`
- `city`
- `addresses`
- `defaultDeliveryAddressId`

Details techniques:

- Ajout de `setDoc` dans `profile-panel.js`.
- Ajout de `updateProfile` Firebase Auth dans `profile-panel.js`.
- Ajout d'une liste locale des departements/communes d'Haiti dans `profile-panel.js` pour editer l'adresse proprement.
- Ajout d'un mode edition controle par `isEditingPersonalInfo`.
- Ajout d'un formulaire `profile-personal-form`.
- Ajout du bouton `Modifier mes informations`.
- Ajout du bouton `Annuler`.
- Ajout de la validation des champs obligatoires avant sauvegarde.

Fichiers modifies:

- `profile-panel.js`
- `cart.js`
- `.tmp-main-cleancopy/profile-panel.js`
- `.tmp-main-cleancopy/cart.js`

Verification:

```powershell
node --check profile-panel.js
node --check cart.js
node --check .tmp-main-cleancopy\profile-panel.js
node --check .tmp-main-cleancopy\cart.js
```

Resultat:

- Tous les checks passent sans erreur de syntaxe.

Etat GitHub:

- Aucun push n'a encore ete fait pour ces derniers correctifs.

## Plans vendeur avant candidature

Date: 19 mai 2026

Objectif:

- Avant de voir le formulaire de candidature vendeur, un utilisateur connecte qui n'est pas deja vendeur doit choisir entre deux plans.
- Le choix du plan est sauvegarde avec la candidature.
- L'admin doit pouvoir modifier le prix du Plan PRO a tout moment.

Plans ajoutes:

- `BASIC`
- Gratuit
- Pour tous les vendeurs
- Mise en ligne de 5 produits
- Acces au tableau de bord vendeur
- Gestion des commandes
- Paiement via MonCash / NatCash / Carte bancaire
- Support standard reponse sous 24-48h
- Request payment tous les 30 jours par defaut

- `PRO`
- Prix par defaut: `1750 HTG`
- Payable via MonCash / NatCash
- Pour vendeurs actifs qui veulent plus de visibilite
- Tout du Plan Basic
- Mise en ligne illimitee de produits
- Badge Vendeur Verifie
- Position amelioree dans les recherches
- Paiement via MonCash / NatCash / Carte bancaire
- Statistiques de ventes avancees
- Support prioritaire reponse sous 12h
- Request payment tous les 30 jours par defaut

Fichiers modifies:

- `vendor-application.js`
- `.tmp-main-cleancopy/vendor-application.js`
- `.tmp-dashboard-sync/vendors-dashboard.js`

Donnees sauvegardees avec la candidature:

- `planId`
- `planLabel`
- `planPrice`
- `planCurrency`
- `planPaymentRequired`
- `planPaymentStatus`
- `payoutRequestIntervalDays`

Reglage admin ajoute:

- Collection/document Firestore: `vendorPlanSettings/main`
- `proPrice`
- `currency`
- `payoutDelayDays`

Dans le dashboard admin vendeur, une section permet maintenant de modifier:

- Prix du Plan PRO
- Devise
- Nombre de jours entre chaque request payment

Quand une candidature est approuvee, le profil vendeur dans `vendors/{vendorId}` conserve aussi les informations de plan.

Verification:

```powershell
node --check vendor-application.js
node --check .tmp-main-cleancopy\vendor-application.js
node --check .tmp-dashboard-sync\vendors-dashboard.js
```

Resultat:

- Tous les checks passent sans erreur de syntaxe.

Etat GitHub:

- Aucun push n'a encore ete fait pour cette mise a jour.

## 2026-05-28 - Impression Photo: plusieurs photos avec dimension par photo

Contexte:

- Le module Impression Photo etait encore construit autour d'une seule image.
- La logique demandee ne doit pas utiliser d'intervalle.
- Le client doit pouvoir ajouter plusieurs photos.
- Chaque photo doit avoir sa propre dimension et son propre nombre de tirages.

Changements effectues:

- `printing-photo.js` ne garde plus une seule variable `file`.
- Le module utilise maintenant une liste `photos[]`.
- Le champ upload accepte plusieurs fichiers image avec `multiple`.
- Etape 1:
  - Le client ajoute une ou plusieurs photos.
  - Chaque photo ajoutee apparait dans une liste.
  - Chaque photo peut etre retiree avant validation.
- Etape 2:
  - Le client choisit le type de papier.
  - Chaque photo affiche son propre champ `Dimension`.
  - Chaque photo affiche son propre champ `Nombre de tirages`.
  - Un champ `Tirages par defaut` aide a pre-remplir les nouvelles photos.
- Etape 3:
  - Le recapitulatif affiche une ligne par photo.
  - Le total impression additionne toutes les photos.
  - Les frais de reception impression continuent de s'ajouter au total final.
- A l'ajout au panier:
  - Toutes les photos sont uploadees dans Firebase Storage.
  - L'article panier garde `printingFiles[]` avec `fileName`, `fileUrl`, `storagePath`, `dimension`, `copies`.
  - Les anciennes options `URL fichier` et `Chemin storage` restent presentes pour compatibilite avec les anciens traitements.
- `printing-photo.html` charge maintenant `printing-photo.js?v=20260528-2`.

Verification:

- `node --check printing-photo.js`: OK.

Precautions:

- Ne pas remettre une dimension globale unique pour toutes les photos.
- Ne pas introduire de logique d'intervalle dans Impression Photo.
- Si le dashboard doit nettoyer les fichiers Firebase, il doit lire `printingFiles[]` pour ne pas oublier les photos multiples.

## 2026-05-26 - Nettoyage definitif du formulaire vendeur

Contexte:

- Le formulaire pour devenir vendeur avait accumule trop de champs au fil des iterations: zones de livraison, KYC, champs entreprise, reseaux sociaux et autres informations qui ne doivent plus etre demandees au moment de la candidature.
- La livraison se definit maintenant par produit, pas dans la candidature vendeur.
- Le KYC a ete abandonne pour ce formulaire.

Champs conserves dans `vendor-application.js`:

- `Nom complet`
- `Email`
- `Telephone`
- `Adresse`
- `Ville`
- `Identification` avec options `CIN`, `NIF`, `Licence`, `Passeport`
- `Numero`
- `Nom de la boutique`
- `Banque` avec options `UNIBANK`, `SOGEBANK`, `BNC`, `CAPITAL BANK`, `BUH`
- `Devise` avec options `Gourdes`, `USD`
- `Nom du compte`
- `Numero du compte`
- `Presentation de votre activite`

Changements effectues:

- `mergeRequiredVendorFields()` force maintenant cette liste officielle, meme si l ancienne configuration Firestore contient encore d anciens champs.
- Les anciennes fonctions de zones de livraison de candidature vendeur ont ete retirees de `vendor-application.js`.
- Le payload conserve une livraison par produit par defaut (`mode: per_product`, zones vides) pour rester compatible avec la logique checkout actuelle.
- Le fichier `vendor-application.html` charge maintenant `vendor-application.js?v=20260526-1` pour eviter que le navigateur serve l ancienne version.

Verification:

```powershell
node --check vendor-application.js
```

Resultat:

- Check syntaxe OK.
- Les champs livraison/KYC ne sont plus dans le formulaire vendeur.

## 2026-05-28 - Livraison pour le module Impression

Contexte:

- Les modules impression (`documents`, `photo`, `CAD`) ajoutaient deja des demandes au panier, mais il n'y avait pas de logique claire de reception/livraison.
- La livraison marketplace ne doit pas etre reutilisee telle quelle pour l'impression, car un client peut simplement vouloir imprimer un CV et passer le recuperer dans un point de retrait.
- Le module `grand-format` reste un workflow de devis WhatsApp manuel et n'entre pas dans ce flux panier.

Nouvelle logique:

- Les points de retrait impression sont gratuits.
- L'admin peut ajouter/retirer des points de retrait via le dashboard.
- Chaque point de retrait contient:
  - `Nom du point`
  - `Adresse`
  - `Telephone`
  - `Actif`
- L'admin peut aussi definir des zones de livraison a domicile pour l'impression:
  - `Pays`
  - `Departement`
  - `Commune`
  - `Prix`
  - `Delai`
  - `Actif`
- Les reglages sont stockes dans:

```text
printingDeliverySettings/main
```

Changements cote site:

- Ajout de `printing-delivery-utils.js`.
- Les pages suivantes affichent maintenant un bloc `Reception de votre impression` dans l'etape tarif:
  - `printing-documents.js`
  - `printing-photo.js`
  - `printing-cad.js`
- Le client peut choisir:
  - `Point de retrait gratuit`
  - `Livraison a domicile`
- Si le client est connecte, ses adresses sauvegardees sont proposees pour la livraison domicile.
- Si la zone choisie n'existe pas dans les reglages admin, la livraison domicile est refusee et le client doit choisir un point de retrait.
- Le prix final ajoute:

```text
Total a payer = Total impression + Frais reception
```

Changements panier/checkout:

- Les items impression sont ajoutes avec `sourceType: printing`.
- Le choix de reception est sauvegarde dans `printingDelivery`.
- Les frais de reception sont inclus directement dans le prix de l'item impression.
- `checkout.js` reconnait les items impression et ne leur applique pas la livraison marketplace une deuxieme fois.
- Les options du panier/PDF affichent:
  - Methode de reception
  - Point de retrait ou adresse de livraison
  - Frais reception
  - Total a payer

Fichiers modifies:

- `printing-delivery-utils.js`
- `printing-documents.js`
- `printing-documents.html`
- `printing-photo.js`
- `printing-photo.html`
- `printing-cad.js`
- `printing-cad.html`
- `checkout.js`
- `JOURNAL_DE_BORD_MODIFICATIONS.md`

Verification:

```powershell
node --check printing-delivery-utils.js
node --check printing-documents.js
node --check printing-photo.js
node --check printing-cad.js
node --check checkout.js
```

Precautions:

- Ne pas brancher les items impression sur les zones de livraison produit marketplace, sinon le checkout peut bloquer les commandes inutilement.
- Les frais impression sont calcules avant ajout au panier et doivent rester dans le prix de l'item.
- Si on veut plus tard que le choix reception se fasse dans la modal checkout, il faudra creer un flux checkout dedie a `sourceType: printing`.

## 2026-05-28 - Rules Firestore pour livraison impression

Contexte:

- Le dashboard admin sauvegarde les reglages de reception impression dans `printingDeliverySettings/main`.
- Les pages impression publiques doivent lire ces reglages pour afficher les points de retrait et les zones domicile.
- Sans regle explicite, Firebase peut refuser la lecture publique ou l'ecriture admin selon le contexte.

Changements effectues:

- Ajout d'une regle Firestore explicite pour `printingDeliverySettings/{docId}`.
- Lecture autorisee publiquement pour que les modules impression puissent calculer les options de reception.
- Ecriture reservee aux admins.
- Ajout d'une regle Firestore pour `printingDeletedFiles/{docId}`.
- Lecture/ecriture reservees aux admins pour le suivi des fichiers impression supprimes.

Verification:

- Les rules ont ete modifiees dans `firestore.rules`.

Precaution:

- Pour que cela soit actif sur Firebase, il faut deployer les rules Firestore, pas Firebase Hosting.

## Correction identite client dans dashboard admin et commandes

Date: 19 mai 2026

Objectif:

- Eviter que le nom utilisateur remplace le vrai nom client dans le dashboard admin.
- Afficher les informations du formulaire inscription dans la fiche client admin.
- Faire monter dans les commandes: Nom, Prenom, Email, Adresse.

Cause trouvee:

- `profile-panel.js` sauvegardait `name` avec la valeur du username.
- Le dashboard admin utilisait `client.name` et `order.customerName` avant `firstName` / `lastName`.

Corrections appliquees:

- `profile-panel.js`: `name` redevient `Prenom Nom`; le username est sauvegarde separement dans `username` et `displayName`.
- `cart.js`: les commandes manuelles sauvegardent maintenant `customerFirstName`, `customerLastName`, `customerUsername`.
- `payment.js`: les commandes MonCash et paiements manuels envoient aussi `customerFirstName` et `customerLastName`.
- `functions/index.js`: les commandes MonCash stockent `customerFirstName` et `customerLastName`.
- `Dpayment.html`: la fiche client admin affiche Nom, Prenom, Nom utilisateur, Email, Telephone, Date naissance, Adresse, nombre d adresses, commandes et total depense.
- `Dpayment.html`: la table commandes, details commande et PDF admin utilisent `Nom + Prenom` avant username.
- `dashboard-orders.js`: le module commandes separe utilise aussi `Nom + Prenom`, Email et Adresse reelle.

Verification:

```powershell
node --check cart.js
node --check payment.js
node --check profile-panel.js
node --check functions\index.js
node --check dashboard-orders.js
```

Resultat:

- Les checks passent sans erreur de syntaxe.

Etat GitHub:

- Aucun push n'a encore ete fait pour cette mise a jour.

## Frais de service mensuel vendeur

Date: 19 mai 2026

Objectif:

- Ajouter un module admin `Frais de service mensuel`.
- Permettre a l admin de demander le paiement mensuel d un store abonne.
- Suspendre automatiquement le store tant que le frais mensuel n est pas paye.
- Reactiver automatiquement le store apres paiement confirme.
- Afficher le paiement dans le dashboard vendeur avec date, heure et methode.

Fichiers modifies:

- `.tmp-dashboard-sync/vendors-dashboard.js`
- `.tmp-main-cleancopy/DvendorProducts.html`
- `.tmp-main-cleancopy/functions/index.js`
- `.tmp-main-cleancopy/moncash/return/moncash-return.js`
- `.tmp-main-cleancopy/catalog-products.js`
- `DvendorProducts.html`
- `functions/index.js`
- `moncash/return/moncash-return.js`
- `catalog-products.js`

Comportement admin ajoute:

- Nouvelle section `Frais mensuel` dans le dashboard vendeurs.
- Liste des stores avec abonnement mensuel.
- Bouton `Request frais de service mensuel`.
- Si le store a deja paye son cycle courant, le bouton reste bloque jusqu aux 30 jours suivants.
- Si le store n a pas paye, le message `Request payment for this store` apparait en rouge.
- L admin voit le montant, le statut store, la date de paiement, la methode et la prochaine echeance.
- Bouton `Marquer paye` disponible pour confirmer manuellement NatCash ou Carte bancaire si necessaire.

Comportement vendeur ajoute:

- Carte `Frais de service mensuel` dans le dashboard vendeur.
- Le vendeur voit montant, dernier paiement, prochaine echeance et methode.
- Si le store est suspendu, un message rouge explique que le paiement est requis.
- Le vendeur peut choisir MonCash, NatCash ou Carte bancaire.
- MonCash lance un paiement securise et reactive le store apres verification serveur.
- NatCash / Carte bancaire enregistrent une demande de verification admin.
- Les produits d un store suspendu sont marques `vendorServiceFeeStatus: suspended` et ne sont plus visibles dans le catalogue public.

Backend ajoute:

- `requestVendorServiceFee`
- `getVendorServiceFeeStatus`
- `startVendorServiceFeePayment`

Collections Firestore utilisees:

- `vendorServiceFees`
- `vendors`
- `clients`
- `paymentSessions`

Regle business:

- Cycle de paiement: 30 jours.
- Store non paye: `suspended_service_fee`.
- Store paye: `active`.
- Prochaine echeance: `paidAt + 30 jours`.

Verification:

```powershell
node --check functions\index.js
node --check vendors-dashboard.js
node --check moncash\return\moncash-return.js
```

Resultat:

- Les checks passent sans erreur de syntaxe.

Etat GitHub:

- Aucun push n'a encore ete fait pour cette mise a jour.

## Verification KYC vendeur

Date: 19 mai 2026

Objectif:

- Ajouter une verification KYC dans le formulaire pour devenir vendeur.
- Permettre au vendeur de telecharger sa carte d'identite.
- Demander obligatoirement le recto et le verso.
- Preparer les informations qui pourront etre demandees par Stripe.

Fichiers modifies:

- `vendor-application.js`
- `.tmp-main-cleancopy/vendor-application.js`

Comportement ajoute:

- Un bloc `Verification KYC` apparait dans le formulaire vendeur.
- Le bouton `Faire la verification KYC` ouvre une modal full screen.
- La modal demande:
- `Recto *`
- `Verso *`

Formats acceptes:

- JPG
- PNG
- WEBP
- PDF

Stockage:

- Les documents sont uploades dans Firebase Storage.
- Chemin utilise:

```text
vendor-kyc/{uid}/recto
vendor-kyc/{uid}/verso
```

Donnees sauvegardees avec la candidature:

- `kycStatus`
- `kycDocuments.recto`
- `kycDocuments.verso`

Chaque document KYC contient:

- `side`
- `url`
- `path`
- `name`
- `originalName`
- `contentType`
- `size`
- `uploadedAt`

Validation:

- Le formulaire vendeur ne peut pas etre envoye si le recto ou le verso manque.
- La modal affiche une erreur si le format est invalide ou si un upload echoue.

Verification:

```powershell
node --check vendor-application.js
node --check .tmp-main-cleancopy\vendor-application.js
```

Resultat:

- Les checks passent sans erreur de syntaxe.

Etat GitHub:

- Aucun push n'a encore ete fait pour cette mise a jour.
