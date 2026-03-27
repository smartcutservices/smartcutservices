# Smart Cut Services - Feuille de Route

## Vision

Centraliser le back-office dans un seul dashboard desktop-only, migrer les medias vers Firebase Storage, et livrer progressivement les modules demandes par le client sans casser le site existant.

## Etat actuel

### Fait

- Dashboard unifie avec sidebar et workspace desktop-only.
- Base du module vendeurs:
  - page publique de candidature vendeur
  - enregistrement Firebase
  - dashboard admin pour voir et valider les candidatures
- Base du back-office vendeur separe:
  - creation du profil vendeur a l'approbation
  - espace vendeur distinct initial
  - soumission de produits vendeur avec image Firebase Storage
  - revue admin des produits vendeur avec statut et commission simple
  - regles de commission par categorie cote admin
  - publication publique dans une page marketplace vendeurs separee
  - ajout au panier depuis la marketplace vendeurs
  - suivi simple des ventes vendeur depuis les commandes existantes
  - affichage brut / commission / net cote vendeur et cote admin
- Debut de migration des images vers Firebase Storage.
- Dashboard produits prepare pour uploader des images dans Firebase Storage.
- Dashboard hero prepare pour uploader vers Firebase Storage.
- Dashboard galerie prepare pour uploader ses deux images vers Firebase Storage.
- Header prepare pour uploader le logo vers Firebase Storage.
- Footer prepare pour uploader logo, icones sociales et logos paiement vers Firebase Storage.
- Helpers medias unifies pour le front public et les zones admin deja migrees.
- Base des modules `Commandes`, `Impression` et `Vendeurs` ajoutee au dashboard unifie.
- Couche admin de configuration impression reliee a Firebase:
  - POD Documents
  - Impression Photo
  - Plans CAD
  - Stickers et Grand Format via WhatsApp
- Parcours client POD Documents:
  - upload PDF
  - detection du nombre de pages
  - calcul du prix
  - ajout au panier existant
- Parcours client Impression Photo:
  - upload image
  - calcul du prix
  - ajout au panier existant
- Parcours client Plans CAD:
  - upload PDF
  - suggestion de dimension
  - calcul du prix
  - ajout au panier existant
- Parcours client Stickers / Grand Format:
  - lecture de la config admin
  - generation du lien WhatsApp specialise
- Note logistique interne ajoutee dans les modules commandes admin.
- Documentation interne marketplace / impression ajoutee.

### En cours

- Migration progressive des images locales vers Firebase Storage.
- Suivi de commande client/admin.
- Stabilisation du back-office vendeur separe.
- Configuration admin des modules impression.

### Pas encore fait

- Nettoyage final des anciens chemins image locaux.
- Validation visuelle finale dans le navigateur.

## Checklist priorisee

### Priorite 1 - Stabilisation coeur de site

- [ ] Finaliser le suivi de commande client.
- [ ] Valider visuellement la barre de progression.
- [ ] Verifier les etapes `Commande`, `Expedie`, `En livraison`, `Livre`.
- [ ] Verifier les mises a jour visibles en temps reel.
- [ ] Finaliser les tests de migration Firebase Storage sur `Hero`, `Galerie`, `Header`, `Footer`.
- [ ] Nettoyer les textes de transition encore lies aux anciennes images locales.

### Priorite 2 - Systeme vendeur

- [x] Formulaire `Devenir vendeur`
- [x] Validation admin des candidatures
- [x] Attribuer un vrai role `vendor`
- [x] Creer une base d'espace vendeur separe
- [x] Permettre l'ajout de produits vendeur
- [x] Permettre la gestion prix / stock / livraison
- [x] Ajouter une validation admin des produits vendeur
- [x] Ajouter le calcul de commission par categorie
- [x] Publier les produits vendeur dans une section publique separee

### Priorite 3 - Impression

- [x] Poser la configuration admin des modules impression
- [x] POD Documents: upload PDF, nombre de pages, calcul prix, dimensions, papier, quantite
- [x] Stickers & Grand Format: bouton WhatsApp, redirection equipe, estimation manuelle
- [x] Plans CAD: upload fichier, detection dimension, calcul prix, dimensions configurables
- [x] Impression photo: upload image, dimensions, papiers, calcul prix

