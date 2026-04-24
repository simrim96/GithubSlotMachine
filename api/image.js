export default async function handler(req, res) {
  // 1. Generiamo un numero casuale unico per ogni richiesta
  const cacheBust = Date.now();
  // 2. Puntiamo al file RAW di GitHub aggiungendo il parametro casuale
  const url = `https://raw.githubusercontent.com/TUO_USER/github-slot-machine/main/slot.svg?t=${cacheBust}`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error("GitHub non risponde");
    const svg = await response.text();

    // 3. Header per distruggere qualsiasi forma di cache
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.setHeader('Surrogate-Control', 'no-store');
    
    res.status(200).send(svg);
  } catch (error) {
    res.status(500).send("<svg><text>Errore caricamento</text></svg>");
  }
}
