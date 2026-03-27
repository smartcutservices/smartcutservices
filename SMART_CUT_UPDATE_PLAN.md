# Plan De Mise A Jour Smart Cut Services

## 1. Contexte actuel

- Le site public actuel repose sur `index.html` + modules JavaScript separés.
- Le back-office existe deja sous forme de pages dashboard comme `Dproducts.html`, `Dpayment.html` et `Dlivraison.html`.
- La base de donnees et l'authentification passent par Firebase.
- Le design front actuel est deja pose:
  - palette luxe chaude (`#1F1E1C`, `#C6A75E`, `#F5F1E8`)
  - typographies elegantes (`Cormorant Garamond`, `Playfair Display`, `Manrope`)
  - modales et cartes tres presentes
- Le systeme de commandes existe deja, mais il est centre sur les statuts de paiement:
  - `pending`
  - `review`
  - `approved`
  - `rejected`
  - `expired`

## 2. Objectif du chantier

Faire evoluer le site existant vers une vraie plateforme Smart Cut Services plus complete, sans casser:

- le style visuel actuel
- l'experience mobile
- la logique Firebase deja en place
- les dashboards deja utilises par le client

## 3. Regles de design a respecter

- Ne pas refaire le site de zero.
- Reutiliser les couleurs, polices, espacements et types de cartes deja visibles sur le front.
- Les nouvelles pages doivent sembler faire partie du meme produit.
- Les nouveaux dashboards doivent rester plus sobres et utilitaires, comme les dashboards actuels.
- Toute nouvelle fonctionnalite front doit etre mobile-first.
- Les nouveaux statuts, badges et etapes doivent rester lisibles et coherents avec les badges existants.

## 4. Strategie generale

Ordre recommande:

1. Stabiliser le socle des commandes et statuts.
2. Ajouter les outils de configuration admin necessaires.
3. Ajouter les nouveaux produits/services d'impression.
4. Ajouter l'espace vendeurs marketplace.
5. Faire la finition UX, les validations, et les tests complets.

## 5. Checklist globale

### Phase A. Audit technique et normalisation

- [ ] Lister toutes les collections Firebase actuelles reellement utilisees.
- [ ] Documenter la structure des commandes actuelles (`clients/{clientId}/orders`).
- [ ] Documenter la structure des produits actuels (`products`).
- [ ] Verifier quels champs sont deja affiches dans `cart.js`, `checkout.js`, `payment.js`, `Dpayment.html`.
- [ ] Identifier les pages dashboard a etendre au lieu d'en creer de nouvelles.
- [ ] Definir une convention unique de nommage pour les nouveaux types de produits et services.

Livrable attendu:

- une mini documentation technique des donnees existantes
- une liste des points de branchement exacts

### Phase B. Refonte logique des commandes et du suivi client

Objectif:
garder la logique actuelle de paiement, mais ajouter le suivi de commande demande par le client.

- [ ] Distinguer clairement `statut paiement` et `statut livraison`.
- [ ] Ajouter un champ de progression commande/livraison separe du statut de paiement.
- [ ] Definir les etapes client visibles:
  - `Commande`
  - `Expedie`
  - `En cours de livraison`
  - `Livre`
- [ ] Prevoir aussi les cas d'exception:
  - commande en verification
  - commande rejetee
  - commande expiree
- [ ] Mettre a jour le modele de donnees des commandes pour supporter ces deux niveaux:
  - paiement
  - fulfillment/livraison
- [ ] Afficher la progression dans l'espace client existant dans `cart.js`.
- [ ] Afficher cette progression aussi dans le dashboard admin commande.
- [ ] Permettre la mise a jour manuelle de la progression depuis le dashboard.
- [ ] Verifier que les notifications navigateur restent coherentes avec les nouveaux statuts.
- [ ] Mettre a jour les PDF si necessaire pour refléter les nouvelles informations utiles.

Decision recommandee:

- conserver `status` pour la verification/paiement
- ajouter un nouveau champ du type `fulfillmentStatus`

### Phase C. Dashboard commande et livraison unifies

Objectif:
eviter la dispersion entre paiement et livraison.

- [ ] Revoir `Dpayment.html` pour y integrer la progression de commande.
- [ ] Decider si `Dlivraison.html` reste une page de configuration uniquement.
- [ ] Ajouter dans le dashboard commande:
  - filtre par statut paiement
  - filtre par statut livraison
  - actions rapides pour changer l'etape de livraison
  - affichage du mode de livraison choisi
- [ ] Ajouter un detail propre de la commande:
  - infos client
  - produits/services commandes
  - preuve de paiement
  - infos de livraison
  - progression commande

### Phase D. Print On Demand documents PDF

Objectif:
creer un vrai flux de commande pour l'impression de documents.

