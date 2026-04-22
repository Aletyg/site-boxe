// api/wikimedia.js — Proxy Wikimedia Commons pour KO MAG
import { setCors } from './_cors.js'; // ← MODIFIÉ

const cache = {};

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

async function getWikiImage(name) {
  const key = name.toLowerCase();
  if (cache[key]) return cache[key];

  const title = WIKI_TITLES[key] || name;
  const url = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=pageimages&pithumbsize=800&format=json`;

  const r = await fetch(url, {
    headers: { 'User-Agent': 'KO-MAG/1.0 (https://komag.fr; contact@komag.fr)' }
  });
  if (!r.ok) throw new Error('Wikipedia HTTP ' + r.status);

  const d = await r.json();
  const pages = d?.query?.pages || {};
  const page = Object.values(pages)[0];
  const img = page?.thumbnail?.source || null;

  if (img) cache[key] = img;
  return img;
}

export default async function handler(req, res) {
  if (!setCors(req, res)) return; // ← MODIFIÉ
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { name } = req.query;
  if (!name || name.length < 2) return res.status(400).json({ error: 'name requis' });

  try {
    const img = await getWikiImage(name.trim());
    if (!img) return res.status(404).json({ error: 'Aucune image trouvée' });

    res.setHeader('Cache-Control', 's-maxage=86400');
    return res.status(200).json({ img });
  } catch(err) {
    return res.status(502).json({ error: err.message });
  }
}
