// app/api/predictions/route.js
import { redis } from "@/lib/redis";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") || new Date().toISOString().split("T")[0];

  try {
    const data = await redis.get(`predictions:${date}`);

    if (!data) {
      return Response.json({
        date,
        predictions: [],
        message: "Aucune prédiction en cache pour cette date — le cron a-t-il déjà tourné aujourd'hui ?",
      });
    }

    return Response.json(data);
  } catch (error) {
    return Response.json({ error: error.message, date }, { status: 500 });
  }
}
