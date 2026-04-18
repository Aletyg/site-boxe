// api/gemini.js — Proxy Gemini pour KO MAG
// Clé cachée côté serveur, zéro exposition au navigateur

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY manquante dans les variables Vercel.' });
  }

  const { prompt, model = 'gemini-2.0-flash', task = 'text' } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt manquant' });

  try {
    if (task === 'image') {
      // ── Génération d'image avec Imagen 3
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-001:predict?key=${GEMINI_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instances: [{ prompt }],
            parameters: { sampleCount: 1, aspectRatio: '16:9', safetySetting: 'block_only_high' }
          })
        }
      );
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error?.message || 'Imagen error ' + r.status);
      }
      const d = await r.json();
      const b64 = d.predictions?.[0]?.bytesBase64Encoded;
      if (!b64) throw new Error('Pas d\'image retournée');
      res.setHeader('Cache-Control', 's-maxage=3600'); // cache image 1h
      return res.status(200).json({ image: `data:image/png;base64,${b64}` });

    } else {
      // ── Génération de texte / articles avec Gemini 2.0 Flash
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.85,
              maxOutputTokens: 4000,
              responseMimeType: 'application/json'
            },
            systemInstruction: {
              parts: [{
                text: `Tu es le rédacteur en chef de KO MAG, magazine de boxe de référence en France. Tu rédiges des articles longs, fouillés, avec un ton expert et engageant — comme L'Équipe ou RMC Sport. Tes articles font minimum 400 mots, structurés en 4-5 paragraphes distincts séparés par ###. Tu utilises les vraies actualités fournies pour contextualiser. Tu réponds UNIQUEMENT en JSON valide, sans markdown, sans backtick.`
              }]
            }
          })
        }
      );
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error?.message || 'Gemini error ' + r.status);
      }
      const d = await r.json();
      const txt = d.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const clean = txt.replace(/```json|```/g, '').trim();

      res.setHeader('Cache-Control', 's-maxage=600'); // cache articles 10 min
      return res.status(200).json({ result: clean });
    }

  } catch (err) {
    console.error('Gemini proxy error:', err.message);
    return res.status(502).json({ error: err.message });
  }
}
