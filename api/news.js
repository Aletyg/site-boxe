// api/news.js
export default async function handler(req, res) {
  const API_KEY = process.env.NEWS_API_KEY;
  const response = await fetch(`https://newsapi.org/v2/everything?q=boxing&apiKey=${API_KEY}`);
  const data = await response.json();
  res.status(200).json(data);
}