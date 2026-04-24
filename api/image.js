export default async function handler(req, res) {
  // Aggiungiamo un timestamp per "fregare" la cache di GitHub a monte
  const url = `https://raw.githubusercontent.com/simrim96/GithubSlotMachine/main/slot.svg?t=${Date.now()}`;
  
  const response = await fetch(url);
  const svg = await response.text();

  res.setHeader('Content-Type', 'image/svg+xml');
  // Header anti-cache estremi
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, proxy-revalidate');
  res.setHeader('Surrogate-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  res.send(svg);
}
