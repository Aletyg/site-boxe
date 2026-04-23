// api/articles.js — Cache articles sports de combat (1h)
// Articles longs avec retry automatique si JSON incomplet
const GEMINI_KEY = () => process.env.GEMINI_API_KEY;
const NEWS_KEY = () => process.env.NEWS_API_KEY;

let cache = { articles: null, generatedAt: null, ttl: 60 * 60 * 1000 };

const UNSPLASH = {
  boxing_fight:    'https://images.unsplash.com/photo-1579952363873-27f3bade9f55?w=800&q=85',
  boxing_training: 'https://images.unsplash.com/photo-1517438476312-10d79c077509?w=800&q=85',
  boxing_champ:    'https://images.unsplash.com/photo-1616279969856-759f316a5ac1?w=800&q=85',
  boxing_gloves:   'https://images.unsplash.com/photo-1607962837359-5e7e89f86776?w=800&q=85',
  boxing_ring:     'https://images.unsplash.com/photo-1549719386-74dfcbf7dbed?w=800&q=85',
  boxing_punch:    'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=800&q=85',
  mma:             'https://images.unsplash.com/photo-1555597673-b21d5c935865?w=800&q=85',
  mma_training:    'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=800&q=85',
  kickboxing:      'https://images.unsplash.com/photo-1616699002947-dc3e5a7a6fb3?w=800&q=85',
};

const BAD_IMG = ['soccer','football','basket','tennis','golf','rugby','swim','cricket','baseball','hockey','nfl','nba','volleyball'];

// ── Wikimedia Commons : photo réelle du boxeur par nom ──────────────────────
const wikiImgCache = {};
const BOXER_NAMES = ['Usyk','Fury','Canelo','Crawford','Davis','Garcia','Benavidez','Joshua','Wilder','Lomachenko','Haney','Tank','Beterbiev','Bivol','Inoue','Navarrete','Estrada'];

const WIKI_TITLES = {
  'usyk':       'Oleksandr Usyk',
  'fury':       'Tyson Fury',
  'canelo':     'Saúl Álvarez',
  'crawford':   'Terence Crawford',
  'davis':      'Gervonta Davis',
  'tank':       'Gervonta Davis',
  'garcia':     'Ryan Garcia',
  'benavidez':  'David Benavidez',
  'joshua':     'Anthony Joshua',
  'wilder':     'Deontay Wilder',
  'lomachenko': 'Vasyl Lomachenko',
  'haney':      'Devin Haney',
  'beterbiev':  'Artur Beterbiev',
  'bivol':      'Dmitry Bivol',
  'inoue':      'Naoya Inoue',
  'navarrete':  'Emanuel Navarrete',
  'estrada':    'Juan Francisco Estrada',
  'plant':      'Caleb Plant',
  'charlo':     'Jermell Charlo',
  'spence':     'Errol Spence Jr.',
  'loma':       'Vasyl Lomachenko',
};

