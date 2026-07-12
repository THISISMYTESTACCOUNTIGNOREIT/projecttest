/* ============================================================
   DESK PORTFOLIO — v2 pipeline
   Data:    Google Drive folder (live) OR files.json (fallback)
   Layout:  desk_layout.json = default state (positions, folder
            membership, scribbles) that every visitor sees
   Admin:   ?admin=1 → arrange desk, draw/erase, Export Layout
   Model:   files live either ON the desk or IN a folder.
            Drag out of a folder → it's on the desk.
            Drop onto any open folder → it joins that folder.
   ============================================================ */

// ---------------- CONFIG ----------------
const CONFIG = {
    // Google Drive integration (optional — see README.md)
    DRIVE_FOLDER_ID: "1ByycLpYJOp4YleuAhmsvOe4-AqoXYaWp",   // ← paste your folder id back here
    DRIVE_API_KEY:   "AIzaSyDCqn9lKWJsPm9ns8eKDDR6Mshabpzt7BU",   // ← paste your API key back here
    LAYOUT_URL: "desk_layout.json",
};

const CATEGORY_WALL   = 0x0001;
const CATEGORY_FILE   = 0x0002;
const CATEGORY_FOLDER = 0x0004;
const CATEGORY_HIDDEN = 0x0008; // hidden children — the mouse can't grab these

const EJECT_THRESHOLD = 200; // drag a child this far from its folder → leaves it
const ADOPT_THRESHOLD = 160; // drop a file this close to an open folder → joins it

// ---------------- SPRITES ----------------
// To upgrade a sprite: replace the PNG in assets/ (same filename),
// then update w/h here if the aspect ratio changed. That's it.
const SPRITE = {
    folder_closed: { w: 125, h: 154, src: 'assets/folder_closed.png' },
    folder_open:   { w: 215, h: 148, src: 'assets/folder_open.png'   },
    paper:         { w: 118, h: 152, src: 'assets/paper.png'         },
    polaroid:      { w: 152, h: 165, src: 'assets/polaroid.png'      },
};

const IMAGES = {};
function preloadImages(cb) {
    const keys = Object.keys(SPRITE);
    let loaded = 0;
    keys.forEach(key => {
        const img = new window.Image();
        img.onload = img.onerror = () => { if (++loaded === keys.length) cb(); };
        img.src = SPRITE[key].src;
        IMAGES[key] = img;
    });
}

// ---------------- BANNER ----------------
function showBanner(msg, isError = true) {
    let el = document.getElementById('deskBanner');
    if (!el) {
        el = document.createElement('div');
        el.id = 'deskBanner';
        el.style.cssText = 'position:fixed;bottom:12px;left:50%;transform:translateX(-50%);' +
            'padding:8px 16px;border-radius:6px;font:13px sans-serif;z-index:999;max-width:80%;';
        document.body.appendChild(el);
    }
    el.style.background = isError ? '#c0392b' : '#2e7d32';
    el.style.color = '#fff';
    el.textContent = msg;
    clearTimeout(el._t);
    el._t = setTimeout(() => el.remove(), 6000);
}

// ---------------- DATA LAYER ----------------
let portfolioData = null;

function fileTypeFromMime(mime) {
    if (!mime) return 'doc';
    if (mime.startsWith('image/') || mime.startsWith('video/')) return 'image';
    return 'doc';
}

async function fetchDriveTree(folderId, depth = 0) {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    const fields = encodeURIComponent('files(id,name,mimeType,webViewLink)');
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&key=${CONFIG.DRIVE_API_KEY}&fields=${fields}&pageSize=100`;
    const res = await fetch(url);
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Drive API ${res.status}: ${body.slice(0, 300)}`);
    }
    const json = await res.json();
    const files = (json.files || []).sort((a, b) => a.name.localeCompare(b.name));

    const items = [];
    for (const f of files) {
        if (f.mimeType === 'application/vnd.google-apps.folder') {
            let children = [];
            if (depth < 1) {
                try { children = await fetchDriveTree(f.id, depth + 1); }
                catch (e) { console.warn('Child folder fetch failed:', f.name, e); }
            }
            items.push({
                id: f.id, name: f.name, type: 'folder',
                url: `https://drive.google.com/drive/folders/${f.id}`,
                children,
            });
        } else {
            items.push({
                id: f.id, name: f.name, type: 'file',
                fileType: fileTypeFromMime(f.mimeType),
                url: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
            });
        }
    }
    return items;
}