- [ ] Definir un type de produit/service `print_document`.
- [ ] Creer une interface client pour upload PDF.
- [ ] Lire automatiquement le nombre de pages du PDF.
- [ ] Permettre le choix du format:
  - `8.5x11`
  - `8.5x14`
  - `11x17`
  - `12x18`
- [ ] Permettre le choix du type de papier:
  - Bond
  - Glossy
  - Bristol Glossy
  - Autocollant
- [ ] Permettre le choix de la quantite.
- [ ] Calculer le prix total selon:
  - nombre de pages
  - format
  - type de papier
  - quantite
- [ ] Ajouter une fiche recap avant ajout au panier.
- [ ] Ajouter cet article special dans le panier existant.
- [ ] Sauvegarder dans la commande les details techniques d'impression.
- [ ] Prevoir cote admin l'activation/desactivation des formats.
- [ ] Prevoir cote admin l'activation/desactivation des papiers.
- [ ] Prevoir cote admin la grille tarifaire.

### Phase E. Stickers et grand format avec WhatsApp

Objectif:
ne pas sur-automatiser ce que le client veut gerer manuellement.

- [ ] Creer une section service `Stickers et Grand Format`.
- [ ] Ajouter une explication claire du process.
- [ ] Ajouter un bouton WhatsApp visible et elegant.
- [ ] Permettre au client d'envoyer ou preparer son fichier.
- [ ] Ajouter un message pre-rempli WhatsApp selon le service choisi.
- [ ] Si utile, sauvegarder une demande locale/Firebase avant redirection WhatsApp.
- [ ] Garder ce flux hors panier si le prix n'est pas calcule automatiquement.

### Phase F. Impression plans CAD

Objectif:
creer un deuxieme flux PDF specialise.

- [ ] Definir un type de service `print_cad`.
- [ ] Creer une interface dediee aux plans CAD.
- [ ] Autoriser upload PDF.
- [ ] Lire les dimensions du fichier si possible.
- [ ] Ajouter les dimensions disponibles:
  - `17x24`
  - `24x36`
  - `24x24`
  - `24x48`
  - `36x48`
  - `8.5x11`
  - `8.5x14`
  - `11x17`
- [ ] Permettre l'ajout futur d'autres dimensions depuis l'admin.
- [ ] Utiliser un seul type de papier si c'est la regle metier.
- [ ] Calculer le prix selon la dimension choisie.
- [ ] Ajouter le service au panier avec ses metadonnees techniques.
- [ ] Ajouter les tarifs CAD cote admin.

### Phase G. Impression photo

Objectif:
creer un troisieme flux specialise, plus simple que le POD documents.

- [ ] Definir un type de service `print_photo`.
- [ ] Creer une interface de commande photo.
- [ ] Permettre upload image/fichier.
- [ ] Ajouter les dimensions:
  - `4x6`
  - `5x7`
  - `8.5x11`
  - `11x17`
  - `13x19`
- [ ] Ajouter les types de papier:
  - Matte
  - Ultra Glossy
  - Premium Glossy
  - Premium Semiglossy
- [ ] Ajouter la quantite.
- [ ] Calculer le prix automatiquement.
- [ ] Ajouter activation/desactivation admin:
  - dimensions
  - papiers
  - tarifs

### Phase H. Configuration admin des services d'impression

Objectif:
eviter le code dur partout.

- [ ] Creer une zone admin unique pour la configuration impression.
- [ ] Y gerer les services:
  - documents
  - CAD
  - photo
  - stickers/grand format
- [ ] Y gerer:
  - disponibilite
  - formats
  - papiers
  - prix
  - textes d'aide
  - numero WhatsApp
- [ ] Decider si cette configuration rejoint `Dproducts.html` ou une nouvelle page dashboard.

Recommendation:

- creer une page dediee, du type `Dprint.html`, car ce domaine a sa propre logique metier

### Phase I. Marketplace vendeurs

Objectif:
passer du simple catalogue actuel a un vrai modele multi-vendeurs.

- [ ] Definir le modele `vendors`.
- [ ] Definir les statuts vendeurs:
  - `pending`
  - `approved`
  - `rejected`
  - `suspended`
- [ ] Creer un formulaire de candidature vendeur.
- [ ] Permettre a l'admin d'accepter ou refuser un vendeur.
- [ ] Ajouter les informations vendeur necessaires:
  - nom boutique
  - responsable
  - telephone
  - WhatsApp
  - adresse
  - categorie
  - documents si necessaire
- [ ] Lier chaque produit a un vendeur.
- [ ] Prevoir le cas des produits Smart Cut internes.
- [ ] Ajouter un taux de commission par categorie ou type de produit.
- [ ] Afficher le vendeur sur la fiche produit si pertinent.
- [ ] Ajouter un dashboard vendeur:
  - produits
  - commandes
  - statut
  - profil
- [ ] Definir les permissions:
  - admin global
  - vendeur
  - client

### Phase J. Gestion des commandes vendeurs

