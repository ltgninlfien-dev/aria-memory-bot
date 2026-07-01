# ARIA Memory — Bot de trading Or/Forex avec mémoire IA

## Déploiement sur Vercel

1. Crée un dépôt GitHub et uploade tous ces fichiers
2. Va sur vercel.com, connecte-toi avec GitHub
3. "Add New Project" → sélectionne ce dépôt → Deploy
4. Une fois déployé, ouvre l'URL fournie par Vercel
5. Colle ta clé API Twelve Data dans l'app et démarre le bot

## Pourquoi cette version fonctionne (contrairement à l'artifact)

L'API route `/app/api/market-data/route.js` tourne côté serveur sur
l'infrastructure de Vercel — elle n'est pas soumise aux restrictions
réseau du sandbox artifact de claude.ai. Le navigateur appelle cette
route locale, qui elle-même appelle Twelve Data sans blocage CORS.

## Stockage

Les trades/mémoire sont sauvegardés dans le localStorage du navigateur.
Ça persiste entre les sessions sur le même appareil/navigateur, mais
ne se synchronise pas entre appareils différents.
