// api/_cors.js — Gestion CORS centralisée pour KO MAG
const ALLOWED_ORIGIN = 'https://komag.fr';

export function setCors(req, res, { cronOnly = false } = {}) {
  const origin = req.headers.origin || '';
  const isCron = req.headers['x-vercel-cron'] === '1';

  if (cronOnly && !isCron) {
    res.status(403).json({ error: 'Accès non autorisé' });
    return false;
  }

  if (origin === ALLOWED_ORIGIN || isCron) {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  return true;
}
