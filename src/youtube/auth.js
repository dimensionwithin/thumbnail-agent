'use strict';

// Owner-OAuth fuer die YouTube Data API v3.
// Begruendung: Members-only-Videos (Inner Circle) sind ueber einen reinen Public-API-Key
// NICHT sichtbar. Deshalb authentifizieren wir als Kanal-Owner.
//
// Scopes:
//   P2 (Inventar lesen): youtube.readonly
//   P5 (thumbnails.set) : youtube.force-ssl
// Wir holen den Token mit dem groesseren Scope (force-ssl deckt auch das Lesen ab),
// damit derselbe Token fuer Inventar und Publish gilt. Token wird lokal persistiert.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const { google } = require('googleapis');

const SCOPES = ['https://www.googleapis.com/auth/youtube.force-ssl'];

function tokenPath() {
  return path.resolve(process.env.YOUTUBE_TOKEN_PATH || '.youtube-token.json');
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Env-Variable ${name} fehlt. Lege .env nach .env.example an.`);
  return v;
}

function makeClient() {
  const redirectUri = process.env.YOUTUBE_REDIRECT_URI || 'http://localhost:53682/oauth2callback';
  return new google.auth.OAuth2(
    requireEnv('YOUTUBE_CLIENT_ID'),
    requireEnv('YOUTUBE_CLIENT_SECRET'),
    redirectUri
  );
}

function loadToken() {
  const p = tokenPath();
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function saveToken(tokens) {
  fs.writeFileSync(tokenPath(), JSON.stringify(tokens, null, 2));
}

// Loopback-OAuth-Flow: oeffnet die Consent-URL (zum Kopieren) und faengt den Redirect ab.
function interactiveAuth(oauth2) {
  return new Promise((resolve, reject) => {
    const redirectUri = new URL(process.env.YOUTUBE_REDIRECT_URI || 'http://localhost:53682/oauth2callback');
    const port = Number(redirectUri.port) || 53682;

    const authUrl = oauth2.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: SCOPES,
    });

    const server = http.createServer(async (req, res) => {
      try {
        const reqUrl = new URL(req.url, `http://localhost:${port}`);
        if (reqUrl.pathname !== redirectUri.pathname) { res.writeHead(404); res.end(); return; }
        const code = reqUrl.searchParams.get('code');
        const err = reqUrl.searchParams.get('error');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        if (err) { res.end(`<h1>OAuth-Fehler: ${err}</h1>`); server.close(); return reject(new Error(err)); }
        res.end('<h1>Auth ok.</h1><p>Du kannst dieses Fenster schliessen.</p>');
        const { tokens } = await oauth2.getToken(code);
        oauth2.setCredentials(tokens);
        saveToken(tokens);
        server.close();
        resolve(tokens);
      } catch (e) {
        try { res.writeHead(500); res.end(String(e)); } catch {}
        server.close();
        reject(e);
      }
    });

    server.listen(port, () => {
      console.log('\nOeffne diese URL im Browser und stimme zu:\n');
      console.log(authUrl + '\n');
      console.log(`Warte auf Redirect an ${redirectUri.origin}${redirectUri.pathname} ...`);
    });
    server.on('error', reject);
  });
}

// Liefert einen autorisierten OAuth2-Client. Refresht/erneuert bei Bedarf.
async function getAuthorizedClient({ interactive = true } = {}) {
  const oauth2 = makeClient();
  const saved = loadToken();
  if (saved) {
    oauth2.setCredentials(saved);
    oauth2.on('tokens', (t) => { saveToken({ ...saved, ...t }); });
    return oauth2;
  }
  if (!interactive) {
    throw new Error('Kein OAuth-Token vorhanden. Fuehre zuerst `npm run auth` aus.');
  }
  await interactiveAuth(oauth2);
  return oauth2;
}

// Direkt aufgerufen (`npm run auth`): Flow erzwingen / Token pruefen.
if (require.main === module) {
  (async () => {
    try {
      const oauth2 = await getAuthorizedClient({ interactive: true });
      const yt = google.youtube({ version: 'v3', auth: oauth2 });
      const me = await yt.channels.list({ part: ['snippet', 'contentDetails'], mine: true });
      const ch = me.data.items && me.data.items[0];
      if (ch) {
        console.log(`\nAuthentifiziert als Kanal: ${ch.snippet.title} (${ch.id})`);
        console.log(`Uploads-Playlist: ${ch.contentDetails.relatedPlaylists.uploads}`);
        console.log(`Token gespeichert unter: ${tokenPath()}`);
      } else {
        console.log('Token ok, aber kein Kanal gefunden (mine=true).');
      }
    } catch (e) {
      console.error('Auth fehlgeschlagen:', e.message);
      process.exit(1);
    }
  })();
}

module.exports = { getAuthorizedClient, SCOPES, tokenPath };
