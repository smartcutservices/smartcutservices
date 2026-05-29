# Incident Auth Mobile - Smart Cut Services

Date: 2026-05-23

Ce document sert de journal de bord pour expliquer le probleme de connexion en mode mobile/petit ecran, les fausses pistes que nous avons suivies, la cause exacte trouvee, et les regles a respecter pour eviter de refaire la meme erreur.

## Resume court

Le probleme ne venait pas d'un seul bug Firebase. Il venait surtout de differences de comportement entre desktop et mobile.

En plein ecran desktop, la connexion marchait. En petit ecran/mobile, plusieurs comportements differents se declenchaient:

- Google Auth passait par `redirect` au lieu de `popup`.
- Le clic sur l'icone profil ouvrait le panel profil au lieu d'ouvrir directement la modal login pour un user non connecte.
- Apres une connexion reussie, un state Firebase `null` pouvait arriver et faire croire que le user etait deconnecte.
- Le vrai dernier bug: le meme touch/click mobile qui ouvrait le panel profil frappait ensuite le bouton `Deconnexion` quand le panel apparaissait. Donc le user etait connecte, puis le site appelait `logout()` immediatement.

Le fix final est dans la version cache `20260523-6`.

## Symptomes observes

- Sur desktop plein ecran, la connexion fonctionnait.
- En mode telephone/petit ecran, la connexion ne fonctionnait pas au debut.
- Ensuite, apres plusieurs corrections, la connexion fonctionnait en petit ecran, mais des que le user cliquait sur l'icone profil, il etait automatiquement deconnecte.
- La console montrait souvent `currentUid: null`, `isAuthenticated: false`, ou `Missing or insufficient permissions`.
- Le message `Missing or insufficient permissions` dans `profile-panel.js` etait une consequence: le panel essayait de lire `clients/{uid}` alors que le user venait d'etre deconnecte automatiquement.

## Fausses pistes

Nous avons d'abord pense que:

- Firebase Auth ne gardait pas la persistence locale.
- Android/Chrome bloquait IndexedDB ou localStorage.
- Le cache servait une ancienne version JS.
- Firestore rules empechaient le profil de charger.
- Le dashboard ou les rules Firebase etaient la cause directe.

Ces pistes avaient du sens, mais elles n'etaient pas la cause finale.

## Indices importants

Les logs importants qui ont permis de comprendre:

- Avant correction, la console ne montrait pas `login:start`, `auth-form:submit`, ni `modal:rendered`. Cela voulait dire que le flow n'atteignait meme pas la vraie fonction de connexion.
- En petit ecran, le code Google utilisait `signInWithRedirect`, alors qu'en desktop il utilisait `signInWithPopup`.
- Apres correction du flow login, la console a montre une stack claire:

```text
profile-panel.js:1241
logout()
signOut()
```

Cela prouvait que le site appelait lui-meme `logout()` au moment d'ouvrir le profil.

## Causes racines

### 1. Branch responsive differente

Le bug n'apparaissait pas en desktop parce que le site ne suivait pas exactement le meme chemin en petit ecran.

Regle a retenir: si un bug existe seulement en mode telephone, chercher d'abord dans les branches responsive, pas seulement dans Firebase.

### 2. Google Auth utilisait redirect en petit ecran

Le code faisait:

```js
const touchCapable = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
const isSmallScreen = window.matchMedia('(max-width: 1024px)').matches;
return touchCapable || isSmallScreen;
```

Donc en mobile, Google passait par redirect. Ce redirect rechargeait la page et rendait le diagnostic tres confus.

Fix:

- Utiliser popup sur desktop et mobile.
- Garder redirect seulement comme fallback si le popup est bloque.

### 3. Le panel profil s'ouvrait pour les users non connectes

Avant, un user non connecte qui cliquait l'icone profil ouvrait le panel profil, puis devait cliquer sur "Se connecter".

En mobile, ce chemin ajoutait trop de risques.

Fix:

- Si `isAuthenticated === false`, l'icone profil ouvre directement la modal login.
- Si `isAuthenticated === true`, l'icone profil ouvre le panel profil.

### 4. Null auth state apres login

