require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const SPOTIFY_REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI;

const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI  = process.env.GOOGLE_REDIRECT_URI;

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');
const PHOTOS_DIR = path.join(DATA_DIR, 'photos');
const VIDEOS_DIR = path.join(DATA_DIR, 'videos');
const AVATARS_DIR = path.join(DATA_DIR, 'avatars');
const SPOTIFY_TOKENS_DIR = path.join(DATA_DIR, 'spotify-tokens');
const SEED_DIR = path.join(__dirname, 'data-seed');

function initDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, { recursive: true });
  if (!fs.existsSync(VIDEOS_DIR)) fs.mkdirSync(VIDEOS_DIR, { recursive: true });
  if (!fs.existsSync(AVATARS_DIR)) fs.mkdirSync(AVATARS_DIR, { recursive: true });
  if (!fs.existsSync(SPOTIFY_TOKENS_DIR)) fs.mkdirSync(SPOTIFY_TOKENS_DIR, { recursive: true });

  const files = ['config.json', 'appointments.json', 'chores.json', 'messages.json'];
  for (const file of files) {
    const dest = path.join(DATA_DIR, file);
    if (!fs.existsSync(dest)) {
      const src = path.join(SEED_DIR, file);
      if (fs.existsSync(src)) fs.copyFileSync(src, dest);
    }
  }
}

initDataDir();

function readJSON(file) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
}
function writeJSON(file, data) {
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2), 'utf8');
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/photos', express.static(PHOTOS_DIR));
app.use('/videos', express.static(VIDEOS_DIR));
app.use('/avatars', express.static(AVATARS_DIR));

// Multer for photos (10 MB limit)
const photoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, PHOTOS_DIR),
  filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});
const uploadPhoto = multer({
  storage: photoStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    file.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('Images only'));
  }
});

// Multer for videos (200 MB limit)
const videoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, VIDEOS_DIR),
  filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});
const uploadVideo = multer({
  storage: videoStorage,
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    file.mimetype.startsWith('video/') ? cb(null, true) : cb(new Error('Videos only'));
  }
});

// ── Spotify OAuth (per-user) ───────────────────────────────────────────────

const SPOTIFY_SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state'
].join(' ');

// Sanitise a family-member name so it's safe as a filename
function sanitizeUser(user) {
  return String(user).replace(/[^a-zA-Z0-9א-ת_-]/g, '_').slice(0, 64);
}

function readUserSpotifyToken(user) {
  try {
    return JSON.parse(fs.readFileSync(
      path.join(SPOTIFY_TOKENS_DIR, `${sanitizeUser(user)}.json`), 'utf8'
    ));
  } catch { return null; }
}

function writeUserSpotifyToken(user, data) {
  fs.writeFileSync(
    path.join(SPOTIFY_TOKENS_DIR, `${sanitizeUser(user)}.json`),
    JSON.stringify(data, null, 2)
  );
}

async function refreshAccessToken(refreshToken) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64')
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })
  });
  return res.json();
}

// Step 1: redirect to Spotify login — encode username in state
app.get('/auth/spotify', (req, res) => {
  const user  = req.query.user || '';
  const state = Buffer.from(JSON.stringify({ user })).toString('base64');
  const params = new URLSearchParams({
    client_id:     SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri:  SPOTIFY_REDIRECT_URI,
    scope:         SPOTIFY_SCOPES,
    show_dialog:   'false',
    state
  });
  res.redirect(`https://accounts.spotify.com/authorize?${params}`);
});

