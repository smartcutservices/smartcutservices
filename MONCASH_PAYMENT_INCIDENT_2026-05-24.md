# Incident MonCash - 24 mai 2026

Ce document explique clairement ce qui a ete fait pour le probleme MonCash ou le client voyait un message technique du type:

```text
Could not open JPA EntityManager for transaction; nested exception is org.hibernate.exception.JDBCConnectionException: Unable to acquire JDBC Connection
```

Le but est de garder une trace propre pour eviter de refaire les memes erreurs ou de chercher au mauvais endroit plus tard.

## Resume rapide

Le probleme venait du fait que MonCash retournait une erreur technique cote serveur, et notre site affichait cette erreur brute au client dans une alerte navigateur.

Ce n'etait pas un probleme de formulaire checkout, ni un probleme direct de cache, ni un probleme cause par les warnings `Tracking Prevention`.

La correction faite:

- Le backend Firebase Functions ne renvoie plus les erreurs techniques MonCash au client.
- Le frontend filtre aussi les erreurs MonCash au cas ou une erreur technique passerait quand meme.
- Le client voit maintenant un message propre et comprehensible.
- Les logs techniques restent disponibles cote serveur pour debug.
- Le warning Firestore sur `categories567` a ete retire de la recherche publique pour ne pas nous perdre dans la console.
- Les versions de cache JS ont ete augmentees pour forcer les navigateurs a charger les nouveaux fichiers.

## Symptomes observes

Pendant le checkout, dans la modal:

```text
Paiement securise
Payer avec MonCash
Redirection vers MonCash...
```

Le navigateur affichait une alerte:

```text
Could not open JPA EntityManager for transaction; nested exception is org.hibernate.exception.JDBCConnectionException: Unable to acquire JDBC Connection
```

Dans la console, on voyait aussi beaucoup de messages comme:

```text
Tracking Prevention blocked access to storage for <URL>
cdn.tailwindcss.com should not be used in production
search.js:723 Recherche produits ignoree sur categories567: FirebaseError: Missing or insufficient permissions.
```

## Ce qui etait vraiment important

Le message `JPA EntityManager / JDBC Connection` indique un probleme cote service MonCash ou cote API utilisee par MonCash.

Notre erreur a nous etait de laisser ce message technique remonter jusqu'au client.

Avant correction:

1. Le client clique sur paiement MonCash.
2. `payment.js` appelle `moncash-client.js`.
3. `moncash-client.js` appelle la Cloud Function `createMoncashPayment`.
4. `functions/index.js` appelle l'API MonCash pour creer une redirection.
5. MonCash retourne une erreur technique Java/Hibernate/JDBC.
6. La Cloud Function renvoie `error.message` au frontend.
7. `payment.js` affiche directement ce message avec `alert(error.message)`.

Resultat: le client voyait un message technique incomprehensible.

## Ce qui n'etait pas la cause principale

Les messages suivants ne causaient pas ce bug MonCash:

- `Tracking Prevention blocked access to storage`
- `cdn.tailwindcss.com should not be used in production`
- Les warnings CDN Font Awesome / AnimeJS / Tesseract

Ces messages peuvent etre nettoyes plus tard, mais ils ne sont pas responsables de l'erreur `JPA EntityManager`.

Par contre, cette ligne etait un vrai bruit a nettoyer:

```text
search.js:723 Recherche produits ignoree sur categories567: Missing or insufficient permissions
```

Elle venait du fait que `search.js` essayait de lire la collection Firestore `categories567`, qui n'est pas accessible publiquement avec les rules actuelles.

## Fichiers modifies

### `functions/index.js`

Ajout d'une fonction de securisation:

```js
getSafeMoncashPublicError(error)
```

Cette fonction detecte les messages techniques contenant des mots comme:

- `jpa entitymanager`
- `jdbcconnectionexception`
- `jdbc connection`
- `hibernate`
- `org.hibernate`
- `nested exception`
- `stack trace`

Si un de ces mots est detecte, le backend renvoie maintenant:

```text
MonCash est temporairement indisponible. Votre paiement n a pas ete lance. Veuillez reessayer dans quelques minutes.
```

Le backend garde quand meme le vrai message technique dans les logs Firebase avec:

```js
logger.error(...)
```

La fonction est utilisee dans:

- `createMoncashPayment`
- `startVendorServiceFeePayment`

