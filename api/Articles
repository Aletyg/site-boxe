// api/articles.js — Cache articles Gemini côté serveur (1h)
// Premier visiteur attend ~10s, tous les autres ont les articles instantanément

const GEMINI_KEY = () => process.env.GEMINI_API_KEY;
const NEWS_KEY = () => process.env.NEWS_API_KEY;

// Cache en mémoire Vercel
let cache = {
  articles: null,
  generatedAt: null,
  ttl: 60 * 60 * 1000 // 1 heure
};

async function fetchNews() {
  const key = NEWS_KEY();
  if (!key) return [];
  try {
    const queries = ['boxing fight champion', 'boxe combat titre'];
    const BOXING_KW = ['box','fight','knock','punch','champion','bout','ring',
      'heavyweight','welter','lightweight','title','combat','boxe',
      'usyk','fury','canelo','crawford','davis','garcia','joshua'];
    const isBoxing = a => {
      const txt = ((a.title||'')+(a.description||'')).toLowerCase();
      return BOXING_KW.some(k => txt.includes(k));
    };
    const results = await Promise.all(queries.map(q =>
      fetch(`https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&sortBy=publishedAt&pageSize=6&apiKey=${key}`)
        .then(r => r.json()).catch(() => ({ articles: [] }))
    ));
    const seen = new Set();
    return results.flatMap(r => r.articles || [])
      .filter(a => a.title && a.title !== '[Removed]' && !seen.has(a.title) && isBoxing(a) && seen.add(a.title))
      .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
      .slice(0, 6);
  } catch(e) { return []; }
}

async function generateArticles(realNews) {
  const key = GEMINI_KEY();
  if (!key) throw new Error('GEMINI_API_KEY manquante');

  const date = new Date().toLocaleDateString('fr-FR', {weekday:'long',year:'numeric',month:'long',day:'numeric'});
  const ctx = realNews.length > 0
    ? realNews.slice(0,4).map((a,i) => `[${i}] "${a.title}" — ${(a.description||'').slice(0,150)} (url: ${a.url})`).join('\n')
    : '';

  const cats = ['RÉSULTATS','ANALYSE','INTERVIEW','ENTRAÎNEMENT','ÉVÉNEMENT','TRANSFERTS'];
  const boxeurs = ['Usyk','Fury','Canelo','Crawford','Davis','Garcia'];
  const sources = ['LEquipe','RMC Sport','Eurosport','ESPN','Sky Sports','BBC Sport'];

  // 6 appels en parallèle — 1 article par appel
  const results = await Promise.all(cats.map((cat, i) => {
    const hasReal = realNews[i];
    const prompt = hasReal
      ? `KO MAG redacteur. Date: ${date}.
Traduis et recris en francais professionnel:
Titre: "${hasReal.title}"
Resume: "${(hasReal.description||'').slice(0,200)}"
Source: ${hasReal.source?.name||'source'}
URL: ${hasReal.url}
JSON: {"articles":[{"titre":"...","categorie":"${cat}","resume":"...","contenu":"...","temps":"${timeAgoServer(hasReal.publishedAt)}","source":"${hasReal.source?.name||sources[i]}","url":"${hasReal.url}"}]}
resume: max 12 mots. contenu: 2 paragraphes 80 mots chacun separes par ###. Pas apostrophe.`
      : `KO MAG. Date: ${date}.
JSON: {"articles":[{"titre":"...","categorie":"${cat}","resume":"...","contenu":"...","temps":"Il y a ${i+1}h","source":"${sources[i]}","url":""}]}
1 article sur ${boxeurs[i]} en boxe. resume 10 mots. contenu 2 paragraphes 80 mots separes par ###. Pas apostrophe.`;

    return callGeminiServer(prompt).catch(() => null);
  }));

  return results
    .filter(r => r && r.articles && r.articles.length > 0)
    .flatMap(r => r.articles);
}

async function callGeminiServer(prompt) {
  const key = GEMINI_KEY();
  const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];
  for (const model of MODELS) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.7, maxOutputTokens: 800, responseMimeType: 'application/json' },
            systemInstruction: { parts: [{ text: 'Reponds UNIQUEMENT en JSON valide et complet. Sans apostrophes dans les valeurs.' }] }
          })
        }
      );
      const d = await r.json();
      if (!r.ok) continue;
      const txt = d.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const clean = txt.replace(/```json|```/g, '').trim();
      JSON.parse(clean); // valider
      return JSON.parse(clean);
    } catch(e) { continue; }
  }
  throw new Error('Tous les modeles ont echoue');
}

function timeAgoServer(dateStr) {
  if (!dateStr) return 'Récemment';
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 60000);
  if (diff < 60) return `Il y a ${diff} min`;
  if (diff < 1440) return `Il y a ${Math.floor(diff/60)}h`;
  return `Il y a ${Math.floor(diff/1440)}j`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const now = Date.now();
  const cacheValid = cache.articles && cache.generatedAt && (now - cache.generatedAt) < cache.ttl;

  if (cacheValid) {
    console.log('[KO MAG] Cache hit — articles servis instantanément');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
    res.setHeader('X-Cache', 'HIT');
    return res.status(200).json({
      articles: cache.articles,
      generatedAt: cache.generatedAt,
      cached: true
    });
  }

  // Cache expiré ou vide — générer de nouveaux articles
  console.log('[KO MAG] Cache miss — génération en cours...');
  try {
    const realNews = await fetchNews();
    const articles = await generateArticles(realNews);

    if (articles.length > 0) {
      cache.articles = articles;
      cache.generatedAt = now;
    }

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json({
      articles: cache.articles || [],
      generatedAt: cache.generatedAt,
      cached: false
    });
  } catch(err) {
    // En cas d'erreur, retourner le cache périmé si disponible
    if (cache.articles) {
      return res.status(200).json({ articles: cache.articles, cached: true, stale: true });
    }
    return res.status(502).json({ error: err.message });
  }
}
