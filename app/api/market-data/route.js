// app/api/market-data/route.js
// Cette route tourne côté SERVEUR sur Vercel, donc pas de blocage CORS/sandbox.
// Le navigateur du client appelle CETTE route, qui elle-même appelle Twelve Data.

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const apiKey = searchParams.get('apikey');
  const symbol = searchParams.get('symbol') || 'XAU/USD';
  const interval = searchParams.get('interval') || '5min';
  const outputsize = searchParams.get('outputsize') || '50';

  if (!apiKey) {
    return Response.json({ status: 'error', message: 'apikey manquant' }, { status: 400 });
  }

  try {
    const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=${outputsize}&apikey=${apiKey}`;
    const res = await fetch(url, { cache: 'no-store' });
    const data = await res.json();
    return Response.json(data);
  } catch (err) {
    return Response.json({ status: 'error', message: err.message }, { status: 500 });
  }
}