// Step 2: Spotify calls back — decode state → save per-user token
app.get('/auth/spotify/callback', async (req, res) => {
  const { code, error, state } = req.query;
  if (error || !code) return res.send(`<p>שגיאה: ${error || 'no code'}</p>`);

  // Decode the username we encoded in Step 1
  let user = '';
  try {
    const decoded = JSON.parse(Buffer.from(state || '', 'base64').toString());
    user = decoded.user || '';
  } catch {}

  const resp = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64')
    },
    body: new URLSearchParams({
      grant_type:   'authorization_code',
      code,
      redirect_uri: SPOTIFY_REDIRECT_URI
    })
  });
  const data = await resp.json();
  if (data.error) return res.send(`<p>שגיאה: ${data.error_description}</p>`);

  const tokenData = {
    access_token:  data.access_token,
    refresh_token: data.refresh_token,
    expires_at:    Date.now() + (data.expires_in - 60) * 1000
  };

  if (user) {
    writeUserSpotifyToken(user, tokenData);
  }

  const userLabel = user ? `<p>מחובר בתור: <strong>${user}</strong></p>` : '';
  res.send(`<!DOCTYPE html><html lang="he" dir="rtl">
    <head><meta charset="UTF-8"><title>Spotify מחובר</title>
    <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#eaf5fd;}
    .box{text-align:center;padding:2rem;background:white;border-radius:20px;box-shadow:0 4px 24px rgba(0,0,0,.1);}
    h2{color:#1a8fd1;}p{color:#555;}</style></head>
    <body><div class="box"><h2>✅ Spotify מחובר בהצלחה!</h2>
    ${userLabel}
    <a href="/">חזרה לפורטל</a></div></body></html>`);
});

// Provide fresh access token to frontend — per-user
app.get('/api/spotify-token', async (req, res) => {
  const user = req.query.user || '';
  if (!user) return res.json({ ok: false, error: 'missing_user' });

  const token = readUserSpotifyToken(user);
  if (!token) return res.json({ ok: false, error: 'not_connected' });

  if (Date.now() > token.expires_at) {
    const refreshed = await refreshAccessToken(token.refresh_token);
    if (refreshed.error) return res.json({ ok: false, error: refreshed.error });
    token.access_token = refreshed.access_token;
    token.expires_at   = Date.now() + (refreshed.expires_in - 60) * 1000;
    if (refreshed.refresh_token) token.refresh_token = refreshed.refresh_token;
    writeUserSpotifyToken(user, token);
  }

  res.json({ ok: true, access_token: token.access_token });
});

// Check connection status — per-user
app.get('/api/spotify-status', (req, res) => {
  const user = req.query.user || '';
  if (!user) return res.json({ connected: false });
  const token = readUserSpotifyToken(user);
  res.json({ connected: !!token });
});

// Daily song
app.get('/api/daily-song', (req, res) => {
  try { res.json(readJSON('daily-song.json')); }
  catch { res.json({ trackId: null, title: '', artist: '', date: '' }); }
});
app.post('/api/daily-song', (req, res) => {
  writeJSON('daily-song.json', req.body);
  res.json({ ok: true });
});

// Auth
app.post('/api/auth', (req, res) => {
  const config = readJSON('config.json');
  res.json({ ok: req.body.password === config.editPassword });
});

// Config
app.get('/api/config', (req, res) => res.json(readJSON('config.json')));
app.post('/api/config', (req, res) => { writeJSON('config.json', req.body); res.json({ ok: true }); });

// Appointments
app.get('/api/appointments', (req, res) => res.json(readJSON('appointments.json')));
app.post('/api/appointments', (req, res) => { writeJSON('appointments.json', req.body); res.json({ ok: true }); });

// Chores
app.get('/api/chores', (req, res) => res.json(readJSON('chores.json')));
app.post('/api/chores', (req, res) => { writeJSON('chores.json', req.body); res.json({ ok: true }); });

// Messages
app.get('/api/messages', (req, res) => res.json(readJSON('messages.json')));
app.post('/api/messages', (req, res) => { writeJSON('messages.json', req.body); res.json({ ok: true }); });

// Photos
app.get('/api/photos', (req, res) => {
  const files = fs.readdirSync(PHOTOS_DIR).filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f));
  res.json(files);
});
app.post('/api/photos', uploadPhoto.single('photo'), (req, res) => {
  res.json({ ok: true, filename: req.file.filename });
});
app.delete('/api/photos/:filename', (req, res) => {
  const fp = path.join(PHOTOS_DIR, path.basename(req.params.filename));
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  res.json({ ok: true });
});

// Avatars
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, AVATARS_DIR),
  filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});
const uploadAvatar = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    file.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('Images only'));
  }
});

