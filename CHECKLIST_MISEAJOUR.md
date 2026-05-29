# Checklist - Mise a jour majeure Smart Cut Services

Date de creation: 19 mai 2026

Objectif: transformer le fichier `miseajour.md` en checklist claire pour suivre ce qui est deja fait, ce qui reste a tester, et ce qui reste a developper.

Dernier audit code: 19 mai 2026.

Conclusion audit:

- Le module client/adresses/checkout vendeur/frais mensuel est bien present dans le code local et pousse sur GitHub.
- Les nouvelles Cloud Functions pour frais mensuel et suivi livraison vendeur ont ete deployees en production le 19 mai 2026.
- Les articles digitaux, delais de livraison, limite Basic, badge Pro, mise en avant Pro et suivi livre par vendeur sont maintenant implementes cote code local.
- Les points marques `[~]` existent partiellement, sous forme de texte, d'UI ou de base technique, mais ne sont pas encore garantis comme workflow complet en production.

Ecarts importants detectes:

- Articles digitaux: implemente cote formulaire, panier, commande et compte client; email automatique a brancher selon le prestataire choisi.
- Delai de livraison: implemente cote produit, marketplace, panier et commandes.
- Limite Basic a 5 produits: enforce cote dashboard vendeur.
- Badge vendeur verifie Pro: visible cote marketplace et recherche.
- Mise en avant Pro dans la recherche: appliquee cote recherche et marketplace.
- Upgrade Basic vers Pro: non implemente comme workflow complet.
- Carte bancaire reelle: non branchee.
- Vendeur qui marque une commande comme livree: implemente cote dashboard vendeur + Cloud Function, deploy production a faire.
- Cloud Functions frais mensuel/suivi vendeur: code present et deploy production effectue.

Legende:

- `[ ]` A faire
- `[x]` Fait ou deja implemente
- `[~]` A verifier / a finaliser

## 1. Compte client / acheteur

- [x] Le formulaire d'inscription client demande le nom.
- [x] Le formulaire d'inscription client demande le prenom.
- [x] Le formulaire d'inscription client demande la date de naissance.
- [x] Le formulaire d'inscription client demande l'email.
- [x] Le formulaire d'inscription client demande le telephone.
- [x] Le formulaire d'inscription client demande le mot de passe.
- [x] Le formulaire d'inscription client demande la confirmation du mot de passe.
- [x] Le champ age est remplace par date de naissance.
- [x] Le profil client conserve nom, prenom, date de naissance, email, telephone et adresses.
- [x] Le nom utilisateur ne remplace plus le vrai nom client dans le dashboard admin.
- [x] Le dashboard admin affiche nom, prenom, email et adresse pour les commandes.
- [~] Tester avec un nouveau compte client reel.
- [~] Tester avec un ancien compte client qui avait seulement un username.

## 2. Adresses client

- [x] Le client peut entrer une adresse principale.
- [x] Le pays est limite a Haiti pour le moment.
- [x] Le client peut choisir un departement.
- [x] La commune depend du departement choisi.
- [x] Le client peut cocher une adresse comme adresse de livraison.
- [x] Le client peut enregistrer plusieurs adresses de livraison.
- [x] Au checkout, le client peut choisir une adresse deja sauvegardee.
- [x] Au checkout, une nouvelle adresse peut etre sauvegardee sur le compte.
- [~] Tester l'ajout de plusieurs adresses sur mobile.
- [~] Tester le changement d'adresse par defaut.

## 3. Modification des informations client

- [x] Le client peut modifier son nom.
- [x] Le client peut modifier son prenom.
- [x] Le client peut modifier son username.
- [x] Le client peut modifier son telephone.
- [x] Le client peut modifier son adresse.
- [x] Le client peut modifier departement et commune.
- [x] Le client peut demander un changement de mot de passe.
- [x] Le message de reset mot de passe indique que l'email peut etre dans les spams.
- [x] L'email ne doit pas etre modifiable par le client.
- [ ] Ajouter ou verifier un outil admin pour changer l'email client si necessaire.

## 4. Formulaire pour devenir vendeur

- [x] Le vendeur voit les plans avant le formulaire.
- [x] Le plan Basic est gratuit.
- [x] Le plan Pro affiche un prix configurable.
- [x] Le vendeur peut choisir un plan.
- [x] Le vendeur doit effectuer une verification KYC.
- [x] Le vendeur peut uploader le recto de sa carte d'identite.
- [x] Le vendeur peut uploader le verso de sa carte d'identite.
- [x] Le formulaire bloque l'envoi si le KYC obligatoire manque.
- [x] Ajouter le numero d'identite vendeur: NIF, CIN ou passeport.
- [x] Ajouter les informations bancaires vendeur: titulaire du compte.
- [x] Ajouter les informations bancaires vendeur: banque.
- [x] Ajouter les informations bancaires vendeur: numero de compte / IBAN.
- [x] Ajouter les informations bancaires vendeur: SWIFT / BIC.
- [x] Ajouter le cas entreprise: nom entreprise.
- [x] Ajouter le cas entreprise: NIF entreprise.
- [x] Ajouter le cas entreprise: adresse entreprise.
- [x] Ajouter le cas entreprise: compte bancaire entreprise.

