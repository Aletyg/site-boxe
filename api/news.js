const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

export default async function handler(req, res) {
  const API_KEY = process.env.NEWS_API_KEY;
  
  if (!API_KEY) {
    return res.status(500).json({ error: "Clé API manquante dans Vercel" });
  }

  try {
    const response = await fetch(`https://newsapi.org/v2/everything?q=boxing&language=fr&sortBy=publishedAt&apiKey=${API_KEY}`);
    const data = await response.json();
    
    // Ajoute des headers pour éviter les blocages
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: "Erreur serveur", details: error.message });
  }
}
