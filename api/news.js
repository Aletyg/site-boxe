// api/news.js — Proxy NewsAPI pour KO MAG — filtre articles boxe uniquement
import { setCors } from './_cors.js'; // ← MODIFIÉ

export default async function handler(req, res) {
  if (!setCors(req, res)) return; // ← MODIFIÉ
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const API_KEY = process.env.NEWS_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: 'NEWS_API_KEY manquante' });

  const queries = [
    'boxing fight champion',
    'boxe combat titre mondial',
    'knockout boxing match'
  ];

  const BOXING_KEYWORDS = ['box', 'fight', 'knock', 'punch', 'champion', 'bout', 
    'ring', 'heavyweight', 'welter', 'lightweight', 'middleweight', 'title', 
    'combat', 'boxe', 'pugiliste', 'usyk', 'fury', 'canelo', 'crawford', 
    'davis', 'garcia', 'joshua', 'dubois', 'benavidez'];

  const isBoxing = (article) => {
    const txt = ((article.title || '') + ' ' + (article.description || '')).toLowerCase();
    return BOXING_KEYWORDS.some(k => txt.includes(k));
  };

  try {
    const fetches = queries.map(q =>
      fetch(`https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&sortBy=publishedAt&pageSize=8&apiKey=${API_KEY}`)
        .then(r => r.json())
        .catch(() => ({ articles: [] }))
    );

    const results = await Promise.all(fetches);

    const seen = new Set();
    const articles = results
      .flatMap(r => r.articles || [])
      .filter(a => {
        if (!a.title || a.title === '[Removed]' || seen.has(a.title)) return false;
        if (!isBoxing(a)) return false;
        seen.add(a.title);
        return true;
      })
      .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
      .slice(0, 9);

    res.setHeader('Cache-Control', 's-maxage=300');
    return res.status(200).json({ status: 'ok', articles, fetchedAt: new Date().toISOString() });

  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
}
