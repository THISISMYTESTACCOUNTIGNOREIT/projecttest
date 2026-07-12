# Desk Portfolio

A physics-based portfolio site. Two views: a normal file list, and a "desk view" where
your projects are draggable papers, polaroids, and folders on a wooden desk (Matter.js).

---

## File structure

| File | Purpose |
|---|---|
| `index.html` | Page skeleton, loads Matter.js + script.js |
| `style.css` | Header + normal view styling |
| `script.js` | Everything: data loading, physics, rendering, admin mode |
| `files.json` | Fallback portfolio data (used when Drive isn't configured/reachable) |
| `desk_layout.json` | The default desk arrangement everyone sees |
| `assets/` | Sprite images (folders, paper, polaroid) |

---

## 1. Google Drive integration (live auto-updating)

Once set up, the site reads your Drive folder **live on every page load**.
Add or remove files in Drive → refresh the site → it's updated. No redeploy needed.

### Setup (one time, ~10 minutes)

1. **Make your portfolio folder public:** In Google Drive, right-click the folder →
   Share → General access → "Anyone with the link" → Viewer.

2. **Get the folder ID:** Open the folder in your browser. The URL looks like
   `https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp` — the long string after
   `/folders/` is your folder ID.

3. **Create an API key:**
   - Go to https://console.cloud.google.com
   - Create a project (any name)
   - APIs & Services → Library → search "Google Drive API" → Enable
   - APIs & Services → Credentials → Create Credentials → API key
   - **Restrict it** (important): edit the key → Application restrictions →
     "Websites" → add your site URL (e.g. `https://yourname.github.io/*`).
     API restrictions → restrict to "Google Drive API".

4. **Paste both into `script.js`:** at the top, in `CONFIG`:
   ```js
   DRIVE_FOLDER_ID: "1AbCdEfGhIjKlMnOp",
   DRIVE_API_KEY:   "AIzaSy...",
   ```

### How files map to the desk
- Subfolders (one level deep) → desk folders with their files inside
- Images/videos → polaroid sprite
- Everything else (docs, PDFs, etc.) → paper sprite
- Double-click any item → opens it in Google Drive

If Drive is unreachable, the site silently falls back to `files.json`.

**Note:** the API key is visible in your page source. That's normal and safe for
read-only public-folder access *as long as you restrict the key* (step 3).

---

## 2. Hosting on GitHub Pages (free)

1. Create a GitHub account if you don't have one, then create a new **public** repo
   (e.g. `portfolio`).
2. Upload everything in this folder to the repo root (`index.html` must be at the root,
   not inside a subfolder).
3. Repo → Settings → Pages → Source: "Deploy from a branch" → Branch: `main`, folder `/ (root)` → Save.
4. Wait ~1 minute. Your site is live at `https://YOURUSERNAME.github.io/portfolio/`.

That link is what you send to people. Every push to the repo updates the site in ~1 min.

---

## 3. The layout workflow (your edits vs. visitors' edits)

**Visitors:** can drag everything around and play — their changes live only in their
browser session and reset on refresh. They can never affect your site.

**You (setting the default arrangement):**
1. Open the live site with `?admin=1` at the end:
   `https://yourname.github.io/portfolio/?admin=1`
2. Arrange the desk exactly how you want — positions, opened/ejected files, everything.
3. Click **Export Layout** (button in the header). It downloads `desk_layout.json`.
4. Replace `desk_layout.json` in your repo with the downloaded one, commit, push.
5. That arrangement is now the default state for every visitor.

**New files** you add to Drive that aren't in the layout yet spawn at a stable
pseudo-random spot (the "just tossed it on the desk" look) until you arrange and
re-export.

*(Anyone can technically add `?admin=1` to the URL — all it does is let them download
a JSON file of the current arrangement. It cannot change your site.)*

---

## 4. Local development

Use VS Code + Live Server. Right-click `index.html` **inside this folder** →
"Open with Live Server". The URL must be `127.0.0.1:5500/index.html` with no
subfolder in the path, or `fetch()` calls will 404.

---

## 5. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Blank desk + blank normal view | `files.json` not found (server root wrong) | Serve from inside the project folder (see §4) |
| "Google Drive unreachable" banner | Bad API key, key not restricted to your domain, folder not public, or Drive API not enabled | Re-check §1 steps 1–3 |
| Items stuck off-screen after resize | (Handled automatically — items clamp back into view) | — |
| Desk frozen, nothing draggable | JS error killed the input handler | Open DevTools console (F12), read the first red error |
| Layout export didn't change the live site | Old `desk_layout.json` still in repo, or browser cache | Confirm the file replaced + hard-refresh (Ctrl+Shift+R) |
| Item names cut off | Names longer than 18 chars are truncated with … | Rename in Drive, or raise the limit in `truncate()` in script.js |

---

## Tuning knobs (all in script.js)

- `EJECT_THRESHOLD` (200px) — how far a file must be dragged from its folder to eject
- `ADOPT_THRESHOLD` (160px) — how close to drop an ejected file to re-adopt it
- `SPRITE` sizes — display dimensions of each sprite
- Desk color — `#c8a97e` in the render loop

---

## 6. New in v2

**Desk view is now the default.** Visitors land on the desk; "Normal View" is the toggle.

**Files permanently join folders.** Drag any file onto any *open* folder (golden glow
shows the drop zone) and it becomes part of that folder — closes with it, moves with it.
Drag a file out past ~200px and it leaves the folder and lives on the desk.
All membership changes are captured by Export Layout, so your arrangement — including
which files live in which folders — becomes the site default.

**Scribbles.** In admin mode (`?admin=1`) you get ✏️ Draw and 🧽 Erase buttons.
Draw directly on the desk (pencil style), erase by clicking strokes. Scribbles are saved
in the exported layout and every visitor sees them. Visitors cannot draw.

**Upgrading sprites:** replace the PNG in `assets/` (keep the filename), and if the
aspect ratio changed, update the `w`/`h` for that sprite in the `SPRITE` block at the
top of `script.js`. Nothing else needs to change. Tip: PNGs with transparent
backgrounds at roughly 2–3x display size look crispest.
