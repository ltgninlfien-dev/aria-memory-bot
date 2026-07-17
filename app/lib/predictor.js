// lib/predictor.js
// Moteur de prédiction : modèle de Poisson (score exact + mi-temps) + scoring pondéré /100
// Portage direct de la logique validée dans le prototype HTML.

const MAX_GOALS = 5;

function factorial(n) {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function poissonPMF(k, lambda) {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

export function computeLambdas({
  leagueAvgHome,
  leagueAvgAway,
  homeScored5,
  homeConceded5,
  awayScored5,
  awayConceded5,
  h2hHomeWins = 0,
  h2hAwayWins = 0,
  h2hDraws = 0,
  homeInjuryImpact = 0,
  awayInjuryImpact = 0,
}) {
  const homeAttack = homeScored5 / 5 / leagueAvgHome;
  const homeDefense = homeConceded5 / 5 / leagueAvgAway;
  const awayAttack = awayScored5 / 5 / leagueAvgAway;
  const awayDefense = awayConceded5 / 5 / leagueAvgHome;

  const h2hTotal = h2hHomeWins + h2hAwayWins + h2hDraws || 1;
  const h2hHomeBias = 1 + ((h2hHomeWins - h2hAwayWins) / h2hTotal) * 0.15;
  const h2hAwayBias = 1 + ((h2hAwayWins - h2hHomeWins) / h2hTotal) * 0.15;

  let lambdaHome = leagueAvgHome * homeAttack * awayDefense * h2hHomeBias;
  let lambdaAway = leagueAvgAway * awayAttack * homeDefense * h2hAwayBias;

  lambdaHome *= 1 - homeInjuryImpact * 0.06;
  lambdaAway *= 1 - awayInjuryImpact * 0.06;

  return {
    lambdaHome: Math.max(0.15, lambdaHome),
    lambdaAway: Math.max(0.15, lambdaAway),
  };
}

export function buildScoreMatrix(lambdaHome, lambdaAway, maxGoals = MAX_GOALS) {
  const cells = [];
  for (let i = 0; i <= maxGoals; i++) {
    for (let j = 0; j <= maxGoals; j++) {
      cells.push({ home: i, away: j, p: poissonPMF(i, lambdaHome) * poissonPMF(j, lambdaAway) });
    }
  }
  return cells.sort((a, b) => b.p - a.p);
}

export function outcomeProbabilities(cells) {
  let pHome = 0,
    pDraw = 0,
    pAway = 0,
    total = 0;
  cells.forEach(({ home, away, p }) => {
    total += p;
    if (home > away) pHome += p;
    else if (home === away) pDraw += p;
    else pAway += p;
  });
  return { pHome: pHome / total, pDraw: pDraw / total, pAway: pAway / total };
}

export function halfTimeSplit(lambdaHome, lambdaAway, htRatio = 0.45) {
  return {
    lambdaHTHome: lambdaHome * htRatio,
    lambdaHTAway: lambdaAway * htRatio,
    lambda2HHome: lambdaHome * (1 - htRatio),
    lambda2HAway: lambdaAway * (1 - htRatio),
  };
}

export function topHtFtCombos(
  lambdaHTHome,
  lambdaHTAway,
  lambda2HHome,
  lambda2HAway,
  maxGoals = MAX_GOALS,
  topN = 3
) {
  const comboMap = {};
  for (let h1 = 0; h1 <= maxGoals; h1++) {
    for (let a1 = 0; a1 <= maxGoals; a1++) {
      const pHT = poissonPMF(h1, lambdaHTHome) * poissonPMF(a1, lambdaHTAway);
      if (pHT < 0.0005) continue;
      for (let h2 = 0; h2 <= maxGoals; h2++) {
        for (let a2 = 0; a2 <= maxGoals; a2++) {
          const p2H = poissonPMF(h2, lambda2HHome) * poissonPMF(a2, lambda2HAway);
          const p = pHT * p2H;
          if (p < 0.0003) continue;
          const key = `${h1}-${a1}|${h1 + h2}-${a1 + a2}`;
          comboMap[key] = (comboMap[key] || 0) + p;
        }
      }
    }
  }
  return Object.entries(comboMap)
    .map(([key, p]) => ({ key, p }))
    .sort((a, b) => b.p - a.p)
    .slice(0, topN);
}

export function weightedScore({
  homeScored5,
  homeConceded5,
  awayScored5,
  awayConceded5,
  homeRank = 10,
  awayRank = 10,
  h2hHomeWins = 0,
  h2hAwayWins = 0,
  homeInjuryImpact = 0,
  awayInjuryImpact = 0,
}) {
  let homeScore = 50;
  homeScore += (homeScored5 - homeConceded5 - (awayScored5 - awayConceded5)) * 2;
  homeScore += (awayRank - homeRank) * 1.2;
  homeScore += (h2hHomeWins - h2hAwayWins) * 3;
  homeScore += 5; // avantage terrain
  homeScore -= homeInjuryImpact * 3;
  homeScore += awayInjuryImpact * 3;
  homeScore = Math.max(5, Math.min(95, homeScore));
  return { homeScore, awayScore: 100 - homeScore };
}

// Point d'entrée unique : prend les données brutes déjà collectées et renvoie
// la prédiction complète (score exact, 1N2, mi-temps, combos MT/FT, scoring).
export function runFullPrediction(input) {
  const { lambdaHome, lambdaAway } = computeLambdas(input);
  const cells = buildScoreMatrix(lambdaHome, lambdaAway);
  const outcomes = outcomeProbabilities(cells);
  const topScores = cells.slice(0, 3);

  const { lambdaHTHome, lambdaHTAway, lambda2HHome, lambda2HAway } = halfTimeSplit(
    lambdaHome,
    lambdaAway,
    input.htRatio ?? 0.45
  );
  const htCells = buildScoreMatrix(lambdaHTHome, lambdaHTAway);
  const htTopScores = htCells.slice(0, 3);
  const htftCombos = topHtFtCombos(lambdaHTHome, lambdaHTAway, lambda2HHome, lambda2HAway);

  const scoring = weightedScore(input);

  const poissonFavors = outcomes.pHome > outcomes.pAway ? "domicile" : outcomes.pAway > outcomes.pHome ? "exterieur" : "nul";
  const scoringFavors = scoring.homeScore > 50 ? "domicile" : "exterieur";
  const coherent = poissonFavors === scoringFavors || poissonFavors === "nul";

  return {
    lambdaHome,
    lambdaAway,
    topScores,
    outcomes,
    htTopScores,
    htftCombos,
    scoring,
    coherence: { poissonFavors, scoringFavors, coherent },
  };
}
