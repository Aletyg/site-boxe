// api/global.js — Sources mondiales sports de combat + traduction OpenAI GPT
// Cherche des articles sérieux du monde entier, traduit et résume en français
// Cron : toutes les heures via vercel.json

const OPENAI_KEY  = () => process.env.OPENAI_API_KEY;
const GEMINI_KEY  = () => process.env.GEMINI_API_KEY;

// ── Sources RSS mondiales sérieuses ──────────────────────────────────────────
const GLOBAL_SOURCES = [
  // USA
  { name: 'ESPN Boxing',        url: 'https://www.espn.com/boxing/',       rss: 'https://www.espn.com/espn/rss/boxing/news' },
  { name: 'The Ring Magazine',  url: 'https://www.ringtv.com',             rss: 'https://www.ringtv.com/feed/' },
  { name: 'Boxing Scene',       url: 'https://www.boxingscene.com',        rss: 'https://www.boxingscene.com/feed/' },
  { name: 'MMA Fighting',       url: 'https://www.mmafighting.com',        rss: 'https://www.mmafighting.com/rss/current' },
  { name: 'MMA Junkie',         url: 'https://mmajunkie.usatoday.com',     rss: 'https://mmajunkie.usatoday.com/feed' },
  { name: 'Bad Left Hook',      url: 'https://www.badlefthook.com',        rss: 'https://www.badlefthook.com/rss/current' },
  // UK
  { name: 'Sky Sports Boxing',  url: 'https://www.skysports.com/boxing',   rss: 'https://www.skysports.com/rss/12040' },
  { name: 'Boxing News',        url: 'https://www.boxingnewsonline.net',   rss: 'https://www.boxingnewsonline.net/feed/' },
  { name: 'BBC Sport Boxing',   url: 'https://www.bbc.com/sport/boxing',   rss: 'https://feeds.bbci.co.uk/sport/boxing/rss.xml' },
  // Via Google News (sources sans RSS direct)
  { name: 'World Boxing',       url: 'https://worldboxingnews.net',        rss: 'https://news.google.com/rss/search?q=boxing+MMA+combat+world&hl=en&gl=US&ceid=US:en' },
  { name: 'UFC News',           url: 'https://www.ufc.com',                rss: 'https://news.google.com/rss/search?q=UFC+MMA+fight+results&hl=en&gl=US&ceid=US:en' },
];

const COMBAT_KW = ['boxing','box','fight','ko','knockout','punch','champion','bout','ring','mma','ufc','kickbox','muay','combat','title','belt','heavyweight','welter','lightweight','middleweight','featherweight'];

function isBoxingArticle(title, desc) {
  const txt = ((title||'')+(desc||'')).toLowerCase();
  return COMBAT_KW.some(k => txt.includes(k));
}

// ── Parser RSS ────────────────────────────────────────────────────────────────
function parseRSS(xml, sourceName, sourceUrl) {
  const items = [];
  const blockRe = /<(?:item|entry)>([\s\S]*?)<\/(?:item|entry)>/g;

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
    const link    = get('link') || getAttr('link', 'href');
    const pubDate = get('pubDate') || get('published') || get('dc:date') || '';

    // Image : plusieurs sources possibles
    let img = getAttr('enclosure', 'url') || getAttr('media:content', 'url') || getAttr('media:thumbnail', 'url');
    if (!img) {
      const imgM = rawDesc.match(/<img[^>]+src=["']([^"']+)["']/);
      if (imgM) img = decodeXML(imgM[1]);
    }

    const cleanDesc = decodeXML(rawDesc).replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim().slice(0,500);
    if (!title || !link) return null;
    if (!isBoxingArticle(title, cleanDesc)) return null;

    return { title, link, img: img||'', desc: cleanDesc, pubDate, source: sourceName, sourceUrl, lang: 'en' };
  };

  let m;
  while ((m = blockRe.exec(xml)) !== null) {
    const item = parseBlock(m[1]);
    if (item) items.push(item);
  }
  return items;
}

function decodeXML(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ')
    .replace(/&#(\d+);/g,(_, n) => String.fromCharCode(n));
}

// ── Extraire og:image depuis la page source ───────────────────────────────────
const BAD_IMG_DOMAINS_G = [
  'news.google.com','gstatic.com','google.com/images',
  'placeholder','no-image','default','noimage','logo','icon','favicon',
];

function extractOgImage(html) {
  if (!html) return null;
  const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  const img = m ? m[1] : null;
  if (!img) return null;
  const u = img.toLowerCase();
  return BAD_IMG_DOMAINS_G.some(k => u.includes(k)) ? null : img;
}

function extractYoutubeId(html) {
  if (!html) return null;
  const patterns = [
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /"videoId"\s*:\s*"([a-zA-Z0-9_-]{11})"/,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return m[1];
  }
  return null;
}

async function fetchArticlePage(url) {
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok || r.status === 403) return { ogImage: null, youtubeId: null };
    const html = await r.text();
    return { ogImage: extractOgImage(html), youtubeId: extractYoutubeId(html) };
  } catch(e) {
    return { ogImage: null, youtubeId: null };
  }
}

