export default async function handler(req, res) {
  const url = "https://raw.githubusercontent.com/TUO_USER/github-slot-machine/main/slot.svg";
  const response = await fetch(url);
  const svg = await response.text();

  // Questi header dicono a GitHub: "NON SALVARE QUESTA IMMAGINE"
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  res.send(svg);
}
