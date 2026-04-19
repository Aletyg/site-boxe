// api/articles.js — Cache articles Gemini côté serveur (1h)
const GEMINI_KEY = () => process.env.GEMINI_API_KEY;
const NEWS_KEY = () => process.env.NEWS_API_KEY;

let cache = { articles: null, generatedAt: null, ttl: 60 * 60 * 1000 };

async function fetchNews() {
  const key = NEWS_KEY();
  if (!key) return [];
  try {
    const BOXING_KW = ['box','fight','knock','punch','champion','bout','ring','heavyweight','welter','lightweight','title','combat','boxe','usyk','fury','canelo','crawford','davis','garcia','joshua'];
    const isBoxing = a => {
      const txt = ((a.title||'')+(a.description||'')).toLowerCase();
      return BOXING_KW.some(k => txt.includes(k));
    };
    const r = await fetch(`https://newsapi.org/v2/everything?q=boxing+champion&sortBy=publishedAt&pageSize=6&apiKey=${key}`);
    const d = await r.json();
    const seen = new Set();
    return (d.articles||[])
      .filter(a => a.title && a.title !== '[Removed]' && !seen.has(a.title) && isBoxing(a) && seen.add(a.title))
      .slice(0, 6);
  } catch(e) { return []; }
}

async function callGemini(prompt) {
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
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 600, // Réduit à 600 pour éviter la troncature
              responseMimeType: 'application/json'
            },
            systemInstruction: {
              parts: [{ text: 'Reponds UNIQUEMENT en JSON valide et COMPLET. Texte tres court. Pas apostrophes.' }]
            }
          })
        }
      );
      const d = await r.json();
      if (!r.ok) { console.error(model, d.error?.message); continue; }
      const txt = (d.candidates?.[0]?.content?.parts?.[0]?.text || '').replace(/```json|```/g,'').trim();
      // Valider JSON
      JSON.parse(txt);
      console.log(`[KO MAG] OK: ${model}`);
      return JSON.parse(txt);
    } catch(e) {
      console.error(`[KO MAG] ${model} failed:`, e.message);
    }
  }
  return null;
}

function timeAgo(dateStr) {
  if (!dateStr) return 'Recemment';
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 60000);
  if (diff < 60) return `Il y a ${diff} min`;
  if (diff < 1440) return `Il y a ${Math.floor(diff/60)}h`;
  return `Il y a ${Math.floor(diff/1440)}j`;
}

async function generateArticles(realNews) {
  const date = new Date().toLocaleDateString('fr-FR', {day:'numeric',month:'long',year:'numeric'});
  const cats = ['RÉSULTATS','ANALYSE','INTERVIEW','ENTRAÎNEMENT','ÉVÉNEMENT','TRANSFERTS'];
  const sources = ['LEquipe','RMC Sport','Eurosport','ESPN','Sky Sports','BBC Sport'];

  // 1 article par appel - JSON minuscule, jamais tronqué
  const promises = cats.map((cat, i) => {
    const news = realNews[i];
    const prompt = news
      ? `Date: ${date}. Traduis en francais: "${news.title}". Source: ${news.source?.name}. URL: ${news.url}
JSON: {"articles":[{"titre":"...","categorie":"${cat}","resume":"...","contenu":"...","temps":"${timeAgo(news.publishedAt)}","source":"${news.source?.name||sources[i]}","url":"${news.url}"}]}
titre: max 8 mots. resume: max 8 mots. contenu: 2 phrases ###  2 phrases.`
      : `Date: ${date}. Article boxe ${cat}.
JSON: {"articles":[{"titre":"...","categorie":"${cat}","resume":"...","contenu":"...","temps":"Il y a ${i+1}h","source":"${sources[i]}","url":""}]}
titre: max 8 mots. resume: max 8 mots. contenu: 2 phrases ### 2 phrases.`;
    return callGemini(prompt).catch(() => null);
  });

  const results = await Promise.all(promises);
  return results.filter(r => r?.articles?.length > 0).flatMap(r => r.articles);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const now = Date.now();
  const cacheValid = cache.articles && cache.generatedAt && (now - cache.generatedAt) < cache.ttl;

  if (cacheValid) {
    console.log('[KO MAG] Cache HIT');
    res.setHeader('Cache-Control', 's-maxage=3600');
    res.setHeader('X-Cache', 'HIT');
    return res.status(200).json({ articles: cache.articles, cached: true });
  }

  console.log('[KO MAG] Cache MISS - génération...');
  try {
    const realNews = await fetchNews();
    const articles = await generateArticles(realNews);

    if (articles.length > 0) {
      cache.articles = articles;
      cache.generatedAt = now;
    }

    res.setHeader('Cache-Control', 's-maxage=3600');
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json({ articles: cache.articles || [], cached: false });
  } catch(err) {
    if (cache.articles) return res.status(200).json({ articles: cache.articles, cached: true, stale: true });
    return res.status(502).json({ error: err.message });
  }
}