app.post('/api/avatars/:member', uploadAvatar.single('avatar'), (req, res) => {
  const member = decodeURIComponent(req.params.member);
  const config = readJSON('config.json');
  // Delete old avatar file if exists
  const old = (config.avatars || {})[member];
  if (old) { const fp = path.join(AVATARS_DIR, old); if (fs.existsSync(fp)) fs.unlinkSync(fp); }
  config.avatars = config.avatars || {};
  config.avatars[member] = req.file.filename;
  writeJSON('config.json', config);
  res.json({ ok: true, filename: req.file.filename });
});

app.delete('/api/avatars/:member', (req, res) => {
  const member = decodeURIComponent(req.params.member);
  const config = readJSON('config.json');
  const filename = (config.avatars || {})[member];
  if (filename) {
    const fp = path.join(AVATARS_DIR, filename);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    delete config.avatars[member];
    writeJSON('config.json', config);
  }
  res.json({ ok: true });
});

// Videos
app.get('/api/videos', (req, res) => {
  const files = fs.readdirSync(VIDEOS_DIR).filter(f => /\.(mp4|mov|webm|avi|mkv)$/i.test(f));
  res.json(files);
});
app.post('/api/videos', uploadVideo.single('video'), (req, res) => {
  res.json({ ok: true, filename: req.file.filename });
});
app.delete('/api/videos/:filename', (req, res) => {
  const fp = path.join(VIDEOS_DIR, path.basename(req.params.filename));
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  res.json({ ok: true });
});

// ── Google Photos OAuth ────────────────────────────────────────────────────

const GOOGLE_TOKEN_FILE       = path.join(DATA_DIR, 'google-token.json');
const GOOGLE_PHOTOS_CFG_FILE  = path.join(DATA_DIR, 'google-photos-config.json');
const GOOGLE_PHOTOS_SCOPE     = 'https://www.googleapis.com/auth/drive.readonly';
const PHOTO_CACHE_TTL         = 50 * 60 * 1000; // 50 minutes

// In-memory URL cache (Google baseUrls expire ~60 min)
let photoUrlCache = { urls: [], albumId: null, fetchedAt: 0 };

function readGoogleToken() {
  try { return JSON.parse(fs.readFileSync(GOOGLE_TOKEN_FILE, 'utf8')); }
  catch { return null; }
}
function writeGoogleToken(data) {
  fs.writeFileSync(GOOGLE_TOKEN_FILE, JSON.stringify(data, null, 2));
}
function readGPhotosCfg() {
  try { return JSON.parse(fs.readFileSync(GOOGLE_PHOTOS_CFG_FILE, 'utf8')); }
  catch { return { albumId: null, albumName: '' }; }
}

async function getGoogleToken() {
  const token = readGoogleToken();
  if (!token) return null;
  if (Date.now() < token.expires_at) return token.access_token;

  // Refresh
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: token.refresh_token,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET
    })
  });
  const data = await r.json();
  if (data.error) return null;
  token.access_token = data.access_token;
  token.expires_at   = Date.now() + (data.expires_in - 60) * 1000;
  writeGoogleToken(token);
  return token.access_token;
}

// Step 1 – redirect to Google consent
app.get('/auth/google', (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.send('<p>הגדר GOOGLE_CLIENT_ID ב-.env</p>');
  const params = new URLSearchParams({
    client_id:    GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope:        GOOGLE_PHOTOS_SCOPE,
    access_type:  'offline',
    prompt:       'consent'
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// Step 2 – exchange code for tokens
app.get('/auth/google/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) return res.send(`<p>שגיאה: ${error || 'no code'}</p>`);

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:    GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type:   'authorization_code'
    })
  });
  const data = await r.json();
  if (data.error) return res.send(`<p>שגיאה: ${data.error_description}</p>`);

  writeGoogleToken({
    access_token:  data.access_token,
    refresh_token: data.refresh_token,
    expires_at:    Date.now() + (data.expires_in - 60) * 1000
  });
  photoUrlCache = { urls: [], albumId: null, fetchedAt: 0 }; // clear cache

  res.send(`<!DOCTYPE html><html lang="he" dir="rtl">
    <head><meta charset="UTF-8"><title>Google Photos מחובר</title>
    <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;
    margin:0;background:#eaf5fd;}.box{text-align:center;padding:2rem;background:white;border-radius:20px;
    box-shadow:0 4px 24px rgba(0,0,0,.1);}h2{color:#1a8fd1;}p{color:#555;}</style></head>
    <body><div class="box"><h2>✅ Google Photos מחובר!</h2>
    <p>כעת בחר אלבום בפורטל המשפחה (מצב עריכה).</p>
    <a href="/">חזרה לפורטל</a></div></body></html>`);
});