async function fetchData() {
    if (portfolioData) return portfolioData;

    if (CONFIG.DRIVE_FOLDER_ID && CONFIG.DRIVE_API_KEY) {
        try {
            const tree = await fetchDriveTree(CONFIG.DRIVE_FOLDER_ID);
            if (!tree.length) {
                // Empty result usually means the folder isn't shared publicly
                console.warn('Drive returned 0 items — is the folder shared "Anyone with the link"?');
                showBanner('Drive folder appears empty or not public — showing fallback.');
            } else {
                portfolioData = tree;
                console.log('Loaded from Google Drive:', tree.length, 'items');
                return portfolioData;
            }
        } catch (e) {
            console.error('Drive fetch failed, falling back to files.json:', e.message);
            showBanner('Google Drive unreachable — showing cached portfolio. (F12 console has details)');
        }
    }

    const res = await fetch('files.json');
    if (!res.ok) throw new Error('files.json not found');
    portfolioData = await res.json();
    return portfolioData;
}

async function fetchLayout() {
    try {
        const res = await fetch(CONFIG.LAYOUT_URL, { cache: 'no-store' });
        if (!res.ok) return { items: {}, strokes: [] };
        const json = await res.json();
        if (!json || typeof json !== 'object') return { items: {}, strokes: [] };
        return { items: json.items || {}, strokes: json.strokes || [] };
    } catch {
        return { items: {}, strokes: [] };
    }
}

// Stable pseudo-random desk spot from an id — new files land here
function hashPos(id, w, h) {
    let hash = 0;
    const s = String(id);
    for (let i = 0; i < s.length; i++) hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
    const rx = Math.abs(hash % 1000) / 1000;
    const ry = Math.abs(((hash / 1000) | 0) % 1000) / 1000;
    const ra = Math.abs(((hash / 1000000) | 0) % 1000) / 1000;
    return {
        x: 140 + rx * Math.max(100, w - 320),
        y: 140 + ry * Math.max(100, h - 320),
        angle: (ra - 0.5) * 0.2,
    };
}

function spriteKeyForFile(f) {
    return (f.fileType === 'image' || f.fileType === 'video') ? 'polaroid' : 'paper';
}

// ---------------- NORMAL VIEW ----------------
async function loadNormalView() {
    try {
        const data = await fetchData();
        renderNormalView(data, document.getElementById('normalView'));
    } catch (err) {
        console.error('Data load failed:', err);
        document.getElementById('normalView').textContent = 'Failed to load portfolio data.';
    }
}

function renderNormalView(files, container) {
    container.innerHTML = '';
    const ul = document.createElement('ul');
    files.forEach(file => {
        const li = document.createElement('li');
        if (file.type === 'file') {
            li.textContent = file.name;
            li.className = 'file';
            li.onclick = (e) => { e.stopPropagation(); window.open(file.url, '_blank'); };
        } else if (file.type === 'folder') {
            li.textContent = '📁 ' + file.name;
            li.className = 'folder';
            li.onclick = (e) => {
                e.stopPropagation();
                const existing = li.querySelector('ul');
                if (existing) existing.remove();
                else if (file.children && file.children.length) renderNormalView(file.children, li);
            };
        }
        ul.appendChild(li);
    });
    container.appendChild(ul);
}

