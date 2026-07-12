/* ============================================================
   DESK PORTFOLIO — complete pipeline
   Data:   Google Drive folder (live) OR files.json (fallback)
   Layout: desk_layout.json = default desk state everyone sees
   Admin:  add ?admin=1 to URL → arrange desk → Export Layout
   ============================================================ */

// ---------------- CONFIG ----------------
const CONFIG = {
    // Google Drive integration (optional — see README.md)
    DRIVE_FOLDER_ID: "1ByycLpYJOp4YleuAhmsvOe4-AqoXYaWp",   // long id from your Drive folder URL
    DRIVE_API_KEY:   "",   // API key from Google Cloud Console
    LAYOUT_URL: "desk_layout.json",
};

const CATEGORY_WALL   = 0x0001;
const CATEGORY_FILE   = 0x0002;
const CATEGORY_FOLDER = 0x0004;
const CATEGORY_HIDDEN = 0x0008; // hidden children — the mouse can't grab these

// ---------------- SPRITES ----------------
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
    if (!res.ok) throw new Error(`Drive API ${res.status}`);
    const json = await res.json();
    const files = (json.files || []).sort((a, b) => a.name.localeCompare(b.name));

    const items = [];
    for (const f of files) {
        const isFolder = f.mimeType === 'application/vnd.google-apps.folder';
        if (isFolder) {
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
            portfolioData = await fetchDriveTree(CONFIG.DRIVE_FOLDER_ID);
            console.log('Loaded from Google Drive:', portfolioData.length, 'items');
            return portfolioData;
        } catch (e) {
            console.error('Drive fetch failed, falling back to files.json:', e);
            showBanner('Google Drive unreachable — showing cached portfolio.');
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
        if (!res.ok) return { items: {} };
        const json = await res.json();
        return (json && typeof json === 'object' && json.items) ? json : { items: {} };
    } catch {
        return { items: {} };
    }
}