Pourquoi aussi `startVendorServiceFeePayment`?

Parce que le paiement du plan vendeur Pro utilise aussi MonCash. Si MonCash retourne la meme erreur la-bas, on ne veut pas exposer le message technique au vendeur.

### `payment.js`

Ajout d'une fonction frontend:

```js
getSafeMoncashErrorMessage(error)
```

Elle fait la meme protection cote navigateur.

Avant:

```js
alert(error?.message || 'Impossible de demarrer le paiement MonCash.');
```

Apres:

```js
alert(getSafeMoncashErrorMessage(error));
```

Pourquoi le faire aussi cote frontend si le backend filtre deja?

Parce que c'est une double securite. Si un jour une autre source d'erreur technique arrive au frontend, le client ne verra pas un message Java/Hibernate/JDBC.

### `moncash-client.js`

Ajout d'une protection dans le client API MonCash.

Avant, si la Cloud Function retournait:

```json
{
  "ok": false,
  "message": "Could not open JPA EntityManager..."
}
```

`moncash-client.js` creait une erreur avec ce message brut.

Maintenant, `moncash-client.js` nettoie le message avant de creer l'erreur.

### `search.js`

Avant:

```js
const collectionsToTry = ['products', 'vendorProducts', 'categories567'];
```

Apres:

```js
const collectionsToTry = ['products', 'vendorProducts'];
```

Pourquoi?

Parce que `categories567` provoquait des erreurs Firestore de permission dans la console. Ce n'etait pas le probleme MonCash, mais ca ajoutait du bruit pendant les tests et pouvait nous faire chercher dans la mauvaise direction.

### Cache/version JS

Les versions ont ete augmentees pour forcer les navigateurs a charger les nouveaux fichiers.

Exemples:

- `index.html` passe a `ASSET_VERSION = '20260524-6'`
- `catalogue.html` passe a `ASSET_VERSION = '20260524-6'`
- `product.html` passe a `ASSET_VERSION = '20260524-6'`
- `checkout.js` importe maintenant `payment.js?v=20260524-2`
- `payment.js` importe maintenant `moncash-client.js?v=20260524-2`
- `cart.js`, `header.js`, `products.js`, `product-modal.js`, `product-page.js`, `profile-panel.js` pointent vers la nouvelle chaine cachee.

Pourquoi c'etait important?

Parce que plusieurs bugs recents nous ont montre que certains navigateurs gardaient les anciens fichiers JS. Sans bump de version, on peut croire qu'une correction ne marche pas alors que le navigateur charge encore une ancienne version.

## Deploy effectue

Le commit pousse sur GitHub:

```text
a3158bf1fc1c99f7110f860f8ffa9a1c4689d316
```

Message du commit:

```text
Sanitize MonCash errors and search permissions
```

Les fonctions Firebase deployees:

- `createMoncashPayment`
- `startVendorServiceFeePayment`

Deploy termine avec succes:

```text
functions[createMoncashPayment(us-central1)] Successful update operation.
functions[startVendorServiceFeePayment(us-central1)] Successful update operation.
Deploy complete.
```

## Verification faite

Verification syntaxe:

```text
node --check payment.js
node --check moncash-client.js
node --check checkout.js
node --check cart.js
node --check search.js
node --check functions/index.js
```

Resultat: pas d'erreur de syntaxe.

Verification production:

- `index.html` contient bien `ASSET_VERSION = '20260524-6'`
- `payment.js?v=20260524-2` contient bien `getSafeMoncashErrorMessage`
- `payment.js?v=20260524-2` contient bien le message propre MonCash
- `search.js?v=20260524-6` ne contient plus `categories567`

## Ce qu'il faut retenir pour la prochaine fois

Si un client voit un message technique pendant le paiement:

1. Ne pas se concentrer d'abord sur les warnings `Tracking Prevention`.
2. Verifier d'abord le frontend qui affiche le message avec `alert(...)`.
3. Verifier ensuite la Cloud Function qui renvoie `message: error.message`.
4. Toujours garder les details techniques dans les logs serveur, mais jamais dans l'interface client.
5. Toujours bump les versions JS apres une correction frontend importante.
6. Si un message Firestore permission apparait en console, verifier si le code lit une collection non publique inutilement.

## Comportement attendu maintenant

Si MonCash fonctionne:

