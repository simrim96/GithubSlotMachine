export default async function handler(req, res) {
  const owner = 'simrim96';
  const repo = 'GithubSlotMachine';

  try {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/dispatches`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GITHUB_PAT}`, // Useremo il token che hai creato
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ event_type: 'remote_spin' })
    });

    // Dopo aver inviato il comando, riportiamo l'utente sul profilo
    res.redirect(302, `https://github.com/${owner}`);
  } catch (error) {
    res.status(500).send("Errore nel trigger: " + error.message);
  }
}
