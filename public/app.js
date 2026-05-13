'use strict';

let config = {};
let appointments = [];
let chores = [];
let photos = [];       // filenames (local) OR full URLs (google)
let messages = [];
let currentSlide = 0;
let slideTimer = null;
let editMode = false;
let photoSource = 'local';   // 'local' | 'google'
let gphotoStatus = { connected: false, albumId: null, albumName: '' };
let currentUser = null;   // logged-in name, 'guest', or 'admin'
let userRole    = null;   // 'admin' | 'member' | 'guest'
let calSelectedDate = null;   // ISO date string of the currently selected calendar day
let _editingApptId  = null;   // id of appointment being edited in calendar panel
let _selectedApptId     = null;   // id of selected appointment in main appointments page
let _selectedApptColumn = null;   // safeid of the member column with the selection
let _editingMainApptId  = null;   // id of appointment being edited in main appointments page

// ── Bootstrap ──────────────────────────────────────────────────────────────

async function init() {
  // Config must load first — login modal needs family name + member list
  await loadConfig();
  populateLoginModal();

  // Restore session if saved
  const session = getSession();
  if (session) {
    currentUser = session.name;
    userRole    = session.role;
    startPortal();
  } else {
    document.getElementById('login-modal').classList.remove('hidden');
  }
}

async function startPortal() {
  document.getElementById('login-modal').classList.add('hidden');
  if (userRole === 'guest') document.body.classList.add('guest-mode');
  if (userRole === 'admin') document.body.classList.add('is-admin');
  renderUserPill();
  if (userRole === 'admin') enterEditMode();

  await Promise.all([loadPhotos(), loadAppointments(), loadChores(), loadMessages()]);
  await Promise.all([renderSpotifyEmbed(), renderYouTubeEmbed()]);
  initRouter();
}

// ── Session ────────────────────────────────────────────────────────────────

function getSession() {
  try {
    const s = localStorage.getItem('fpSession') || sessionStorage.getItem('fpSession');
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}

function saveSession(name, role, remember) {
  const data = JSON.stringify({ name, role });
  (remember ? localStorage : sessionStorage).setItem('fpSession', data);
}

function clearSession() {
  localStorage.removeItem('fpSession');
  sessionStorage.removeItem('fpSession');
}

// ── Login modal ────────────────────────────────────────────────────────────

function populateLoginModal() {
  document.getElementById('login-family-name').textContent = config.familyName || 'פורטל המשפחה';
  const sel = document.getElementById('login-name');
  const members = config.members || [];
  sel.innerHTML = '<option value="">בחר שם...</option>' +
    members.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('') +
    '<option value="admin">מנהל</option>';
}

document.getElementById('login-btn').addEventListener('click', async () => {
  const name     = document.getElementById('login-name').value;
  const password = document.getElementById('login-password').value;
  const remember = document.getElementById('login-remember').checked;
  const errEl    = document.getElementById('login-error');

  if (!name) { errEl.textContent = 'אנא בחר שם'; errEl.classList.remove('hidden'); return; }
  errEl.classList.add('hidden');

  const res = await api('POST', '/api/login', { name, password });
  if (!res.ok) {
    errEl.textContent = 'סיסמה שגויה, נסה שנית';
    errEl.classList.remove('hidden');
    document.getElementById('login-password').value = '';
    return;
  }

  currentUser = name;
  userRole    = res.role;
  saveSession(name, res.role, remember);
  startPortal();
});

document.getElementById('login-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('login-btn').click();
});

document.getElementById('guest-btn').addEventListener('click', () => {
  currentUser = 'guest';
  userRole    = 'guest';
  // Guest sessions are never remembered
  sessionStorage.setItem('fpSession', JSON.stringify({ name: 'guest', role: 'guest' }));
  startPortal();
});

document.getElementById('confirm-delete-yes').addEventListener('click', async () => {
  const cb = _pendingDeleteCallback;
  hideConfirmDelete();
  if (cb) await cb();
});
document.getElementById('confirm-delete-no').addEventListener('click', hideConfirmDelete);

