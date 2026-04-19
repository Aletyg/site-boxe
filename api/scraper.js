// api/scraper.js — Scrape les 4 sites boxe + résumé Gemini pour KO MAG
// Extrait la vidéo YouTube embarquée dans la page source si disponible

const GEMINI_KEY = () => process.env.GEMINI_API_KEY;

const SOURCES = [
  { name: 'BoxeMag',   url: 'https://boxemag.ouest-france.fr', rss: 'https://boxemag.ouest-france.fr/feed/' },
  { name: 'Boxenet',   url: 'https://www.boxenet.fr',          rss: 'https://www.boxenet.fr/feed/' },
  { name: 'RMC Sport', url: 'https://rmcsport.bfmtv.com',      rss: 'https://rmcsport.bfmtv.com/rss/sports-de-combat.xml' },
  { name: "L'Equipe",  url: 'https://www.lequipe.fr/Boxe/',    rss: 'https://www.lequipe.fr/rss/actu_rss_Boxe.xml' },
];

const COMBAT_KW = ['box','fight','ko','knock','champion','bout','ring','mma','ufc','kick','muay','combat','titre','ceinture','heavyweight','welter','lightweight','poids','gant','round','arbitre'];

function isBoxingArticle(title, desc) {
  const txt = ((title||'')+(desc||'')).toLowerCase();
  return COMBAT_KW.some(k => txt.includes(k));
}

// Extraire l'ID YouTube depuis n'importe quel HTML
function extractYoutubeId(html) {
  if (!html) return null;
  const patterns = [
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /"videoId"\s*:\s*"([a-zA-Z0-9_-]{11})"/,
    /data-videoid="([a-zA-Z0-9_-]{11})"/,
    /"video_id"\s*:\s*"([a-zA-Z0-9_-]{11})"/,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return m[1];
  }
  return null;
}

// Extraire og:image depuis le HTML de la page
function extractOgImage(html) {
  if (!html) return null;
  const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  return m ? m[1] : null;
}

// Fetcher la page article pour extraire YouTube + og:image
async function fetchArticlePage(url) {
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; KO-MAG/1.0; +https://komag.fr)',
        'Accept': 'text/html',
        'Accept-Language': 'fr-FR,fr;q=0.9',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return { youtubeId: null, ogImage: null };
    const html = await r.text();
    return {
      youtubeId: extractYoutubeId(html),
      ogImage: extractOgImage(html),
    };
  } catch(e) {
    return { youtubeId: null, ogImage: null };
  }
}

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

    const title   = decodeXML(get('title'));
    const rawDesc = get('description') || get('summary') || get('content:encoded') || '';
    const desc    = decodeXML(rawDesc);
    const link    = get('link') || getAttr('link', 'href');
    const pubDate = get('pubDate') || get('published') || get('dc:date') || '';

    let img = getAttr('enclosure', 'url') || getAttr('media:content', 'url') || getAttr('media:thumbnail', 'url');
    if (!img) {
      const imgM = rawDesc.match(/<img[^>]+src=["']([^"']+)["']/);
      if (imgM) img = decodeXML(imgM[1]);
    }

    // YouTube dans le RSS directement ?
    const ytInRss = extractYoutubeId(rawDesc);
    const cleanDesc = desc.replace(/<[^>]+>/g, '').replace(/\s+/g,' ').trim().slice(0, 400);

    if (!title || !link) return null;
    if (!isBoxingArticle(title, cleanDesc)) return null;

    return { title, link, img: img||'', desc: cleanDesc, pubDate, source: sourceName, sourceUrl, ytInRss };
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
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n));
}

