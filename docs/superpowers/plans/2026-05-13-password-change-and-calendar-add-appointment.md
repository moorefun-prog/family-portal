# Password Change & Calendar Add Appointment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each logged-in user change their own password, and let users add appointments directly from the calendar by clicking a date.

**Architecture:** Two independent UI flows added to the existing single-page app. Password change adds a server endpoint + modal. Calendar add appointment extends the existing `showDayDetail()` panel with an inline form. No new files needed — all changes go into the four existing files.

**Tech Stack:** Vanilla JS, HTML, CSS, Node.js/Express, flat JSON storage on Railway volume.

---

## Files Modified

| File | Changes |
|------|---------|
| `server.js` | New `POST /api/change-password` endpoint |
| `public/index.html` | Change-password modal markup; calendar add-form + button in `cal-day-detail` |
| `public/style.css` | Change-password modal styles; calendar inline form styles |
| `public/app.js` | `renderUserPill` update; change-password modal logic; calendar add-appointment logic |

---

## Task 1: Server — `/api/change-password` endpoint

**Files:**
- Modify: `server.js` (after line 116, after the `/api/login` block)

- [ ] **Step 1: Add the endpoint to server.js**

Insert after the `app.post('/api/login', ...)` block (after line 116):

```js
app.post('/api/change-password', (req, res) => {
  const { name, currentPassword, newPassword } = req.body;
  if (!name || newPassword === undefined) return res.json({ ok: false, error: 'missing_fields' });

  const config = readJSON('config.json');

  if (name === 'admin') {
    const adminPwd = config.adminPassword || 'admin123';
    if (currentPassword !== adminPwd) return res.json({ ok: false, error: 'wrong_password' });
    config.adminPassword = newPassword;
  } else {
    if (!config.members.includes(name)) return res.json({ ok: false, error: 'unknown_user' });
    const stored = (config.passwords || {})[name] || '';
    if (currentPassword !== stored) return res.json({ ok: false, error: 'wrong_password' });
    if (!config.passwords) config.passwords = {};
    config.passwords[name] = newPassword;
  }

  writeJSON('config.json', config);
  res.json({ ok: true });
});
```

- [ ] **Step 2: Verify manually**

Run `npm run dev`, then in browser console or Postman:
```
POST http://localhost:3000/api/change-password
{ "name": "מיקי", "currentPassword": "", "newPassword": "test123" }
```
Expected response: `{ "ok": true }`

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: add /api/change-password endpoint"
```

---

## Task 2: HTML — Change-password modal

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Add the modal markup**

Find the login modal closing `</div>` (around line 66) and insert the change-password modal immediately after it:

```html
<!-- Change Password Modal -->
<div id="change-pwd-modal" class="change-pwd-modal hidden">
  <div class="change-pwd-box">
    <h3>שינוי סיסמה</h3>
    <div class="change-pwd-form">
      <input type="password" id="cpwd-current" placeholder="סיסמה נוכחית" autocomplete="current-password">
      <input type="password" id="cpwd-new" placeholder="סיסמה חדשה" autocomplete="new-password">
      <input type="password" id="cpwd-confirm" placeholder="אימות סיסמה חדשה" autocomplete="new-password">
      <p id="cpwd-error" class="cpwd-error hidden">שגיאה — בדוק את הפרטים</p>
      <div style="display:flex;gap:.5rem;margin-top:.5rem">
        <button id="cpwd-save-btn" class="btn btn-primary btn-sm">שמור</button>
        <button id="cpwd-cancel-btn" class="btn btn-secondary btn-sm">ביטול</button>
      </div>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add public/index.html
git commit -m "feat: add change-password modal markup"
```

---

## Task 3: HTML — Calendar add-appointment button and form

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Extend the cal-day-detail panel**

Find (around line 326):
```html
<div id="cal-day-detail" class="cal-day-detail hidden">
  <h3 id="cal-day-title"></h3>
  <div id="cal-day-appointments"></div>
