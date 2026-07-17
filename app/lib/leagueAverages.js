// lib/leagueAverages.js
// Calcule la moyenne réelle de buts marqués à domicile / à l'extérieur pour un
// championnat donné, à partir de la réponse /standings (qui détaille les stats
// home/away de chaque équipe). Remplace les valeurs par défaut (1.4 / 1.15).

export function computeLeagueAverages(standingsResponse) {
  try {
    const table = standingsResponse[0].league.standings[0];

    let homeGoals = 0,
      homePlayed = 0,
      awayGoals = 0,
      awayPlayed = 0;

    for (const team of table) {
      homeGoals += team.home.goals.for;
      homePlayed += team.home.played;
      awayGoals += team.away.goals.for;
      awayPlayed += team.away.played;
    }

    // Sécurité : si le championnat vient de commencer, peu de matchs joués,
    // on retombe sur des valeurs par défaut raisonnables.
    if (homePlayed < 10 || awayPlayed < 10) {
      return { leagueAvgHome: 1.4, leagueAvgAway: 1.15, sampleSize: homePlayed + awayPlayed, reliable: false };
    }

    return {
      leagueAvgHome: homeGoals / homePlayed,
      leagueAvgAway: awayGoals / awayPlayed,
      sampleSize: homePlayed + awayPlayed,
      reliable: true,
    };
  } catch {
    return { leagueAvgHome: 1.4, leagueAvgAway: 1.15, sampleSize: 0, reliable: false };
  }
}