document.getElementById('cpwd-save-btn').addEventListener('click', submitChangePwd);
document.getElementById('cpwd-cancel-btn').addEventListener('click', hideChangePwdModal);
document.getElementById('cpwd-current').addEventListener('keydown', e => { if (e.key === 'Enter') submitChangePwd(); });
document.getElementById('cpwd-new').addEventListener('keydown', e => { if (e.key === 'Enter') submitChangePwd(); });
document.getElementById('cpwd-confirm').addEventListener('keydown', e => { if (e.key === 'Enter') submitChangePwd(); });

// ── User pill & logout ─────────────────────────────────────────────────────

function renderUserPill() {
  const pill = document.getElementById('user-pill');
  if (!pill) return;
  const label = userRole === 'guest' ? 'אורח 👁' :
                userRole === 'admin' ? '⚙️ מנהל' :
                currentUser;
  const changePwdBtn = userRole !== 'guest'
    ? `<button class="user-pill-switch" onclick="showChangePwdModal()">שנה סיסמה</button>`
    : '';
  pill.innerHTML =
    `<span class="user-pill-name">${esc(label)}</span>` +
    changePwdBtn +
    `<button class="user-pill-switch" onclick="logout()">יציאה</button>`;
  pill.classList.remove('hidden');
}

function logout() {
  clearSession();
  location.reload();
}

// ── Change Password ────────────────────────────────────────────────────────

function showChangePwdModal() {
  document.getElementById('cpwd-current').value = '';
  document.getElementById('cpwd-new').value = '';
  document.getElementById('cpwd-confirm').value = '';
  document.getElementById('cpwd-error').classList.add('hidden');
  document.getElementById('change-pwd-modal').classList.remove('hidden');
}

function hideChangePwdModal() {
  document.getElementById('change-pwd-modal').classList.add('hidden');
}