- Le client est redirige normalement vers MonCash.

Si MonCash a encore un probleme interne:

- Le client ne voit plus `JPA EntityManager`, `Hibernate`, ou `JDBC Connection`.
- Il voit un message simple:

```text
MonCash est temporairement indisponible. Votre paiement n a pas ete lance. Veuillez reessayer dans quelques minutes.
```

Le paiement n'est pas lance tant que MonCash ne retourne pas une vraie URL de paiement.

## Important

Cette correction ne repare pas le serveur interne de MonCash si MonCash est temporairement indisponible.

Elle repare notre site pour:

- ne pas afficher d'erreur technique aux clients;
- mieux gerer l'echec;
- eviter de polluer la console avec `categories567`;
- faciliter le debug futur.

## Suite du diagnostic apres retest

Apres le premier correctif, le paiement ne fonctionnait toujours pas. La console navigateur affichait maintenant des logs propres:

```text
[MONCASH_DEBUG] checkout:start
[MONCASH_DEBUG] checkout:customer
[MONCASH_DEBUG] request:start
POST https://us-central1-smartcutservices-9ce54.cloudfunctions.net/createMoncashPayment
Failed to load resource: the server responded with a status of 503
[MONCASH_DEBUG] request:response
status: 503
error: "moncash-temporarily-unavailable"
message: "MonCash est temporairement indisponible..."
```

Ce diagnostic a confirme une chose tres importante:

- Le bouton MonCash fonctionne.
- Le frontend appelle bien `createMoncashPayment`.
- La requete arrive bien a la Cloud Function.
- Le blocage n'est plus dans le checkout frontend.
- Le probleme se produit cote backend quand la fonction essaie de creer le paiement chez MonCash.

Avant ces logs, on pouvait croire que le bouton, le cache, Android, le navigateur ou le checkout etaient responsables. Apres ces logs, on sait que le frontend fait son travail.

## Logs de debug ajoutes

Des logs cibles ont ete ajoutes pour ne plus se perdre dans les warnings navigateur.

### Cote frontend

Dans `payment.js`:

```text
[MONCASH_DEBUG] checkout:start
[MONCASH_DEBUG] checkout:customer
[MONCASH_DEBUG] checkout:redirect-ready
[MONCASH_DEBUG] checkout:error
```

Ces logs permettent de verifier:

- le montant envoye a MonCash;
- le client utilise;
- le nombre de produits;
- la methode de paiement;
- l'adresse de livraison;
- si la redirection MonCash est prete;
- l'erreur retournee au navigateur.

Dans `moncash-client.js`:

```text
[MONCASH_DEBUG] request:start
[MONCASH_DEBUG] request:response
```

Ces logs permettent de verifier:

- l'URL appelee;
- la methode HTTP;
- le status HTTP;
- la duree de la requete;
- le message retourne par la Cloud Function.

### Cote backend

Dans `functions/index.js`:

```text
MONCASH_CREATE_DEBUG request:start
MONCASH_CREATE_DEBUG request:missing-client-id
MONCASH_CREATE_DEBUG request:missing-customer-identity
MONCASH_CREATE_DEBUG request:missing-items
MONCASH_CREATE_DEBUG request:delivery-invalid
MONCASH_CREATE_DEBUG request:invalid-total
MONCASH_CREATE_DEBUG redirect:start
MONCASH_CREATE_DEBUG redirect:ready
MONCASH_CREATE_DEBUG redirect:error
MONCASH_CREATE_DEBUG api:create-payment-failed:fallback-middleware
```

Ces logs permettent de savoir si la function bloque sur:

- les infos client;
- les produits;
- l'adresse de livraison;
- le total;
- l'appel API MonCash;
- le fallback middleware MonCash.

## Correction supplementaire: fallback middleware MonCash

Apres le retest, le status `503` confirmait que l'API principale MonCash ne donnait pas de redirection.

Avant:

```text
createMoncashPayment
-> getMoncashAccessToken()
-> POST /Api/v1/CreatePayment
-> si erreur: retour 503 au frontend
```

Maintenant:

```text
createMoncashPayment
-> essaie /Api/v1/CreatePayment
-> si cette route echoue, essaie /Moncash-middleware/Checkout/Rest/{BusinessKey}
-> si le fallback retourne une URL, le client est redirige vers MonCash
-> si le fallback echoue aussi, alors seulement on retourne l'erreur propre au frontend
```

