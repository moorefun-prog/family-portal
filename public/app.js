'use strict';

let config = {};
let appointments = [];
let chores = [];
let photos = [];       // filenames (local) OR full URLs (google)
let videos = [];
let messages = [];
let currentSlide = 0;
let slideTimer = null;
let editMode = false;
let activeVideo = null;
let photoSource = 'local';   // 'local' | 'google'
let gphotoStatus = { connected: false, albumId: null, albumName: '' };

// ── Spotify SDK ready gate (must be synchronous — before any async code) ───
// The Spotify Web Playback SDK fires window.onSpotifyWebPlaybackSDKReady as
// soon as its script loads, which can happen before our async init finishes.
// We capture that event into a Promise so loadDailySong() can await it safely.
let _spotifySDKReadyResolve;
const spotifySDKReadyPromise = new Promise(resolve => { _spotifySDKReadyResolve = resolve; });
window.onSpotifyWebPlaybackSDKReady = () => _spotifySDKReadyResolve();

// ── Bootstrap ──────────────────────────────────────────────────────────────

async function init() {
  await Promise.all([loadConfig(), loadPhotos(), loadVideos(), loadAppointments(), loadChores(), loadDailySong(), loadMessages()]);
  initRouter();
}

async function loadConfig() {
  config = await api('GET', '/api/config');
  document.getElementById('family-name').textContent = config.familyName || 'פורטל המשפחה';
  document.title = config.familyName || 'פורטל המשפחה';
}

async function loadPhotos() {
  gphotoStatus = await api('GET', '/api/google-status');

  if (gphotoStatus.connected && gphotoStatus.albumId) {
    const result = await api('GET', '/api/album-photos');
    if (result.ok && result.urls && result.urls.length) {
      photos = result.urls;
      photoSource = 'google';
      renderSlideshow();
      // Google baseUrls expire ~60 min — refresh after 50
      setTimeout(() => loadPhotos(), 50 * 60 * 1000);
      return;
    }
  }

  // Fallback: local uploaded photos
  photos = await api('GET', '/api/photos');
  photoSource = 'local';
  renderSlideshow();
}

async function loadVideos() {
  videos = await api('GET', '/api/videos');
  renderVideoList();
}

async function loadAppointments() {
  appointments = await api('GET', '/api/appointments');
  renderAppointments();
}

async function loadChores() {
  chores = await api('GET', '/api/chores');
  renderChores();
}

// ── Spotify Web Playback SDK ───────────────────────────────────────────────

let spotifyPlayer = null;
let spotifyDeviceId = null;
let spotifyState = null;
let progressTimer = null;

async function loadDailySong() {
  const status = await api('GET', '/api/spotify-status');
  const loadingEl = document.getElementById('music-loading-wrap');

  if (!status.connected) {
    loadingEl.classList.add('hidden');
    document.getElementById('spotify-connect').classList.remove('hidden');
    return;
  }

  // Wait for the SDK to fire onSpotifyWebPlaybackSDKReady.
  // If it already fired (script loaded first), this resolves immediately.
  await spotifySDKReadyPromise;

  const { ok } = await api('GET', '/api/spotify-token');
  if (!ok) {
    loadingEl.classList.add('hidden');
    document.getElementById('spotify-connect').classList.remove('hidden');
    return;
  }

  spotifyPlayer = new Spotify.Player({
    name: 'פורטל המשפחה',
    getOAuthToken: async cb => {
      const res = await api('GET', '/api/spotify-token');
      cb(res.access_token);
    },
    volume: 0.8
  });

  spotifyPlayer.addListener('ready', async ({ device_id }) => {
    spotifyDeviceId = device_id;
    loadingEl.classList.add('hidden');
    document.getElementById('spotify-player').classList.remove('hidden');
    await playSong();
  });

  spotifyPlayer.addListener('not_ready', () => {
    spotifyDeviceId = null;
  });

  spotifyPlayer.addListener('player_state_changed', state => {
    if (!state) return;
    spotifyState = state;
    updatePlayerUI(state);
  });

  spotifyPlayer.connect();
}