Apres une connexion reussie, un state Firebase `null` pouvait arriver et provoquer un faux logout.

Fix:

- Quand login/email ou Google reussit, l'app applique le user directement via `emitAuthChange`.
- Si un `null` arrive juste apres et que le logout n'a pas ete explicitement demande par le bouton `Deconnexion`, l'app ignore ce `null`.

### 5. Le vrai dernier bug: clic mobile qui frappait le bouton Deconnexion

Sur petit ecran, quand le user clique l'icone profil, le panel slide-in apparait. Le meme touch/click pouvait atteindre le bouton `Deconnexion` dans le panel.

La console l'a prouve avec:

```text
logout @ auth.js
(anonymous) @ profile-panel.js:1241
```

Fix final:

- Le bouton `Deconnexion` ignore tout clic pendant les premiers `900ms` apres ouverture du panel.
- Ajout du log:

```text
[PROFILE_DEBUG] logout-click ignored right after open
```

## Fichiers touches

- `auth.js`
- `header.js`
- `profile-panel.js`
- `cart.js`
- `firebase-init.js`
- `index.html`
- `like.js`

## Versions importantes

- `20260523-4`: Google Auth popup partout + logs plus clairs.
- `20260523-5`: ignore les faux `null` Firebase apres login.
- `20260523-6`: fix final contre le clic mobile qui appuyait automatiquement sur `Deconnexion`.

## Checklist avant de pousser une correction auth

- Tester plein ecran desktop.
- Tester petit ecran desktop avec devtools/responsive mode.
- Tester vrai telephone Android.
- Tester iPhone si possible.
- Verifier que la console affiche bien la derniere version cache, par exemple `20260523-6`.
- Verifier que le clic profil montre `route: "auth-modal"` si user non connecte.
- Verifier que le clic profil montre `route: "profile-panel"` si user connecte.
- Verifier qu'aucun `logout:requested` ne sort sans click volontaire sur `Deconnexion`.
- Verifier qu'aucun `signOut()` ne se lance pendant l'ouverture du profil.

## Logs a surveiller

Ces logs aident a comprendre rapidement le flow:

```text
[PROFILE_DEBUG] header-profile-click
[AUTH_DEBUG] modal:rendered
[AUTH_DEBUG] modal:events-attach
[AUTH_DEBUG] submit-button:click
[AUTH_DEBUG] login:start
[AUTH_DEBUG] login-direct-success
[AUTH_DEBUG] google:start
[AUTH_DEBUG] google:popup-success
[AUTH_DEBUG] state:null-ignored-after-success
[PROFILE_DEBUG] logout-click ignored right after open
[AUTH_DEBUG] logout:requested
```

Si `logout:requested` apparait sans click volontaire sur le bouton `Deconnexion`, il faut chercher un probleme d'event mobile ou d'overlay.

## Regles pour eviter de refaire l'erreur

1. Ne pas supposer que desktop et mobile suivent le meme flow.
2. Quand un bug existe seulement en mode telephone, inspecter d'abord les conditions `max-width`, `touch`, `pointer`, `redirect`, `mobile`.
3. Ne pas pousser plusieurs corrections sans logs qui prouvent ou le flow s'arrete.
4. Quand un panel apparait sous le doigt, proteger les boutons dangereux pendant les premiers millisecondes.
5. Ne jamais laisser un bouton `Deconnexion` accepter le meme click qui ouvre le panel.
6. Toujours verifier la version cache dans la console avant de conclure qu'un fix ne marche pas.
7. Pour Google Auth, eviter de changer automatiquement de `popup` a `redirect` juste parce que l'ecran est petit.
8. Garder `redirect` seulement comme fallback, pas comme chemin principal mobile.

## Conclusion

Le probleme etait difficile parce qu'il ressemblait a un bug Firebase, mais la cause finale etait un bug UI/event mobile.

La solution definitive a ete:

- Unifier le flow Google Auth.
- Ouvrir la bonne interface selon l'etat auth.
- Proteger l'etat auth contre les faux `null`.
- Bloquer les clics accidentels sur `Deconnexion` juste apres ouverture du panel.

La correction finale est la version `20260523-6`.