async function submitChangePwd() {
  const currentPassword = document.getElementById('cpwd-current').value;
  const newPassword     = document.getElementById('cpwd-new').value;
  const confirm         = document.getElementById('cpwd-confirm').value;
  const errEl           = document.getElementById('cpwd-error');

  errEl.classList.add('hidden');

  if (!newPassword.trim()) { errEl.textContent = 'סיסמה חדשה לא יכולה להיות ריקה'; errEl.classList.remove('hidden'); return; }
  if (newPassword !== confirm) { errEl.textContent = 'הסיסמאות אינן תואמות'; errEl.classList.remove('hidden'); return; }

  const name = userRole === 'admin' ? 'admin' : currentUser;
  const res = await api('POST', '/api/change-password', { name, currentPassword, newPassword });

  if (!res.ok) {
    errEl.textContent = 'סיסמה נוכחית שגויה';
    errEl.classList.remove('hidden');
    return;
  }

  hideChangePwdModal();
  alert('הסיסמה שונתה בהצלחה ✓');
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


async function loadAppointments() {
  appointments = await api('GET', '/api/appointments');
  renderAppointments();
}

async function loadChores() {
  chores = await api('GET', '/api/chores');
  renderChores();
}

// ── Spotify embed ──────────────────────────────────────────────────────────

async function renderSpotifyEmbed() {
  const song = await api('GET', '/api/daily-song');
  const playlistId = song?.playlistId;

  const stripEmbed    = document.getElementById('spotify-embed-strip');
  const fullEmbed     = document.getElementById('spotify-embed-full');
  const noPlaylist    = document.getElementById('spotify-no-playlist');
  const noPlaylistFul = document.getElementById('spotify-no-playlist-full');

  if (!playlistId) {
    if (stripEmbed) stripEmbed.src = '';
    if (fullEmbed)  fullEmbed.src  = '';
    noPlaylist?.classList.remove('hidden');
    noPlaylistFul?.classList.remove('hidden');
    return;
  }

  // theme=0 = dark, matches the dark music strip; omit for light
  const embedUrl = `https://open.spotify.com/embed/playlist/${playlistId}?utm_source=generator&theme=0`;
  if (stripEmbed) stripEmbed.src = embedUrl;
  if (fullEmbed)  fullEmbed.src  = embedUrl;
  noPlaylist?.classList.add('hidden');
  noPlaylistFul?.classList.add('hidden');
}

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
  await renderSpotifyEmbed();
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

// ── YouTube playlist embed ────────────────────────────────────────────────

async function renderYouTubeEmbed() {
  const data     = await api('GET', '/api/youtube-playlist');
  const { id, type } = data || {};

  const embedEl  = document.getElementById('youtube-embed');
  const noListEl = document.getElementById('youtube-no-playlist');

  if (!id) {
    if (embedEl) embedEl.src = '';
    noListEl?.classList.remove('hidden');
    return;
  }

  const embedUrl = type === 'playlist'
    ? `https://www.youtube.com/embed/videoseries?list=${id}&hl=he`
    : `https://www.youtube.com/embed/${id}?hl=he`;

  if (embedEl) embedEl.src = embedUrl;
  noListEl?.classList.add('hidden');
}

document.getElementById('change-video-btn').addEventListener('click', () => {
  document.getElementById('change-video-form').classList.remove('hidden');
  document.getElementById('video-url-input').focus();
});
document.getElementById('video-cancel-btn').addEventListener('click', () => {
  document.getElementById('change-video-form').classList.add('hidden');
});
document.getElementById('video-save-btn').addEventListener('click', async () => {
  const raw = document.getElementById('video-url-input').value.trim();

  // Playlist: ?list=XXXX or &list=XXXX
  const listMatch = raw.match(/[?&]list=([A-Za-z0-9_-]+)/);
  // Single video: youtu.be/ID  or  ?v=ID  or  &v=ID
  const videoMatch = raw.match(/(?:youtu\.be\/|[?&]v=)([A-Za-z0-9_-]{11})/);

  if (!listMatch && !videoMatch) {
    return alert('קישור לא תקין — הדבק קישור לסרטון או לפלייליסט מ-YouTube');
  }

  const type = listMatch ? 'playlist' : 'video';
  const id   = listMatch ? listMatch[1] : videoMatch[1];

  await api('POST', '/api/youtube-playlist', { id, type });
  document.getElementById('change-video-form').classList.add('hidden');
  document.getElementById('video-url-input').value = '';
  await renderYouTubeEmbed();
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

function timeSelectOptions() {
  let opts = '<option value="">-- שעה --</option>';
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 30]) {
      const v = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      opts += `<option value="${v}">${v}</option>`;
    }
  }
  return opts;
}