## Regles de mise en oeuvre

- Toujours preferer une migration progressive.
- Ne pas melanger le statut de paiement et le statut de livraison.
- Garder la compatibilite avec les donnees Firebase existantes.
- Verifier chaque bloc avant de passer au suivant.

## Prochaine execution

1. Finaliser les verifications visuelles section par section.
2. Continuer la validation Firebase Storage sur Hero, Galerie, Header et Footer.
3. Verifier les nouveaux parcours client impression dans le navigateur.
4. Verifier la page marketplace vendeurs avec des produits approuves.
5. Nettoyer les derniers fallback locaux apres validation.

## Nouvelle checklist marketplace

### 1. Structure generale de la plateforme

- [x] Mettre en place une plateforme marketplace multi-vendeurs complete
- [x] Permettre l'interaction claire entre clients, vendeurs et administrateurs

### 2. Gestion des vendeurs

- [x] Creation de compte vendeur
- [x] Interface vendeur pour ajouter des produits
- [x] Interface vendeur pour gerer stock, prix et livraison
- [x] Interface vendeur pour suivre les ventes de base
- [x] Tableau de bord vendeur fonctionnel
- [x] Systeme de validation / acceptation des vendeurs cote admin

### 3. Gestion des produits

- [x] Ajout de produits au catalogue vendeur
- [x] Organisation par categories
- [x] Systeme de recherche produit sur le site principal existant
- [x] Affichage clair des informations produits dans la section marketplace vendeurs

### 4. Parcours client (achat)

- [x] Navigation dans les categories
- [x] Recherche produits
- [x] Ajout au panier
- [x] Validation de commande
- [x] Systeme de paiement integre
- [x] Confirmation de commande

### 5. Systeme de transactions

- [x] Enregistrement des commandes
- [x] Gestion des paiements
- [x] Application automatique des commissions
- [x] Repartition des revenus plateforme / vendeur

### 6. Design et UX

- [x] Interface simple et intuitive pour la marketplace vendeurs
- [x] Navigation claire entre site principal, impression et marketplace vendeurs
- [x] Design responsive du site public
- [x] Experience utilisateur fluide

### 7. Departement creatif

- [ ] Cohérence visuelle du site
- [ ] Qualite des visuels
- [ ] Ergonomie des pages
- [ ] Creation de supports marketing
- [ ] Fidelisation clients

### 8. Vision long terme

- [ ] Prevoir l'evolution de la plateforme
- [ ] Ajouter une application mobile plus tard
- [ ] Ajouter des outils d'analyse pour vendeurs
- [ ] Poser une logique d'amelioration continue

### 9. Design et styling

- [x] Definir clairement les styles globaux
- [x] Verrouiller couleurs, typographie et espacements
- [x] Assurer la coherence visuelle globale
- [x] Integrer Google Fonts correctement

### 10. Bonnes pratiques

- [x] Code propre et lisible sur les nouveaux modules marketplace
- [x] Respect de la structure actuelle du projet
- [x] Reutilisation des composants existants quand possible
- [x] Documentation interne si necessaire

### 11. Suivi de projet

- [x] Suivre l'avancement de chaque module
- [x] Noter ce qui est termine / en cours / a faire
- [ ] Relancer le developpement si besoin
- [x] Verifier la coherence avec les demandes client
- [ ] Preparer des comptes rendus
- [ ] Verifier que chaque partie de la checklist est respectee
- [x] Confirmer explicitement que la structure est bien en place
- [x] Confirmer explicitement que les composants sont reutilisables
- [x] Suivre ce qui est fait et ce qui reste
- [x] Noter les blocages techniques restants

## Blocages restants

- Validation visuelle finale requise dans le navigateur pour cocher completement `FINAL_VALIDATION_CHECKLIST.md`.
- Nettoyage final des derniers fallback locaux a faire seulement apres cette validation.
- Les points `Departement creatif`, `Vision long terme` et `Comptes rendus` restent des sujets de pilotage / marketing, pas des blocages de code.
