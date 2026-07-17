// lib/apiFootball.js
// Wrapper léger autour de l'API-Football v3 (api-sports.io)
// Doc : https://www.api-football.com/documentation-v3

const BASE_URL = "https://v3.football.api-sports.io";

async function callApi(endpoint, params = {}) {
  const url = new URL(`${BASE_URL}${endpoint}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  });

  const res = await fetch(url.toString(), {
    headers: { "x-apisports-key": process.env.API_FOOTBALL_KEY },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`API-Football HTTP ${res.status} sur ${endpoint}`);
  }

  const data = await res.json();

  if (data.errors && Array.isArray(data.errors) === false && Object.keys(data.errors).length > 0) {
    throw new Error(`API-Football: ${JSON.stringify(data.errors)}`);
  }

  return data.response;
}

// Toutes les rencontres d'une date donnée (YYYY-MM-DD), tous championnats confondus.
// Chaque élément renvoyé contient déjà league.name, league.type ("League" ou "Cup"),
// league.country et league.season -> c'est notre "détection" du championnat.
export function getFixturesByDate(date) {
  return callApi("/fixtures", { date });
}

export function getFixturesByLeagueAndDate(leagueId, season, date) {
  return callApi("/fixtures", { league: leagueId, season, date });
}

// Statistiques d'une équipe sur une saison/championnat donné
// (moyennes buts marqués/encaissés domicile-extérieur, forme, etc.)
export function getTeamStatistics(teamId, leagueId, season) {
  return callApi("/teams/statistics", { team: teamId, league: leagueId, season });
}

// Historique des confrontations directes entre deux équipes
export function getHeadToHead(team1Id, team2Id, last = 5) {
  return callApi("/fixtures/headtohead", { h2h: `${team1Id}-${team2Id}`, last });
}

// Classement du championnat (pour le rang utilisé dans le scoring pondéré)
export function getStandings(leagueId, season) {
  return callApi("/standings", { league: leagueId, season });
}

// Recherche de championnats par nom -> renvoie leurs vrais IDs API-Football,
// leur type (League/Cup), pays et saisons disponibles. Utile pour trouver
// l'ID exact d'un championnat précis (ex: "Ligue 1" + "Ivory Coast" en filtre).
export function getLeagues(search, country) {
  const params = {};
  if (search) params.search = search;
  if (country) params.country = country;
  return callApi("/leagues", params);
}

// Liste des blessures/absences connues pour une équipe
export function getInjuries(teamId, leagueId, season) {
  return callApi("/injuries", { team: teamId, league: leagueId, season });
}
