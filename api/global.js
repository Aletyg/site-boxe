// api/global.js — Sources mondiales sports de combat + traduction OpenAI GPT
// Cherche des articles sérieux du monde entier, traduit et résume en français
// Cron : toutes les heures via vercel.json

import { setCors } from './_cors.js';

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
  // Via Google News
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
      const m = block.match(new RegExp(`<${tag}[^>]*${attr}=[\"']([^\"']+)[\"']`));
      return m ? m[1] : '';
    };

    const title   = decodeXML(get('title'));
    const rawDesc = get('description') || get('summary') || get('content:encoded') || '';
    const link    = get('link') || getAttr('link', 'href');
    const pubDate = get('pubDate') || get('published') || get('dc:date') || '';

    let img = getAttr('enclosure', 'url') || getAttr('media:content', 'url') || getAttr('media:thumbnail', 'url');
    if (!img) {
      const imgM = rawDesc.match(/<img[^>]+src=[\"']([^\"']+)[\"']/);
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
  const m = html.match(/<meta[^>]+property=[\"']og:image[\"'][^>]+content=[\"']([^\"']+)[\"']/i)
    || html.match(/<meta[^>]+content=[\"']([^\"']+)[\"'][^>]+property=[\"']og:image[\"']/i);
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
    /\"videoId\"\s*:\s*\"([a-zA-Z0-9_-]{11})\"/,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return m[1];
  }
  return null;
}

function extractArticleText(html) {
  if (!html) return '';
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '');
  const articleMatch = text.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
    || text.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  const src = articleMatch ? articleMatch[1] : text;
  return src.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 3000);
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
    if (!r.ok || r.status === 403) return { ogImage: null, youtubeId: null, fullText: '' };
    const html = await r.text();
    return {
      ogImage: extractOgImage(html),
      youtubeId: extractYoutubeId(html),
      fullText: extractArticleText(html),
    };
  } catch(e) {
    return { ogImage: null, youtubeId: null, fullText: '' };
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
        max_tokens: 1400,
        temperature: 0.3,
        messages: [
          {
            role: 'system',
            content: 'Tu es un expert mondial des sports de combat (boxe, MMA, kickboxing, muay thai) et rédacteur senior pour KO MAG, magazine FRANÇAIS. Tu connais tous les boxeurs professionnels, leurs bilans exacts, les dates et lieux officiels des grands combats, les champions actuels. Tu adaptes TOUJOURS les horaires en heure de Paris et les chaînes TV pour le marché français. Tu replies UNIQUEMENT en JSON valide, sans apostrophe dans les valeurs.',
          },
          {
            role: 'user',
            content: `Tu es rédacteur senior pour KO MAG, magazine français de sports de combat. TON PUBLIC EST EXCLUSIVEMENT FRANÇAIS.

ETAPE 1 - ANALYSE ET ADAPTATION FRANCE:
Article source à traiter:
Titre: "${article.title}"
Source: ${article.source}
${article.fullText && article.fullText.length > 200
  ? `Texte complet lu directement sur ${article.source} (${article.fullText.length} caractères):\n"${article.fullText}"`
  : `Description RSS (résumé partiel):\n"${article.desc}"`}

Avant de rédiger, vérifie et adapte obligatoirement:
- HORAIRES: l article donne un horaire US (ET/PT) ou UK (GMT/BST) ? -> Convertis en heure de Paris (CET hiver UTC+1, CEST été UTC+2). Toujours préciser "heure de Paris".
- CHAÎNES TV: l article cite ESPN, Sky Sports, BT Sport, Showtime, HBO, DAZN US, TNT Sports ? -> Remplace par l équivalent français: Canal+ Sport, RMC Sport 1/2, DAZN France, beIN Sports 1/2, L Equipe TV, TF1, France 2. Si tu ne connais pas la diffusion française exacte, écris "diffusion en France à confirmer".
- BILANS BOXEURS: pas de bilan dans la source ? -> Complete avec les vrais records.
- DATES: donne la date officielle si connue, jamais "à confirmer" si tu la connais.
- LIEUX: précise la salle et la ville si connues.

CHAÎNES FRANÇAISES DE RÉFÉRENCE POUR LA BOXE:
- Canal+ Sport: grands combats mondiaux, soirées Matchroom, Top Rank
- RMC Sport 1/2: UFC, combats MMA, certains galas boxe
- DAZN France: Matchroom Boxing, Golden Boy
- beIN Sports 1/2: combats internationaux
- L Equipe TV: galas français, boxe française
- TF1 / France 2: uniquement très grands événements (rare)

ETAPE 2 - REDACTION EN FRANCAIS:
Réponds UNIQUEMENT en JSON valide (sans apostrophe dans les valeurs):
{
  "titre": "titre accrocheur français max 10 mots",
  "categorie": "RESULTATS|ANALYSE|INTERVIEW|ENTRAINEMENT|EVENEMENT|TRANSFERTS",
  "resume": "1 phrase factuelle et percutante max 15 mots avec horaire français si pertinent",
  "contenu": "article 250 mots, 2 paragraphes séparés par ###. Para1: faits concrets avec date, horaire EN HEURE DE PARIS, chaîne EN FRANCE, lieu (120 mots). Para2: contexte, bilans des boxeurs, enjeux (130 mots). JAMAIS de phrases vagues.",
  "sport": "boxing|mma|kickboxing|muaythai",
  "combats": [],
  "champions": []
}

Pour combats (si pertinent):
[{"boxeur1":"Nom (bilan réel)","boxeur2":"Nom (bilan réel)","date":"date officielle","lieu":"Salle, Ville, Pays","horaire_france":"HHhMM heure de Paris","titre":"Organisation + Catégorie","diffusion":"chaîne française ou diffusion France à confirmer"}]

Pour champions (si pertinent):
[{"rang":"1","nom":"Prénom Nom","categorie":"Catégorie de poids","organisation":"WBC|WBA|WBO|IBF|IBO","bilan":"X-Y-Z","pays":"Pays","statut":"Champion|Interim|Vacant"}]`,
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

// ── Fallback Gemini si pas de clé OpenAI ─────────────────────────────────────
async function translateWithGemini(article) {
  const key = GEMINI_KEY();
  if (!key) return null;

  const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];
  const prompt = `Tu es redacteur KO MAG, magazine FRANÇAIS de sports de combat. Public exclusivement français.
Traduis et adapte pour la France cet article: Titre: "${article.title}" | Source: ${article.source} | Contenu: "${article.desc}"

ADAPTATION OBLIGATOIRE:
- Horaires -> convertis en heure de Paris (CET/CEST)
- Chaines TV -> remplace ESPN/Sky/BT Sport par Canal+ Sport, RMC Sport, DAZN France, beIN Sports selon le combat. Si inconnu: "diffusion France a confirmer"

JSON valide (pas apostrophe): {"titre":"...","categorie":"RESULTATS|ANALYSE|INTERVIEW|ENTRAINEMENT|EVENEMENT|TRANSFERTS","resume":"...","contenu":"faits avec horaire heure de Paris et chaine française###contexte et bilans boxeurs","sport":"boxing|mma|kickboxing|muaythai","combats":[{"boxeur1":"Nom (bilan)","boxeur2":"Nom (bilan)","date":"date officielle","lieu":"salle ville","horaire_france":"HHhMM heure de Paris","titre":"org+cat","diffusion":"chaine française"}],"champions":[{"rang":"1","nom":"Nom","categorie":"cat","organisation":"WBC","bilan":"X-Y","pays":"pays","statut":"Champion"}]}`;

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
            systemInstruction: { parts: [{ text: 'Tu es redacteur pour un magazine FRANÇAIS. Horaires en heure de Paris, chaines TV françaises. JSON valide, pas apostrophe.' }] }
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
  if (!setCors(req, res)) return;
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

    const allRaw = feeds.flat()
      .filter((a, i, arr) => arr.findIndex(b => b.title === a.title) === i)
      .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate))
      .slice(0, 12);

    console.log(`[global] ${allRaw.length} articles bruts récupérés`);
    if (allRaw.length === 0) {
      return res.status(200).json({ articles: [], cached: false, message: 'Aucun article trouvé' });
    }

    const enriched = await Promise.all(
      allRaw.map(async article => {
        const { ogImage, youtubeId, fullText } = await fetchArticlePage(article.link);
        const img = ogImage || article.img || '';
        const hasText = fullText && fullText.length > 200;
        console.log(`[global] "${article.title.slice(0,35)}" | img:${img?'OK':'NON'} | texte:${hasText?fullText.length+'ch':'RSS'}`);
        return { ...article, img, youtubeId, fullText: fullText || '' };
      })
    );

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