// Deterministic pseudo-random spot from an id — new files land
// at a stable "tossed on the desk" position until you arrange them
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
async function loadFiles() {
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

window.addEventListener('DOMContentLoaded', loadFiles);

// ---------------- VIEW TOGGLE ----------------
const toggleBtn  = document.getElementById('toggleView');
const normalView = document.getElementById('normalView');
const deskView   = document.getElementById('deskView');
let deskInitialized = false;

toggleBtn.onclick = () => {
    if (normalView.style.display !== 'none') {
        normalView.style.display = 'none';
        deskView.style.display = 'block';
        toggleBtn.textContent = 'Switch to Normal View';
        if (!deskInitialized) {
            deskInitialized = true; // set immediately — no double-init on rapid clicks
            preloadImages(() => setTimeout(initDeskView, 20));
        }
    } else {
        normalView.style.display = 'block';
        deskView.style.display = 'none';
        toggleBtn.textContent = 'Switch to Desk View';
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
        // Clamp items into the new bounds so nothing strands off-screen
        const pad = 70;
        const clamp = (p) => ({
            x: Math.min(Math.max(p.x, pad), canvas.width  - pad),
            y: Math.min(Math.max(p.y, pad), canvas.height - pad),
        });
        deskItems.forEach(item => {
            item.basePosition = clamp(item.basePosition || item.body.position);
            Body.setPosition(item.body, item.basePosition);
            if (item.children) item.children.forEach(c => {
                if (c.ejected) Body.setPosition(c.body, clamp(c.body.position));
            });
        });
    });

    // ---- Load data + layout in parallel ----
    let data = [], layout = { items: {} };
    try {
        [data, layout] = await Promise.all([fetchData(), fetchLayout()]);
    } catch (e) {
        console.error(e);
        showBanner('Could not load portfolio data.');
        return;
    }

    let zCounter = 1;

    function bringToFront(body) {
        const folderItem = deskItems.find(it => it.type === 'folder' && it.body === body);
        if (folderItem && folderItem.open && folderItem.children && folderItem.children.length) {
            const minChildZ = folderItem.children
                .filter(c => !c.ejected)
                .reduce((min, c) => Math.min(min, c.body.render.zIndex || 0), Infinity);
            body.render.zIndex = isFinite(minChildZ) ? minChildZ - 1 : ++zCounter;
        } else {
            body.render.zIndex = ++zCounter;
        }
    }

    function createBody(x, y, w, h, label, category) {
        return Bodies.rectangle(x, y, w, h, {
            label,
            restitution: 0, friction: 0.9, frictionAir: 0.2,
            density: 0.002, inertia: Infinity,
            collisionFilter: { category, mask: CATEGORY_WALL },
            render: { fillStyle: 'rgba(0,0,0,0)', strokeStyle: 'rgba(0,0,0,0)', lineWidth: 0 }
        });
    }

    // Hidden bodies switch to a category the mouse constraint can't grab
    function setHidden(body, hidden) {
        body.render.visible = !hidden;
        body.collisionFilter.category = hidden ? CATEGORY_HIDDEN : CATEGORY_FILE;
    }

    // ---- Build desk items ----
    let deskItems = [];

    function buildDeskItem(file) {
        const saved = layout.items[file.id];
        const fb = hashPos(file.id ?? file.name, canvas.width, canvas.height);
        const startX = saved && typeof saved.x === 'number' ? saved.x : fb.x;
        const startY = saved && typeof saved.y === 'number' ? saved.y : fb.y;
        const angle  = saved && typeof saved.angle === 'number' ? saved.angle : fb.angle;

        if (file.type === 'file') {
            const sk = spriteKeyForFile(file);
            const sp = SPRITE[sk];
            const body = createBody(startX, startY, sp.w, sp.h, file.name, CATEGORY_FILE);
            body.render.zIndex = zCounter++;
            body.render.spriteKey = sk;
            Body.setAngle(body, angle);
            deskItems.push({ ...file, body, type: 'file', basePosition: { x: startX, y: startY } });
            World.add(world, body);

        } else if (file.type === 'folder') {
            const csp = SPRITE.folder_closed;
            const folderBody = createBody(startX, startY, csp.w, csp.h, file.name, CATEGORY_FOLDER);
            folderBody.render.zIndex = zCounter++;
            folderBody.render.spriteKey = 'folder_closed';
            Body.setAngle(folderBody, angle);

            const children = [];
            if (file.children) {
                const osp = SPRITE.folder_open;
                const childStartX = osp.w / 2 - 30;

                file.children.forEach((child, i) => {
                    const sk = spriteKeyForFile(child);
                    const sp = SPRITE[sk];
                    const sc = layout.items[child.id];
                    const isEjected = !!(sc && sc.ejected);

                    const col = i % 2, row = Math.floor(i / 2);
                    let ox = childStartX + col * (sp.w * 0.4);
                    let oy = -sp.h * 0.1 + row * (sp.h * 0.55);
                    if (sc && !isEjected && typeof sc.ox === 'number') { ox = sc.ox; oy = sc.oy; }

                    const cx = isEjected ? sc.x : startX + ox;
                    const cy = isEjected ? sc.y : startY + oy;

                    const cBody = createBody(cx, cy, sp.w, sp.h, child.name, CATEGORY_FILE);
                    cBody.render.zIndex = zCounter++;
                    cBody.render.spriteKey = sk;
                    Body.setAngle(cBody, (sc && typeof sc.angle === 'number')
                        ? sc.angle : (Math.random() - 0.5) * 0.12);
                    setHidden(cBody, !isEjected);

                    children.push({
                        ...child, body: cBody, spriteKey: sk,
                        offset: { x: ox, y: oy },
                        ejected: isEjected,
                    });
                    World.add(world, cBody);
                });
            }

            deskItems.push({
                ...file, body: folderBody, children, type: 'folder',
                open: false,
                basePosition: { x: startX, y: startY },
            });
            World.add(world, folderBody);
        }
    }

    data.forEach(buildDeskItem);

    // ---- Folder body swap (matches open/closed sprite hitbox) ----
    function swapFolderBody(item, isOpen) {
        const sp = isOpen ? SPRITE.folder_open : SPRITE.folder_closed;
        const old = item.body;
        const pos = old.position, angle = old.angle, oldZ = old.render.zIndex;
        World.remove(world, old);
        const nb = createBody(pos.x, pos.y, sp.w, sp.h, item.name, CATEGORY_FOLDER);
        nb.render.zIndex = oldZ;
        nb.render.spriteKey = isOpen ? 'folder_open' : 'folder_closed';
        Body.setAngle(nb, angle);
        World.add(world, nb);
        item.body = nb;
    }

    function toggleFolderOpen(item) {
        item.open = !item.open;
        if (mc.constraint.bodyB === item.body) mc.constraint.bodyB = null;
        swapFolderBody(item, item.open);

        if (item.children) {
            item.children.forEach(c => {
                if (c.ejected) return;
                setHidden(c.body, !item.open);
                if (item.open) {
                    Body.setPosition(c.body, {
                        x: item.body.position.x + c.offset.x,
                        y: item.body.position.y + c.offset.y,
                    });
                    Body.setVelocity(c.body, { x: 0, y: 0 });
                    c.body.isSleeping = false;
                }
            });
        }
    }

    // ---- Mouse ----
    const mouse = Mouse.create(canvas);
    const mc = MouseConstraint.create(engine, {
        mouse,
        collisionFilter: { mask: CATEGORY_FILE | CATEGORY_FOLDER }, // never grabs hidden
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

    Events.on(mc, 'mousedown', event => {
        const clicked = topmostVisibleAt(event.mouse.position);
        if (!clicked) return;

        const now = Date.now();
        bringToFront(clicked);

        if (clicked === lastClickedBody && now - lastClickTime < DOUBLE_CLICK_DELAY) {
            let handled = false;
            deskItems.forEach(item => {
                if (item.type === 'folder' && item.body === clicked) {
                    toggleFolderOpen(item);
                    handled = true;
                }
            });
            if (!handled) {
                deskItems.forEach(item => {
                    if (item.type === 'file' && item.body === clicked && item.url) {
                        window.open(item.url, '_blank');
                    }
                    if (item.children) item.children.forEach(c => {
                        if (c.body === clicked && c.url) window.open(c.url, '_blank');
                    });
                });
            }
            lastClickedBody = null; lastClickTime = 0;
            return;
        }
        lastClickedBody = clicked;
        lastClickTime = now;
    });

    Events.on(mc, 'startdrag', ev => {
        if (!ev.body || ev.body.label === 'wall') return;

        // Matter grabs an arbitrary overlapping body — redirect to topmost visible
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
        deskItems.forEach(item => {
            if (item.body === target) item.beingDragged = true;
            if (item.children) item.children.forEach(c => {
                if (c.body === target) c.beingDragged = true;
            });
        });
    });

    Events.on(mc, 'enddrag', ev => {
        if (!ev.body || ev.body.label === 'wall') return;
        const dragged = mc.body || ev.body;

        // Clear ALL drag flags — prevents stuck-flag freeze
        deskItems.forEach(item => {
            item.beingDragged = false;
            if (item.children) item.children.forEach(c => { c.beingDragged = false; });
        });

        deskItems.forEach(item => {
            if (item.body === dragged) {
                item.basePosition.x = dragged.position.x;
                item.basePosition.y = dragged.position.y;
            }
            if (item.type === 'folder' && item.children) {
                item.children.forEach(c => {
                    if (c.body !== dragged) return;
                    const dx = c.body.position.x - item.body.position.x;
                    const dy = c.body.position.y - item.body.position.y;
                    const dist = Math.hypot(dx, dy);
                    const EJECT_THRESHOLD = 200, ADOPT_THRESHOLD = 160;

                    if (c.ejected) {
                        if (dist < ADOPT_THRESHOLD && item.open) {
                            c.ejected = false;
                            c.offset.x = dx; c.offset.y = dy;
                        }
                    } else {
                        if (dist > EJECT_THRESHOLD) c.ejected = true;
                        else { c.offset.x = dx; c.offset.y = dy; }
                    }
                });
            }
        });
    });

    Engine.run(engine);

    // ---- Physics pinning loop ----
    Events.on(engine, 'beforeUpdate', () => {
        deskItems.forEach(item => {
            if (item.type !== 'folder') return;

            if (!item.beingDragged) {
                Body.setPosition(item.body, item.basePosition);
                Body.setVelocity(item.body, { x: 0, y: 0 });
            }
            if (item.children) {
                item.children.forEach(c => {
                    if (c.ejected) { setHidden(c.body, false); return; }
                    if (item.open) {
                        if (!c.beingDragged) {
                            Body.setPosition(c.body, {
                                x: item.body.position.x + c.offset.x,
                                y: item.body.position.y + c.offset.y,
                            });
                            Body.setVelocity(c.body, { x: 0, y: 0 });
                        }
                        setHidden(c.body, false);
                    } else {
                        setHidden(c.body, true);
                    }
                });
            }
        });
    });

    // ---- ADMIN MODE (?admin=1) ----
    if (new URLSearchParams(location.search).has('admin')) {
        const btn = document.createElement('button');
        btn.textContent = 'Export Layout';
        btn.style.cssText = 'margin-left:12px;padding:4px 12px;cursor:pointer;';
        document.querySelector('header').appendChild(btn);
        btn.onclick = () => {
            const out = { items: {} };
            deskItems.forEach(item => {
                out.items[item.id] = {
                    x: Math.round(item.body.position.x),
                    y: Math.round(item.body.position.y),
                    angle: +item.body.angle.toFixed(3),
                };
                if (item.children) item.children.forEach(c => {
                    out.items[c.id] = c.ejected
                        ? { x: Math.round(c.body.position.x), y: Math.round(c.body.position.y),
                            angle: +c.body.angle.toFixed(3), ejected: true }
                        : { ox: Math.round(c.offset.x), oy: Math.round(c.offset.y),
                            angle: +c.body.angle.toFixed(3), ejected: false };
                });
            });
            const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'desk_layout.json';
            a.click();
            URL.revokeObjectURL(a.href);
            showBanner('Layout exported — replace desk_layout.json in your repo and push.', false);
        };
        showBanner('Admin mode: arrange the desk, then Export Layout.', false);
    }

    // ---- Render loop ----
    const truncate = (s, n = 18) => s.length > n ? s.slice(0, n - 1) + '…' : s;

    (function customRenderLoop() {
        const ctx = render.context;
        const width = render.options.width, height = render.options.height;

        ctx.fillStyle = '#c8a97e';
        ctx.fillRect(0, 0, width, height);
        ctx.strokeStyle = 'rgba(0,0,0,0.04)';
        ctx.lineWidth = 1;
        for (let y = 0; y < height; y += 18) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y + 6); ctx.stroke();
        }

        // Adoption snap-zone glow
        const ADOPT_THRESHOLD = 160;
        deskItems.forEach(item => {
            if (item.type !== 'folder' || !item.open || !item.children) return;
            if (!item.children.some(c => c.ejected && c.beingDragged)) return;
            const d = Math.hypot(mouse.position.x - item.body.position.x,
                                 mouse.position.y - item.body.position.y);
            if (d < ADOPT_THRESHOLD * 1.5) {
                const alpha = Math.max(0, 1 - d / (ADOPT_THRESHOLD * 1.5));
                ctx.save();
                ctx.beginPath();
                ctx.arc(item.body.position.x, item.body.position.y, ADOPT_THRESHOLD, 0, Math.PI * 2);
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

    console.log('Desk initialized');
}