## 5. Livraison vendeur

- [x] Retirer l'option `Smart Cut gere la livraison` pour les vendeurs.
- [x] Retirer l'option `A decider plus tard` pour les vendeurs.
- [x] Garder seulement `Le vendeur gere la livraison`.
- [x] Le vendeur peut definir les zones de livraison.
- [x] Le vendeur peut choisir livraison sur tout le territoire national.
- [x] Le vendeur peut choisir plusieurs zones specifiques.
- [x] Les zones utilisent pays, departement, commune et prix.
- [x] Les livraisons vendeurs sont limitees a Haiti pour le moment.
- [x] Les vendeurs n'ont pas acces a point de livraison.
- [x] Les vendeurs n'ont pas acces a rencontre avec livreur.
- [x] Les vendeurs utilisent uniquement livraison a domicile.
- [x] Les produits Smart Cut peuvent encore utiliser point de livraison.
- [x] Les produits Smart Cut peuvent encore utiliser rencontre avec livreur.
- [x] Les produits Smart Cut peuvent encore utiliser livraison a domicile.
- [x] Retirer `Proposer un lieu` au checkout.
- [x] Le prix livraison vendeur est ajoute au checkout.
- [x] Le prix du poids est ajoute au total livraison.
- [~] Tester un panier avec produits vendeur seulement.
- [~] Tester un panier avec produits Smart Cut seulement.
- [~] Tester un panier mixte Smart Cut + vendeur.
- [~] Tester une commune non couverte par le vendeur.

## 6. Poids et frais livraison

- [x] Les produits / variations peuvent avoir un poids en grammes ou kilogrammes.
- [x] Les regles de poids peuvent etre definies en grammes ou kilogrammes.
- [x] Les frais de poids sont multiplies par la quantite achetee.
- [x] Le total checkout additionne prix produit + livraison + frais poids.
- [~] Tester l'exemple 1 article: prix + frais poids.
- [~] Tester l'exemple 2 articles: prix x2 + frais poids x2.

## 7. Frais de service mensuel vendeur

- [x] Ajouter un module admin `Frais de service mensuel`.
- [x] Afficher les stores avec abonnement mensuel.
- [x] Ajouter un bouton admin pour request le frais mensuel.
- [x] Le paiement est gere par cycle de 30 jours.
- [x] Si le store n'a pas paye, afficher `Request payment for this store` en rouge.
- [x] Si le store a paye, afficher date, heure et methode de paiement.
- [x] Bloquer un nouveau request tant que les 30 jours ne sont pas termines.
- [x] Suspendre le store vendeur s'il n'a pas paye.
- [x] Reactiver automatiquement le store apres paiement confirme.
- [x] Ajouter une carte frais mensuel dans le dashboard vendeur.
- [x] Ajouter choix MonCash, NatCash et Carte bancaire.
- [x] MonCash peut declencher le paiement en ligne.
- [x] NatCash / Carte bancaire peuvent etre marques payes par admin.
- [x] Les produits du store suspendu sont masques du catalogue public.
- [x] Deployer les Cloud Functions liees au paiement mensuel.
- [~] Tester le paiement MonCash reel d'un frais mensuel.
- [~] Tester le marquage manuel NatCash.
- [~] Tester le marquage manuel Carte bancaire.

## 8. Plans vendeur Basic / Pro

- [x] Plan Basic gratuit.
- [x] Plan Basic: limite de 5 produits bloquee techniquement dans le dashboard vendeur.
- [x] Plan Basic: acces dashboard vendeur.
- [x] Plan Basic: gestion commandes.
- [~] Plan Basic: paiement via MonCash / NatCash / Carte bancaire mentionne dans le texte, mais carte bancaire reelle non branchee.
- [~] Plan Basic: support standard mentionne dans le texte, pas de workflow support dedie.
- [x] Plan Pro: prix admin configurable.
- [x] Plan Pro: badge vendeur verifie affiche cote marketplace et recherche.
- [x] Plan Pro: mise en avant / meilleure visibilite appliquee dans la recherche et le marketplace.
- [x] Plan Pro: produits illimites de fait, et limite Basic appliquee.
- [~] Plan Pro: statistiques avancees presentes partiellement dans le dashboard vendeur, sans gating Pro.
- [~] Plan Pro: support prioritaire mentionne dans le texte, pas de workflow support dedie.
- [x] Appliquer techniquement la limite de 5 produits au plan Basic si ce n'est pas encore enforce.
- [x] Appliquer techniquement la mise en avant Pro dans la recherche.
- [x] Afficher badge vendeur verifie cote marketplace.
- [ ] Permettre upgrade Basic vers Pro.
- [ ] Ajouter paiement carte bancaire reel pour acheteurs Haiti / etranger.