Ce fallback utilise:

- `MONCASH_BUSINESS_KEY`
- `MONCASH_SECRET_API_KEY`
- `crypto.publicEncrypt`
- RSA avec `RSA_NO_PADDING`
- `amount` et `orderId` encryptes
- endpoint `Moncash-middleware/Checkout/Rest/{BusinessKey}`

La documentation de reference utilisee:

```text
https://sandbox.moncashbutton.digicelgroup.com/Moncash-business/resources/doc/MC_Button_Doc.pdf
```

## Fichiers modifies lors de cette suite

### `payment.js`

Ajout de logs:

- `checkout:start`
- `checkout:customer`
- `checkout:redirect-ready`
- `checkout:error`

Changement de version import:

```js
moncash-client.js?v=20260524-3
```

### `moncash-client.js`

Ajout de logs:

- `request:start`
- `request:response`

Ces logs affichent le status HTTP et le message retourne par `createMoncashPayment`.

### `functions/index.js`

Ajouts importants:

```js
buildMoncashPublicKey()
encryptMoncashMiddlewareValue()
createMoncashApiRedirect()
createMoncashMiddlewareRedirect()
createMoncashRedirect()
```

`createMoncashRedirect()` est maintenant responsable de:

1. essayer le flow API principal;
2. logger l'echec du flow API principal;
3. essayer le flow middleware;
4. retourner une URL de checkout si l'un des deux flows reussit.

Les sessions et commandes stockent aussi:

```js
providerMode: 'api' ou 'middleware'
moncashProviderMode: 'api' ou 'middleware'
```

Cela permet de savoir plus tard quelle route MonCash a ete utilisee pour chaque paiement.

## Versions cache et commits

Version frontend apres ajout des logs:

```text
ASSET_VERSION = 20260524-7
payment.js?v=20260524-3
moncash-client.js?v=20260524-3
```

Commit pour les diagnostics:

```text
f4d5012868b9619e910f29dfada608cc52efbe92
Add targeted MonCash diagnostics
```

Commit pour le fallback middleware:

```text
86e755fc06df38b3e7e8ff5156bc29e9f8e385de
Add MonCash middleware fallback
```

Functions redeployees:

```text
createMoncashPayment
startVendorServiceFeePayment
```

Deploy termine avec succes:

```text
functions[createMoncashPayment(us-central1)] Successful update operation.
functions[startVendorServiceFeePayment(us-central1)] Successful update operation.
Deploy complete.
```

## Comment tester maintenant

1. Ouvrir le site.
2. Aller au checkout.
3. Cliquer sur paiement MonCash.
4. Dans la console, regarder uniquement les lignes `[MONCASH_DEBUG]`.

Si tout marche:

```text
[MONCASH_DEBUG] request:response status: 200
[MONCASH_DEBUG] checkout:redirect-ready
```

Puis le navigateur doit rediriger vers MonCash.

Si cela echoue encore:

Il faut copier exactement:

```text
[MONCASH_DEBUG] request:response
[MONCASH_DEBUG] checkout:error
```

Et cote Firebase, chercher:

```text
MONCASH_CREATE_DEBUG api:create-payment-failed:fallback-middleware
MONCASH_CREATE_DEBUG redirect:error
```

Ces lignes diront si:

- l'API principale MonCash echoue;
- le fallback middleware echoue aussi;
- la cle `MONCASH_SECRET_API_KEY` n'est pas au bon format;
- le `BusinessKey` est invalide;
- MonCash retourne un payload inattendu.

## Conclusion technique

Le probleme initial n'etait pas un probleme de checkout frontend.

Le vrai chemin identifie est:

```text
Frontend OK
Cloud Function appelee OK
Blocage dans creation paiement MonCash
```

La solution actuelle est plus robuste:

- logs clairs pour debug;
- message client propre;
- fallback middleware MonCash;
- stockage du mode utilise pour chaque paiement.

Si apres cette correction MonCash refuse encore, le prochain point a verifier sera la validite exacte des secrets:

- `MONCASH_CLIENT_ID`
- `MONCASH_CLIENT_SECRET`
- `MONCASH_BUSINESS_KEY`
- `MONCASH_SECRET_API_KEY`

Et il faudra comparer la reponse brute du fallback middleware avec la documentation MonCash.
