// api/articles.js — Cache articles sports de combat (1h)
const GEMINI_KEY = () => process.env.GEMINI_API_KEY;
const NEWS_KEY = () => process.env.NEWS_API_KEY;

let cache = { articles: null, generatedAt: null, ttl: 60 * 60 * 1000 };

// Images Unsplash ultra-ciblées par sport et catégorie
const UNSPLASH = {
  boxing_gloves: 'https://images.unsplash.com/photo-1607962837359-5e7e89f86776?w=800&q=85',
  boxing_ring: 'https://images.unsplash.com/photo-1549719386-74dfcbf7dbed?w=800&q=85',
  boxing_fight: 'https://images.unsplash.com/photo-1579952363873-27f3bade9f55?w=800&q=85',
  boxing_training: 'https://images.unsplash.com/photo-1517438476312-10d79c077509?w=800&q=85',
  boxing_punch: 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=800&q=85',
  boxing_champion: 'https://images.unsplash.com/photo-1616279969856-759f316a5ac1?w=800&q=85',
  mma_fight: 'https://images.unsplash.com/photo-1555597673-b21d5c935865?w=800&q=85',
  mma_training: 'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=800&q=85',
  kickboxing: 'https://images.unsplash.com/photo-1616699002947-dc3e5a7a6fb3?w=800&q=85',
  default: 'https://images.unsplash.com/photo-1549719386-74dfcbf7dbed?w=800&q=85',
};

// Sélectionner la meilleure image Unsplash selon le titre/catégorie
function getBestUnsplash(titre, categorie, sport) {
  const t = (titre || '').toLowerCase();
  const s = (sport || '').toLowerCase();
  if (s.includes('mma') || s.includes('ufc') || t.includes('mma') || t.includes('ufc')) return UNSPLASH.mma_fight;
  if (s.includes('kick') || t.includes('kick')) return UNSPLASH.kickboxing;
  if (t.includes('entrainement') || t.includes('training') || t.includes('sparring')) return UNSPLASH.boxing_training;
  if (t.includes('champion') || t.includes('titre') || t.includes('ceinture')) return UNSPLASH.boxing_champion;
  if (t.includes('ko') || t.includes('knockout') || t.includes('combat') || t.includes('fight')) return UNSPLASH.boxing_fight;
  if (t.includes('gant') || t.includes('equip')) return UNSPLASH.boxing_gloves;
  if (categorie === 'ENTRAÎNEMENT') return UNSPLASH.boxing_training;
  if (categorie === 'RÉSULTATS') return UNSPLASH.boxing_fight;
  if (categorie === 'ÉVÉNEMENT') return UNSPLASH.boxing_ring;
  return UNSPLASH.boxing_champion;
}

// Vérifier si une image URL est valide et liée aux sports de combat
const BAD_DOMAINS = ['football','soccer','basketball','tennis','golf','rugby','baseball','hockey','cricket','nfl','nba','swim','athlet','run','cycl','ski','volley'];
function isGoodImage(url) {
  if (!url || url.length < 10) return false;
  const u = url.toLowerCase();
  return !BAD_DOMAINS.some(k => u.includes(k));
}

async function fetchNews() {
  const key = NEWS_KEY();
  if (!key) return [];
  try {
    // Requêtes couvrant tous les sports de combat
    const queries = [
      'boxing champion fight',
      'MMA UFC combat',
      'kickboxing muay thai',
      'boxe combat sport'
    ];
    const COMBAT_KW = ['box','fight','knock','punch','champion','bout','ring','mma','ufc','kick','muay','thai','combat','grappl','wrestl','judo','karate','jiu','titre','ceinture'];
    const isCombar = a => {
      const txt = ((a.title||'')+(a.description||'')).toLowerCase();
      return COMBAT_KW.some(k => txt.includes(k));
    };

    const results = await Promise.all(queries.map(q =>
      fetch(`https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&sortBy=publishedAt&pageSize=5&apiKey=${key}`)
        .then(r => r.json()).catch(() => ({articles:[]}))
    ));

    const seen = new Set();
    return results.flatMap(r => r.articles||[])
      .filter(a => a.title && a.title !== '[Removed]' && !seen.has(a.title) && isCombar(a) && seen.add(a.title))
      .sort((a,b) => new Date(b.publishedAt) - new Date(a.publishedAt))
      .slice(0, 6);
  } catch(e) { return []; }
}

