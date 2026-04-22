// api/headline.js — Gemini choisit l'article le plus important des 2-3 derniers jours
import { setCors } from './_cors.js';

const GEMINI_KEY = () => process.env.GEMINI_API_KEY;

let cache = { headline: null, at: null, ttl: 3 * 60 * 60 * 1000 }; // cache 3h

export default async function handler(req, res) {
  if (!setCors(req, res)) return;
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

MISSION : Choisir L'ARTICLE QUI VA FAIRE LE PLUS RÉAGIR les fans de sports de combat aujourd'hui — celui qui provoque de l'émotion, de la surprise, de l'indignation ou du débat.

CRITÈRES DE SÉLECTION (ordre de priorité) :

1. 💥 SCANDALE / CHOC — Ce qui provoque le plus de réactions :
   - Annulation d'un grand combat (dopage, blessure, contrat, problème de dernière minute)
   - Résultat surprise ou controverse (vol de décision, KO inattendu d'un favori)
   - Exclusion, suspension ou affaire disciplinaire d'un nom connu
   - Trahison, dispute publique entre camps, refus de combattre

2. 🥊 RÉSULTAT MAJEUR — Un grand combat s'est terminé :
   - KO ou TKO d'un champion ou ex-champion connu
   - Changement de ceinture mondiale (WBC, WBA, WBO, IBF)
   - Upset retentissant (outsider bat un favori)

3. 📢 ANNONCE EXPLOSIVE — Ce que tout le monde attend :
   - Combat officiel signé entre deux stars mondiales
   - Retour surprise d'un grand champion
   - Affrontement très attendu enfin confirmé

4. 🎤 DÉCLARATION FORTE — Quelqu'un a dit quelque chose de marquant :
   - Défi lancé publiquement
   - Révélation personnelle importante
   - Prise de position controversée

5. 📊 ANALYSE QUI FAIT DÉBAT — Si rien d'autre :
   - Classement contesté
   - Comparaison de champions qui divise

RÈGLES IMPORTANTES :
- Une annulation de combat (surtout pour dopage) > une simple annonce de combat
- Un scandale récent > un bon résultat ancien
- Préfère TOUJOURS les articles de moins de 48h
- Si deux articles ont le même impact, choisis le plus récent

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
              parts: [{ text: 'Tu es rédacteur en chef expert en sports de combat. Tu choisis la Une avec le plus grand impact émotionnel et éditorial pour les fans. Les scandales, annulations et surprises priment sur les simples annonces. JSON valide uniquement.' }]
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

      console.log(`[headline] ✅ Une: [${idx}] "${articles[idx].titre}" — ${parsed.raison} (impact: ${parsed.impact})`);

      res.setHeader('Cache-Control', 's-maxage=10800');
      return res.status(200).json({ headline, cached: false });

    } catch(e) {
      console.error(`[headline] ${model}:`, e.message);
    }
  }

  // Fallback
  return res.status(200).json({
    headline: { index: 0, article: articles[0], raison: 'Article le plus récent', impact: 'MOYEN', model: 'fallback' },
    cached: false,
  });
}