- [ ] Definir comment une commande multi-vendeur est stockee.
- [ ] Decider si une commande globale doit etre decoupee en sous-commandes vendeur.
- [ ] Clarifier la repartition:
  - montant vendeur
  - commission plateforme
  - frais livraison
- [ ] Ajouter une vue admin centralisee.
- [ ] Ajouter une vue vendeur sur ses commandes seulement.

Decision recommandee:

- commencer avec une commande simple par vendeur
- eviter le panier multi-vendeur complexe dans un premier lot

### Phase K. Navigation et UX publique

- [ ] Ajouter les nouveaux services dans la navigation sans surcharger le header.
- [ ] Choisir entre:
  - une categorie "Impression"
  - ou une page hub "Services d'impression"
- [ ] Faire apparaitre proprement:
  - POD Documents
  - Plans CAD
  - Photos
  - Stickers et Grand Format
- [ ] Ajouter une entree "Vendre sur Smart Cut Services" visible mais discrete.
- [ ] Verifier l'experience mobile sur:
  - header
  - mega menu
  - panier
  - checkout
  - modales

### Phase L. Contenu, textes et confiance

- [ ] Revoir les labels pour harmoniser francais / creole / termes metier.
- [ ] Ajouter des textes d'aide pour chaque service d'impression.
- [ ] Expliquer les formats acceptes, limitations et delais.
- [ ] Ajouter des messages de confiance:
  - verification de paiement
  - suivi commande
  - traitement des fichiers
  - confidentiality si necessaire

### Phase M. Tests et validation finale

- [ ] Tester le parcours client produit classique.
- [ ] Tester le parcours POD document.
- [ ] Tester le parcours CAD.
- [ ] Tester le parcours photo.
- [ ] Tester le flux WhatsApp grand format.
- [ ] Tester le suivi de commande client.
- [ ] Tester les notifications.
- [ ] Tester le dashboard admin commande.
- [ ] Tester l'activation/desactivation des options impression.
- [ ] Tester mobile/tablette/desktop.
- [ ] Verifier que rien ne casse dans les pages existantes.

## 6. Priorites de production

### Lot 1. Fondations obligatoires

- [ ] Normalisation des commandes
- [ ] Nouveau suivi client
- [ ] Evolution du dashboard commandes
- [ ] Schema Firebase pour impressions

### Lot 2. Services d'impression automatises

- [ ] POD documents
- [ ] CAD
- [ ] Photo
- [ ] Configuration admin impression

### Lot 3. Services manuels et acquisition vendeurs

- [ ] Stickers / grand format avec WhatsApp
- [ ] Formulaire devenir vendeur
- [ ] Validation admin vendeur

### Lot 4. Marketplace avancee

- [ ] Produits lies aux vendeurs
- [ ] Dashboard vendeur
- [ ] Commission
- [ ] Commandes vendeur

## 7. Risques a anticiper

- Le code actuel est modulaire mais pas encore structure comme une app moderne type Next.js.
- Beaucoup de logique UI est inline dans les composants, donc il faudra faire attention aux regressions.
- Le systeme actuel de commande est pense d'abord pour la validation de paiement, pas pour un vrai fulfilment logistique.
- Les services d'impression ont besoin d'un schema de donnees propre, sinon le panier va devenir confus.
- La marketplace vendeur peut vite devenir un gros chantier si on ne decoupe pas bien les lots.

## 8. Recommandations fermes

- Commencer par le coeur commande avant de construire les nouveaux services.
- Ne pas melanger tout de suite produit classique et marketplace complexe dans le meme sprint.
- Creer un modele clair pour les services speciaux d'impression.
- Garder les dashboards existants et les etendre, au lieu de tout remplacer.
- Ajouter une nouvelle page admin dediee aux services d'impression.
- Introduire les vendeurs en deux temps:
  - candidature + validation
  - puis vrai dashboard vendeur

## 9. Prochaine sequence de travail recommandee

Ordre d'execution concret:

1. Stabiliser le schema commande et les nouveaux statuts.
2. Mettre a jour l'UI client "Mes commandes".
3. Mettre a jour `Dpayment.html` pour piloter la progression.
4. Construire la configuration admin impression.
5. Construire POD documents.
6. Construire CAD.
7. Construire photo.
8. Ajouter stickers/grand format via WhatsApp.
9. Ajouter le module candidature vendeur.
10. Ajouter la gestion admin vendeur.
11. Ajouter ensuite le dashboard vendeur.

## 10. Definition de succes

Le chantier sera considere proprement termine quand:

- le client peut suivre sa commande du paiement a la livraison
- Smart Cut peut gerer ses services d'impression depuis l'admin
- les clients peuvent commander documents, CAD et photos
- les demandes grand format passent proprement par WhatsApp
- l'admin peut approuver ou refuser des vendeurs
- le site reste visuellement coherent avec l'existant
- aucune fonctionnalite actuelle critique n'est cassee
