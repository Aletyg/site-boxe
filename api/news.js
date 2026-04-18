// api/gemini.js — Proxy Gemini pour KO MAG
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY manquante' });

  const { prompt, task = 'text' } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt manquant' });

  if (task === 'image') {
    try {
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
      const d = await r.json();
      if (!r.ok) throw new Error(d.error?.message || 'Imagen error ' + r.status);
      const b64 = d.predictions?.[0]?.bytesBase64Encoded;
      if (!b64) throw new Error('Pas d\'image retournée');
      res.setHeader('Cache-Control', 's-maxage=3600');
      return res.status(200).json({ image: `data:image/png;base64,${b64}` });
    } catch(err) {
      return res.status(502).json({ error: err.message });
    }
  }

  // Modèles disponibles en 2026, dans l'ordre de préférence
  const MODELS = [
    'gemini-2.0-flash-lite',
    'gemini-2.0-flash-001',
    'gemini-1.5-flash',
    'gemini-1.5-flash-latest',
    'gemini-1.5-flash-8b',
  ];

  let lastError = null;
  for (const model of MODELS) {
    try {
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
                text: `Tu es le rédacteur en chef de KO MAG, magazine de boxe de référence en France. Tu rédiges des articles longs, fouillés, avec un ton expert — comme L'Équipe ou RMC Sport. Tes articles font minimum 400 mots, 4-5 paragraphes séparés par ###. Tu réponds UNIQUEMENT en JSON valide, sans markdown, sans backtick.`
              }]
            }
          })
        }
      );

      const d = await r.json();
      if (!r.ok) {
        lastError = d.error?.message || 'HTTP ' + r.status;
        console.error(`[KO MAG] Model ${model} failed:`, lastError);
        continue;
      }

      const txt = d.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!txt) { lastError = 'Réponse vide'; continue; }

      res.setHeader('Cache-Control', 's-maxage=600');
      console.log(`[KO MAG] Success with model: ${model}`);
      return res.status(200).json({ result: txt.replace(/```json|```/g, '').trim(), model });

    } catch(err) {
      lastError = err.message;
      console.error(`[KO MAG] Model ${model} exception:`, err.message);
    }
  }

  return res.status(502).json({ error: 'Tous les modèles ont échoué: ' + lastError });
}
