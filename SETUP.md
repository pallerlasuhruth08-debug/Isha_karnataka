# Isha Karnataka Team Builder — Setup

A single HTML app with login + admin approval, backed by a Google Sheet (Apps
Script web app), hosted on Netlify (or any static host).

| File | What it is |
|---|---|
| `isha_karnataka.html` | The app (open in a browser). |
| `Code.gs` | Backend script for Google Apps Script. |
| `netlify.toml` | Netlify hosting config. |
| `SETUP.md` | This guide. |

The backend `/exec` URL is already pasted into `isha_karnataka.html`. If you ever
redeploy and the URL changes, update the `GAS_URL` line near the top of the HTML.

## A. Backend (already deployed for you)
Your Apps Script web app is live at the `/exec` URL baked into the HTML. To change it:
1. Open the Sheet → **Extensions → Apps Script**, paste `Code.gs`, save.
2. Set your admin email in `var ADMIN_EMAILS = ['...'];` (auto-approved as admin).
3. **Deploy → Manage deployments → edit → New version → Deploy** (URL stays the same).

## B. Publish to a host
**Netlify (drag & drop):** app.netlify.com → Add new site → Deploy manually → drag
this folder in. The bare site URL opens the app (via `netlify.toml`).

**Other static hosts** (Cloudflare Pages, Vercel, GitHub Pages, Surge): upload the
folder. For these, rename `isha_karnataka.html` to `index.html` so it's the homepage,
or create an `index.html` that points to it.

## C. Give your team access
1. Share your live site URL.
2. People click **Sign up** → their account is **pending**.
3. You (admin) open the **Users** tab → **Approve**, set **role**, assign a **centre**.
4. Approved members edit their assigned centre + their own profile; admins edit all.

## App map
- **Dashboard** — region snapshot + centre cards; tap a centre for its dashboard
  (every role, its status, and next step).
- **Centres / My centre** — edit teams (roles, sub-roles, status, next step), stages 1–4.
- **Region** (admin) — region anchor/support roles.
- **Blueprint** — interactive branching roles & responsibilities tree.
- **Users** (admin) — approvals & assignments.
- **My profile** — photo + personal/family, work, Isha-journey, location fields.

## Storage & security
- Planning data = one JSON blob (`ika_v7`), chunked across rows in a `store` tab.
- Accounts in a `users` tab: salted SHA-256 password hash, status, role, centre, token.
  Profiles stored (chunked) under `profile_<email>`.
- Server enforces: only admins write region-wide data; members write only their centre
  and own profile.
- Lightweight auth (no email verification / rate-limiting). Tell users to use a unique
  password. For stronger auth, ask about Netlify Identity.

## Troubleshooting
- **Login says "Backend not configured"** → `GAS_URL` missing in the HTML.
- **"Network/backend error"** → open the `/exec` URL in a browser; must return
  `{"ok":true,...}`. If not, redeploy (Execute as **Me**, access **Anyone**).
- **Signed up but can't log in** → account is pending; an admin must approve it.
- **Member can't edit a centre** → admin must assign them to it in Users.
- **Blank page** → must be online (React/fonts load from CDNs on first paint).
