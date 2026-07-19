// app/lib/predictionsOrchestrator.js
// Assemble les données brutes (stats équipes, H2H, blessures, moyennes championnat)
// et calcule la prédiction complète pour un match donné, via predictor.js.
// Chaque match traité coûte jusqu'à 6 appels API-Football (2x stats, h2h, 2x blessures,
// standings — mise en cache possible pour standings/leagueAverages par championnat).

import { getTeamStatistics, getHeadToHead, getInjuries, getStandings } from './apiFootball';
import { computeLeagueAverages } from './leagueAverages';
import { runFullPrediction } from './predictor';

const leagueAveragesCache = new Map();

async function getLeagueAveragesCached(leagueId, season) {
  const cacheKey = `${leagueId}-${season}`;
  if (leagueAveragesCache.has(cacheKey)) return leagueAveragesCache.get(cacheKey);

  const standings = await getStandings(leagueId, season);
  const averages = computeLeagueAverages(standings);
  leagueAveragesCache.set(cacheKey, averages);
  return averages;
}

function injuryImpactFromList(injuries) {
  if (!Array.isArray(injuries)) return 0;
  return Math.min(1, injuries.length / 5);
}

export async function computeMatchPrediction(fixture) {
  const leagueId = fixture.league.id;
  const season = fixture.league.season;
  const homeTeamId = fixture.teams.home.id;
  const awayTeamId = fixture.teams.away.id;

  const [homeStats, awayStats, h2h, homeInjuries, awayInjuries, leagueAverages] = await Promise.all([
    getTeamStatistics(homeTeamId, leagueId, season),
    getTeamStatistics(awayTeamId, leagueId, season),
    getHeadToHead(homeTeamId, awayTeamId, 5),
    getInjuries(homeTeamId, leagueId, season),
    getInjuries(awayTeamId, leagueId, season),
    getLeagueAveragesCached(leagueId, season),
  ]);

  const homeScored5 = homeStats?.goals?.for?.total?.total ?? 0;
  const homeConceded5 = homeStats?.goals?.against?.total?.total ?? 0;
  const awayScored5 = awayStats?.goals?.for?.total?.total ?? 0;
  const awayConceded5 = awayStats?.goals?.against?.total?.total ?? 0;

  let h2hHomeWins = 0, h2hAwayWins = 0, h2hDraws = 0;
  (h2h || []).forEach(m => {
    const homeGoals = m.goals?.home ?? 0;
    const awayGoals = m.goals?.away ?? 0;
    if (homeGoals > awayGoals) h2hHomeWins++;
    else if (awayGoals > homeGoals) h2hAwayWins++;
    else h2hDraws++;
  });

  const prediction = runFullPrediction({
    leagueAvgHome: leagueAverages.leagueAvgHome,
    leagueAvgAway: leagueAverages.leagueAvgAway,
    homeScored5,
    homeConceded5,
    awayScored5,
    awayConceded5,
    h2hHomeWins,
    h2hAwayWins,
    h2hDraws,
    homeInjuryImpact: injuryImpactFromList(homeInjuries),
    awayInjuryImpact: injuryImpactFromList(awayInjuries),
  });

  return {
    fixtureId: fixture.fixture.id,
    date: fixture.fixture.date,
    league: { id: leagueId, name: fixture.league.name, country: fixture.league.country },
    homeTeam: { id: homeTeamId, name: fixture.teams.home.name, logo: fixture.teams.home.logo },
    awayTeam: { id: awayTeamId, name: fixture.teams.away.name, logo: fixture.teams.away.logo },
    leagueAveragesReliable: leagueAverages.reliable,
    prediction,
  };
}