async function playSong() {
  const song = await api('GET', '/api/daily-song');
  if (!spotifyDeviceId) return;

  // Support both playlist and single track
  const contextUri = song?.playlistId
    ? `spotify:playlist:${song.playlistId}`
    : song?.trackId
      ? null  // legacy single-track — skip, user should set a playlist
      : null;
  if (!contextUri) return;

  const { access_token } = await api('GET', '/api/spotify-token');
  await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${spotifyDeviceId}`, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ context_uri: contextUri })
  });
}

function updatePlayerUI(state) {
  const track = state.track_window?.current_track;
  if (!track) return;

  // ── Strip player ──
  const playBtn = document.getElementById('sp-play');
  playBtn.textContent = state.paused ? '▶' : '⏸';
  playBtn.classList.toggle('playing', !state.paused);

  document.getElementById('sp-title').textContent = track.name;
  document.getElementById('sp-artist').textContent = track.artists.map(a => a.name).join(', ');

  const art = document.getElementById('sp-art');
  if (track.album?.images?.[0]) art.src = track.album.images[0].url;

  const dur = track.duration_ms;
  document.getElementById('sp-dur').textContent = msToTime(dur);

  // ── Full-page player ──
  const fp = id => document.getElementById(id);
  if (fp('sp-full-play')) fp('sp-full-play').textContent = state.paused ? '▶' : '⏸';
  if (fp('sp-full-title'))  fp('sp-full-title').textContent  = track.name;
  if (fp('sp-full-artist')) fp('sp-full-artist').textContent = track.artists.map(a => a.name).join(', ');
  if (fp('sp-full-art') && track.album?.images?.[0]) fp('sp-full-art').src = track.album.images[0].url;
  if (fp('sp-full-dur'))  fp('sp-full-dur').textContent  = msToTime(dur);

  updateProgress(state.position, dur, state.paused);
}

function updateProgress(pos, dur, paused) {
  clearInterval(progressTimer);
  const fill    = document.getElementById('sp-fill');
  const posEl   = document.getElementById('sp-pos');
  const fill2   = document.getElementById('sp-full-fill');
  const posEl2  = document.getElementById('sp-full-pos');
  let current = pos;

  const tick = () => {
    const t = msToTime(current);
    const w = `${Math.min(100, (current / dur) * 100)}%`;
    posEl.textContent  = t;
    fill.style.width   = w;
    if (fill2)  fill2.style.width  = w;
    if (posEl2) posEl2.textContent = t;
    if (!paused) current += 500;
  };
  tick();
  if (!paused) progressTimer = setInterval(tick, 500);
}

function msToTime(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

document.getElementById('sp-play').addEventListener('click', () => spotifyPlayer?.togglePlay());
document.getElementById('sp-prev').addEventListener('click', () => spotifyPlayer?.previousTrack());
document.getElementById('sp-next').addEventListener('click', () => spotifyPlayer?.nextTrack());
document.getElementById('sp-vol').addEventListener('input', e => spotifyPlayer?.setVolume(e.target.value / 100));
document.getElementById('sp-bar').addEventListener('click', async e => {
  if (!spotifyState) return;
  const pct = e.offsetX / e.currentTarget.offsetWidth;
  const ms = Math.floor(pct * spotifyState.track_window.current_track.duration_ms);
  spotifyPlayer.seek(ms);
});

document.getElementById('change-song-btn').addEventListener('click', () => {
  document.getElementById('change-song-form').classList.remove('hidden');
  document.getElementById('song-url-input').focus();
});
document.getElementById('song-cancel-btn').addEventListener('click', () => {
  document.getElementById('change-song-form').classList.add('hidden');
});
document.getElementById('song-save-btn').addEventListener('click', async () => {
  const raw = document.getElementById('song-url-input').value.trim();
  const match = raw.match(/playlist\/([A-Za-z0-9]+)/);
  if (!match) return alert('קישור לא תקין — השתמש בקישור לפלייליסט מ-Spotify');
  const playlistId = match[1];
  await api('POST', '/api/daily-song', { playlistId, date: new Date().toISOString().slice(0, 10) });
  document.getElementById('change-song-form').classList.add('hidden');
  document.getElementById('song-url-input').value = '';
  await playSong();
});

// ── API helper ─────────────────────────────────────────────────────────────

async function api(method, url, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  return res.json();
}

// ── Slideshow ──────────────────────────────────────────────────────────────

function renderSlideshow() {
  const container = document.getElementById('slideshow');
  const dots = document.getElementById('slide-dots');
  const prev = document.getElementById('prev-btn');
  const next = document.getElementById('next-btn');

  if (photos.length === 0) {
    container.innerHTML = `
      <div class="slideshow-placeholder">
        <p>📸 אין תמונות עדיין</p>
        <p class="subtitle">הפעל מצב עריכה כדי להוסיף תמונות</p>
      </div>`;
    prev.classList.add('hidden');
    next.classList.add('hidden');
    dots.innerHTML = '';
    return;
  }

  container.innerHTML = photos.map((f, i) =>
    `<div class="slide${i === 0 ? ' active' : ''}">
       <img src="${photoUrl(f)}" alt="תמונה משפחתית">
     </div>`
  ).join('');

  dots.innerHTML = photos.map((_, i) =>
    `<button class="dot${i === 0 ? ' active' : ''}" onclick="goToSlide(${i})"></button>`
  ).join('');

  prev.classList.remove('hidden');
  next.classList.remove('hidden');

  currentSlide = 0;
  startSlideTimer();
}

function startSlideTimer() {
  clearInterval(slideTimer);
  const interval = (config.photoInterval || 5) * 1000;
  slideTimer = setInterval(() => advanceSlide(1), interval);
}

function goToSlide(index) {
  const slides = document.querySelectorAll('.slide');
  const dotEls = document.querySelectorAll('.dot');
  if (!slides.length) return;

  slides[currentSlide].classList.remove('active');
  dotEls[currentSlide]?.classList.remove('active');
  currentSlide = (index + photos.length) % photos.length;
  slides[currentSlide].classList.add('active');
  dotEls[currentSlide]?.classList.add('active');
  startSlideTimer();
}

function advanceSlide(dir) { goToSlide(currentSlide + dir); }

// ── Photo edit panel ───────────────────────────────────────────────────────

function renderPhotoThumbs() {
  const container = document.getElementById('photo-thumbnails');
  if (photoSource === 'google') {
    container.innerHTML = `<div class="gphoto-active-note">📷 תמונות נטענות מ-Google Photos — ${photos.length} תמונות</div>`;
    return;
  }
  container.innerHTML = photos.map(f => `
    <div class="photo-thumb">
      <img src="${photoUrl(f)}" alt="${f}">
      <button class="delete-photo" onclick="deletePhoto('${f}')" title="מחק">✕</button>
    </div>`
  ).join('');
}

async function deletePhoto(filename) {
  if (!confirm('למחוק את התמונה?')) return;
  await api('DELETE', `/api/photos/${encodeURIComponent(filename)}`);
  photos = photos.filter(f => f !== filename);
  renderSlideshow();
  renderPhotoThumbs();
}

// ── Videos ────────────────────────────────────────────────────────────────

function renderVideoList() {
  const wrap = document.getElementById('video-player-wrap');
  const list = document.getElementById('video-list');

  if (videos.length === 0) {
    wrap.innerHTML = `<div class="video-placeholder"><p>🎬</p><p class="subtitle">לא הועלו סרטונים עדיין</p></div>`;
    list.innerHTML = '';
    return;
  }

  // Auto-play first video if none active
  if (!activeVideo || !videos.includes(activeVideo)) activeVideo = videos[0];
  playVideo(activeVideo, false);

  list.innerHTML = videos.map(f => `
    <div class="video-item${f === activeVideo ? ' active' : ''}" onclick="playVideo('${f}', true)">
      <span class="video-icon">▶️</span>
      <span class="video-name">${esc(f.replace(/^[a-f0-9-]+(\..+)$/, 'סרטון$1'))}</span>
      <button class="delete-video edit-only hidden" onclick="deleteVideo(event,'${f}')" title="מחק">🗑️</button>
    </div>`
  ).join('');

  if (editMode) revealEditControls();
}

function playVideo(filename, updateList) {
  activeVideo = filename;
  const wrap = document.getElementById('video-player-wrap');
  wrap.innerHTML = `
    <video controls autoplay>
      <source src="/videos/${encodeURIComponent(filename)}" type="video/mp4">
    </video>`;
  if (updateList) {
    document.querySelectorAll('.video-item').forEach(el => el.classList.remove('active'));
    const items = document.querySelectorAll('.video-item');
    const idx = videos.indexOf(filename);
    if (items[idx]) items[idx].classList.add('active');
  }
}

async function deleteVideo(e, filename) {
  e.stopPropagation();
  if (!confirm('למחוק סרטון זה?')) return;
  await api('DELETE', `/api/videos/${encodeURIComponent(filename)}`);
  videos = videos.filter(f => f !== filename);
  if (activeVideo === filename) activeVideo = null;
  renderVideoList();
}

document.getElementById('video-upload').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const txt = document.getElementById('video-upload-text');
  txt.textContent = '⏳ מעלה...';
  const form = new FormData();
  form.append('video', file);
  const res = await fetch('/api/videos', { method: 'POST', body: form });
  const data = await res.json();
  txt.textContent = '⬆️ העלה סרטון';
  if (data.ok) {
    videos.push(data.filename);
    activeVideo = data.filename;
    renderVideoList();
  }
  e.target.value = '';
});

document.getElementById('photo-upload').addEventListener('change', async (e) => {
  const files = Array.from(e.target.files);
  for (const file of files) {
    const form = new FormData();
    form.append('photo', file);
    const res = await fetch('/api/photos', { method: 'POST', body: form });
    const data = await res.json();
    if (data.ok) photos.push(data.filename);
  }
  e.target.value = '';
  renderSlideshow();
  renderPhotoThumbs();
});

// ── Appointments ───────────────────────────────────────────────────────────

function renderAppointments() {
  const grid = document.getElementById('appointments-grid');
  const members = config.members || [];

  grid.innerHTML = members.map(member => {
    const memberAppts = appointments
      .filter(a => a.person === member)
      .sort((a, b) => a.date.localeCompare(b.date));

    const items = memberAppts.length
      ? memberAppts.map(a => `
          <div class="appointment-item">
            <div class="appt-info">
              <div class="appt-title">${esc(a.title)}</div>
              <div class="appt-date">${formatDate(a.date)}${a.time ? ' ' + a.time : ''}</div>
            </div>
            <button class="btn-icon edit-only hidden" onclick="deleteAppointment('${a.id}')" title="מחק">🗑️</button>
          </div>`).join('')
      : `<div class="no-appointments">אין פגישות קרובות</div>`;

    const avatarFile = (config.avatars || {})[member];
    const avatarHtml = avatarFile
      ? `<img src="/avatars/${encodeURIComponent(avatarFile)}" alt="${esc(member)}">`
      : `<span class="avatar-initials">${esc(member.charAt(0))}</span>`;

    return `
      <div class="member-column">
        <div class="member-header">
          <div class="avatar-wrap">
            <div class="avatar-circle" onclick="triggerAvatarUpload('${esc(member)}')" title="לחץ להחלפת תמונה">
              ${avatarHtml}
            </div>
            <input type="file" class="avatar-input" id="avatar-input-${safeid(member)}"
              accept="image/*" style="display:none"
              onchange="uploadAvatar('${esc(member)}', this)">
          </div>
          <h3>${esc(member)}</h3>
        </div>
        ${items}
        <div class="add-appt-form hidden" id="appt-form-${safeid(member)}">
          <input type="text" id="appt-title-${safeid(member)}" placeholder="שם הפגישה">
          <input type="date" id="appt-date-${safeid(member)}">
          <input type="text" id="appt-time-${safeid(member)}" placeholder="שעה (לדוגמה 10:00)">
          <div style="display:flex;gap:.5rem">
            <button class="btn btn-primary btn-sm" onclick="saveAppointment('${member}')">הוסף</button>
            <button class="btn btn-secondary btn-sm" onclick="hideApptForm('${safeid(member)}')">ביטול</button>
          </div>
        </div>
        <button class="btn btn-primary btn-sm add-appt-btn"
          onclick="showApptForm('${safeid(member)}')">+ הוסף פגישה</button>
      </div>`;
  }).join('');

  if (editMode) revealEditControls();
}

function showApptForm(id) {
  document.getElementById(`appt-form-${id}`).classList.remove('hidden');
}
function hideApptForm(id) {
  document.getElementById(`appt-form-${id}`).classList.add('hidden');
}

async function saveAppointment(member) {
  const id = safeid(member);
  const title = document.getElementById(`appt-title-${id}`).value.trim();
  const date = document.getElementById(`appt-date-${id}`).value;
  const time = document.getElementById(`appt-time-${id}`).value.trim();
  if (!title || !date) return alert('נא למלא שם ותאריך');

  const { v4: uuidv4 } = { v4: () => Math.random().toString(36).slice(2) };
  appointments.push({ id: uuidv4(), person: member, title, date, time });
  await api('POST', '/api/appointments', appointments);
  renderAppointments();
}

async function deleteAppointment(id) {
  if (!confirm('למחוק פגישה זו?')) return;
  appointments = appointments.filter(a => a.id !== id);
  await api('POST', '/api/appointments', appointments);
  renderAppointments();
}

// ── Avatars ────────────────────────────────────────────────────────────────

function triggerAvatarUpload(member) {
  if (!editMode) return;
  document.getElementById(`avatar-input-${safeid(member)}`).click();
}

async function uploadAvatar(member, input) {
  const file = input.files[0];
  if (!file) return;
  const form = new FormData();
  form.append('avatar', file);
  const res = await fetch(`/api/avatars/${encodeURIComponent(member)}`, { method: 'POST', body: form });
  const data = await res.json();
  if (data.ok) {
    if (!config.avatars) config.avatars = {};
    config.avatars[member] = data.filename;
    renderAppointments();
  }
  input.value = '';
}

// ── Chores ─────────────────────────────────────────────────────────────────

function renderChores() {
  const list = document.getElementById('chores-list');
  const members = config.members || [];

  // populate assignee dropdown
  const sel = document.getElementById('chore-assignee-input');
  sel.innerHTML = members.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');

  if (chores.length === 0) {
    list.innerHTML = '<div class="empty-chores">אין משימות עדיין</div>';
    return;
  }

  list.innerHTML = chores.map(c => `
    <div class="chore-item${c.done ? ' done' : ''}">
      <input type="checkbox" class="chore-checkbox" ${c.done ? 'checked' : ''}
        onchange="toggleChore('${c.id}', this.checked)">
      <div class="chore-info">
        <div class="chore-title">${esc(c.title)}</div>
        <div class="chore-meta">${esc(c.assignee)}${c.dueDate ? ' · ' + formatDate(c.dueDate) : ''}</div>
      </div>
      <div class="chore-actions edit-only hidden">
        <button class="btn-icon" onclick="deleteChore('${c.id}')" title="מחק">🗑️</button>
      </div>
    </div>`
  ).join('');

  if (editMode) revealEditControls();

  // keep full-page chores in sync
  renderChores2();
}

async function toggleChore(id, done) {
  const chore = chores.find(c => c.id === id);
  if (chore) chore.done = done;
  await api('POST', '/api/chores', chores);
  renderChores();
}

async function deleteChore(id) {
  if (!confirm('למחוק משימה זו?')) return;
  chores = chores.filter(c => c.id !== id);
  await api('POST', '/api/chores', chores);
  renderChores();
}

async function clearDoneChores() {
  if (!confirm('למחוק את כל המשימות שבוצעו?')) return;
  chores = chores.filter(c => !c.done);
  await api('POST', '/api/chores', chores);
  renderChores();
}

document.getElementById('add-chore-btn').addEventListener('click', () => {
  document.getElementById('add-chore-form').classList.remove('hidden');
  document.getElementById('add-chore-btn').classList.add('hidden');
  document.getElementById('chore-title-input').focus();
});

document.getElementById('chore-cancel-btn').addEventListener('click', () => {
  document.getElementById('add-chore-form').classList.add('hidden');
  document.getElementById('add-chore-btn').classList.remove('hidden');
});

document.getElementById('chore-save-btn').addEventListener('click', async () => {
  const title = document.getElementById('chore-title-input').value.trim();
  const assignee = document.getElementById('chore-assignee-input').value;
  const dueDate = document.getElementById('chore-due-input').value;
  if (!title) return alert('נא למלא שם המשימה');

  chores.push({ id: Math.random().toString(36).slice(2), title, assignee, done: false, dueDate });
  await api('POST', '/api/chores', chores);
  document.getElementById('chore-title-input').value = '';
  document.getElementById('chore-due-input').value = '';
  document.getElementById('add-chore-form').classList.add('hidden');
  document.getElementById('add-chore-btn').classList.remove('hidden');
  renderChores();
});

document.getElementById('clear-done-btn').addEventListener('click', clearDoneChores);

// ── Edit mode ──────────────────────────────────────────────────────────────

document.getElementById('edit-btn').addEventListener('click', async () => {
  if (editMode) return;
  const pwd = prompt('סיסמה:');
  if (pwd === null) return;
  const { ok } = await api('POST', '/api/auth', { password: pwd });
  if (!ok) { alert('סיסמה שגויה'); return; }
  enterEditMode();
});

document.getElementById('exit-edit-btn').addEventListener('click', exitEditMode);

function enterEditMode() {
  editMode = true;
  document.body.classList.add('edit-mode');
  document.getElementById('edit-toolbar').classList.remove('hidden');
  document.getElementById('photo-edit-panel').classList.remove('hidden');
  renderPhotoThumbs();
  renderGPhotoPanel();
  revealEditControls();
}

function exitEditMode() {
  editMode = false;
  document.body.classList.remove('edit-mode');
  document.getElementById('edit-toolbar').classList.add('hidden');
  document.getElementById('photo-edit-panel').classList.add('hidden');
  document.getElementById('add-chore-form').classList.add('hidden');
  document.querySelectorAll('.edit-only').forEach(el => el.classList.add('hidden'));
}

function revealEditControls() {
  document.querySelectorAll('.edit-only').forEach(el => el.classList.remove('hidden'));
}

// ── Config modal ───────────────────────────────────────────────────────────

document.getElementById('save-config-btn').addEventListener('click', () => {
  document.getElementById('cfg-family-name').value = config.familyName || '';
  document.getElementById('cfg-password').value = config.editPassword || '';
  document.getElementById('cfg-interval').value = config.photoInterval || 5;
  document.getElementById('cfg-members').value = (config.members || []).join(', ');
  document.getElementById('config-modal').classList.remove('hidden');
});

document.getElementById('cfg-cancel-btn').addEventListener('click', () => {
  document.getElementById('config-modal').classList.add('hidden');
});

document.getElementById('cfg-save-btn').addEventListener('click', async () => {
  const familyName = document.getElementById('cfg-family-name').value.trim();
  const editPassword = document.getElementById('cfg-password').value.trim();
  const photoInterval = parseInt(document.getElementById('cfg-interval').value) || 5;
  const members = document.getElementById('cfg-members').value
    .split(',').map(s => s.trim()).filter(Boolean);

  config = { familyName, members, editPassword, photoInterval };
  await api('POST', '/api/config', config);

  document.getElementById('config-modal').classList.add('hidden');
  document.getElementById('family-name').textContent = familyName;
  document.title = familyName;
  startSlideTimer();
  renderAppointments();
  renderChores();
});

// ── Slide nav buttons ──────────────────────────────────────────────────────

document.getElementById('prev-btn').addEventListener('click', () => advanceSlide(-1));
document.getElementById('next-btn').addEventListener('click', () => advanceSlide(1));

// ── Helpers ────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function safeid(str) {
  return str.replace(/[^a-zA-Z0-9֐-׿]/g, '_');
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

// ── Google Photos ──────────────────────────────────────────────────────────

function photoUrl(f) {
  // Google Photos: full https URL. Local: prepend /photos/ route.
  return (photoSource === 'google' || f.startsWith('http'))
    ? f
    : `/photos/${encodeURIComponent(f)}`;
}

function renderGPhotoPanel() {
  const s = gphotoStatus;
  const ind  = document.getElementById('gphoto-indicator');
  const txt  = document.getElementById('gphoto-status-text');
  const conn = document.getElementById('gphoto-connect-row');
  const alb  = document.getElementById('gphoto-album-row');
  const act  = document.getElementById('gphoto-active-row');
  const locS = document.getElementById('local-photo-section');

  // Hide all rows first
  [conn, alb, act].forEach(el => el.classList.add('hidden'));

  if (!s.connected) {
    ind.textContent = '🔴';
    txt.textContent = 'Google Photos לא מחובר';
    conn.classList.remove('hidden');
    locS.style.display = '';
  } else if (!s.albumId) {
    ind.textContent = '🟡';
    txt.textContent = 'מחובר — אנא בחר אלבום';
    alb.classList.remove('hidden');
    loadAlbumList();
    locS.style.display = '';
  } else {
    ind.textContent = '🟢';
    txt.textContent = `Google Photos · ${s.albumName || s.albumId}`;
    act.classList.remove('hidden');
    // Hide local upload when Google is active
    locS.style.display = 'none';
  }
}

async function loadAlbumList() {
  const sel = document.getElementById('gphoto-album-select');
  sel.innerHTML = '<option value="">טוען אלבומים...</option>';
  const result = await api('GET', '/api/google-albums');
  if (!result.ok) {
    sel.innerHTML = `<option value="">שגיאה: ${result.error}</option>`;
    return;
  }
  sel.innerHTML = '<option value="">-- בחר אלבום --</option>' +
    result.albums.map(a =>
      `<option value="${esc(a.id)}" data-name="${esc(a.title)}">${esc(a.title)} (${a.count})</option>`
    ).join('');
  if (gphotoStatus.albumId) {
    sel.value = gphotoStatus.albumId;
  }
}

document.getElementById('gphoto-save-album-btn').addEventListener('click', async () => {
  const sel      = document.getElementById('gphoto-album-select');
  const albumId  = sel.value;
  const albumName = sel.options[sel.selectedIndex]?.dataset.name || albumId;
  if (!albumId) return alert('אנא בחר אלבום');
  await api('POST', '/api/google-photos-config', { albumId, albumName });
  gphotoStatus.albumId   = albumId;
  gphotoStatus.albumName = albumName;
  renderGPhotoPanel();
  await loadPhotos();
  renderPhotoThumbs();
});

document.getElementById('gphoto-refresh-btn').addEventListener('click', async () => {
  document.getElementById('gphoto-status-text').textContent = '⟳ מרענן תמונות...';
  const result = await api('GET', '/api/album-photos?refresh=1');
  if (result.ok) {
    photos     = result.urls;
    photoSource = 'google';
    renderSlideshow();
    renderPhotoThumbs();
    document.getElementById('gphoto-status-text').textContent = `Google Photos · ${gphotoStatus.albumName} (${photos.length})`;
  } else {
    alert('שגיאה בטעינת התמונות: ' + result.error);
    document.getElementById('gphoto-status-text').textContent = `Google Photos · ${gphotoStatus.albumName}`;
  }
});

document.getElementById('gphoto-change-btn').addEventListener('click', async () => {
  gphotoStatus.albumId   = null;
  gphotoStatus.albumName = '';
  renderGPhotoPanel();
});

document.getElementById('gphoto-disconnect-btn').addEventListener('click', async () => {
  if (!confirm('לנתק את Google Photos?')) return;
  await api('POST', '/api/google-disconnect', {});
  gphotoStatus = { connected: false, albumId: null, albumName: '' };
  photoSource  = 'local';
  photos       = await api('GET', '/api/photos');
  renderSlideshow();
  renderPhotoThumbs();
  renderGPhotoPanel();
});

// ── Messages ───────────────────────────────────────────────────────────────

async function loadMessages() {
  messages = await api('GET', '/api/messages');
  renderMessageBoard();
}

function renderMessageBoard() {
  const scroll = document.getElementById('message-scroll');
  if (!scroll) return;

  if (!messages.length) {
    scroll.innerHTML = '<div class="msg-empty">אין הודעות עדיין</div>';
    scroll.style.animation = 'none';
    return;
  }

  const cardHtml = messages.map(m => `
    <div class="msg-card">
      <div class="msg-author">${esc(m.author)}</div>
      <div class="msg-text">${esc(m.text)}</div>
      <div class="msg-time">${formatMsgTime(m.timestamp)}</div>
    </div>`).join('');

  if (window.innerWidth <= 680) {
    // Repeat 6× so content always fills screen — no blank gaps between loops
    const REPEATS = 6;
    scroll.innerHTML = Array(REPEATS).fill(cardHtml).join('');
    scroll.style.animation = 'none';
    requestAnimationFrame(() => {
      const segmentPx = scroll.scrollWidth / REPEATS;
      const dur = Math.max(1, segmentPx / 50); // 50px/s
      let ks = document.getElementById('_ticker_ks');
      if (!ks) { ks = document.createElement('style'); ks.id = '_ticker_ks'; document.head.appendChild(ks); }
      ks.textContent = `@keyframes tickerScroll { 0%{transform:translateX(-${segmentPx}px)} 100%{transform:translateX(0)} }`;
      scroll.style.animation = `tickerScroll ${dur}s linear infinite`;
    });
  } else {
    // Vertical scroller: duplicate once for seamless loop
    scroll.innerHTML = cardHtml + cardHtml;
    const dur = Math.max(14, messages.length * 7);
    scroll.style.animation = `msgScrollUp ${dur}s linear infinite`;
  }
}

function formatMsgTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// ── Add message modal ──────────────────────────────────────────────────────

document.getElementById('add-message-btn').addEventListener('click', () => {
  document.getElementById('add-message-modal').classList.remove('hidden');
  document.getElementById('msg-text-input').focus();
});

document.getElementById('msg-cancel-btn').addEventListener('click', () => {
  document.getElementById('add-message-modal').classList.add('hidden');
  document.getElementById('msg-author-input').value = '';
  document.getElementById('msg-text-input').value = '';
});

document.getElementById('msg-send-btn').addEventListener('click', async () => {
  const author = document.getElementById('msg-author-input').value.trim();
  const text   = document.getElementById('msg-text-input').value.trim();
  if (!author) return alert('נא למלא את שמך');
  if (!text)   return alert('נא לכתוב הודעה');

  messages.push({
    id: Math.random().toString(36).slice(2),
    author,
    text,
    timestamp: new Date().toISOString()
  });
  await api('POST', '/api/messages', messages);
  renderMessageBoard();

  document.getElementById('add-message-modal').classList.add('hidden');
  document.getElementById('msg-author-input').value = '';
  document.getElementById('msg-text-input').value = '';
});

// ── Manage messages modal (edit mode) ─────────────────────────────────────

document.getElementById('manage-messages-btn').addEventListener('click', () => {
  renderMessagesAdmin();
  document.getElementById('manage-messages-modal').classList.remove('hidden');
});

document.getElementById('manage-msg-close-btn').addEventListener('click', () => {
  document.getElementById('manage-messages-modal').classList.add('hidden');
});

function renderMessagesAdmin() {
  const list = document.getElementById('messages-admin-list');
  if (!messages.length) {
    list.innerHTML = '<div class="empty-chores">אין הודעות עדיין</div>';
    return;
  }
  list.innerHTML = messages.map(m => `
    <div class="msg-admin-card">
      <div class="msg-admin-body">
        <div class="msg-admin-author">${esc(m.author)}</div>
        <div class="msg-admin-text">${esc(m.text)}</div>
        <div class="msg-admin-time">${formatMsgTime(m.timestamp)}</div>
      </div>
      <div class="msg-admin-actions">
        <button class="btn btn-secondary btn-sm" onclick="openEditMsg('${m.id}')">✏️</button>
        <button class="btn btn-danger btn-sm"    onclick="deleteMsg('${m.id}')">🗑️</button>
      </div>
    </div>`).join('');
}

function openEditMsg(id) {
  const m = messages.find(x => x.id === id);
  if (!m) return;
  document.getElementById('edit-msg-id').value     = id;
  document.getElementById('edit-msg-author').value = m.author;
  document.getElementById('edit-msg-text').value   = m.text;
  document.getElementById('manage-messages-modal').classList.add('hidden');
  document.getElementById('edit-message-modal').classList.remove('hidden');
}

document.getElementById('edit-msg-cancel-btn').addEventListener('click', () => {
  document.getElementById('edit-message-modal').classList.add('hidden');
  document.getElementById('manage-messages-modal').classList.remove('hidden');
});

document.getElementById('edit-msg-save-btn').addEventListener('click', async () => {
  const id     = document.getElementById('edit-msg-id').value;
  const author = document.getElementById('edit-msg-author').value.trim();
  const text   = document.getElementById('edit-msg-text').value.trim();
  if (!author || !text) return alert('נא למלא את כל השדות');

  const m = messages.find(x => x.id === id);
  if (m) { m.author = author; m.text = text; }
  await api('POST', '/api/messages', messages);
  renderMessageBoard();

  document.getElementById('edit-message-modal').classList.add('hidden');
  document.getElementById('manage-messages-modal').classList.remove('hidden');
  renderMessagesAdmin();
});

async function deleteMsg(id) {
  if (!confirm('למחוק הודעה זו?')) return;
  messages = messages.filter(m => m.id !== id);
  await api('POST', '/api/messages', messages);
  renderMessageBoard();
  renderMessagesAdmin();
}

// ── Navigation / Router ────────────────────────────────────────────────────

let currentPage = 'home';
let calYear = null;
let calMonth = null;

function navigate(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const page = document.getElementById(`page-${pageId}`);
  if (page) page.classList.add('active');

  const navItem = document.querySelector(`.nav-item[data-page="${pageId}"]`);
  if (navItem) navItem.classList.add('active');

  currentPage = pageId;

  if (pageId === 'calendar') renderCalendar();
  else if (pageId === 'chores')  renderChores2();
  else if (pageId === 'media')   renderMediaFull();
  else if (pageId === 'spotify') syncFullPlayer();

  history.replaceState(null, '', pageId === 'home' ? window.location.pathname : `#${pageId}`);
  window.scrollTo(0, 0);
}