async function callGemini(prompt) {
  const key = GEMINI_KEY();
  for (const model of ['gemini-2.5-flash','gemini-2.5-flash-lite']) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({
            contents: [{parts:[{text:prompt}]}],
            generationConfig: { temperature:0.7, maxOutputTokens:500, responseMimeType:'application/json' },
            systemInstruction: { parts:[{text:'JSON valide et complet uniquement. Texte tres court. Pas apostrophes dans valeurs JSON.'}] }
          })
        }
      );
      const d = await r.json();
      if (!r.ok) continue;
      const txt = (d.candidates?.[0]?.content?.parts?.[0]?.text||'').replace(/```json|```/g,'').trim();
      JSON.parse(txt); // valider
      return JSON.parse(txt);
    } catch(e) { continue; }
  }
  return null;
}

function timeAgo(str) {
  if (!str) return 'Recemment';
  const diff = Math.floor((Date.now()-new Date(str))/60000);
  if (diff < 60) return `Il y a ${diff}min`;
  if (diff < 1440) return `Il y a ${Math.floor(diff/60)}h`;
  return `Il y a ${Math.floor(diff/1440)}j`;
}

async function generateArticles(realNews) {
  const date = new Date().toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'});
  const cats = ['RÉSULTATS','ANALYSE','INTERVIEW','ENTRAÎNEMENT','ÉVÉNEMENT','TRANSFERTS'];
  const sources = ['LEquipe','RMC Sport','Eurosport','ESPN','MMA Fighting','Le Monde'];

  const promises = cats.map((cat, i) => {
    const news = realNews[i];
    const prompt = news
      ? `Date: ${date}. Sport de combat. Traduis en francais: "${news.title}". Source: ${news.source?.name}. URL: ${news.url}. Image disponible: ${news.urlToImage||'aucune'}.
JSON: {"articles":[{"titre":"...","categorie":"${cat}","resume":"...","contenu":"...","temps":"${timeAgo(news.publishedAt)}","source":"${news.source?.name||sources[i]}","url":"${news.url}","img":"${news.urlToImage||''}","sport":"..."}]}
sport: boxing/mma/kickboxing/muaythai/other. titre max 8 mots. resume max 8 mots. contenu: 2 phrases courtes ### 2 phrases courtes.`
      : `Date: ${date}. Article sport de combat categorie ${cat}.
JSON: {"articles":[{"titre":"...","categorie":"${cat}","resume":"...","contenu":"...","temps":"Il y a ${i+1}h","source":"${sources[i]}","url":"","img":"","sport":"boxing"}]}
sport: boxing/mma/kickboxing. titre max 8 mots. resume max 8 mots. contenu: 2 phrases ### 2 phrases.`;
    return callGemini(prompt).catch(()=>null);
  });

  const results = await Promise.all(promises);
  return results
    .filter(r => r?.articles?.length > 0)
    .flatMap(r => r.articles)
    .map(a => ({
      ...a,
      // Choisir la meilleure image : vraie photo si cohérente, sinon Unsplash ciblé
      img: isGoodImage(a.img) ? a.img : getBestUnsplash(a.titre, a.categorie, a.sport)
    }));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const now = Date.now();
  const cacheValid = cache.articles && cache.generatedAt && (now-cache.generatedAt) < cache.ttl;

  if (cacheValid) {
    console.log('[KO MAG] Cache HIT');
    res.setHeader('Cache-Control','s-maxage=3600');
    return res.status(200).json({ articles: cache.articles, cached: true });
  }

  console.log('[KO MAG] Cache MISS - génération...');
  try {
    const realNews = await fetchNews();
    const articles = await generateArticles(realNews);
    if (articles.length > 0) { cache.articles = articles; cache.generatedAt = now; }
    res.setHeader('Cache-Control','s-maxage=3600');
    return res.status(200).json({ articles: cache.articles||[], cached: false });
  } catch(err) {
    if (cache.articles) return res.status(200).json({ articles: cache.articles, cached: true, stale: true });
    return res.status(502).json({ error: err.message });
  }
}
