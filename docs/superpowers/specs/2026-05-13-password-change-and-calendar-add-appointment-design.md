# Design: Password Change & Calendar Add Appointment

**Date:** 2026-05-13  
**Project:** Family Portal (Mor-Shachar)

---

## Feature 1 — Change Password

### Goal
Allow each logged-in member (and admin) to change their own password from within the portal, without needing admin access to the config modal.

### UI
- A **"שנה סיסמה"** link appears in the header user pill area, next to the logout button
- Hidden for guests (guests have no password)
- Opens a dedicated modal with three fields:
  1. Current password
  2. New password
  3. Confirm new password
- A **שמור** (Save) button submits the form
- Inline error shown if current password is wrong or new passwords don't match
- On success: modal closes silently, no page reload

### API
**New endpoint:** `POST /api/change-password`

Request body:
```json
{ "name": "מיקי", "currentPassword": "old", "newPassword": "new" }
```

Server logic:
- If `name === 'admin'`: verify against `config.adminPassword`
- Otherwise: verify against `config.passwords[name]` (empty string = no password set → any current password accepted... actually: if no password is set, current password field must be blank to pass)
- On match: update the relevant password field in `config.json`, save
- Return `{ ok: true }` or `{ ok: false, error: 'wrong_password' }`

### Roles
| Role | Behavior |
|------|----------|
| admin (מנהל) | Can change their own admin password |
| member | Can change their own member password |
| guest | "שנה סיסמה" link not shown |

---

## Feature 2 — Calendar Add Appointment

### Goal
Allow users to add an appointment directly from the calendar view by clicking a date and using the day-detail panel — without navigating to the appointments page.

### UI
- Clicking a date shows the existing `cal-day-detail` panel
- A **"+ הוסף פגישה"** button appears at the bottom of the panel (hidden for guests)
- Clicking the button reveals an inline add form within the panel:
  - **Title** — text input, required
  - **Time** — 30-min interval 24H `<select>` (00:00–23:30), optional
  - **Member** — dropdown, **admin only**; lists all `config.members` + הרשי; members do not see this field (appointment auto-assigned to `currentUser`)
  - **Date** — pre-filled from the selected calendar day, not shown to user
- **הוסף** (Add) and **ביטול** (Cancel) buttons
- On save:
  - Appointment pushed to the global `appointments` array
  - `POST /api/appointments` called to persist
  - Calendar grid re-renders (new dot/tag appears on the day)
  - Day-detail panel refreshes to show the new appointment
  - Add form hides

### Roles
| Role | Behavior |
|------|----------|
| admin (מנהל) | Sees member dropdown, can assign to any member or הרשי |
| member | No dropdown, appointment auto-assigned to themselves |
| guest | "הוסף פגישה" button not shown |

### Data
Appointment object (unchanged schema):
```json
{ "id": "abc123", "person": "יהונתן", "title": "רופא שיניים", "date": "2026-05-20", "time": "14:30" }
```

---

## Out of Scope
- Editing existing appointments from the calendar (delete only, unchanged)
- Admin adding appointments for themselves from the calendar (admin is for management, not personal scheduling)
- Password strength validation (family-internal tool, not required)