function initRouter() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      navigate(item.dataset.page);
    });
  });

  // honour URL hash on load
  const hash = window.location.hash.slice(1);
  if (['calendar','chores','media','spotify'].includes(hash)) navigate(hash);

  window.addEventListener('hashchange', () => {
    const h = window.location.hash.slice(1);
    navigate(['calendar','chores','media','spotify'].includes(h) ? h : 'home');
  });
}

// ── Calendar ──────────────────────────────────────────────────────────────

const HEB_MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
// In RTL grid, index 0 renders rightmost → Sunday on right (Israeli convention)
const HEB_DAYS = ['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳'];

function renderCalendar() {
  const today = new Date();
  if (calYear === null)  calYear  = today.getFullYear();
  if (calMonth === null) calMonth = today.getMonth();

  document.getElementById('cal-month-label').textContent = `${HEB_MONTHS[calMonth]} ${calYear}`;

  const grid = document.getElementById('calendar-grid');

  // Header row
  let html = `<div class="cal-header-row">`;
  HEB_DAYS.forEach(d => { html += `<div class="cal-dow">${d}</div>`; });
  html += `</div>`;

  // Build weeks
  const firstDay  = new Date(calYear, calMonth, 1);
  const lastDay   = new Date(calYear, calMonth + 1, 0);
  const startDow  = firstDay.getDay(); // 0=Sun
  const numWeeks  = Math.ceil((startDow + lastDay.getDate()) / 7);

  // Group appointments by ISO date string
  const apptsByDate = {};
  appointments.forEach(a => {
    (apptsByDate[a.date] = apptsByDate[a.date] || []).push(a);
  });

  let day = 1 - startDow;
  for (let w = 0; w < numWeeks; w++) {
    html += `<div class="cal-week">`;
    for (let dow = 0; dow < 7; dow++) {
      const d = new Date(calYear, calMonth, day);
      const dateStr   = d.toISOString().slice(0, 10);
      const isToday   = d.toDateString() === today.toDateString();
      const isOther   = d.getMonth() !== calMonth;
      const appts     = (!isOther && apptsByDate[dateStr]) || [];

      let cls = 'cal-day';
      if (isOther) cls += ' other-month';
      if (isToday) cls += ' today';
      if (appts.length) cls += ' has-appts';

      const apptTags = appts.slice(0, 3).map(a =>
        `<span class="cal-appt-label">${esc(a.title)}</span>`).join('');

      html += `<div class="${cls}" onclick="showDayDetail('${dateStr}')">
        <div class="cal-day-num">${d.getDate()}</div>
        ${apptTags}
      </div>`;
      day++;
    }
    html += `</div>`;
  }

  grid.innerHTML = html;
  document.getElementById('cal-day-detail').classList.add('hidden');

  // Nav buttons (reassign each render to avoid stacking listeners)
  const prevBtn = document.getElementById('cal-prev-btn');
  const nextBtn = document.getElementById('cal-next-btn');
  prevBtn.onclick = () => { calMonth--; if (calMonth < 0)  { calMonth = 11; calYear--; } renderCalendar(); };
  nextBtn.onclick = () => { calMonth++; if (calMonth > 11) { calMonth = 0;  calYear++; } renderCalendar(); };
}

