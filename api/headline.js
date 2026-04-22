// api/headline.js — Gemini choisit l'article le plus important
import { setCors } from './_cors.js'; // ← MODIFIÉ

const GEMINI_KEY = () => process.env.GEMINI_API_KEY;

let cache = { headline: null, at: null, ttl: 3 * 60 * 60 * 1000 };

export default async function handler(req, res) {
  if (!setCors(req, res)) return; // ← MODIFIÉ
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST requis' });

  const { articles } = req.body || {};
  if (!articles || !articles.length) return res.status(400).json({ error: 'articles requis' });

  const key = GEMINI_KEY();
  if (!key) return res.status(500).json({ error: 'GEMINI_API_KEY manquante' });

  if (cache.headline && cache.at && Date.now() - cache.at < cache.ttl) {
    console.log('[headline] Cache HIT');
    return res.status(200).json({ headline: cache.headline, cached: true });
  }

  const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-1.5-flash'];

  const candidates = articles.slice(0, 15).map((a, i) => {
    let age = '';
    if (a.temps) {
      const h = a.temps.match(/(\d+)h/);
      const m = a.temps.match(/(\d+)min/);
      const j = a.temps.match(/(\d+)j/);
      if (m) age = 'publié il y a ' + m[1] + ' minutes';
      else if (h) age = 'publié il y a ' + h[1] + 'h';
      else if (j) age = 'publié il y a ' + j[1] + ' jour(s)';
    }
    return `[${i}] "${a.titre}"
   Source: ${a.source || 'KO MAG'} | Catégorie: ${a.categorie || '?'} | Sport: ${a.sport || 'boxing'} | ${age || a.temps || ''}
   Résumé: ${(a.resume || '').slice(0, 120)}`;
  }).join('\n\n');

  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const prompt = `Tu es rédacteur en chef de KO MAG, magazine français de sports de combat. Date: ${today}.

Voici les ${Math.min(articles.length, 15)} articles publiés ces derniers jours :

${candidates}

MISSION : Choisir l'article qui mérite LA UNE du site aujourd'hui.

CRITÈRES DE SÉLECTION (ordre de priorité) :
1. 🥊 Résultat d'un combat majeur avec un grand nom (KO, titre mondial, upset)
2. 📢 Annonce officielle d'un combat très attendu par les fans
3. 💥 Scoop ou rebondissement majeur
4. 🎤 Interview exclusive d'un champion
5. 📊 Analyse ou classement qui fait débat
6. À défaut : l'article le plus récent

IMPORTANT : Préfère les articles récents (moins de 24h).

Réponds UNIQUEMENT en JSON valide :
{
  "index": 0,
  "raison": "explication courte et percutante de ton choix (max 15 mots)",
  "impact": "FORT|MOYEN|FAIBLE"
}`;

  for (const model of MODELS) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 150,
              responseMimeType: 'application/json',
            },
            systemInstruction: {
              parts: [{ text: 'Tu es rédacteur en chef expert en sports de combat. JSON valide uniquement.' }]
            }
          }),
        }
      );

      if (!r.ok) { console.warn(`[headline] ${model}: HTTP ${r.status}`); continue; }
      const d = await r.json();
      const txt = (d.candidates?.[0]?.content?.parts?.[0]?.text || '').replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(txt);

      const idx = parsed.index;
      if (typeof idx !== 'number' || idx < 0 || idx >= articles.length) {
        console.warn(`[headline] index invalide: ${idx}`); continue;
      }

      const headline = {
        index: idx,
        article: articles[idx],
        raison: parsed.raison || '',
        impact: parsed.impact || 'MOYEN',
        model,
      };

      cache.headline = headline;
      cache.at = Date.now();

      res.setHeader('Cache-Control', 's-maxage=10800');
      return res.status(200).json({ headline, cached: false });

    } catch(e) {
      console.error(`[headline] ${model}:`, e.message);
    }
  }

  return res.status(200).json({
    headline: { index: 0, article: articles[0], raison: 'Article le plus récent', impact: 'MOYEN', model: 'fallback' },
    cached: false,
  });
}
