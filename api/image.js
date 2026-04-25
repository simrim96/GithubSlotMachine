export default async function handler(req, res) {
  const user = "simrim96";
  const repo = "GithubSlotMachine";
  
  // Aggiungiamo il timestamp per "bucare" la cache di GitHub
  const url = `https://raw.githubusercontent.com/${user}/${repo}/main/slot.svg?t=${Date.now()}`;

  const response = await fetch(url, { 
    cache: 'no-store',
    headers: { 'Cache-Control': 'no-cache' }
  });
  
  const svg = await response.text();

  res.setHeader('Content-Type', 'image/svg+xml');
  // Header per distruggere la cache del browser e di GitHub Camo
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  
  res.send(svg);
}