// Connection status
app.get('/api/google-status', (req, res) => {
  const cfg = readGPhotosCfg();
  res.json({ connected: !!readGoogleToken(), albumId: cfg.albumId, albumName: cfg.albumName });
});

// List Drive folders (shown in album picker)
app.get('/api/google-albums', async (req, res) => {
  const token = await getGoogleToken();
  if (!token) return res.json({ ok: false, error: 'not_connected' });

  const q   = encodeURIComponent("mimeType='application/vnd.google-apps.folder' and trashed=false");
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=100&orderBy=name`;
  const r   = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await r.json();
  if (data.error) return res.json({ ok: false, error: data.error.message });

  const albums = (data.files || []).map(f => ({ id: f.id, title: f.name, count: '' }));
  res.json({ ok: true, albums });
});

// Save selected album
app.post('/api/google-photos-config', (req, res) => {
  const { albumId, albumName } = req.body;
  fs.writeFileSync(GOOGLE_PHOTOS_CFG_FILE, JSON.stringify({ albumId, albumName }, null, 2));
  photoUrlCache = { urls: [], albumId: null, fetchedAt: 0 }; // bust cache
  res.json({ ok: true });
});

// Disconnect Google Photos
app.post('/api/google-disconnect', (req, res) => {
  if (fs.existsSync(GOOGLE_TOKEN_FILE))     fs.unlinkSync(GOOGLE_TOKEN_FILE);
  if (fs.existsSync(GOOGLE_PHOTOS_CFG_FILE)) fs.unlinkSync(GOOGLE_PHOTOS_CFG_FILE);
  photoUrlCache = { urls: [], albumId: null, fetchedAt: 0 };
  res.json({ ok: true });
});

// List images in selected Drive folder (cached 50 min), served via proxy
app.get('/api/album-photos', async (req, res) => {
  const cfg = readGPhotosCfg();
  if (!cfg.albumId) return res.json({ ok: false, error: 'no_album' });

  const now   = Date.now();
  const force = req.query.refresh === '1';
  if (!force && photoUrlCache.albumId === cfg.albumId &&
      (now - photoUrlCache.fetchedAt) < PHOTO_CACHE_TTL && photoUrlCache.urls.length) {
    return res.json({ ok: true, urls: photoUrlCache.urls });
  }

  const token = await getGoogleToken();
  if (!token) return res.json({ ok: false, error: 'not_connected' });

  const fileIds = [];
  let pageToken = '';
  do {
    const q   = encodeURIComponent(`'${cfg.albumId}' in parents and mimeType contains 'image/' and trashed=false`);
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&pageSize=100&orderBy=createdTime${pageToken ? '&pageToken=' + pageToken : ''}`;
    const r   = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await r.json();
    if (data.error) return res.json({ ok: false, error: data.error.message });
    (data.files || []).forEach(f => fileIds.push(f.id));
    pageToken = data.nextPageToken || '';
  } while (pageToken);

  // URLs served through our own proxy so the token stays server-side
  const urls = fileIds.map(id => `/drive-photo/${id}`);
  photoUrlCache = { urls, albumId: cfg.albumId, fetchedAt: now };
  res.json({ ok: true, urls });
});

// Proxy: fetch a Drive image using the stored token and stream it to the browser
app.get('/drive-photo/:fileId', async (req, res) => {
  const token = await getGoogleToken();
  if (!token) return res.status(401).send('Not connected');

  const r = await fetch(
    `https://www.googleapis.com/drive/v3/files/${req.params.fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!r.ok) return res.status(r.status).send('Could not fetch image');

  res.setHeader('Content-Type', r.headers.get('content-type') || 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  const buf = await r.arrayBuffer();
  res.send(Buffer.from(buf));
});

app.listen(PORT, () => console.log(`Family Portal running on port ${PORT}`));
