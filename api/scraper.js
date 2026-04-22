async function summarizeArticle(article) {
  const key = GEMINI_KEY();
  if (!key) return null;
  const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-1.5-flash'];

  const today = new Date().toLocaleDateString("fr-FR", {day:"numeric",month:"long",year:"numeric"});
  const hasFullText = article.fullText && article.fullText.length > 200;
  const sourceContent = hasFullText
    ? `Texte complet de l article (${article.fullText.length} caractères lus directement sur le site):\n"${article.fullText}"`
    : `Description RSS (résumé partiel):\n"${article.desc}"`;

  const prompt = `Tu es redacteur senior expert en sports de combat pour KO MAG. Date du jour: ${today}.
TON PUBLIC EST EXCLUSIVEMENT FRANÇAIS. Toutes les informations doivent être adaptées pour un lecteur en France.

ETAPE 1 - ANALYSE (reflechis avant de rediger):
Lis cet article source attentivement:
Titre: "${article.title}"
Source: ${article.source}
${sourceContent}

Pose-toi ces questions:
- L article dit "nous vous dirons quand" ou "date a confirmer" ? -> Si tu connais la vraie date, donne-la.
- L article parle d un combat sans donner le lieu ? -> Si tu connais le lieu officiel, complete.
- L article mentionne des boxeurs sans donner leur bilan ? -> Complete avec leurs vrais records.
- L article annonce un combat sans dire la diffusion ? -> Cherche sur quelle chaine c est diffuse EN FRANCE (Canal+, RMC Sport, DAZN France, beIN Sports, TF1, France 2, L Equipe TV) et precise-le.
- L article donne un horaire en heure locale americaine ou britannique ? -> Convertis en heure française (Paris, CET/CEST).
- L article presente des champions de facon incomplete ? -> Complete avec tous les champions que tu connais.
- L article contient des informations vagues ou incompletes ? -> Enrichis avec tes connaissances officielles.

ADAPTATION FRANCE OBLIGATOIRE:
- Horaires: toujours en heure de Paris (CET hiver = UTC+1, CEST ete = UTC+2). Indique "heure française" ou "heure de Paris".
- Chaines TV: remplace ESPN/Sky Sports/BT Sport/DAZN US par l equivalent francais. Si tu ne connais pas la chaine française exacte, ecris "diffusion en France a confirmer" plutot que de donner une chaine etrangere.
- Chaines françaises courantes pour la boxe: Canal+ Sport, RMC Sport 1/2, DAZN France, beIN Sports 1/2, L Equipe TV, TF1 (grands evenements), France 2 (grands evenements).
- Prix en euros si mentionnes, pas en dollars ou livres.

ETAPE 2 - REDACTION:
Reponds UNIQUEMENT en JSON valide (pas apostrophe dans les valeurs):
{
  "titre": "titre accrocheur max 10 mots",
  "categorie": "RESULTATS|ANALYSE|INTERVIEW|ENTRAINEMENT|EVENEMENT|TRANSFERTS",
  "resume": "1 phrase impactante max 15 mots avec les vraies infos",
  "contenu": "article enrichi 200 mots, 2 paragraphes separes par ###. Para1: faits principaux avec date, lieu, horaire EN HEURE FRANÇAISE, chaine EN FRANCE (80 mots). Para2: contexte, enjeux, bilans des boxeurs (120 mots). NE PAS ecrire nous vous dirons ou date a confirmer.",
  "sport": "boxing|mma|kickboxing|muaythai",
  "combats": [],
  "champions": []
}

Pour combats - inclure si pertinent:
[{"boxeur1":"Nom (bilan)","boxeur2":"Nom (bilan)","date":"date officielle","lieu":"salle, ville, pays","horaire_france":"HHhMM heure de Paris","titre":"organisation + categorie","diffusion":"chaine française ou diffusion France a confirmer"}]

Pour champions - inclure si pertinent:
[{"rang":"1","nom":"Prenom Nom","categorie":"categorie de poids","organisation":"WBC|WBA|WBO|IBF|IBO","bilan":"X-Y-Z","pays":"pays","statut":"Champion|Interim|Vacant"}]`;

  for (const model of MODELS) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.4, maxOutputTokens: 1400, responseMimeType: 'application/json' },
            systemInstruction: { parts: [{ text: 'Tu es un expert mondial des sports de combat et redacteur pour un magazine FRANÇAIS. Tu adaptes toujours les horaires en heure de Paris et les chaines TV pour le marche français. JSON valide uniquement. Pas apostrophe.' }] }
          })
        }
      );
      if (!r.ok) continue;
      const d = await r.json();
      const txt = (d.candidates?.[0]?.content?.parts?.[0]?.text||'').replace(/```json|```/g,'').trim();
      const parsed = JSON.parse(txt);
      return {
        ...parsed,
        url: article.link,
        img: article.img || '',
        youtubeId: article.youtubeId || null,
        temps: timeAgo(article.pubDate),
        source: article.source,
        sourceUrl: article.sourceUrl,
        isReal: true,
      };
    } catch(e) {
      console.error(`[scraper] ${model}:`, e.message);
    }
  }
  return null;
}