</div>
```

Replace with:
```html
<div id="cal-day-detail" class="cal-day-detail hidden">
  <h3 id="cal-day-title"></h3>
  <div id="cal-day-appointments"></div>
  <button id="cal-add-appt-btn" class="btn btn-primary btn-sm" style="margin-top:.75rem">+ הוסף פגישה</button>
  <div id="cal-add-appt-form" class="cal-add-appt-form hidden">
    <input type="text" id="cal-appt-title" placeholder="שם הפגישה">
    <select id="cal-appt-time"></select>
    <select id="cal-appt-member" class="hidden"></select>
    <div style="display:flex;gap:.5rem;margin-top:.5rem">
      <button class="btn btn-primary btn-sm" onclick="saveCalendarAppointment()">הוסף</button>
      <button class="btn btn-secondary btn-sm" onclick="hideCalApptForm()">ביטול</button>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add public/index.html
git commit -m "feat: add calendar add-appointment form markup"
```

---

## Task 4: CSS — Change-password modal styles

**Files:**
- Modify: `public/style.css`

- [ ] **Step 1: Add styles**

Append to `style.css` (after the last rule):

```css
/* ── Change Password Modal ───────────────────────────────────────────────── */

.change-pwd-modal {
  position: fixed; inset: 0; z-index: 3000;
  background: rgba(13,45,69,0.55);
  display: flex; align-items: center; justify-content: center;
}
.change-pwd-modal.hidden { display: none; }

.change-pwd-box {
  background: var(--surface);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  padding: 2rem 2rem 1.5rem;
  width: min(340px, 92vw);
  display: flex; flex-direction: column; gap: 1rem;
}
.change-pwd-box h3 {
  font-size: 1.2rem; font-weight: 700;
  color: var(--text); text-align: center;
}
.change-pwd-form {
  display: flex; flex-direction: column; gap: .75rem;
}
.change-pwd-form input {
  width: 100%; padding: .65rem 1rem;
  border: 1.5px solid var(--border); border-radius: var(--radius-xs);
  font-family: inherit; font-size: 1rem; direction: rtl;
}
.cpwd-error {
  color: var(--danger); font-size: .85rem; text-align: center;
}
.cpwd-error.hidden { display: none; }

/* ── Calendar add-appointment inline form ───────────────────────────────── */

