export default async function handler(req, res) {
  // Cambia TUO_USER e NOME_REPO con i tuoi dati reali
  const user = "simrim96";
  const repo = "GithubSlotMachine";
  
  // Il timestamp forza GitHub a scaricare il file nuovo dalla repo
  const githubUrl = `https://raw.githubusercontent.com/${user}/${repo}/main/slot.svg?t=${Date.now()}`;

  try {
    const response = await fetch(githubUrl);
    const svg = await response.text();

    // Diciamo al browser (e a GitHub) di NON memorizzare nulla
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    res.status(200).send(svg);
  } catch (e) {
    res.status(500).send("<svg><text y='20'>Errore caricamento</text></svg>");
  }
}
