// api/gemini.js — Proxy Gemini pour KO MAG
import { setCors } from './_cors.js'; // ← MODIFIÉ

export default async function handler(req, res) {
  if (!setCors(req, res)) return; // ← MODIFIÉ
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY manquante' });

  const { prompt, task = 'text' } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt manquant' });

  if (task === 'image') {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${GEMINI_KEY}`,
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
      if (!b64) throw new Error('Pas image');
      res.setHeader('Cache-Control', 's-maxage=3600');
      return res.status(200).json({ image: `data:image/png;base64,${b64}` });
    } catch(err) {
      return res.status(502).json({ error: err.message });
    }
  }

  const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-1.5-flash'];

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
              temperature: 0.7,
              maxOutputTokens: 1200,
              responseMimeType: 'application/json'
            },
            systemInstruction: {
              parts: [{
                text: 'Tu es redacteur de KO MAG. Reponds UNIQUEMENT en JSON valide et complet. Pas apostrophes dans les valeurs JSON. Texte court.'
              }]
            }
          })
        }
      );

      const d = await r.json();
      if (!r.ok) {
        lastError = d.error?.message || 'HTTP ' + r.status;
        console.error(`Model ${model} failed:`, lastError);
        continue;
      }

      const txt = d.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!txt) { lastError = 'Reponse vide'; continue; }

      const clean = txt.replace(/```json|```/g, '').trim();
      
      try {
        JSON.parse(clean);
      } catch(jsonErr) {
        lastError = 'JSON incomplet: ' + jsonErr.message;
        console.error(`Model ${model} JSON invalide:`, lastError);
        continue;
      }

      res.setHeader('Cache-Control', 's-maxage=600');
      console.log(`Success: ${model}`);
      return res.status(200).json({ result: clean, model });

    } catch(err) {
      lastError = err.message;
      console.error(`Model ${model} exception:`, err.message);
    }
  }

  return res.status(502).json({ error: 'Echec: ' + lastError });
}
