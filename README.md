# 🏠 Family Portal — פורטל המשפחה

A private, Hebrew RTL family dashboard for the Mor-Shachar family. Built as a full-stack web application and hosted on Railway.

---

## Features

### 🔐 Authentication & Roles
- Mandatory login screen — the portal is not accessible without signing in
- **Three roles:**
  | Role | Access |
  |------|--------|
  | `מנהל` (Admin) | Full access, auto-enters edit mode, sees the ✏️ edit button |
  | Member | Can view everything, add/edit their own appointments, change their own password |
  | Guest | View-only — no add, edit, or delete actions |
- Session persistence: "זכור אותי" keeps you logged in across browser restarts
- Each user can change their own password from the header

### 📅 Appointments
- Per-member appointment columns on the home page
- **הרשי** (the family dog 🐶) has a dedicated appointment card — admin-only
- Click any appointment to highlight it → **✏️ ערוך** / **🗑️ מחק** / **ביטול** actions appear
- Delete shows a Hebrew confirmation modal before removing
- Time picker: 30-minute intervals in 24H format (00:00 – 23:30)

### 📆 Calendar
- Monthly calendar view with Hebrew month/day labels
- Click any date to highlight it and see existing appointments for that day
- **"+ הוסף פגישה"** button sits permanently at the bottom — pick a date first, then add
- Admin gets a member dropdown to assign appointments to any family member
- Members auto-assign to themselves
- Edit or delete appointments directly from the day-detail panel

### ✅ Chores
- Shared chore list with assignees and due dates
- Mark chores as done / clear completed

### 📸 Photos & Media
- Photo slideshow (local uploads or Google Photos album)
- YouTube embed: paste a single video URL or a full playlist URL
- Both panes sized at 16:9 aspect ratio

### 💬 Messages
- Floating message board / ticker

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla HTML, CSS, JavaScript (no framework) |
| Backend | Node.js 20 + Express 5 |
| Storage | Flat JSON files on a Railway persistent volume |
| Container | Docker (`node:20-alpine`) |
| Hosting | [Railway](https://railway.app) |
| CI/CD | GitHub → Railway auto-deploy on push to `master` |

---

## Project Structure

```
Family_Portal/
├── server.js              # Express API + static file serving
├── Dockerfile             # node:20-alpine container
├── railway.toml           # Railway deploy config
├── public/
│   ├── index.html         # Single-page app shell
│   ├── app.js             # All frontend logic
│   └── style.css          # RTL styles + responsive layout
├── data-seed/             # Default data — copied to /data on first boot
│   ├── config.json
│   ├── appointments.json
│   ├── chores.json
│   ├── messages.json
│   └── youtube-playlist.json
├── data/                  # Live data (Railway persistent volume — gitignored)
└── docs/
    └── superpowers/
        ├── specs/         # Feature design documents
        └── plans/         # Implementation plans
```

---

## Getting Started (Local Development)

**Prerequisites:** Node.js 20+

```bash
git clone https://github.com/moorefun-prog/family-portal.git
cd family-portal
npm install
npm run dev        # starts with --watch (auto-restarts on file change)
```

Open [http://localhost:3000](http://localhost:3000)

**Default credentials:**
| User | Password |
|------|----------|
| מנהל (admin) | `admin123` |
| Family members | No password set by default |

---

## Deployment (Railway)

Every push to `master` triggers an automatic Railway deploy:

```
git push origin master
  └─ Railway builds Docker image
       └─ npm ci --omit=dev
            └─ node server.js → live
```

- **Volume:** Railway persistent volume mounted at `/data` — survives redeployments
- **First boot:** If `/data` is empty, seed files from `data-seed/` are copied in automatically
- **Restart policy:** `on_failure`, max 3 retries

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/login` | Authenticate, returns `{ ok, role }` |
| `POST` | `/api/change-password` | Change own password |
| `GET/POST` | `/api/config` | Read/write family config |
| `GET/POST` | `/api/appointments` | Read/write appointments |
| `GET/POST` | `/api/chores` | Read/write chores |
| `GET/POST` | `/api/messages` | Read/write messages |
| `GET/POST` | `/api/youtube-playlist` | Read/write YouTube embed settings |
| `GET/POST` | `/api/photos` | Photo management |

---

## Notes

- **RTL layout** — the entire UI is right-to-left (Hebrew)
- **No database** — all data stored as JSON files; suitable for low-concurrency family use
- **API has no server-side auth guard** — suitable for private/internal use only
- **Music player** — code is preserved but hidden; can be re-enabled by removing `display: none` from the music strip CSS
