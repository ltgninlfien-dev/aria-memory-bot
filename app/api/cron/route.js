// app/api/cron/daily-predictions/route.js
import { NextResponse } from "next/server";
import { getFixturesByDate } from "@/lib/apiFootball";
import { redis } from "@/lib/redis";
import { computeMatchPrediction } from "@/lib/predictionsOrchestrator";

const WATCHED_LEAGUES = [61, 39, 140, 135, 78];
const MAX_MATCHES_PER_DAY = 5;

export async function GET(request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const today = new Date().toISOString().split("T")[0];

  try {
    const fixtures = await getFixturesByDate(today);
    const relevant = fixtures.filter((f) => WATCHED_LEAGUES.includes(f.league.id));
    const toProcess = relevant.slice(0, MAX_MATCHES_PER_DAY);
    const skipped = relevant.length - toProcess.length;

    const predictions = [];
    const errors = [];

    for (const fixture of toProcess) {
      try {
        const prediction = await computeMatchPrediction(fixture);
        predictions.push(prediction);
      } catch (err) {
        errors.push({ fixtureId: fixture.fixture?.id, error: err.message });
      }
    }

    await redis.set(`predictions:${today}`, { date: today, predictions, generatedAt: Date.now() }, { ex: 60 * 60 * 24 });

    return NextResponse.json({
      date: today,
      totalFixtures: fixtures.length,
      watchedFixtures: relevant.length,
      processed: predictions.length,
      skippedDueToLimit: skipped,
      errors,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