## 9. Decaissement vendeur

- [x] Les vendeurs peuvent request payment tous les 30 jours sur leurs ventes.
- [x] Le dashboard admin garde l'historique des decaissements vendeur.
- [x] Le dashboard vendeur affiche l'historique de paiement / decaissement.
- [~] Tester un cycle complet vente confirmee -> request payout -> paiement vendeur.

## 10. Articles digitaux

- [x] Ajouter une option `Article digital` dans le formulaire produit vendeur.
- [x] Permettre au vendeur d'ajouter un lien de telechargement.
- [~] Envoyer le lien de telechargement par email au client apres achat confirme.
- [x] Afficher le lien de telechargement dans le compte utilisateur apres paiement confirme.
- [x] Marquer la livraison des articles digitaux comme instantanee.
- [ ] Proteger le lien de telechargement contre un partage public non voulu.

## 11. Delai de livraison

- [x] Ajouter un champ delai de livraison pour les produits physiques.
- [x] Afficher le delai de livraison au client avant paiement.
- [x] Pour les articles digitaux, afficher livraison instantanee.
- [x] Inclure le delai de livraison dans le detail commande.
- [ ] Inclure le delai de livraison dans le PDF commande si necessaire.

## 12. Suivi livraison vendeur

- [x] Le vendeur doit pouvoir marquer une commande comme livree depuis son dashboard.
- [x] Quand le vendeur marque livre, la barre suivi commande client doit passer automatiquement a livre.
- [x] Garder une trace date / heure de confirmation livraison vendeur.
- [x] Eviter qu'un vendeur modifie les commandes d'un autre vendeur.
- [~] Tester avec commande multi-vendeurs si ce cas existe.

## 13. Dashboard admin - donnees client et commandes

- [x] La fiche client admin affiche les informations du formulaire d'inscription.
- [x] Les commandes admin affichent Nom, Prenom, Email, Adresse.
- [x] Le PDF admin utilise le vrai nom client.
- [x] Le PDF admin utilise la vraie adresse client.
- [~] Tester avec une commande invite.
- [~] Tester avec une commande compte client.
- [~] Tester avec un ancien compte incomplet.

## 14. PDF et documents

- [x] Corriger l'encodage des PDFs de commande.
- [x] Corriger les montants qui apparaissaient avec `/` au lieu d'espace.
- [x] Corriger le PDF dashboard coupe en bas.
- [x] Afficher code promo dans PDFs quand utilise.
- [~] Tester PDF client.
- [~] Tester PDF admin.
- [~] Tester PDF avec code promo.
- [~] Tester PDF avec produit vendeur et livraison vendeur.

## 15. PWA / favicon

- [x] Ajouter favicon depuis le dossier `ico`.
- [x] Ajouter manifest PWA.
- [x] Ajouter prompt installation PWA.
- [x] Le message installation reapparait tant que l'utilisateur n'a pas clique `Installer` ou `Je ne suis pas interesse`.
- [~] Tester Android.
- [~] Tester iPhone.
- [~] Tester PC.

## 16. Points a clarifier avec le client

- [ ] Confirmer comment gerer un panier avec plusieurs vendeurs et plusieurs frais livraison.
- [ ] Confirmer si le plan Basic doit etre bloque strictement a 5 produits.
- [ ] Confirmer le prestataire carte bancaire final.
- [ ] Confirmer si NatCash doit etre automatique ou validation admin manuelle.
- [ ] Confirmer si les liens digitaux doivent expirer.
- [ ] Confirmer si un client etranger peut payer avec carte et livrer uniquement en Haiti.
- [ ] Confirmer si les emails transactionnels doivent etre geres par Firebase Functions, SendGrid, Gmail ou autre service.

## 17. Verification avant push / deploy

- [x] Lancer `node --check` sur les fichiers JS modifies.
- [ ] Verifier que les fichiers `.md` ne sont pas stages si l'utilisateur ne veut pas les push.
- [ ] Verifier que `.firebase` n'est pas stage.
- [ ] Verifier que les fichiers hors scope ne sont pas stages.
- [ ] Commit site repo.
- [ ] Commit dashboard repo si necessaire.
- [ ] Push site repo.
- [ ] Push dashboard repo.
- [x] Deployer Cloud Functions si des endpoints backend ont change.
- [ ] Tester le parcours principal en production apres deploy.