// ── Traduction + résumé OpenAI GPT ───────────────────────────────────────────
async function translateWithGPT(article) {
  const key = OPENAI_KEY();
  if (!key) return null;

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 900,
        temperature: 0.6,
        messages: [
          {
            role: 'system',
            content: 'Tu es rédacteur senior pour KO MAG, magazine français de sports de combat. Tu traduis et résumes des articles anglophones en français professionnel. Tu réponds UNIQUEMENT en JSON valide, sans apostrophe dans les valeurs (remplace par des guillemets ou supprime).',
          },
          {
            role: 'user',
            content: `Traduis et résume cet article de sports de combat en français professionnel.

Titre original: "${article.title}"
Source: ${article.source} (${article.sourceUrl})
Contenu: "${article.desc}"

Réponds UNIQUEMENT en JSON valide:
{
  "titre": "titre accrocheur en français max 10 mots",
  "categorie": "RESULTATS|ANALYSE|INTERVIEW|ENTRAINEMENT|EVENEMENT|TRANSFERTS",
  "resume": "1 phrase impactante max 15 mots",
  "contenu": "article 200 mots minimum 2 paragraphes séparés par ###. Para1: faits principaux avec contexte (100 mots). Para2: analyse et perspectives (100 mots)",
  "sport": "boxing|mma|kickboxing|muaythai"
}`,
          },
        ],
      }),
    });

    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      console.error('[global] OpenAI error:', r.status, err.error?.message);
      return null;
    }

    const d = await r.json();
    const txt = (d.choices?.[0]?.message?.content || '').replace(/```json|```/g,'').trim();
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
      isGlobal: true,
    };
  } catch(e) {
    console.error('[global] GPT parse error:', e.message);
    return null;
  }
}

// Fallback Gemini si pas de clé OpenAI
async function translateWithGemini(article) {
  const key = GEMINI_KEY();
  if (!key) return null;

  const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];
  const prompt = `Tu es redacteur KO MAG. Traduis et resume en francais cet article de sports de combat.
Titre: "${article.title}" | Source: ${article.source} | Contenu: "${article.desc}"
JSON valide uniquement (pas apostrophe): {"titre":"...","categorie":"RESULTATS|ANALYSE|INTERVIEW|ENTRAINEMENT|EVENEMENT|TRANSFERTS","resume":"...","contenu":"...###...","sport":"boxing|mma|kickboxing|muaythai"}`;

  for (const model of MODELS) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.6, maxOutputTokens: 900, responseMimeType: 'application/json' },
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
        isGlobal: true,
      };
    } catch(e) { continue; }
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

// ── Cache serveur 1h ──────────────────────────────────────────────────────────
let cache = { articles: null, at: null, ttl: 60 * 60 * 1000 };

// ── Handler ───────────────────────────────────────────────────────────────────
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

  console.log('[global] Fetch sources mondiales...');

  const RSS_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Accept': 'application/rss+xml, application/xml, text/xml, */*',
  };

  try {
    // 1. Lire tous les flux RSS en parallèle
    const feeds = await Promise.all(
      GLOBAL_SOURCES.map(async src => {
        try {
          const r = await fetch(src.rss, { headers: RSS_HEADERS, signal: AbortSignal.timeout(8000) });
          if (!r.ok) { console.warn(`[global] RSS ${src.name}: HTTP ${r.status}`); return []; }
          const xml = await r.text();
          const items = parseRSS(xml, src.name, src.url);
          console.log(`[global] RSS ${src.name}: ${items.length} articles`);
          return items;
        } catch(e) {
          console.warn(`[global] RSS ${src.name}: ${e.message}`);
          return [];
        }
      })
    );

    // 2. Agréger, dédupliquer, trier par date, garder les 12 plus récents
    const allRaw = feeds.flat()
      .filter((a, i, arr) => arr.findIndex(b => b.title === a.title) === i)
      .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate))
      .slice(0, 12);

    console.log(`[global] ${allRaw.length} articles bruts récupérés`);
    if (allRaw.length === 0) {
      return res.status(200).json({ articles: [], cached: false, message: 'Aucun article trouvé' });
    }

    // 3. Fetcher chaque page source pour og:image + YouTube
    const enriched = await Promise.all(
      allRaw.map(async article => {
        const { ogImage, youtubeId } = await fetchArticlePage(article.link);
        const img = ogImage || article.img || '';
        console.log(`[global] "${article.title.slice(0,35)}" | img:${img?'OK':'AUCUNE'} | src:${article.source}`);
        return { ...article, img, youtubeId };
      })
    );

    // 4. Traduire + résumer avec GPT (ou Gemini en fallback), max 6 en parallèle
    const toTranslate = enriched.slice(0, 6);
    const hasOpenAI = !!OPENAI_KEY();
    console.log(`[global] Traduction via ${hasOpenAI ? 'OpenAI GPT-4o-mini' : 'Gemini (fallback)'}...`);

    const translated = await Promise.all(
      toTranslate.map(a =>
        (hasOpenAI ? translateWithGPT(a) : translateWithGemini(a)).catch(() => null)
      )
    );

    const articles = translated.filter(Boolean);
    console.log(`[global] ${articles.length} articles traduits et publiés`);

    if (articles.length > 0) {
      cache.articles = articles;
      cache.at = now;
    }

    res.setHeader('Cache-Control', 's-maxage=3600,stale-while-revalidate=600');
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json({
      articles,
      cached: false,
      engine: hasOpenAI ? 'openai-gpt4o-mini' : 'gemini',
    });

  } catch(err) {
    console.error('[global] Erreur:', err.message);
    if (cache.articles) return res.status(200).json({ articles: cache.articles, cached: true, stale: true });
    return res.status(502).json({ error: err.message });
  }
}