function buildMemberColumn(member, showAddBtn) {
  const memberAppts = appointments
    .filter(a => a.person === member)
    .sort((a, b) => a.date.localeCompare(b.date));

  const items = memberAppts.length
    ? memberAppts.map(a => {
        const canAct  = userRole === 'admin' || (userRole === 'member' && a.person === currentUser);
        const clickable = canAct && !editMode;
        return `
        <div class="appointment-item${clickable ? ' appt-clickable' : ''}"
             data-id="${a.id}"
             ${clickable ? `onclick="selectAppointment('${a.id}', '${safeid(member)}')"` : ''}>
          <div class="appt-info">
            <div class="appt-title">${esc(a.title)}</div>
            <div class="appt-date">${formatDate(a.date)}${a.time ? ' ' + a.time : ''}</div>
          </div>
          <button class="btn-icon edit-only hidden" onclick="event.stopPropagation();deleteAppointment('${a.id}')" title="מחק">🗑️</button>
        </div>`;
      }).join('')
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
        <select id="appt-time-${safeid(member)}">${timeSelectOptions()}</select>
        <div style="display:flex;gap:.5rem">
          <button class="btn btn-primary btn-sm" onclick="saveAppointment('${member}')">הוסף</button>
          <button class="btn btn-secondary btn-sm" onclick="hideApptForm('${safeid(member)}')">ביטול</button>
        </div>
      </div>
      <div id="appt-actions-${safeid(member)}" class="appt-actions hidden">
        <button class="btn btn-secondary btn-sm" onclick="editSelectedAppointment()">✏️ ערוך</button>
        <button class="btn btn-danger btn-sm" onclick="deleteSelectedAppointment()">🗑️ מחק</button>
        <button class="btn btn-secondary btn-sm" onclick="deselectAppointment()">ביטול</button>
      </div>
      ${showAddBtn ? `<button id="add-appt-btn-${safeid(member)}" class="btn btn-primary btn-sm add-appt-btn"
          onclick="showApptForm('${safeid(member)}')">+ הוסף פגישה</button>` : ''}
    </div>`;
}

function renderAppointments() {
  _selectedApptId = null; _selectedApptColumn = null; _editingMainApptId = null;
  const grid = document.getElementById('appointments-grid');
  const members = config.members || [];

  const cols = members.map(member => {
    const showAddBtn = userRole === 'admin'
      || (!editMode && currentUser === member)
      || (editMode && userRole !== 'guest');
    return buildMemberColumn(member, showAddBtn);
  });

  // הרשי — appointment card only, add button for admin only
  cols.push(buildMemberColumn('הרשי', userRole === 'admin'));

  grid.innerHTML = cols.join('');
  if (editMode) revealEditControls();
}

function showApptForm(id) {
  document.getElementById(`appt-form-${id}`).classList.remove('hidden');
}
function hideApptForm(id) {
  const form = document.getElementById(`appt-form-${id}`);
  if (form) form.classList.add('hidden');
  // Reset save button text
  const saveBtn = form?.querySelector('.btn-primary');
  if (saveBtn) saveBtn.textContent = 'הוסף';
  deselectAppointment();
}

// ── Appointment selection (main page) ──────────────────────────────────────

function selectAppointment(id, columnId) {
  if (_selectedApptId === id) { deselectAppointment(); return; }
  deselectAppointment();

  _selectedApptId     = id;
  _selectedApptColumn = columnId;

  // Highlight selected item
  const item = document.querySelector(`.appointment-item[data-id="${id}"]`);
  if (item) item.classList.add('appt-selected');

  // Swap add button → actions bar
  const addBtn  = document.getElementById(`add-appt-btn-${columnId}`);
  const actions = document.getElementById(`appt-actions-${columnId}`);
  if (addBtn)  addBtn.classList.add('hidden');
  if (actions) actions.classList.remove('hidden');
}

function deselectAppointment() {
  if (!_selectedApptId) return;

  document.querySelectorAll('.appointment-item.appt-selected')
    .forEach(el => el.classList.remove('appt-selected'));

  if (_selectedApptColumn) {
    const addBtn  = document.getElementById(`add-appt-btn-${_selectedApptColumn}`);
    const actions = document.getElementById(`appt-actions-${_selectedApptColumn}`);
    const form    = document.getElementById(`appt-form-${_selectedApptColumn}`);
    if (actions) actions.classList.add('hidden');
    if (form)    { form.classList.add('hidden'); const sb = form.querySelector('.btn-primary'); if (sb) sb.textContent = 'הוסף'; }
    if (addBtn)  addBtn.classList.remove('hidden');
  }

  _selectedApptId     = null;
  _selectedApptColumn = null;
  _editingMainApptId  = null;
}

function editSelectedAppointment() {
  if (!_selectedApptId || !_selectedApptColumn) return;
  const a = appointments.find(x => x.id === _selectedApptId);
  if (!a) return;

  _editingMainApptId = _selectedApptId;

  // Pre-fill form
  document.getElementById(`appt-title-${_selectedApptColumn}`).value = a.title;
  document.getElementById(`appt-date-${_selectedApptColumn}`).value  = a.date;
  document.getElementById(`appt-time-${_selectedApptColumn}`).value  = a.time || '';

  // Switch button label
  const form   = document.getElementById(`appt-form-${_selectedApptColumn}`);
  const saveBtn = form?.querySelector('.btn-primary');
  if (saveBtn) saveBtn.textContent = 'עדכן';

  // Hide actions, show form
  document.getElementById(`appt-actions-${_selectedApptColumn}`)?.classList.add('hidden');
  showApptForm(_selectedApptColumn);
}

function deleteSelectedAppointment() {
  if (!_selectedApptId) return;
  deleteAppointment(_selectedApptId);
}

async function saveAppointment(member) {
  const id    = safeid(member);
  const title = document.getElementById(`appt-title-${id}`).value.trim();
  const date  = document.getElementById(`appt-date-${id}`).value;
  const time  = document.getElementById(`appt-time-${id}`).value;
  if (!title || !date) return alert('נא למלא שם ותאריך');

  if (_editingMainApptId) {
    appointments = appointments.map(a =>
      a.id === _editingMainApptId ? { ...a, title, date, time } : a
    );
  } else {
    appointments.push({ id: Math.random().toString(36).slice(2), person: member, title, date, time });
  }

  _selectedApptId     = null;
  _selectedApptColumn = null;
  _editingMainApptId  = null;
  await api('POST', '/api/appointments', appointments);
  renderAppointments();
}

let _pendingDeleteId   = null;
let _pendingDeleteCallback = null;

function showConfirmDelete(id, onConfirm) {
  _pendingDeleteId       = id;
  _pendingDeleteCallback = onConfirm;
  document.getElementById('confirm-delete-modal').classList.remove('hidden');
}
function hideConfirmDelete() {
  _pendingDeleteId       = null;
  _pendingDeleteCallback = null;
  document.getElementById('confirm-delete-modal').classList.add('hidden');
}

async function deleteAppointment(id) {
  showConfirmDelete(id, async () => {
    appointments = appointments.filter(a => a.id !== id);
    await api('POST', '/api/appointments', appointments);
    renderAppointments();
  });
}

async function deleteCalendarAppointment(id) {
  showConfirmDelete(id, async () => {
    appointments = appointments.filter(a => a.id !== id);
    await api('POST', '/api/appointments', appointments);
    renderCalendar();
    if (calSelectedDate) showDayDetail(calSelectedDate);
  });
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
  if (userRole === 'guest') return;
  document.getElementById('add-chore-form').classList.remove('hidden');
  document.getElementById('add-chore-btn').classList.add('hidden');
  // Pre-select logged-in user as assignee
  const sel = document.getElementById('chore-assignee-input');
  if (userRole === 'member' && currentUser) sel.value = currentUser;
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
  if (userRole === 'guest') return;
  if (userRole === 'admin') { enterEditMode(); return; } // admin already authed
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
  document.body.classList.remove('guest-mode');
  document.getElementById('edit-toolbar').classList.remove('hidden');
  document.getElementById('photo-edit-panel').classList.remove('hidden');
  renderPhotoThumbs();
  renderGPhotoPanel();
  revealEditControls();
  renderAppointments(); // re-render so add buttons appear for all columns
}

function exitEditMode() {
  editMode = false;
  document.body.classList.remove('edit-mode');
  if (userRole === 'guest') document.body.classList.add('guest-mode');
  document.getElementById('edit-toolbar').classList.add('hidden');
  document.getElementById('photo-edit-panel').classList.add('hidden');
  document.getElementById('add-chore-form').classList.add('hidden');
  document.querySelectorAll('.edit-only').forEach(el => el.classList.add('hidden'));
  renderAppointments(); // re-render so add buttons reflect role
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
  renderPasswordFields();
  document.getElementById('config-modal').classList.remove('hidden');
});

function renderPasswordFields() {
  const members = config.members || [];
  const passwords = config.passwords || {};
  const list = document.getElementById('cfg-passwords-list');
  list.innerHTML = members.map(m => `
    <div class="cfg-password-row">
      <label class="cfg-password-label">${esc(m)}</label>
      <input type="password" class="cfg-password-input" data-member="${esc(m)}"
        value="${esc(passwords[m] || '')}" placeholder="ללא סיסמה" autocomplete="new-password">
      <button type="button" class="btn-icon cfg-pwd-toggle" onclick="togglePwdVisibility(this)" title="הצג">👁</button>
    </div>`).join('') +
    `<div class="cfg-password-row">
      <label class="cfg-password-label">⚙️ מנהל</label>
      <input type="password" id="cfg-admin-password" data-member="admin"
        value="${esc(config.adminPassword || '')}" placeholder="סיסמת מנהל" autocomplete="new-password">
      <button type="button" class="btn-icon cfg-pwd-toggle" onclick="togglePwdVisibility(this)" title="הצג">👁</button>
    </div>`;
}

function togglePwdVisibility(btn) {
  const input = btn.previousElementSibling;
  input.type = input.type === 'password' ? 'text' : 'password';
}

document.getElementById('cfg-cancel-btn').addEventListener('click', () => {
  document.getElementById('config-modal').classList.add('hidden');
});

document.getElementById('cfg-save-btn').addEventListener('click', async () => {
  const familyName    = document.getElementById('cfg-family-name').value.trim();
  const editPassword  = document.getElementById('cfg-password').value.trim();
  const photoInterval = parseInt(document.getElementById('cfg-interval').value) || 5;
  const members       = document.getElementById('cfg-members').value
    .split(',').map(s => s.trim()).filter(Boolean);

  // Collect member passwords
  const passwords = {};
  document.querySelectorAll('.cfg-password-input').forEach(input => {
    const member = input.dataset.member;
    const val    = input.value.trim();
    if (val) passwords[member] = val;
  });
  const adminPassword = (document.getElementById('cfg-admin-password')?.value || '').trim()
                        || config.adminPassword || 'admin123';

  config = { ...config, familyName, members, editPassword, adminPassword, photoInterval, passwords };
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
  if (userRole === 'guest') return;
  const authorInput = document.getElementById('msg-author-input');
  const authorRow   = document.getElementById('msg-author-row');
  if (userRole === 'member' || userRole === 'admin') {
    const label = userRole === 'admin' ? 'מנהל' : currentUser;
    authorInput.value = label;
    if (authorRow) authorRow.classList.add('hidden');
  } else {
    authorInput.value = '';
    if (authorRow) authorRow.classList.remove('hidden');
  }
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

      html += `<div class="${cls}" data-date="${dateStr}" onclick="showDayDetail('${dateStr}')">
        <div class="cal-day-num">${d.getDate()}</div>
        ${apptTags}
      </div>`;
      day++;
    }
    html += `</div>`;
  }

  grid.innerHTML = html;

  // Re-apply selected highlight if a date is still selected in this month
  if (calSelectedDate) {
    const sel = grid.querySelector(`[data-date="${calSelectedDate}"]`);
    if (sel) sel.classList.add('selected');
    else document.getElementById('cal-day-detail').classList.add('hidden'); // navigated away from selected month
  } else {
    document.getElementById('cal-day-detail').classList.add('hidden');
  }

  // Show/hide add button based on role
  const addBtn = document.getElementById('cal-add-appt-btn');
  if (userRole !== 'guest') addBtn.classList.remove('hidden');
  else addBtn.classList.add('hidden');

  // Nav buttons (reassign each render to avoid stacking listeners)
  const prevBtn = document.getElementById('cal-prev-btn');
  const nextBtn = document.getElementById('cal-next-btn');
  prevBtn.onclick = () => { calMonth--; if (calMonth < 0)  { calMonth = 11; calYear--; } renderCalendar(); };
  nextBtn.onclick = () => { calMonth++; if (calMonth > 11) { calMonth = 0;  calYear++; } renderCalendar(); };
}

function showDayDetail(dateStr) {
  calSelectedDate = dateStr;

  // Highlight selected date
  document.querySelectorAll('.cal-day').forEach(el => el.classList.remove('selected'));
  document.querySelector(`.cal-day[data-date="${dateStr}"]`)?.classList.add('selected');

  const appts  = appointments.filter(a => a.date === dateStr);
  const detail = document.getElementById('cal-day-detail');
  const [y, m, d] = dateStr.split('-');
  document.getElementById('cal-day-title').textContent = `${parseInt(d)} ב${HEB_MONTHS[parseInt(m)-1]} ${y}`;

  const list = document.getElementById('cal-day-appointments');
  list.innerHTML = appts.length
    ? appts.map(a => {
        const canDelete = userRole === 'admin' || (userRole === 'member' && a.person === currentUser);
        return `
        <div class="appointment-item">
          <div class="appt-info">
            <div class="appt-title">${esc(a.title)}</div>
            <div class="appt-date">${esc(a.person)}${a.time ? ' · ' + a.time : ''}</div>
          </div>
          ${canDelete ? `
            <button class="btn-icon" onclick="editCalendarAppointment('${a.id}')" title="ערוך">✏️</button>
            <button class="btn-icon" onclick="deleteCalendarAppointment('${a.id}')" title="מחק">🗑️</button>` : ''}
        </div>`;
      }).join('')
    : `<div class="no-appointments">אין פגישות ביום זה</div>`;

  detail.classList.remove('hidden');
  detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function showCalApptForm() {
  if (!calSelectedDate) { alert('נא לבחור תאריך בלוח תחילה'); return; }

  document.getElementById('cal-appt-title').value = '';
  document.getElementById('cal-appt-time').innerHTML = timeSelectOptions();

  // Member dropdown — admin only
  const memberSel = document.getElementById('cal-appt-member');
  if (userRole === 'admin') {
    const allMembers = [...(config.members || []), 'הרשי'];
    memberSel.innerHTML = allMembers.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
    memberSel.classList.remove('hidden');
  } else {
    memberSel.classList.add('hidden');
  }

  document.getElementById('cal-add-appt-form').classList.remove('hidden');
  document.getElementById('cal-add-appt-btn').classList.add('hidden');
}

function editCalendarAppointment(id) {
  const a = appointments.find(x => x.id === id);
  if (!a) return;
  _editingApptId = id;

  document.getElementById('cal-appt-title').value = a.title;
  document.getElementById('cal-appt-time').innerHTML = timeSelectOptions();
  document.getElementById('cal-appt-time').value = a.time || '';
  document.getElementById('cal-appt-save-btn').textContent = 'עדכן';

  const memberSel = document.getElementById('cal-appt-member');
  if (userRole === 'admin') {
    const allMembers = [...(config.members || []), 'הרשי'];
    memberSel.innerHTML = allMembers.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
    memberSel.value = a.person;
    memberSel.classList.remove('hidden');
  } else {
    memberSel.classList.add('hidden');
  }

  document.getElementById('cal-add-appt-form').classList.remove('hidden');
  document.getElementById('cal-add-appt-btn').classList.add('hidden');
}

function hideCalApptForm() {
  _editingApptId = null;
  document.getElementById('cal-appt-save-btn').textContent = 'הוסף';
  document.getElementById('cal-add-appt-form').classList.add('hidden');
  document.getElementById('cal-add-appt-btn').classList.remove('hidden');
}

async function saveCalendarAppointment() {
  if (userRole === 'guest') return;
  const title  = document.getElementById('cal-appt-title').value.trim();
  const time   = document.getElementById('cal-appt-time').value;
  const person = userRole === 'admin'
    ? document.getElementById('cal-appt-member').value
    : currentUser;

  if (!title) { alert('נא להזין שם פגישה'); return; }
  if (!calSelectedDate) return;

  if (_editingApptId) {
    // Edit existing appointment
    appointments = appointments.map(a =>
      a.id === _editingApptId ? { ...a, title, time, person } : a
    );
    _editingApptId = null;
  } else {
    // Add new appointment
    appointments.push({ id: Math.random().toString(36).slice(2), person, title, date: calSelectedDate, time });
  }

  await api('POST', '/api/appointments', appointments);
  renderCalendar();
  showDayDetail(calSelectedDate);
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

document.getElementById('cal-add-appt-btn').addEventListener('click', showCalApptForm);

// ── Media full page ───────────────────────────────────────────────────────

function renderMediaFull() {
  const grid = document.getElementById('media-full-grid');
  if (!grid) return;

  const html = photos.map(f => `
    <div class="media-full-item">
      <img src="${photoUrl(f)}" alt="תמונה" loading="lazy">
    </div>`).join('');

  grid.innerHTML = html || '<div class="empty-chores">לא הועלו תמונות עדיין</div>';
}

// ── Spotify full page sync ────────────────────────────────────────────────

function syncFullPlayer() {
  // Full-page embed is set at init; nothing to sync dynamically.
}

// ── Start ──────────────────────────────────────────────────────────────────

init();
