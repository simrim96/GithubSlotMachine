export default async function handler(req, res) {
  const user = "simrim96";
  const repo = "GithubSlotMachine";
  
  // Usiamo un URL che GitHub non può aver memorizzato
  const url = `https://raw.githubusercontent.com/${user}/${repo}/main/slot.svg?nocache=${Date.now()}`;

  try {
    const response = await fetch(url, { cache: 'no-store' });
    const svg = await response.text();

    // Diciamo a GitHub e al Browser: "Dimentica questa immagine appena l'hai mostrata"
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.setHeader('Age', '0');
    res.setHeader('Pragma', 'no-cache');

    res.status(200).send(svg);
  } catch (e) {
    res.status(500).send("<svg><text y='20'>Errore</text></svg>");
  }
}
