export default async function handler(req, res) {
  // 1. URL diretto del file su GitHub con cache-buster temporale
  const githubRawUrl = `https://raw.githubusercontent.com/simrim96/GithubSlotMachine/main/slot.svg?t=${Date.now()}`;
  
  try {
    const response = await fetch(githubRawUrl);
    
    if (!response.ok) {
      return res.status(404).send("Immagine non trovata su GitHub");
    }

    const svgData = await response.text();

    // 2. Imposta gli header per distruggere la cache a ogni livello
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    // 3. Invia il contenuto dell'SVG
    return res.status(200).send(svgData);
  } catch (error) {
    return res.status(500).send("<svg><text y='20'>Errore di connessione a GitHub</text></svg>");
  }
}