async function fetchWikimediaImage(name) {
  if (!name) return null;
  const key = name.toLowerCase();
  if (wikiImgCache[key]) return wikiImgCache[key];
  const title = WIKI_TITLES[key] || name;
  try {
    const url = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=pageimages&pithumbsize=800&format=json`;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'KO-MAG/1.0 (https://komag.fr)' },
      signal: AbortSignal.timeout(5000)
    });
    if (!r.ok) return null;
    const d = await r.json();
    const pages = d?.query?.pages || {};
    const page = Object.values(pages)[0];
    const img = page?.thumbnail?.source || null;
    if (img) wikiImgCache[key] = img;
    return img;
  } catch(e) {
    return null;
  }
}

function detectBoxerName(titre) {
  if (!titre) return null;
  return BOXER_NAMES.find(n => titre.toLowerCase().includes(n.toLowerCase())) || null;
}

function getBestImg(titre, categorie, sport, originalImg) {
  // Garder l'image originale si elle semble pertinente
  if (originalImg && originalImg.length > 10 && !BAD_IMG.some(k => originalImg.toLowerCase().includes(k))) {
    return originalImg;
  }
  const t = (titre||'').toLowerCase();
  const s = (sport||'boxing').toLowerCase();
  if (s.includes('mma') || s.includes('ufc') || t.includes('mma') || t.includes('ufc')) {
    return categorie === 'ENTRAÎNEMENT' ? UNSPLASH.mma_training : UNSPLASH.mma;
  }
  if (s.includes('kick') || t.includes('kick') || s.includes('muay')) return UNSPLASH.kickboxing;
  if (categorie === 'ENTRAÎNEMENT') return UNSPLASH.boxing_training;
  if (categorie === 'RÉSULTATS') return UNSPLASH.boxing_fight;
  if (categorie === 'ÉVÉNEMENT') return UNSPLASH.boxing_ring;
  if (t.includes('champion') || t.includes('titre')) return UNSPLASH.boxing_champ;
  if (t.includes('gant') || t.includes('equip')) return UNSPLASH.boxing_gloves;
  return UNSPLASH.boxing_punch;
}

async function fetchNews() {
  const key = NEWS_KEY();
  if (!key) return [];
  try {
    const COMBAT_KW = ['box','fight','knock','punch','champion','bout','ring','mma','ufc','kick','muay','combat','titre','ceinture','heavyweight','welter','lightweight'];
    const isCombar = a => {
      const txt = ((a.title||'')+(a.description||'')).toLowerCase();
      return COMBAT_KW.some(k => txt.includes(k));
    };
    const queries = ['boxing champion fight', 'MMA UFC combat', 'kickboxing muay thai'];
    const results = await Promise.all(queries.map(q =>
      fetch(`https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&sortBy=publishedAt&pageSize=4&apiKey=${key}`)
        .then(r => r.json()).catch(() => ({articles:[]}))
    ));
    const seen = new Set();
    return results.flatMap(r => r.articles||[])
      .filter(a => a.title && a.title !== '[Removed]' && !seen.has(a.title) && isCombar(a) && seen.add(a.title))
      .sort((a,b) => new Date(b.publishedAt) - new Date(a.publishedAt))
      .slice(0, 6);
  } catch(e) { return []; }
}

// Appel Gemini avec retry si JSON incomplet
async function callGemini(prompt, maxRetries = 2) {
  const key = GEMINI_KEY();
  const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    for (const model of MODELS) {
      try {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
          {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({
              contents: [{parts:[{text: attempt > 0 ? prompt + '\n\nIMPORTANT: JSON doit etre COMPLET et se terminer par }]}' : prompt}]}],
              generationConfig: {
                temperature: 0.75,
                maxOutputTokens: 1500, // Plus de tokens pour articles longs
                responseMimeType: 'application/json'
              },
              systemInstruction: {
                parts: [{text: 'Tu es redacteur expert sports de combat pour KO MAG. Reponds UNIQUEMENT en JSON valide, complet et bien forme. Pas apostrophes dans les valeurs JSON. Articles detailles et professionnels.'}]
              }
            })
          }
        );
        const d = await r.json();
        if (!r.ok) { console.error(`[${model}] HTTP ${r.status}:`, d.error?.message); continue; }
        let txt = (d.candidates?.[0]?.content?.parts?.[0]?.text || '').replace(/```json|```/g,'').trim();
        
        // Tenter de réparer si JSON incomplet
        try {
          JSON.parse(txt);
        } catch(jsonErr) {
          console.warn(`[${model}] JSON incomplet (attempt ${attempt}), réparation...`);
          // Couper à la dernière entrée complète
          const lastBrace = txt.lastIndexOf('}');
          if (lastBrace > 0) {
            txt = txt.slice(0, lastBrace + 1);
            // Fermer les structures
            let opens = (txt.match(/\[/g)||[]).length - (txt.match(/\]/g)||[]).length;
            let openB = (txt.match(/\{/g)||[]).length - (txt.match(/\}/g)||[]).length;
            for(let i=0;i<openB;i++) txt += '}';
            for(let i=0;i<opens;i++) txt += ']';
          }
          try { JSON.parse(txt); } catch(e2) {
            if (attempt < maxRetries) break; // retry
            continue; // prochain modèle
          }
        }
        
        const parsed = JSON.parse(txt);
        console.log(`[KO MAG] OK: ${model} (attempt ${attempt})`);
        return parsed;
      } catch(e) {
        console.error(`[${model}] Exception:`, e.message);
      }
    }
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
  const date = new Date().toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  const cats = ['RÉSULTATS','ANALYSE','INTERVIEW','ENTRAÎNEMENT','ÉVÉNEMENT','TRANSFERTS'];
  const sources = ['LEquipe','RMC Sport','Eurosport','ESPN','MMA Fighting','BBC Sport'];

  const promises = cats.map((cat, i) => {
    const news = realNews[i];

    const prompt = news
      ? `Tu es redacteur senior pour KO MAG. Date: ${date}.
Traduis et developpe cet article en francais professionnel et detaille:
Titre original: "${news.title}"
Description: "${(news.description||'').slice(0,300)}"
Source: ${news.source?.name} | URL: ${news.url}

JSON uniquement (pas apostrophe dans valeurs):
{"articles":[{
  "titre":"...",
  "categorie":"${cat}",
  "resume":"...",
  "contenu":"...",
  "temps":"${timeAgo(news.publishedAt)}",
  "source":"${news.source?.name||sources[i]}",
  "url":"${news.url}",
  "img":"${news.urlToImage||''}",
  "sport":"..."
}]}

CONSIGNES:
- titre: accrocheur, max 10 mots, en francais
- resume: 1 phrase impactante, max 15 mots
- contenu: article complet de 300 mots minimum, 4 paragraphes separes par ###
  * Para 1: le fait principal avec contexte (80 mots)
  * Para 2: historique et enjeux (80 mots)  
  * Para 3: details, chiffres, citations (80 mots)
  * Para 4: perspectives et suite (60 mots)
- sport: boxing, mma, kickboxing, ou muaythai`
      : `Tu es redacteur senior pour KO MAG. Date: ${date}.
Redige un article original de sports de combat sur la categorie ${cat}.

JSON uniquement (pas apostrophe dans valeurs):
{"articles":[{
  "titre":"...",
  "categorie":"${cat}",
  "resume":"...",
  "contenu":"...",
  "temps":"Il y a ${i+1}h",
  "source":"${sources[i]}",
  "url":"",
  "img":"",
  "sport":"boxing"
}]}

CONSIGNES:
- titre: accrocheur sur la boxe/MMA, max 10 mots
- resume: 1 phrase impactante max 15 mots
- contenu: article de 300 mots minimum, 4 paragraphes separes par ###
  * Para 1: ouverture percutante avec fait principal (80 mots)
  * Para 2: contexte et historique (80 mots)
  * Para 3: analyse et details (80 mots)
  * Para 4: perspectives (60 mots)
- Citer des boxeurs reels: Usyk, Fury, Canelo, Crawford, Davis, Garcia, Benavidez
- sport: boxing, mma, kickboxing, ou muaythai`;

    return callGemini(prompt).catch(()=>null);
  });

  const results = await Promise.all(promises);
  const rawArticles = results
    .filter(r => r?.articles?.length > 0)
    .flatMap(r => r.articles);

  // Enrichissement Wikimedia Commons : photo réelle si boxeur détecté dans le titre
  const enriched = await Promise.all(rawArticles.map(async a => {
    let img = getBestImg(a.titre, a.categorie, a.sport, a.img);
    const boxerName = detectBoxerName(a.titre);
    if (boxerName) {
      const wikiImg = await fetchWikimediaImage(boxerName).catch(() => null);
      if (wikiImg) img = wikiImg;
    }
    return { ...a, img };
  }));

  return enriched;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const now = Date.now();
  const cacheValid = cache.articles && cache.generatedAt && (now-cache.generatedAt) < cache.ttl;

  if (cacheValid) {
    console.log('[KO MAG] Cache HIT — articles servis instantanement');
    res.setHeader('Cache-Control','s-maxage=3600,stale-while-revalidate=600');
    res.setHeader('X-Cache','HIT');
    return res.status(200).json({ articles: cache.articles, cached: true, generatedAt: cache.generatedAt });
  }

  console.log('[KO MAG] Cache MISS — generation en cours...');
  try {
    const realNews = await fetchNews();
    console.log(`[KO MAG] ${realNews.length} vraies news recuperees`);
    const articles = await generateArticles(realNews);
    console.log(`[KO MAG] ${articles.length} articles generes`);

    if (articles.length > 0) {
      cache.articles = articles;
      cache.generatedAt = now;
    }

    res.setHeader('Cache-Control','s-maxage=3600,stale-while-revalidate=600');
    res.setHeader('X-Cache','MISS');
    return res.status(200).json({ articles: cache.articles||[], cached: false, generatedAt: cache.generatedAt });
  } catch(err) {
    console.error('[KO MAG] Erreur generation:', err.message);
    if (cache.articles) return res.status(200).json({ articles: cache.articles, cached: true, stale: true });
    return res.status(502).json({ error: err.message });
  }
}
