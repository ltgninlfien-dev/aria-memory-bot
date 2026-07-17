// app/api/cron/daily-predictions/route.js
// Déclenché quotidiennement par Vercel Cron (voir vercel.json).
// Récupère les matchs du jour pour les championnats suivis et les met en cache.

import { NextResponse } from "next/server";
import { getFixturesByDate } from "@/lib/apiFootball";
import { redis } from "@/lib/redis";

// IDs de championnats API-Football à suivre. Ajoute/enlève selon tes besoins.
// Quelques IDs courants : 39 Premier League, 61 Ligue 1 (France), 140 La Liga,
// 135 Serie A, 78 Bundesliga. Pour trouver l'ID d'un championnat ivoirien/africain
// précis, appelle GET /leagues?search=nom_du_championnat avec ta clé API.
const WATCHED_LEAGUES = [61, 39, 140, 135, 78];

export async function GET(request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const today = new Date().toISOString().split("T")[0];

  try {
    const fixtures = await getFixturesByDate(today);
    const relevant = fixtures.filter((f) => WATCHED_LEAGUES.includes(f.league.id));

    await redis.set(`fixtures:${today}`, relevant, { ex: 60 * 60 * 24 });

    return NextResponse.json({
      date: today,
      totalFixtures: fixtures.length,
      watchedFixtures: relevant.length,
      leagues: [...new Set(relevant.map((f) => f.league.name))],
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
