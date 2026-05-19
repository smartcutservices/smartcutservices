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