async function summarizeArticle(article) {
  const key = GEMINI_KEY();
  if (!key) return null;
  const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-1.5-flash'];

  const prompt = `Tu es redacteur senior de KO MAG, magazine de sports de combat.
Resume et enrichis cet article en francais professionnel.

Titre original: "${article.title}"
Source: ${article.source}
Description: "${article.desc}"

Reponds UNIQUEMENT en JSON valide (pas apostrophe dans les valeurs, utilise guillemets ou supprime):
{
  "titre": "...",
  "categorie": "RESULTATS|ANALYSE|INTERVIEW|ENTRAINEMENT|EVENEMENT|TRANSFERTS",
  "resume": "...",
  "contenu": "...",
  "sport": "boxing|mma|kickboxing|muaythai"
}

CONSIGNES:
- titre: accrocheur en francais, max 10 mots
- resume: 1 phrase impactante max 15 mots
- contenu: 150-200 mots, 2 paragraphes separes par ###
- Pas apostrophe dans les valeurs JSON`;

  for (const model of MODELS) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.6, maxOutputTokens: 800, responseMimeType: 'application/json' },
            systemInstruction: { parts: [{ text: 'Tu es redacteur KO MAG. JSON valide uniquement. Pas apostrophe dans valeurs JSON.' }] }
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
        youtubeId: article.youtubeId || null,
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
  if (!str) return 'Recemment';
  const diff = Math.floor((Date.now() - new Date(str)) / 60000);
  if (isNaN(diff) || diff < 0) return 'Recemment';
  if (diff < 60) return `Il y a ${diff}min`;
  if (diff < 1440) return `Il y a ${Math.floor(diff/60)}h`;
  return `Il y a ${Math.floor(diff/1440)}j`;
}

let cache = { articles: null, at: null, ttl: 60 * 60 * 1000 };

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

  console.log('[scraper] Fetch RSS...');
  try {
    // 1. Lire les 4 flux RSS
    const feeds = await Promise.all(
      SOURCES.map(src =>
        fetch(src.rss, {
          headers: { 'User-Agent': 'KO-MAG/1.0 (https://komag.fr)' },
          signal: AbortSignal.timeout(8000),
        })
        .then(r => r.ok ? r.text() : '')
        .then(xml => parseRSS(xml, src.name, src.url))
        .catch(e => { console.error('[scraper] RSS', src.name, e.message); return []; })
      )
    );

    // 2. Agréger, dédupliquer, trier
    const allRaw = feeds.flat()
      .filter((a, i, arr) => arr.findIndex(b => b.title === a.title) === i)
      .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate))
      .slice(0, 9);

    console.log(`[scraper] ${allRaw.length} articles bruts`);
    if (allRaw.length === 0) return res.status(200).json({ articles: [], cached: false });

    // 3. Fetcher chaque page pour YouTube + og:image (en parallèle, max 9 requêtes)
    const enrichedRaw = await Promise.all(
      allRaw.map(async article => {
        // YouTube déjà dans le RSS ? Pas besoin de fetcher la page
        if (article.ytInRss) {
          return { ...article, youtubeId: article.ytInRss };
        }
        const { youtubeId, ogImage } = await fetchArticlePage(article.link);
        return {
          ...article,
          youtubeId: youtubeId || null,
          img: ogImage || article.img || '',
        };
      })
    );

    const withVideo = enrichedRaw.filter(a => a.youtubeId).length;
    console.log(`[scraper] ${withVideo}/${enrichedRaw.length} articles avec video YouTube`);

    // 4. Résumer avec Gemini (6 en parallèle max)
    const summarized = await Promise.all(
      enrichedRaw.slice(0, 6).map(a => summarizeArticle(a).catch(() => null))
    );

    const articles = summarized.filter(Boolean);
    console.log(`[scraper] ${articles.length} articles finaux OK`);

    if (articles.length > 0) {
      cache.articles = articles;
      cache.at = now;
    }

    res.setHeader('Cache-Control', 's-maxage=3600,stale-while-revalidate=600');
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json({ articles, cached: false });

  } catch(err) {
    console.error('[scraper] Erreur:', err.message);
    if (cache.articles) return res.status(200).json({ articles: cache.articles, cached: true, stale: true });
    return res.status(502).json({ error: err.message });
  }
}
