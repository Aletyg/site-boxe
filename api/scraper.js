// api/scraper.js — Scrape les 4 sites boxe + résumé Gemini pour KO MAG
// Extrait la vidéo YouTube via RSS, page HTML, et recherche YouTube RSS

const GEMINI_KEY = () => process.env.GEMINI_API_KEY;

// Sources directes (WordPress → RSS fiable)
const SOURCES_DIRECT = [
  {
    name: 'BoxeMag',
    url: 'https://boxemag.ouest-france.fr',
    rss: [
      'https://boxemag.ouest-france.fr/feed/',
      'https://boxemag.ouest-france.fr/?feed=rss2',
    ],
  },
  {
    name: 'Boxenet',
    url: 'https://www.boxenet.fr',
    rss: [
      'https://www.boxenet.fr/feed/',
      'https://www.boxenet.fr/?feed=rss2',
    ],
  },
];

const SOURCES_GOOGLE = [];

// Chaînes YouTube boxing de référence pour la recherche de vidéo
const BOXING_YT_CHANNELS = [
  'UCxKWFBLG0Miy1A6U8_1hCew', // Matchroom Boxing
  'UCKd7-SFfFMNLNKvJBiLhHlw', // ESPN Boxing
  'UCBe4uJDMnT5MMNZZ2e7-0Og', // Top Rank Boxing
  'UCQuEQKQ2vNMN6HyEjUhLGLg', // DAZN Boxing
  'UCRGMnzu6yYbSFpkDdMv53mA', // RMC Sport Combat
  'UCfkdLydtxHHJxGKq38GkVqQ', // BoxingScene
  'UC3yKpBnS41tqRBJpCqPQNXw', // UFC (résumés)
];

const COMBAT_KW = ['box','fight','ko','knock','champion','bout','ring','mma','ufc','kick','muay','combat','titre','ceinture','heavyweight','welter','lightweight','poids','gant','round','arbitre','burns','fury','usyk','canelo','crawford'];

function isBoxingArticle(title, desc) {
  const txt = ((title||'')+(desc||'')).toLowerCase();
  return COMBAT_KW.some(k => txt.includes(k));
}

