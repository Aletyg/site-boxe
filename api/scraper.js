// api/scraper.js — Scrape les 4 sites boxe + résumé Gemini pour KO MAG
// Pas de clé NewsAPI nécessaire — scraping direct des sites sources

const GEMINI_KEY = () => process.env.GEMINI_API_KEY;

// ── Sources ──────────────────────────────────────────────────────────────────
const SOURCES = [
  {
    name: 'Boxenet',
    url: 'https://www.boxenet.fr',
    rss: 'https://www.boxenet.fr/feed/',
    color: '#E8001A',
  },
  {
    name: 'BoxeMag',
    url: 'https://boxemag.ouest-france.fr',
    rss: 'https://boxemag.ouest-france.fr/feed/',
    color: '#F5B800',
  },
  {
    name: 'RMC Sport',
    url: 'https://rmcsport.bfmtv.com/sports-de-combat/boxe/',
    rss: 'https://rmcsport.bfmtv.com/rss/sports-de-combat.xml',
    color: '#0066CC',
  },
  {
    name: "L'Équipe",
    url: 'https://www.lequipe.fr/Boxe/',
    rss: 'https://www.lequipe.fr/rss/actu_rss_Boxe.xml',
    color: '#FFCD00',
  },
];

// Mots-clés pour filtrer uniquement les articles boxe/combat
const COMBAT_KW = ['box','fight','ko','knock','champion','bout','ring','mma','ufc','kick','muay','combat','titre','ceinture','heavyweight','welter','lightweight','poids','gant','round','arbitre','puncheur'];

function isBoxingArticle(title, desc) {
  const txt = ((title||'')+(desc||'')).toLowerCase();
  return COMBAT_KW.some(k => txt.includes(k));
}