.cal-add-appt-form {
  display: flex; flex-direction: column; gap: .5rem;
  margin-top: .75rem; padding-top: .75rem;
  border-top: 1px solid var(--border);
}
.cal-add-appt-form.hidden { display: none; }
.cal-add-appt-form input,
.cal-add-appt-form select {
  width: 100%; padding: .55rem .8rem;
  border: 1.5px solid var(--border); border-radius: var(--radius-xs);
  font-family: inherit; font-size: .95rem; direction: rtl;
}
```

- [ ] **Step 2: Commit**

```bash
git add public/style.css
git commit -m "feat: add change-password modal and calendar form styles"
```

---

## Task 5: JS — Change-password logic

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Update `renderUserPill` to include change-password link**

Find the current `renderUserPill` function:
```js
function renderUserPill() {
  const pill = document.getElementById('user-pill');
  if (!pill) return;
  const label = userRole === 'guest' ? 'אורח 👁' :
                userRole === 'admin' ? '⚙️ מנהל' :
                currentUser;
  pill.innerHTML =
    `<span class="user-pill-name">${esc(label)}</span>` +
    `<button class="user-pill-switch" onclick="logout()">יציאה</button>`;
  pill.classList.remove('hidden');
}
```

Replace with:
```js
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
```

- [ ] **Step 2: Add change-password modal functions**

Insert after the `logout()` function (around line 128):

```js
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

  if (!newPassword) { errEl.textContent = 'סיסמה חדשה לא יכולה להיות ריקה'; errEl.classList.remove('hidden'); return; }
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
```

- [ ] **Step 3: Wire up modal buttons**

After the `init()` call at the bottom of the file (or in a DOMContentLoaded block), add:

```js
document.getElementById('cpwd-save-btn').addEventListener('click', submitChangePwd);
document.getElementById('cpwd-cancel-btn').addEventListener('click', hideChangePwdModal);
document.getElementById('cpwd-current').addEventListener('keydown', e => { if (e.key === 'Enter') submitChangePwd(); });
document.getElementById('cpwd-new').addEventListener('keydown', e => { if (e.key === 'Enter') submitChangePwd(); });
document.getElementById('cpwd-confirm').addEventListener('keydown', e => { if (e.key === 'Enter') submitChangePwd(); });
```

- [ ] **Step 4: Verify manually**

- Log in as מיקי (no password set)
- Click "שנה סיסמה" in header
- Enter empty current password, new password "abc", confirm "abc" → should succeed
- Log out, log back in with "abc" → should work
- Click "שנה סיסמה" again, enter wrong current password → should show error
- Verify guest sees no "שנה סיסמה" button

- [ ] **Step 5: Commit**

```bash
git add public/app.js
git commit -m "feat: change-password modal — UI and API integration"
```

---

## Task 6: JS — Calendar add-appointment logic

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Track selected calendar date**

At the top of the file, near the other state variables, add:

```js
let calSelectedDate = null;   // ISO string of clicked calendar day
```

- [ ] **Step 2: Update `showDayDetail` to set state and wire the add button**

Find the current `showDayDetail` function:
```js
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
```

Replace with:
```js
function showDayDetail(dateStr) {
  calSelectedDate = dateStr;
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

  // Add-appointment controls — hidden for guests
  const addBtn  = document.getElementById('cal-add-appt-btn');
  const addForm = document.getElementById('cal-add-appt-form');
  hideCalApptForm();

  if (userRole === 'guest') {
    addBtn.classList.add('hidden');
  } else {
    addBtn.classList.remove('hidden');

    // Member dropdown — admin only
    const memberSel = document.getElementById('cal-appt-member');
    const allMembers = [...(config.members || []), 'הרשי'];
    if (userRole === 'admin') {
      memberSel.innerHTML = allMembers.map(m =>
        `<option value="${esc(m)}">${esc(m)}</option>`).join('');
      memberSel.classList.remove('hidden');
    } else {
      memberSel.classList.add('hidden');
    }

    // Time select
    const timeSel = document.getElementById('cal-appt-time');
    timeSel.innerHTML = timeSelectOptions();
  }

  detail.classList.remove('hidden');
  detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
```

- [ ] **Step 3: Add `hideCalApptForm`, `showCalApptForm`, and `saveCalendarAppointment`**

Insert after `showDayDetail`:

```js
function showCalApptForm() {
  document.getElementById('cal-appt-title').value = '';
  document.getElementById('cal-appt-time').value = '';
  document.getElementById('cal-add-appt-form').classList.remove('hidden');
  document.getElementById('cal-add-appt-btn').classList.add('hidden');
}

function hideCalApptForm() {
  document.getElementById('cal-add-appt-form').classList.add('hidden');
  document.getElementById('cal-add-appt-btn').classList.remove('hidden');
}

async function saveCalendarAppointment() {
  const title  = document.getElementById('cal-appt-title').value.trim();
  const time   = document.getElementById('cal-appt-time').value;
  const person = userRole === 'admin'
    ? document.getElementById('cal-appt-member').value
    : currentUser;

  if (!title) { alert('נא להזין שם פגישה'); return; }
  if (!calSelectedDate) return;

  const { v4: uuidv4 } = { v4: () => Math.random().toString(36).slice(2) };
  appointments.push({ id: uuidv4(), person, title, date: calSelectedDate, time });
  await api('POST', '/api/appointments', appointments);

  // Refresh calendar grid and day detail
  renderCalendar();
  showDayDetail(calSelectedDate);
}
```

- [ ] **Step 4: Wire add button**

Find where the other event listeners are wired up (near the login button listeners), and add:

```js
document.getElementById('cal-add-appt-btn').addEventListener('click', showCalApptForm);
```

- [ ] **Step 5: Verify manually**

- Log in as מיקי → go to calendar → click a date → "הוסף פגישה" appears
- Click it → form appears with title input, time select, no member dropdown
- Fill in title, pick time, click "הוסף" → appointment saved, calendar dot appears, day detail refreshes
- Log in as מנהל → click a date → form shows member dropdown with all members + הרשי
- Log in as guest → click a date → no "הוסף פגישה" button visible

- [ ] **Step 6: Commit**

```bash
git add public/app.js
git commit -m "feat: add appointment from calendar day-detail panel"
```

---

## Task 7: Push & verify on Railway

- [ ] **Step 1: Push**

```bash
git push
```

- [ ] **Step 2: Verify on live Railway URL**

- Change password as a member → log out → log back in with new password ✓
- Add appointment from calendar as member → appears in appointments page ✓
- Add appointment from calendar as admin → member dropdown shown, assigned correctly ✓
- Guest: no add button, no change-password link ✓
