# Prédicteur de matchs — Backend API-Football

Backend Next.js (App Router) qui collecte les données de matchs via API-Football
et génère des prédictions (score exact, mi-temps, combos MT/FT, 1N2) avec le
moteur Poisson + scoring pondéré déjà validé dans le prototype.

## Structure

```
lib/apiFootball.js     -> appels à l'API-Football (fixtures, stats, H2H, classement)
lib/predictor.js       -> moteur de calcul (Poisson + scoring, pur, sans dépendance réseau)
lib/redis.js           -> client Upstash Redis (cache)
app/api/fixtures       -> GET /api/fixtures?date=YYYY-MM-DD
                           -> liste les matchs du jour, groupés par championnat,
                              avec type (League/Cup), pays, saison
app/api/leagues        -> GET /api/leagues?search=ligue+1&country=Ivory+Coast
                           -> trouve le vrai ID d'un championnat par nom/pays
                              (utile pour compléter WATCHED_LEAGUES dans le cron)
app/api/predict        -> POST /api/predict
                           -> génère une prédiction complète pour un match,
                              avec la moyenne de buts réelle du championnat
                              (calculée depuis le classement, cache 24h)
lib/leagueAverages.js   -> calcul de la moyenne domicile/extérieur réelle
                           à partir des stats home/away du classement
lib/aiAnalysis.js       -> analyse qualitative via Claude (avec recherche web
                           pour vérifier compositions/blessures récentes),
                           en complément du modèle statistique

## Couche IA (optionnelle)

`/api/predict` accepte un paramètre `withAi: true` dans le body. Quand il est
présent :
- la prédiction statistique est envoyée à Claude (via l'API Anthropic)
- Claude peut faire une recherche web pour vérifier le contexte récent du
  match (compositions probables, blessures, enjeu)
- il renvoie une synthèse de 5-6 phrases en français dans `aiAnalysis.summary`

L'IA ne recommande **jamais** de montant à parier — elle commente uniquement
la lecture du match, en signalant explicitement quand la confiance du modèle
est faible.

Par défaut `withAi` est à `false` pour éviter des appels (donc des coûts)
inutiles sur des matchs que tu ne comptes pas jouer. Utilise-le seulement
pour les matchs que tu es en train d'analyser sérieusement.

Nécessite `ANTHROPIC_API_KEY` dans les variables d'environnement Vercel
(console.anthropic.com -> API Keys). Sans cette clé, tout continue de
fonctionner normalement, `aiAnalysis` est juste absent de la réponse.
app/api/cron/daily-predictions
                        -> tâche quotidienne (Vercel Cron) qui pré-charge
                           les matchs du jour pour les championnats suivis
vercel.json             -> planification du cron (6h du matin, ajustable)
```

## Mise en place depuis mobile

1. **Récupérer une clé API-Football** : crée un compte sur api-football.com
   (le plan gratuit suffit pour tester : 100 requêtes/jour).
2. **Copier ces fichiers dans ton repo GitHub existant** (celui d'ARIA ou un
   nouveau repo) — via l'appli GitHub mobile ou l'éditeur web de GitHub sur
   le navigateur mobile, en créant chaque fichier avec le contenu fourni.
3. **Vérifier `package.json`** : ajoute `@upstash/redis` s'il n'y est pas déjà
   (il l'est probablement déjà si tu l'utilises sur ARIA).
4. **Sur Vercel** (dashboard mobile ou navigateur) :
   - Importe/relie le repo si ce n'est pas déjà fait
   - Dans Settings → Environment Variables, ajoute :
     `API_FOOTBALL_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`,
     `CRON_SECRET`, et `ANTHROPIC_API_KEY` (optionnelle, pour la couche IA)
   - Déploie
5. **Tester** : ouvre `https://ton-projet.vercel.app/api/fixtures?date=2026-07-18`
   dans le navigateur mobile — tu dois voir la liste des matchs du jour groupés
   par championnat, avec leur type.

## Utilisation typique

1. Appeler `/api/fixtures?date=...` pour voir les matchs du jour et récupérer
   les `fixtureId`, `homeTeamId`, `awayTeamId`, `leagueId`, `season` de ceux
   qui t'intéressent.
2. Appeler `/api/predict` en POST avec ces IDs pour obtenir la prédiction
   complète (score exact, mi-temps, 1N2, scoring).

## Trouver les championnats africains (Ligue 1 CI, CAF...)

Je n'ai pas de source fiable pour te donner les IDs exacts d'API-Football
sans les inventer, donc utilise l'endpoint de recherche une fois déployé :

```
https://ton-projet.vercel.app/api/leagues?search=ligue+1&country=Ivory+Coast
https://ton-projet.vercel.app/api/leagues?search=CAF+Champions+League
```

Ça te renvoie l'ID réel, le type (League/Cup) et les saisons disponibles.
Ajoute ensuite ces IDs dans `WATCHED_LEAGUES` (fichier
`app/api/cron/daily-predictions/route.js`).

## Limites connues à ce stade

- Le plan gratuit API-Football limite le nombre de requêtes/jour — le cache
  Redis (6h sur les prédictions, 24h sur les moyennes de ligue) est là pour
  économiser les appels.
- Comme dans le prototype : le score exact reste une probabilité, jamais une
  certitude. Le but du moteur est d'être cohérent et calibrable dans le temps,
  pas de "deviner" à coup sûr.

## Prochaine étape suggérée

Ajouter un module de suivi (comme le shadow trading sur ARIA) : enregistrer
chaque prédiction avant le match, puis comparer au résultat réel une fois
le match terminé (`/fixtures?id=...&status=FT`), pour mesurer la fiabilité
du modèle dans le temps et ajuster les pondérations en conséquence.