function showDayDetail(dateStr) {
  const appts  = appointments.filter(a => a.date === dateStr);
  const detail = document.getElementById('cal-day-detail');
  const [y, m, d] = dateStr.split('-');
  document.getElementById('cal-day-title').textContent = `${parseInt(d)} ב${HEB_MONTHS[parseInt(m)-1]} ${y}`;

  const list = document.getElementById('cal-day-appointments');
  list.innerHTML = appts.length
    ? appts.map(a => `
        <div class="appointment-item">
          <div class="appt-info">
            <div class="appt-title">${esc(a.title)}</div>
            <div class="appt-date">${esc(a.person)}${a.time ? ' · ' + a.time : ''}</div>
          </div>
        </div>`).join('')
    : `<div class="no-appointments">אין פגישות ביום זה</div>`;

  detail.classList.remove('hidden');
  detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ── Chores full page ──────────────────────────────────────────────────────

function renderChores2() {
  const list = document.getElementById('chores-list2');
  if (!list) return;

  const members = config.members || [];
  const sel = document.getElementById('chore-assignee-input2');
  if (sel) sel.innerHTML = members.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');

  if (!chores.length) {
    list.innerHTML = '<div class="empty-chores">אין משימות עדיין</div>';
    return;
  }

  list.innerHTML = chores.map(c => `
    <div class="chore-item${c.done ? ' done' : ''}">
      <input type="checkbox" class="chore-checkbox" ${c.done ? 'checked' : ''}
        onchange="toggleChore('${c.id}', this.checked)">
      <div class="chore-info">
        <div class="chore-title">${esc(c.title)}</div>
        <div class="chore-meta">${esc(c.assignee)}${c.dueDate ? ' · ' + formatDate(c.dueDate) : ''}</div>
      </div>
      <div class="chore-actions${editMode ? '' : ' hidden'}">
        <button class="btn-icon" onclick="deleteChore('${c.id}')" title="מחק">🗑️</button>
      </div>
    </div>`).join('');
}

document.getElementById('add-chore-btn2').addEventListener('click', () => {
  document.getElementById('add-chore-form2').classList.remove('hidden');
  document.getElementById('add-chore-btn2').classList.add('hidden');
});
document.getElementById('chore-cancel-btn2').addEventListener('click', () => {
  document.getElementById('add-chore-form2').classList.add('hidden');
  document.getElementById('add-chore-btn2').classList.remove('hidden');
});
document.getElementById('chore-save-btn2').addEventListener('click', async () => {
  const title    = document.getElementById('chore-title-input2').value.trim();
  const assignee = document.getElementById('chore-assignee-input2').value;
  const dueDate  = document.getElementById('chore-due-input2').value;
  if (!title) return alert('נא למלא שם המשימה');
  chores.push({ id: Math.random().toString(36).slice(2), title, assignee, done: false, dueDate });
  await api('POST', '/api/chores', chores);
  document.getElementById('chore-title-input2').value = '';
  document.getElementById('chore-due-input2').value = '';
  document.getElementById('add-chore-form2').classList.add('hidden');
  document.getElementById('add-chore-btn2').classList.remove('hidden');
  renderChores();  // also triggers renderChores2 via the sync call inside
});
document.getElementById('clear-done-btn2').addEventListener('click', async () => {
  if (!confirm('למחוק את כל המשימות שבוצעו?')) return;
  chores = chores.filter(c => !c.done);
  await api('POST', '/api/chores', chores);
  renderChores();
});

// ── Media full page ───────────────────────────────────────────────────────

function renderMediaFull() {
  const grid = document.getElementById('media-full-grid');
  if (!grid) return;

  let html = '';
  photos.forEach(f => {
    html += `<div class="media-full-item">
      <img src="/photos/${encodeURIComponent(f)}" alt="תמונה" loading="lazy">
    </div>`;
  });
  videos.forEach(f => {
    html += `<div class="media-full-item">
      <video controls preload="metadata">
        <source src="/videos/${encodeURIComponent(f)}" type="video/mp4">
      </video>
    </div>`;
  });

  grid.innerHTML = html || '<div class="empty-chores">לא הועלו תמונות או סרטונים עדיין</div>';
}

// ── Spotify full page sync ────────────────────────────────────────────────

function syncFullPlayer() {
  if (spotifyState) {
    updatePlayerUI(spotifyState);
  } else {
    const t = document.getElementById('sp-full-title');
    if (t) t.textContent = 'Spotify לא מחובר';
  }
}

// Full page Spotify controls
document.getElementById('sp-full-play').addEventListener('click', () => spotifyPlayer?.togglePlay());
document.getElementById('sp-full-prev').addEventListener('click', () => spotifyPlayer?.previousTrack());
document.getElementById('sp-full-next').addEventListener('click', () => spotifyPlayer?.nextTrack());
document.getElementById('sp-full-vol').addEventListener('input', e => spotifyPlayer?.setVolume(e.target.value / 100));
document.getElementById('sp-full-bar').addEventListener('click', e => {
  if (!spotifyState) return;
  const pct = e.offsetX / e.currentTarget.offsetWidth;
  const ms  = Math.floor(pct * spotifyState.track_window.current_track.duration_ms);
  spotifyPlayer.seek(ms);
});

// ── Start ──────────────────────────────────────────────────────────────────

init();
