# Notes de push et precautions

Date: 19 mai 2026

Ce fichier explique ce qui a ete fait lors du push des mises a jour, les erreurs rencontrees, et les precautions a garder pour les prochains push.

## Repos concernes

Deux repos differents ont ete pousses.

### Site public

Repo local:

```text
C:\Users\tleov\Music\rendu\.tmp-main-cleancopy
```

Remote GitHub:

```text
ssh://git@github.com/smartcutservices/smartcutservices.git
```

Commit pousse:

```text
deb4a314fa9787168deafac83066b107405d650f
```

Message commit:

```text
Update customer and vendor delivery flows
```

### Dashboard admin

Repo local:

```text
C:\Users\tleov\Music\rendu\.tmp-dashboard-sync
```

Remote GitHub:

```text
ssh://git@github.com/smartcutservices/dashboard-.git
```

Commit pousse:

```text
dca6e237965f256e756d3c04789ca1264b28c717
```

Message commit:

```text
Update vendor delivery admin and PDF layout
```

## Fichiers pousses dans le site

Les fichiers suivants ont ete inclus dans le commit du site:

- `DvendorProducts.html`
- `auth.js`
- `cart.js`
- `checkout.js`
- `vendor-application.js`
- `vendor-marketplace.js`
- `JOURNAL_DE_BORD_MODIFICATIONS.md`

Le dossier `.firebase\` etait non suivi dans `.tmp-main-cleancopy`. Il n'a pas ete ajoute au commit.

## Fichiers pousses dans le dashboard

Les fichiers suivants ont ete inclus dans le commit du dashboard:

- `Dpayment.html`
- `DvendorProducts.html`
- `vendors-dashboard.js`

Le fichier suivant etait modifie localement mais n'a pas ete inclus:

- `dashboardFullHero.html`

Raison:

- Il ne faisait pas partie des modifications demandees.
- Il fallait eviter de pousser une modification non liee au travail en cours.

## Verification avant push

Avant les commits, les fichiers JavaScript importants ont ete verifies avec `node --check`.

Commandes executees:

```powershell
node --check .tmp-main-cleancopy\auth.js
node --check .tmp-main-cleancopy\checkout.js
node --check .tmp-main-cleancopy\vendor-application.js
node --check .tmp-main-cleancopy\vendor-marketplace.js
node --check .tmp-main-cleancopy\cart.js
node --check .tmp-dashboard-sync\vendors-dashboard.js
```

Resultat:

- Tous les checks sont passes sans erreur de syntaxe.

## Erreur rencontree pendant le push dashboard

Le push du site a fonctionne directement.

Le premier push du dashboard a echoue avec l'erreur:

```text
Permission to smartcutservices/dashboard-.git denied to leo50978.
```

Cause:

- Le push dashboard utilisait la mauvaise identite SSH.
- La cle par defaut GitHub correspondait au compte `leo50978`, mais ce compte n'avait pas le droit de pousser sur `smartcutservices/dashboard-.git`.

## Cle SSH correcte pour le dashboard

Les cles SSH disponibles ont ete inspectees.

La cle correcte pour le dashboard est:

```text
C:\Users\tleov\.ssh\id_ed25519_dashboard_repo_v2
```

Test SSH:

```text
Hi smartcutservices/dashboard-! You've successfully authenticated, but GitHub does not provide shell access.
```

Cela confirme que cette cle correspond bien au repo dashboard.

## Cle SSH correcte pour le site

La cle qui a fonctionne pour le site est:

```text
C:\Users\tleov\.ssh\id_ed25519_clientrepo
```

Test SSH:

```text
Hi smartcutservices/smartcutservices! You've successfully authenticated, but GitHub does not provide shell access.
```

## Methode qui a permis de pousser le dashboard

Le push dashboard a ete refait avec Dulwich en forcant explicitement la cle SSH:

```python
porcelain.push(
  repo,
  'ssh://git@github.com/smartcutservices/dashboard-.git',
  'refs/heads/main:refs/heads/main',
  key_filename=r'C:\Users\tleov\.ssh\id_ed25519_dashboard_repo_v2'
)
```

Resultat:

```text
Push to ssh://git@github.com/smartcutservices/dashboard-.git successful.
Ref refs/heads/main updated
```

## Regles a respecter pour les prochains push

### 1. Toujours separer site et dashboard

Le site et le dashboard sont deux repos differents.

Ne pas supposer qu'un push dans le site pousse aussi le dashboard.

### 2. Toujours verifier le status avant de stage

Verifier:

```python
porcelain.status(repo)
```

Avant de faire `add`, regarder:

- fichiers modifies
- fichiers non suivis
- fichiers qui ne font pas partie de la demande

### 3. Ne pas stage les fichiers non lies a la demande

Exemple concret:

```text
dashboardFullHero.html
```

Ce fichier etait modifie localement mais il n'a pas ete inclus parce qu'il etait hors scope.

### 4. Utiliser la bonne cle SSH selon le repo

Pour le site:

```text
id_ed25519_clientrepo
```

Pour le dashboard:

```text
id_ed25519_dashboard_repo_v2
```

### 5. En cas d'erreur GitHub permission denied

Ne pas reessayer au hasard.

Verifier d'abord quelle cle GitHub repond:

```powershell
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i "$env:USERPROFILE\.ssh\id_ed25519_dashboard_repo_v2" -T git@github.com
```

Si GitHub repond avec le bon repo, utiliser cette cle explicitement dans le push.

### 6. Toujours verifier les checks avant push

Pour les fichiers JavaScript:

```powershell
node --check fichier.js
```

Cela evite de pousser une erreur de syntaxe evidente.

### 7. Toujours garder une trace dans le journal

Les changements fonctionnels doivent aussi etre documentes dans:

```text
JOURNAL_DE_BORD_MODIFICATIONS.md
```

Les details specifiques au push, aux cles SSH ou aux erreurs GitHub doivent etre documentes ici:

```text
PUSH_NOTES_ET_PRECAUTIONS.md
```

## Etat final apres push

Site:

- Push reussi.
- Working tree propre, sauf dossier non suivi `.firebase\`.

Dashboard:

- Push reussi.
- `dashboardFullHero.html` reste modifie localement et non pousse.

## Resume important

Pour ne pas repeter la meme erreur:

- Site et dashboard sont deux repos differents.
- Dashboard doit etre pousse avec `id_ed25519_dashboard_repo_v2`.
- Ne jamais inclure `dashboardFullHero.html` sans demande explicite.
- Toujours faire un status avant stage.
- Toujours verifier `node --check` avant push.
