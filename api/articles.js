// api/articles.js — Cache articles sports de combat (1h)
// Articles longs avec retry automatique si JSON incomplet
import { setCors } from './_cors.js'; // ← MODIFIÉ

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
        .then(r => r.json()).catch(()
