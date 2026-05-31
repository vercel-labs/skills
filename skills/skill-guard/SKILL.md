---
name: skill-guard
description: >
  Garde de sécurité pour toute installation de skill ou plugin Claude.
  Déclencher OBLIGATOIREMENT dès que l'utilisateur demande d'installer
  un plugin Claude (`claude plugin install`), un skill (`npx skills add`),
  ou tout équivalent — même si l'utilisateur tape la commande directement.
  Affiche un pictogramme de risque (✅ ⚠️ ❌ ❓) et bloque l'installation
  si un risque est détecté jusqu'à confirmation explicite. Ne jamais laisser
  passer une installation sans ce rapport.
---

## Objectif

Intercepter toute installation de skill ou plugin et évaluer son niveau de
risque avant d'exécuter quoi que ce soit — ou, pour les skills interactifs,
pendant l'exécution avant que les fichiers ne soient écrits sur disque.

## Étape 1 — Identifier la source et le nom du package

Extraire depuis la demande :
- **Nom du package** (ex. `code-review`, `find-skills`)
- **Source** (ex. `claude-plugins-official`, `vercel-labs/skills`, URL GitHub)
- **Type de commande** : `claude plugin install` ou `npx skills add`

## Étape 2 — Collecter les informations de risque

### Cas A : `claude plugin install X@marketplace`

Exécuter **avant** l'installation :
```
claude plugin details X@marketplace
```
Analyser l'inventaire retourné pour détecter des signaux d'alerte :
- Présence de hooks (exécution automatique)
- Présence de serveurs MCP (accès réseau)
- Scripts bash exécutés à l'install
- Permissions inhabituelles

Les scores externes (Socket, Snyk) ne sont pas disponibles pour ce canal.
Compenser par l'analyse structurelle de l'inventaire + recherche web si doute.

### Cas B : `npx skills add <repo> --skill <name>`

Les scores Socket/Snyk sont fournis par skills.sh **dans la sortie de la
commande elle-même**, juste avant que les fichiers soient écrits sur disque.

Protocole en deux temps :

**Temps 1 — Pré-check rapide :**
Tenter un WebFetch sur `https://skills.sh/<org>/<repo>` pour récupérer
d'éventuels scores publiés. Si les scores ne sont pas disponibles (page
rendue côté client), passer au Temps 2.

**Temps 2 — Interception pendant l'installation :**
Lancer la commande normalement et lire attentivement la sortie. La section
"Security Risk Assessments" apparaît dans la sortie **avant** que
l'installation ne se finalise. Capturer ces scores immédiatement.

Format attendu dans la sortie :
```
Security Risk Assessments
  <skill-name>  <Gen>  <Socket>  <Snyk>
  Details: https://skills.sh/<org>/<repo>
```

Dès que ces scores apparaissent, appliquer la règle de l'Étape 3.
Si ⚠️ ou ❌ détecté, afficher le rapport et demander confirmation.
Si l'utilisateur refuse, exécuter immédiatement `npx skills remove <name> -y`.

### Recherche web complémentaire (si données insuffisantes)

```
<nom-du-package> security vulnerability site:socket.dev OR site:snyk.io
```

## Étape 3 — Appliquer la règle de risque

| Pictogramme | Niveau | Condition |
|-------------|--------|-----------|
| ✅ | Sûr | Safe + 0 alertes sur tous les scanners disponibles |
| ⚠️ | Risque modéré | Medium Risk sur au moins un scanner |
| ❌ | Risque élevé | High Risk ou Critical sur au moins un scanner |
| ❓ | Inconnu | Aucune donnée de risque disponible |

## Étape 4 — Afficher le rapport

Format standard du rapport :

```
[PICTOGRAMME] <nom-du-package>
  Source    : <marketplace ou URL>
  Scanners  : Gen=[résultat] · Socket=[résultat] · Snyk=[résultat]
  Détails   : <URL si disponible>
```

**Comportement selon le niveau :**

- **✅ Sûr** : Procéder ou confirmer l'installation. Aucune action requise.
- **⚠️ Risque modéré** : Afficher le rapport et demander :
  > "Un risque modéré a été détecté. Veux-tu quand même installer ce package ?"
  Ne pas finaliser sans confirmation explicite.
- **❌ Risque élevé** : Afficher le rapport avec avertissement fort.
  Déconseiller fortement l'installation. Demander confirmation explicite.
  Si installé (Cas B), proposer la désinstallation immédiate.
- **❓ Inconnu** : Indiquer l'absence de données et demander confirmation.

## Règle absolue

Ne jamais sauter cette vérification, même si l'utilisateur donne la commande
directement. La sécurité de l'utilisateur prime sur la rapidité d'exécution.
