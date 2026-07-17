// lib/aiAnalysis.js
// Couche IA optionnelle : envoie la prédiction statistique à l'API Claude,
// qui peut faire une recherche web pour vérifier le contexte récent
// (compositions probables, blessures de dernière minute, enjeu du match)
// et renvoie une synthèse factuelle en français.
//
// Nécessite une clé API Anthropic (console.anthropic.com) dans ANTHROPIC_API_KEY.
// C'est une clé différente de celle utilisée dans l'interface claude.ai —
// l'usage via l'API est facturé à l'usage (voir la page pricing sur le site
// d'Anthropic pour les tarifs à jour).

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

// claude-sonnet-5 = bon compromis qualité/coût pour ce type d'analyse.
// Pour réduire les coûts si tu appelles ça sur beaucoup de matchs, tu peux
// passer à claude-haiku-4-5-20251001 via la variable d'env AI_MODEL.
const DEFAULT_MODEL = "claude-sonnet-5";

export async function getAiAnalysis({ homeTeam, awayTeam, leagueName, matchDate, prediction }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { available: false, reason: "ANTHROPIC_API_KEY non configurée" };
  }

  const topScore = prediction.topScores[0];
  const { pHome, pDraw, pAway } = prediction.outcomes;

  const systemPrompt = `Tu es un analyste sportif factuel et prudent. Tu reçois une prédiction
statistique (modèle de Poisson) pour un match de football. Ta tâche :

1. Utilise la recherche web pour vérifier s'il y a des informations récentes
   (compositions probables, blessures/suspensions, enjeu du match, forme des
   derniers jours) qui pourraient nuancer la prédiction statistique.
2. Rédige une synthèse courte (5-6 phrases maximum) en français simple, sans
   jargon technique, qui explique le pronostic et signale toute divergence
   entre les statistiques et le contexte réel que tu as trouvé.
3. Reste factuel : si tu ne trouves rien de significatif, dis-le simplement
   plutôt que d'inventer du contexte.
4. Ne donne jamais de conseil de mise, de montant à parier, ni de cote —
   uniquement une lecture du match.`;

  const userPrompt = `Match : ${homeTeam} vs ${awayTeam}
Championnat : ${leagueName}
Date : ${matchDate}

Prédiction statistique (modèle Poisson) :
- Score exact le plus probable : ${topScore.home}-${topScore.away} (${(topScore.p * 100).toFixed(1)}%)
- Probabilités 1N2 : Domicile ${(pHome * 100).toFixed(0)}% / Nul ${(pDraw * 100).toFixed(0)}% / Extérieur ${(pAway * 100).toFixed(0)}%

Vérifie s'il y a des infos récentes pertinentes puis donne ta synthèse.`;

  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.AI_MODEL || DEFAULT_MODEL,
        max_tokens: 700,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
        tools: [{ type: "web_search_20250305", name: "web_search" }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { available: false, reason: `Erreur API Claude ${res.status}: ${errText}` };
    }

    const data = await res.json();
    const summary = data.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    return { available: true, summary, model: data.model };
  } catch (err) {
    return { available: false, reason: err.message };
  }
}
