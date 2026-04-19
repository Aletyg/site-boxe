// api/debug.js — Diagnostique les sources RSS pour KO MAG
// Accessible sur /api/debug — à supprimer après diagnostic

const SOURCES_TEST = [
  {
    name: 'BoxeMag',
    urls: [
      'https://boxemag.ouest-france.fr/feed/',
      'https://boxemag.ouest-france.fr/?feed=rss2',
    ]
  },
  {
    name: 'Boxenet',
    urls: [
      'https://www.boxenet.fr/feed/',
      'https://www.boxenet.fr/?feed=rss2',
    ]
  },
  {
    name: 'RMC Sport',
    urls: [
      'https://rmcsport.bfmtv.com/rss/sports-de-combat.xml',
      'https://rmcsport.bfmtv.com/rss/boxe.xml',
      'https://www.bfmtv.com/rss/sport/sports-de-combat/',
    ]
  },
  {
    name: "L'Equipe",
    urls: [
      'https://www.lequipe.fr/rss/actu_rss_Boxe.xml',
      'https://www.lequipe.fr/rss/actu_rss_MMA.xml',
    ]
  },
];

const HEADERS = [
  { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
  { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36' },
  { 'User-Agent': 'KO-MAG/1.0 (https://komag.fr)' },
];

async function testUrl(url) {
  for (const headers of HEADERS) {
    try {
      const r = await fetch(url, {
        headers: { ...headers, 'Accept': 'application/rss+xml, application/xml, text/xml, */*' },
        signal: AbortSignal.timeout(8000),
      });
      const text = r.ok ? await r.text() : '';
      const isRSS = text.includes('<rss') || text.includes('<feed') || text.includes('<channel');
      const itemCount = (text.match(/<item>/g) || text.match(/<entry>/g) || []).length;
      return {
        url,
        status: r.status,
        ok: r.ok,
        size: text.length,
        isRSS,
        itemCount,
        userAgent: headers['User-Agent'].slice(0, 30),
        preview: text.slice(0, 200).replace(/\s+/g,' '),
      };
    } catch(e) {
      if (HEADERS.indexOf(headers) === HEADERS.length - 1) {
        return { url, error: e.message };
      }
    }
  }
  return { url, error: 'Toutes les tentatives ont échoué' };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  const results = {};
  for (const src of SOURCES_TEST) {
    results[src.name] = await Promise.all(src.urls.map(testUrl));
  }

  return res.status(200).json({
    timestamp: new Date().toISOString(),
    results,
    summary: Object.entries(results).map(([name, tests]) => ({
      name,
      working: tests.filter(t => t.isRSS && t.itemCount > 0).map(t => t.url),
      failed: tests.filter(t => !t.isRSS || t.itemCount === 0).map(t => t.url),
    }))
  });
}