// ── Parser RSS/Atom simple (regex, pas de DOM côté serverless) ───────────────
function parseRSS(xml, sourceName, sourceUrl) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;

  const parseBlock = (block) => {
    const get = (tag) => {
      const m = block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([^<]*)<\\/${tag}>`));
      return m ? (m[1]||m[2]||'').trim() : '';
    };
    const getAttr = (tag, attr) => {
      const m = block.match(new RegExp(`<${tag}[^>]*${attr}=["']([^"']+)["']`));
      return m ? m[1] : '';
    };

    const title = decodeXML(get('title'));
    const desc  = decodeXML(get('description') || get('summary') || get('content:encoded'));
    const link  = get('link') || getAttr('link', 'href');
    const pubDate = get('pubDate') || get('published') || get('dc:date') || '';
    // Image : enclosure, media:content, ou img dans la description
    let img = getAttr('enclosure', 'url') || getAttr('media:content', 'url') || getAttr('media:thumbnail', 'url');
    if (!img) {
      const imgM = desc.match(/<img[^>]+src=["']([^"']+)["']/);
      if (imgM) img = imgM[1];
    }
    // Nettoyer la description HTML
    const cleanDesc = desc.replace(/<[^>]+>/g, '').replace(/\s+/g,' ').trim().slice(0, 400);

    if (!title || !link) return null;
    if (!isBoxingArticle(title, cleanDesc)) return null;

    return { title, link, img: img||'', desc: cleanDesc, pubDate, source: sourceName, sourceUrl };
  };

  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const item = parseBlock(m[1]);
    if (item) items.push(item);
  }
  if (items.length === 0) {
    while ((m = entryRe.exec(xml)) !== null) {
      const item = parseBlock(m[1]);
      if (item) items.push(item);
    }
  }
  return items;
}

function decodeXML(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ')
    .replace(/&#(\d+);/g, (_,n) => String.fromCharCode(n));
}

// ── Résumé Gemini d'un article ────────────────────────────────────────────────
async function summarizeArticle(article) {
  const key = GEMINI_KEY();
  if (!key) return null;

  const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-1.5-flash'];

  const prompt = `Tu es rédacteur senior de KO MAG, magazine de sports de combat.
Résume et enrichis cet article de boxe en français professionnel.

Titre original: "${article.title}"
Source: ${article.source} (${article.sourceUrl})
Description: "${article.desc}"

Réponds UNIQUEMENT en JSON valide (pas d'apostrophe dans les valeurs, utilise des guillemets ou remplace par ""):
{
  "titre": "...",
  "categorie": "RÉSULTATS|ANALYSE|INTERVIEW|ENTRAÎNEMENT|ÉVÉNEMENT|TRANSFERTS",
  "resume": "...",
  "contenu": "...",
  "sport": "boxing|mma|kickboxing|muaythai"
}

CONSIGNES:
- titre: accrocheur en français, max 10 mots
- resume: 1 phrase impactante max 15 mots
- contenu: résumé enrichi 150-200 mots, 2 paragraphes séparés par ###
  * Para 1: faits principaux avec contexte (80-100 mots)
  * Para 2: analyse et perspectives (70-100 mots)
- Pas apostrophe dans les valeurs JSON`;

  for (const model of MODELS) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({
            contents: [{parts:[{text: prompt}]}],
            generationConfig: { temperature: 0.6, maxOutputTokens: 800, responseMimeType: 'application/json' },
            systemInstruction: { parts: [{text: 'Tu es rédacteur KO MAG. JSON valide uniquement. Pas apostrophe dans valeurs JSON.'}] }
          })
        }
      );
      if (!r.ok) continue;
      const d = await r.json();
      const txt = (d.candidates?.[0]?.content?.parts?.[0]?.text||'').replace(/```json|```/g,'').trim();
      const parsed = JSON.parse(txt);
      return {
        ...parsed,
        url: article.link,
        img: article.img || '',
        temps: timeAgo(article.pubDate),
        source: article.source,
        sourceUrl: article.sourceUrl,
        isReal: true,
      };
    } catch(e) {
      console.error(`[scraper] ${model}:`, e.message);
    }
  }
  return null;
}

function timeAgo(str) {
  if (!str) return 'Récemment';
  const diff = Math.floor((Date.now() - new Date(str)) / 60000);
  if (isNaN(diff) || diff < 0) return 'Récemment';
  if (diff < 60) return `Il y a ${diff}min`;
  if (diff < 1440) return `Il y a ${Math.floor(diff/60)}h`;
  return `Il y a ${Math.floor(diff/1440)}j`;
}

// ── Cache serveur (1h) ────────────────────────────────────────────────────────
let cache = { articles: null, at: null, ttl: 60 * 60 * 1000 };

// ── Handler principal ─────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const now = Date.now();
  if (cache.articles && cache.at && (now - cache.at) < cache.ttl) {
    res.setHeader('Cache-Control', 's-maxage=3600,stale-while-revalidate=600');
    res.setHeader('X-Cache', 'HIT');
    return res.status(200).json({ articles: cache.articles, cached: true });
  }

  console.log('[scraper] Fetch RSS sources...');
  try {
    // 1. Scraper les 4 flux RSS en parallèle
    const feeds = await Promise.all(
      SOURCES.map(src =>
        fetch(src.rss, {
          headers: { 'User-Agent': 'KO-MAG/1.0 (https://komag.fr; contact@komag.fr)' },
          signal: AbortSignal.timeout(8000)
        })
        .then(r => r.ok ? r.text() : '')
        .then(xml => parseRSS(xml, src.name, src.url))
        .catch(e => { console.error('[scraper] RSS error', src.name, e.message); return []; })
      )
    );

    // 2. Agréger et trier par date
    const allRaw = feeds.flat()
      .filter((a, i, arr) => arr.findIndex(b => b.title === a.title) === i) // déduplication
      .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate))
      .slice(0, 12); // max 12 articles à résumer

    console.log(`[scraper] ${allRaw.length} articles bruts récupérés`);

    if (allRaw.length === 0) {
      return res.status(200).json({ articles: [], cached: false, error: 'Aucun article RSS récupéré' });
    }

    // 3. Résumer avec Gemini en parallèle (max 6 pour ne pas saturer l'API)
    const toSummarize = allRaw.slice(0, 6);
    const summarized = await Promise.all(
      toSummarize.map(a => summarizeArticle(a).catch(() => null))
    );

    const articles = summarized.filter(Boolean);
    console.log(`[scraper] ${articles.length} articles résumés OK`);

    if (articles.length > 0) {
      cache.articles = articles;
      cache.at = now;
    }

    res.setHeader('Cache-Control', 's-maxage=3600,stale-while-revalidate=600');
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json({ articles, cached: false });

  } catch(err) {
    console.error('[scraper] Erreur globale:', err.message);
    if (cache.articles) return res.status(200).json({ articles: cache.articles, cached: true, stale: true });
    return res.status(502).json({ error: err.message });
  }
}