// ── Extraction YouTube — tous les patterns possibles ─────────────────────────
function extractYoutubeId(text) {
  if (!text) return null;
  const patterns = [
    // Embed iframe
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    // Watch URL
    /youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
    // URL courte
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    // JSON videoId
    /"videoId"\s*:\s*"([a-zA-Z0-9_-]{11})"/,
    // data-videoid attribut HTML
    /data-videoid=["']([a-zA-Z0-9_-]{11})["']/,
    // WordPress block embed
    /wp-block-embed[^"]*"[^>]*>\s*(?:[\s\S]*?)youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
    // src avec youtube
    /src=["'][^"']*youtube\.com\/embed\/([a-zA-Z0-9_-]{11})[^"']*["']/,
    // ytplayer
    /"video_id"\s*:\s*"([a-zA-Z0-9_-]{11})"/,
    // URL dans attributs divers
    /youtube\.com[^"'\s]*[?&]v=([a-zA-Z0-9_-]{11})/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1] && m[1].length === 11) return m[1];
  }
  return null;
}

// ── Détection des mauvaises images (logo Google, placeholders...) ────────────
const BAD_IMG_DOMAINS = [
  'news.google.com', 'gstatic.com', 'google.com/images',
  'placeholder', 'no-image', 'default', 'noimage', 'logo', 'icon', 'favicon',
];

function isBadImage(url) {
  if (!url || url.length < 15) return true;
  const u = url.toLowerCase();
  return BAD_IMG_DOMAINS.some(k => u.includes(k));
}

// ── Extraire l'URL réelle depuis un lien Google News (qui redirige) ──────────
// Google News encode l'URL réelle en base64 dans le lien
function extractRealUrlFromGoogleNews(googleUrl) {
  if (!googleUrl || !googleUrl.includes('news.google.com')) return googleUrl;
  // Format: https://news.google.com/rss/articles/CBMi... — l'URL réelle est dans le HTML de la page
  // On laisse fetch() suivre la redirection HTTP naturellement
  return googleUrl;
}

function extractOgImage(html) {
  if (!html) return null;
  const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  const img = m ? m[1] : null;
  return img && !isBadImage(img) ? img : null;
}

// ── Fetcher la page source et extraire og:image + YouTube ───────────────────
// Extraire le texte principal d'un article HTML (supprime nav, footer, pub, etc.)
function extractArticleText(html) {
  if (!html) return '';
  // Supprimer scripts, styles, nav, footer, aside, pub
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<figure[\s\S]*?<\/figure>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  // Extraire le contenu des balises article/main en priorité
  const articleMatch = text.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
    || text.match(/<main[^>]*>([\s\S]*?)<\/main>/i)
    || text.match(/<div[^>]*(?:class|id)=["'][^"']*(?:content|article|post|body|story)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);

  const src = articleMatch ? articleMatch[1] : text;

  // Nettoyer les balises HTML restantes
  return src
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 3000); // max 3000 chars pour ne pas saturer le contexte
}

async function fetchArticlePage(url) {
  const agents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  ];

  for (const agent of agents) {
    try {
      const r = await fetch(url, {
        headers: {
          'User-Agent': agent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
          'Cache-Control': 'no-cache',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) continue;
      const html = await r.text();
      if (html.length < 500) continue;

      const ogImage   = extractOgImage(html);
      const youtubeId = extractYoutubeId(html);
      const fullText  = extractArticleText(html); // ← texte complet de l'article

      return { youtubeId, ogImage, fullText };
    } catch(e) {
      continue;
    }
  }
  return { youtubeId: null, ogImage: null, fullText: '' };
}

// ── Recherche YouTube via RSS des chaînes de référence ───────────────────────
function scoreMatch(articleTitle, videoTitle) {
  const words = articleTitle.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const vt = videoTitle.toLowerCase();
  return words.filter(w => vt.includes(w)).length;
}

async function findYoutubeVideoForArticle(articleTitle) {
  try {
    const feeds = await Promise.all(
      BOXING_YT_CHANNELS.map(channelId =>
        fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, {
          headers: { 'User-Agent': 'KO-MAG/1.0 (https://komag.fr)' },
          signal: AbortSignal.timeout(5000),
        })
        .then(r => r.ok ? r.text() : '')
        .catch(() => '')
      )
    );

    const allVideos = [];
    for (const xml of feeds) {
      if (!xml) continue;
      const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
      let m;
      while ((m = entryRe.exec(xml)) !== null) {
        const block = m[1];
        const vidM = block.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
        const titleM = block.match(/<title>([^<]+)<\/title>/);
        if (vidM && titleM) {
          allVideos.push({ videoId: vidM[1], title: decodeXML(titleM[1]) });
        }
      }
    }

    if (allVideos.length === 0) return null;

    // Scorer chaque vidéo par pertinence avec le titre de l'article
    const scored = allVideos
      .map(v => ({ ...v, score: scoreMatch(articleTitle, v.title) }))
      .filter(v => v.score > 0)
      .sort((a, b) => b.score - a.score);

    return scored.length > 0 ? scored[0].videoId : null;
  } catch(e) {
    return null;
  }
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
    const desc    = decodeXML(rawDesc);
    const link    = get('link') || getAttr('link', 'href');
    const pubDate = get('pubDate') || get('published') || get('dc:date') || '';

    let img = getAttr('enclosure', 'url') || getAttr('media:content', 'url') || getAttr('media:thumbnail', 'url');
    if (!img) {
      const imgM = rawDesc.match(/<img[^>]+src=["']([^"']+)["']/);
      if (imgM) img = decodeXML(imgM[1]);
    }

    // YouTube directement dans le RSS (fréquent pour BoxeMag/Boxenet qui embedent des vidéos dans leurs articles)
    const ytInRss = extractYoutubeId(rawDesc) || extractYoutubeId(block);

    const cleanDesc = desc.replace(/<[^>]+>/g, '').replace(/\s+/g,' ').trim().slice(0, 400);
    if (!title || !link) return null;
    if (!isBoxingArticle(title, cleanDesc)) return null;

    return { title, link, img: img||'', desc: cleanDesc, pubDate, source: sourceName, sourceUrl, ytInRss };
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
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n));
}

// ── Résumé Gemini ─────────────────────────────────────────────────────────────
async function summarizeArticle(article) {
  const key = GEMINI_KEY();
  if (!key) return null;
  const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-1.5-flash'];

  const today = new Date().toLocaleDateString("fr-FR", {day:"numeric",month:"long",year:"numeric"});
  const hasFullText = article.fullText && article.fullText.length > 200;
  const sourceContent = hasFullText
    ? `Texte complet de l article (${article.fullText.length} caractères lus directement sur le site):\n"${article.fullText}"`
    : `Description RSS (résumé partiel):\n"${article.desc}"`;

  const prompt = `Tu es redacteur senior expert en sports de combat pour KO MAG. Date du jour: ${today}.

ETAPE 1 - ANALYSE (reflechis avant de rediger):
Lis cet article source attentivement:
Titre: "${article.title}"
Source: ${article.source}
${sourceContent}

Pose-toi ces questions:
- L article dit "nous vous dirons quand" ou "date a confirmer" ? -> Si tu connais la vraie date, donne-la.
- L article parle d un combat sans donner le lieu ? -> Si tu connais le lieu officiel, complete.
- L article mentionne des boxeurs sans donner leur bilan ? -> Complete avec leurs vrais records.
- L article annonce un combat sans dire la diffusion ? -> Si tu sais sur quelle chaine, precise.
- L article presente des champions de facon incomplete ? -> Complete avec tous les champions que tu connais pour ces categories.
- L article contient des informations vagues ou incompletes ? -> Enrichis avec tes connaissances officielles.

ETAPE 2 - REDACTION:
Reponds UNIQUEMENT en JSON valide (pas apostrophe dans les valeurs):
{
  "titre": "titre accrocheur max 10 mots",
  "categorie": "RESULTATS|ANALYSE|INTERVIEW|ENTRAINEMENT|EVENEMENT|TRANSFERTS",
  "resume": "1 phrase impactante max 15 mots avec les vraies infos",
  "contenu": "article enrichi 200 mots, 2 paragraphes separes par ###. NE PAS ecrire nous vous dirons ou date a confirmer - donner les vraies infos si tu les connais. Etre factuel et precis.",
  "sport": "boxing|mma|kickboxing|muaythai",
  "combats": [],
  "champions": []
}

Pour combats - inclure si pertinent:
[{"boxeur1":"Nom (bilan)","boxeur2":"Nom (bilan)","date":"date officielle ou TBD si vraiment inconnue","lieu":"salle, ville, pays","titre":"organisation + categorie","diffusion":"chaine officielle"}]

Pour champions - inclure si pertinent:
[{"rang":"1","nom":"Prenom Nom","categorie":"categorie de poids","organisation":"WBC|WBA|WBO|IBF|IBO","bilan":"X-Y-Z","pays":"pays","statut":"Champion|Interim|Vacant"}]`;

  for (const model of MODELS) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.4, maxOutputTokens: 1400, responseMimeType: 'application/json' },
            systemInstruction: { parts: [{ text: 'Tu es un expert mondial des sports de combat. Tu connais tous les boxeurs, leurs bilans, les dates et lieux officiels des combats, les champions de chaque organisation. Tu enrichis toujours les articles avec tes vraies connaissances. JSON valide uniquement. Pas apostrophe.' }] }
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

  console.log('[scraper] Fetch RSS sources...');
  try {
    // 1. Lire les 4 flux RSS — essaie chaque URL de fallback
    const RSS_HEADERS = {
      'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      'Accept-Language': 'fr-FR,fr;q=0.9',
    };

    async function fetchRSS(src) {
      const urls = Array.isArray(src.rss) ? src.rss : [src.rss];
      for (const rssUrl of urls) {
        try {
          const r = await fetch(rssUrl, {
            headers: RSS_HEADERS,
            signal: AbortSignal.timeout(10000),
          });
          if (!r.ok) {
            console.warn(`[scraper] RSS ${src.name} → ${rssUrl} : HTTP ${r.status}`);
            continue;
          }
          const xml = await r.text();
          if (!xml || xml.length < 200) {
            console.warn(`[scraper] RSS ${src.name} → ${rssUrl} : vide (${xml.length} chars)`);
            continue;
          }
          const items = parseRSS(xml, src.name, src.url);
          console.log(`[scraper] RSS ${src.name} → ${rssUrl} : ${items.length} articles`);
          return items;
        } catch(e) {
          console.warn(`[scraper] RSS ${src.name} → ${rssUrl} : ${e.message}`);
        }
      }
      console.error(`[scraper] RSS ${src.name} : TOUTES les URLs ont échoué`);
      return [];
    }

    // Fetch sources directes + Google News en parallèle
    const [directFeeds, googleFeeds] = await Promise.all([
      Promise.all(SOURCES_DIRECT.map(fetchRSS)),
      Promise.all(SOURCES_GOOGLE.map(async src => {
        try {
          const r = await fetch(src.rss, {
            headers: RSS_HEADERS,
            signal: AbortSignal.timeout(10000),
          });
          if (!r.ok) { console.warn(`[scraper] GNews ${src.name}: HTTP ${r.status}`); return []; }
          const xml = await r.text();
          const items = parseRSS(xml, src.name, src.url);
          console.log(`[scraper] GNews ${src.name}: ${items.length} articles`);
          return items;
        } catch(e) {
          console.warn(`[scraper] GNews ${src.name}: ${e.message}`);
          return [];
        }
      })),
    ]);
    const feeds = [...directFeeds, ...googleFeeds];

    // 2. Agréger, dédupliquer, trier
    const allRaw = feeds.flat()
      .filter((a, i, arr) => arr.findIndex(b => b.title === a.title) === i)
      .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate))
      .slice(0, 9);

    console.log(`[scraper] ${allRaw.length} articles bruts`);
    if (allRaw.length === 0) return res.status(200).json({ articles: [], cached: false });

    // 3. Fetcher chaque page source pour og:image + YouTube + texte complet
    const enrichedRaw = await Promise.all(
      allRaw.map(async article => {
        const pageData = await fetchArticlePage(article.link);
        const youtubeId = article.ytInRss || pageData.youtubeId || null;
        const img = pageData.ogImage || article.img || '';
        const fullText = pageData.fullText || ''; // texte complet pour Gemini
        const hasFullText = fullText.length > 200;
        console.log(`[scraper] "${article.title.slice(0,35)}" | img:${img?'OK':'NON'} | texte:${hasFullText?fullText.length+'chars':'RSS seul'}`);
        return { ...article, youtubeId, img, fullText };
      })
    );

    const withVideo   = enrichedRaw.filter(a => a.youtubeId).length;
    const withImg     = enrichedRaw.filter(a => a.img).length;
    const withFullTxt = enrichedRaw.filter(a => a.fullText?.length > 200).length;
    console.log(`[scraper] ${withImg}/${enrichedRaw.length} img | ${withVideo}/${enrichedRaw.length} yt | ${withFullTxt}/${enrichedRaw.length} texte complet`);

    // 4. Résumer avec Gemini (6 max)
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