// ---------------- VIEW TOGGLE (desk is default) ----------------
const toggleBtn  = document.getElementById('toggleView');
const normalView = document.getElementById('normalView');
const deskView   = document.getElementById('deskView');
let deskInitialized = false;
let normalLoaded = false;

function startDesk() {
    if (deskInitialized) return;
    deskInitialized = true;
    preloadImages(() => setTimeout(initDeskView, 20));
}

window.addEventListener('DOMContentLoaded', startDesk);

toggleBtn.onclick = () => {
    const deskShowing = deskView.style.display !== 'none';
    if (deskShowing) {
        deskView.style.display = 'none';
        normalView.style.display = 'block';
        toggleBtn.textContent = 'Switch to Desk View';
        if (!normalLoaded) { normalLoaded = true; loadNormalView(); }
    } else {
        normalView.style.display = 'none';
        deskView.style.display = 'block';
        toggleBtn.textContent = 'Switch to Normal View';
        startDesk();
    }
};

// ---------------- DESK VIEW ----------------
async function initDeskView() {
    const { Engine, Render, World, Bodies, Body, Mouse,
            MouseConstraint, Composite, Events, Query } = Matter;

    const engine = Engine.create();
    engine.world.gravity.x = 0;
    engine.world.gravity.y = 0;
    const world = engine.world;

    const canvas = document.getElementById('deskView');
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight - document.querySelector('header').offsetHeight;

    const render = Render.create({
        canvas, engine,
        options: { width: canvas.width, height: canvas.height, wireframes: false }
    });

    // ---- Walls ----
    let walls = [];
    function wallOpts() {
        return { isStatic: true, label: 'wall',
                 collisionFilter: { category: CATEGORY_WALL, mask: CATEGORY_FILE | CATEGORY_FOLDER } };
    }
    function buildWalls() {
        walls.forEach(w => World.remove(world, w));
        const t = 80, w = canvas.width, h = canvas.height;
        walls = [
            Bodies.rectangle(w/2, -t/2,    w, t, wallOpts()),
            Bodies.rectangle(w/2, h + t/2, w, t, wallOpts()),
            Bodies.rectangle(-t/2,   h/2,  t, h, wallOpts()),
            Bodies.rectangle(w + t/2, h/2, t, h, wallOpts()),
        ];
        World.add(world, walls);
    }
    buildWalls();

    window.addEventListener('resize', () => {
        canvas.width  = window.innerWidth;
        canvas.height = window.innerHeight - document.querySelector('header').offsetHeight;
        render.options.width  = canvas.width;
        render.options.height = canvas.height;
        buildWalls();
        const pad = 70;
        const clamp = (p) => ({
            x: Math.min(Math.max(p.x, pad), canvas.width  - pad),
            y: Math.min(Math.max(p.y, pad), canvas.height - pad),
        });
        folders.forEach(f => {
            f.basePosition = clamp(f.basePosition);
            Body.setPosition(f.body, f.basePosition);
        });
        topFiles.forEach(fl => Body.setPosition(fl.body, clamp(fl.body.position)));
    });

    // ---- Load data + layout ----
    let data = [], layout = { items: {}, strokes: [] };
    try {
        [data, layout] = await Promise.all([fetchData(), fetchLayout()]);
    } catch (e) {
        console.error(e);
        showBanner('Could not load portfolio data.');
        return;
    }

    let strokes = Array.isArray(layout.strokes) ? layout.strokes : [];

    // ================= DATA MODEL =================
    // folders:  [{ id, name, url, body, children:[fileRef], open, basePosition }]
    // topFiles: [{ id, name, url, fileType, body, spriteKey }]        (on the desk)
    // children: same file objects but held in folder.children, with .offset
    // A file object moves BETWEEN these containers when adopted/removed.

    const folders = [];
    const topFiles = [];
    let zCounter = 1;

    function createBody(x, y, w, h, label, category) {
        return Bodies.rectangle(x, y, w, h, {
            label,
            restitution: 0, friction: 0.9, frictionAir: 0.2,
            density: 0.002, inertia: Infinity,
            collisionFilter: { category, mask: CATEGORY_WALL },
            render: { fillStyle: 'rgba(0,0,0,0)', strokeStyle: 'rgba(0,0,0,0)', lineWidth: 0 }
        });
    }

    function setHidden(body, hidden) {
        body.render.visible = !hidden;
        body.collisionFilter.category = hidden ? CATEGORY_HIDDEN : CATEGORY_FILE;
    }

    // ---- Flatten source data, then apply layout parent overrides ----
    const srcFolders = data.filter(d => d.type === 'folder');
    const srcFiles = [];
    data.filter(d => d.type === 'file').forEach(f => srcFiles.push({ ...f, originalParent: null }));
    srcFolders.forEach(fd => (fd.children || []).forEach(c => {
        if (c.type === 'file') srcFiles.push({ ...c, originalParent: fd.id });
    }));

    const folderIds = new Set(srcFolders.map(f => f.id));

    function effectiveParent(file) {
        const saved = layout.items[file.id];
        if (saved && 'parent' in saved) {
            // Layout explicitly re-parented this file (or set it to null = desk)
            if (saved.parent === null) return null;
            if (folderIds.has(saved.parent)) return saved.parent;
        }
        return folderIds.has(file.originalParent) ? file.originalParent : null;
    }

    // ---- Build folders ----
    srcFolders.forEach(fd => {
        const saved = layout.items[fd.id];
        const fb = hashPos(fd.id, canvas.width, canvas.height);
        const x = saved && typeof saved.x === 'number' ? saved.x : fb.x;
        const y = saved && typeof saved.y === 'number' ? saved.y : fb.y;
        const angle = saved && typeof saved.angle === 'number' ? saved.angle : fb.angle;

        const sp = SPRITE.folder_closed;
        const body = createBody(x, y, sp.w, sp.h, fd.name, CATEGORY_FOLDER);
        body.render.zIndex = zCounter++;
        body.render.spriteKey = 'folder_closed';
        Body.setAngle(body, angle);
        World.add(world, body);

        folders.push({
            id: fd.id, name: fd.name, url: fd.url,
            body, children: [], open: false,
            basePosition: { x, y },
        });
    });

    // ---- Build files (parented or on-desk) ----
    srcFiles.forEach((file, idx) => {
        const parentId = effectiveParent(file);
        const sk = spriteKeyForFile(file);
        const sp = SPRITE[sk];
        const saved = layout.items[file.id];

        const fileObj = {
            id: file.id, name: file.name, url: file.url,
            fileType: file.fileType, spriteKey: sk,
            body: null, offset: null, beingDragged: false,
        };

        if (parentId) {
            const folder = folders.find(f => f.id === parentId);
            // In-folder default stacking position (right half of open folder)
            const i = folder.children.length;
            const col = i % 2, row = Math.floor(i / 2);
            let ox = SPRITE.folder_open.w / 2 - 30 + col * (sp.w * 0.4);
            let oy = -sp.h * 0.1 + row * (sp.h * 0.55);
            if (saved && typeof saved.ox === 'number') { ox = saved.ox; oy = saved.oy; }

            const body = createBody(
                folder.body.position.x + ox, folder.body.position.y + oy,
                sp.w, sp.h, file.name, CATEGORY_FILE);
            body.render.zIndex = zCounter++;
            body.render.spriteKey = sk;
            Body.setAngle(body, (saved && typeof saved.angle === 'number')
                ? saved.angle : (Math.random() - 0.5) * 0.12);
            setHidden(body, true); // folders start closed
            World.add(world, body);

            fileObj.body = body;
            fileObj.offset = { x: ox, y: oy };
            folder.children.push(fileObj);
        } else {
            const fb = hashPos(file.id ?? file.name + idx, canvas.width, canvas.height);
            const x = saved && typeof saved.x === 'number' ? saved.x : fb.x;
            const y = saved && typeof saved.y === 'number' ? saved.y : fb.y;
            const angle = saved && typeof saved.angle === 'number' ? saved.angle : fb.angle;

            const body = createBody(x, y, sp.w, sp.h, file.name, CATEGORY_FILE);
            body.render.zIndex = zCounter++;
            body.render.spriteKey = sk;
            Body.setAngle(body, angle);
            World.add(world, body);

            fileObj.body = body;
            topFiles.push(fileObj);
        }
    });

    // ---- Container helpers ----
    function findFile(body) {
        let hit = topFiles.find(f => f.body === body);
        if (hit) return { file: hit, parent: null };
        for (const fd of folders) {
            hit = fd.children.find(c => c.body === body);
            if (hit) return { file: hit, parent: fd };
        }
        return null;
    }

    function removeFromContainer(file, parent) {
        if (parent) {
            const i = parent.children.indexOf(file);
            if (i >= 0) parent.children.splice(i, 1);
        } else {
            const i = topFiles.indexOf(file);
            if (i >= 0) topFiles.splice(i, 1);
        }
    }

    function adoptFile(file, fromParent, toFolder) {
        removeFromContainer(file, fromParent);
        file.offset = {
            x: file.body.position.x - toFolder.body.position.x,
            y: file.body.position.y - toFolder.body.position.y,
        };
        toFolder.children.push(file);
    }

    function releaseToDesk(file, fromParent) {
        removeFromContainer(file, fromParent);
        file.offset = null;
        setHidden(file.body, false);
        topFiles.push(file);
    }

    // ---- z-order ----
    function bringToFront(body) {
        const folder = folders.find(f => f.body === body);
        if (folder && folder.open && folder.children.length) {
            const minChildZ = folder.children
                .reduce((min, c) => Math.min(min, c.body.render.zIndex || 0), Infinity);
            body.render.zIndex = isFinite(minChildZ) ? minChildZ - 1 : ++zCounter;
        } else {
            body.render.zIndex = ++zCounter;
        }
    }

    // ---- Folder open/close ----
    function swapFolderBody(folder, isOpen) {
        const sp = isOpen ? SPRITE.folder_open : SPRITE.folder_closed;
        const old = folder.body;
        const pos = old.position, angle = old.angle, oldZ = old.render.zIndex;
        World.remove(world, old);
        const nb = createBody(pos.x, pos.y, sp.w, sp.h, folder.name, CATEGORY_FOLDER);
        nb.render.zIndex = oldZ;
        nb.render.spriteKey = isOpen ? 'folder_open' : 'folder_closed';
        Body.setAngle(nb, angle);
        World.add(world, nb);
        folder.body = nb;
    }

    function toggleFolderOpen(folder) {
        folder.open = !folder.open;
        if (mc.constraint.bodyB === folder.body) mc.constraint.bodyB = null;
        swapFolderBody(folder, folder.open);

        folder.children.forEach(c => {
            setHidden(c.body, !folder.open);
            if (folder.open) {
                Body.setPosition(c.body, {
                    x: folder.body.position.x + c.offset.x,
                    y: folder.body.position.y + c.offset.y,
                });
                Body.setVelocity(c.body, { x: 0, y: 0 });
                c.body.isSleeping = false;
            }
        });
    }

    // ---- Mouse ----
    const mouse = Mouse.create(canvas);
    const mc = MouseConstraint.create(engine, {
        mouse,
        collisionFilter: { mask: CATEGORY_FILE | CATEGORY_FOLDER },
        constraint: { stiffness: 0.2, render: { visible: false } }
    });
    World.add(world, mc);

    function topmostVisibleAt(pos) {
        const bodies = Query.point(Composite.allBodies(world), pos)
            .filter(b => b.label !== 'wall' && b.render.visible !== false);
        if (!bodies.length) return null;
        return bodies.reduce((top, b) =>
            (b.render.zIndex || 0) > (top.render.zIndex || 0) ? b : top);
    }

    let lastClickTime = 0, lastClickedBody = null;
    const DOUBLE_CLICK_DELAY = 300;
    let draggedFileRef = null; // for the adoption glow

    Events.on(mc, 'mousedown', event => {
        if (adminTool !== 'none') return; // drawing mode — no desk interaction
        const clicked = topmostVisibleAt(event.mouse.position);
        if (!clicked) return;

        const now = Date.now();
        bringToFront(clicked);

        if (clicked === lastClickedBody && now - lastClickTime < DOUBLE_CLICK_DELAY) {
            const folder = folders.find(f => f.body === clicked);
            if (folder) {
                toggleFolderOpen(folder);
            } else {
                const hit = findFile(clicked);
                if (hit && hit.file.url) window.open(hit.file.url, '_blank');
            }
            lastClickedBody = null; lastClickTime = 0;
            return;
        }
        lastClickedBody = clicked;
        lastClickTime = now;
    });

    Events.on(mc, 'startdrag', ev => {
        if (!ev.body || ev.body.label === 'wall') return;

        // Redirect grab to the topmost visible body
        const top = topmostVisibleAt(mouse.position);
        let target = ev.body;
        if (top && top !== ev.body) {
            mc.constraint.bodyB = top;
            mc.body = top;
            mc.constraint.pointB = {
                x: mouse.position.x - top.position.x,
                y: mouse.position.y - top.position.y,
            };
            target = top;
        }

        bringToFront(target);

        const folder = folders.find(f => f.body === target);
        if (folder) { folder.beingDragged = true; return; }
        const hit = findFile(target);
        if (hit) {
            hit.file.beingDragged = true;
            draggedFileRef = hit.file;
        }
    });

    Events.on(mc, 'enddrag', ev => {
        if (!ev.body || ev.body.label === 'wall') return;
        const dragged = mc.body || ev.body;
        draggedFileRef = null;

        // Clear all drag flags (stuck-flag safety)
        folders.forEach(f => {
            f.beingDragged = false;
            f.children.forEach(c => { c.beingDragged = false; });
        });
        topFiles.forEach(f => { f.beingDragged = false; });

        // Folder moved → update its home
        const folder = folders.find(f => f.body === dragged);
        if (folder) {
            folder.basePosition.x = dragged.position.x;
            folder.basePosition.y = dragged.position.y;
            return;
        }

        // File dropped → adoption / release / offset update
        const hit = findFile(dragged);
        if (!hit) return;
        const { file, parent } = hit;

        // Nearest OPEN folder within adopt range
        let nearest = null, nearestDist = Infinity;
        folders.forEach(fd => {
            if (!fd.open) return;
            const d = Math.hypot(file.body.position.x - fd.body.position.x,
                                 file.body.position.y - fd.body.position.y);
            if (d < ADOPT_THRESHOLD && d < nearestDist) { nearest = fd; nearestDist = d; }
        });

        if (nearest && nearest !== parent) {
            adoptFile(file, parent, nearest);         // joins a (new) folder — permanent
        } else if (nearest && nearest === parent) {
            file.offset.x = file.body.position.x - parent.body.position.x;
            file.offset.y = file.body.position.y - parent.body.position.y;
        } else if (parent) {
            const d = Math.hypot(file.body.position.x - parent.body.position.x,
                                 file.body.position.y - parent.body.position.y);
            if (d > EJECT_THRESHOLD) releaseToDesk(file, parent);  // left the folder
            else {
                file.offset.x = file.body.position.x - parent.body.position.x;
                file.offset.y = file.body.position.y - parent.body.position.y;
            }
        }
        // top-level file dropped in open space: stays where it lands
    });

    Engine.run(engine);

    // ---- Physics pinning ----
    Events.on(engine, 'beforeUpdate', () => {
        folders.forEach(fd => {
            if (!fd.beingDragged) {
                Body.setPosition(fd.body, fd.basePosition);
                Body.setVelocity(fd.body, { x: 0, y: 0 });
            }
            fd.children.forEach(c => {
                if (fd.open) {
                    if (!c.beingDragged) {
                        Body.setPosition(c.body, {
                            x: fd.body.position.x + c.offset.x,
                            y: fd.body.position.y + c.offset.y,
                        });
                        Body.setVelocity(c.body, { x: 0, y: 0 });
                    }
                    setHidden(c.body, false);
                } else {
                    setHidden(c.body, true);
                }
            });
        });
    });

    // ---- ADMIN MODE (?admin=1): arrange + scribble + export ----
    let adminTool = 'none'; // 'none' | 'draw' | 'erase'
    const isAdmin = new URLSearchParams(location.search).has('admin');

    if (isAdmin) {
        const header = document.querySelector('header');
        const mkBtn = (label) => {
            const b = document.createElement('button');
            b.textContent = label;
            b.style.cssText = 'margin-left:8px;padding:4px 12px;cursor:pointer;';
            header.appendChild(b);
            return b;
        };
        const drawBtn  = mkBtn('✏️ Draw');
        const eraseBtn = mkBtn('🧽 Erase');
        const exportBtn = mkBtn('Export Layout');

        function setTool(tool) {
            adminTool = (adminTool === tool) ? 'none' : tool;
            drawBtn.style.background  = adminTool === 'draw'  ? '#ffd54f' : '';
            eraseBtn.style.background = adminTool === 'erase' ? '#ffd54f' : '';
            // Disable physics grabbing while a tool is active
            mc.collisionFilter.mask = adminTool === 'none'
                ? (CATEGORY_FILE | CATEGORY_FOLDER) : 0;
            canvas.style.cursor = adminTool === 'none' ? 'default'
                : adminTool === 'draw' ? 'crosshair' : 'cell';
        }
        drawBtn.onclick  = () => setTool('draw');
        eraseBtn.onclick = () => setTool('erase');

        // Scribble input
        let currentStroke = null;
        canvas.addEventListener('mousedown', () => {
            if (adminTool === 'draw') {
                currentStroke = [{ x: mouse.position.x, y: mouse.position.y }];
                strokes.push(currentStroke);
            } else if (adminTool === 'erase') {
                eraseAt(mouse.position);
            }
        });
        canvas.addEventListener('mousemove', () => {
            if (adminTool === 'draw' && currentStroke) {
                const last = currentStroke[currentStroke.length - 1];
                const d = Math.hypot(mouse.position.x - last.x, mouse.position.y - last.y);
                if (d > 3) currentStroke.push({ x: Math.round(mouse.position.x), y: Math.round(mouse.position.y) });
            } else if (adminTool === 'erase' && mouse.button === 0) {
                eraseAt(mouse.position);
            }
        });
        window.addEventListener('mouseup', () => { currentStroke = null; });

        function eraseAt(pos) {
            const R = 20;
            for (let i = strokes.length - 1; i >= 0; i--) {
                if (strokes[i].some(p => Math.hypot(p.x - pos.x, p.y - pos.y) < R)) {
                    strokes.splice(i, 1);
                }
            }
        }

        exportBtn.onclick = () => {
            const out = { items: {}, strokes };
            folders.forEach(fd => {
                out.items[fd.id] = {
                    x: Math.round(fd.body.position.x),
                    y: Math.round(fd.body.position.y),
                    angle: +fd.body.angle.toFixed(3),
                };
                fd.children.forEach(c => {
                    out.items[c.id] = {
                        parent: fd.id,
                        ox: Math.round(c.offset.x), oy: Math.round(c.offset.y),
                        angle: +c.body.angle.toFixed(3),
                    };
                });
            });
            topFiles.forEach(f => {
                out.items[f.id] = {
                    parent: null,
                    x: Math.round(f.body.position.x),
                    y: Math.round(f.body.position.y),
                    angle: +f.body.angle.toFixed(3),
                };
            });
            const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'desk_layout.json';
            a.click();
            URL.revokeObjectURL(a.href);
            showBanner('Layout exported — replace desk_layout.json in your repo and push.', false);
        };

        showBanner('Admin: arrange desk, ✏️ draw / 🧽 erase scribbles, then Export Layout.', false);
    }

    // ---- Render loop ----
    const truncate = (s, n = 18) => s.length > n ? s.slice(0, n - 1) + '…' : s;

    (function customRenderLoop() {
        const ctx = render.context;
        const width = render.options.width, height = render.options.height;

        // Desk surface
        ctx.fillStyle = '#c8a97e';
        ctx.fillRect(0, 0, width, height);
        ctx.strokeStyle = 'rgba(0,0,0,0.04)';
        ctx.lineWidth = 1;
        for (let y = 0; y < height; y += 18) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y + 6); ctx.stroke();
        }

        // Scribbles (under everything — drawn ON the desk)
        if (strokes.length) {
            ctx.save();
            ctx.strokeStyle = 'rgba(45,35,25,0.75)';
            ctx.lineWidth = 2.5;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            strokes.forEach(st => {
                if (st.length < 2) return;
                ctx.beginPath();
                ctx.moveTo(st[0].x, st[0].y);
                for (let i = 1; i < st.length; i++) ctx.lineTo(st[i].x, st[i].y);
                ctx.stroke();
            });
            ctx.restore();
        }

        // Adoption glow: dragging any file near any open folder
        if (draggedFileRef) {
            folders.forEach(fd => {
                if (!fd.open) return;
                const d = Math.hypot(mouse.position.x - fd.body.position.x,
                                     mouse.position.y - fd.body.position.y);
                if (d < ADOPT_THRESHOLD * 1.5) {
                    const alpha = Math.max(0, 1 - d / (ADOPT_THRESHOLD * 1.5));
                    ctx.save();
                    ctx.beginPath();
                    ctx.arc(fd.body.position.x, fd.body.position.y, ADOPT_THRESHOLD, 0, Math.PI * 2);
                    ctx.fillStyle = `rgba(255,220,100,${alpha * 0.18})`;
                    ctx.fill();
                    ctx.strokeStyle = `rgba(255,200,50,${alpha * 0.5})`;
                    ctx.lineWidth = 2;
                    ctx.setLineDash([6, 4]);
                    ctx.stroke();
                    ctx.setLineDash([]);
                    ctx.restore();
                }
            });
        }

        // Bodies (painter's algorithm)
        let bodies = Composite.allBodies(world).filter(b =>
            b.label !== 'wall' && b.render.visible !== false);
        bodies.sort((a, b) => (a.render.zIndex || 0) - (b.render.zIndex || 0));

        bodies.forEach(body => {
            const sk = body.render.spriteKey;
            const img = sk ? IMAGES[sk] : null;
            const sp = sk ? SPRITE[sk] : null;

            ctx.save();
            ctx.translate(body.position.x, body.position.y);
            ctx.rotate(body.angle);

            if (img && img.complete && img.naturalWidth > 0 && sp) {
                ctx.drawImage(img, -sp.w / 2, -sp.h / 2, sp.w, sp.h);
            } else {
                const hw = (sp ? sp.w : 100) / 2, hh = (sp ? sp.h : 60) / 2;
                ctx.fillStyle = '#f5f0e8';
                ctx.strokeStyle = '#aaa';
                ctx.lineWidth = 1;
                ctx.fillRect(-hw, -hh, hw * 2, hh * 2);
                ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);
            }

            ctx.fillStyle = 'rgba(30,20,10,0.85)';
            ctx.font = 'bold 11px Georgia, serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(truncate(body.label), 0, (sp ? sp.h / 2 : 30) + 4);

            ctx.restore();
        });

        requestAnimationFrame(customRenderLoop);
    })();

    console.log('Desk initialized (v2 pipeline)');
}
