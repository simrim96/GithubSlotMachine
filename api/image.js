export default async function handler(req, res) {
  const user = "simrim96";
  const repo = "GithubSlotMachine";
  
  // Usa la GitHub Contents API invece di raw.githubusercontent.com
  // perché raw ha una CDN cache aggressiva (~5 min) che serve contenuti vecchi
  const url = `https://api.github.com/repos/${user}/${repo}/contents/slot.svg`;

  const headers = {
    'Accept': 'application/vnd.github.v3.raw',  // Restituisce il contenuto diretto, non JSON
    'If-None-Match': '',                         // Impedisce risposte 304 cached
    'User-Agent': 'GithubSlotMachine',
  };

  // Usa il token per rate limit più alto (5000/h vs 60/h)
  if (process.env.GITHUB_PAT) {
    headers['Authorization'] = `Bearer ${process.env.GITHUB_PAT}`;
  }

  const response = await fetch(url, { headers });
  const svg = await response.text();

  res.setHeader('Content-Type', 'image/svg+xml');
  // Header per distruggere la cache del browser e di GitHub Camo
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, s-maxage=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  // ETag unico per ogni richiesta: forza il proxy a trattarla come nuova
  res.setHeader('ETag', `"${Date.now()}"`);
  
  res.send(svg);
}
