// api/news.js — Proxy NewsAPI pour KO MAG
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const API_KEY = process.env.NEWS_API_KEY;
  if (!API_KEY) {
    return res.status(500).json({ error: 'NEWS_API_KEY manquante' });
  }

  // Sans language=fr → beaucoup plus de résultats
  const queries = ['boxing', 'boxing champion fight', 'boxe combat'];

  try {
    const fetches = queries.map(q =>
      fetch(`https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&sortBy=publishedAt&pageSize=5&apiKey=${API_KEY}`)
        .then(r => r.json())
        .catch(() => ({ articles: [] }))
    );

    const results = await Promise.all(fetches);

    const seen = new Set();
    const articles = results
      .flatMap(r => r.articles || [])
      .filter(a => {
        if (!a.title || a.title === '[Removed]' || seen.has(a.title)) return false;
        seen.add(a.title);
        return true;
      })
      .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
      .slice(0, 9);

    res.setHeader('Cache-Control', 's-maxage=300');
    return res.status(200).json({ status: 'ok', articles, fetchedAt: new Date().toISOString() });

  } catch (err) {
    return res.status(502).json({ error: 'Erreur serveur', detail: err.message });
  }
}
