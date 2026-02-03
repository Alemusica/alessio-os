/**
 * Depth Lab — 3D Swiss-Japanese Minimal Typography Space
 *
 * Testo puro nello spazio 3D con depth of field reale.
 * Niente card, niente bordi — solo tipografia che vive in un volume.
 * Navigazione con scroll/trackpad lungo l'asse Z.
 * F-stop simulato via CSS blur() basato sulla distanza dal piano focale.
 */

export function depthLabPage(projects: Array<{project: string; msg_count: number; session_ids?: string[]}>): string {
  // Distribuisci i progetti nello spazio 3D
  const items = projects.map((p, i) => {
    const name = p.project || 'home';
    const count = p.msg_count || 0;
    const sessions = Array.isArray(p.session_ids) ? [...new Set(p.session_ids)].length : 0;
    // Distribuzione spaziale — griglia 3D con variazione organica
    const cols = 4;
    const col = i % cols;
    const row = Math.floor(i / cols);
    const layer = Math.floor(i / (cols * 3)); // Z-layer ogni 3 righe
    const x = -450 + col * 300 + (row % 2) * 40; // offset alternato
    const y = -250 + (row % 3) * 200;
    const z = -layer * 350 - (i % 5) * 80; // profondità variabile
    return { name, count, sessions, x, y, z, index: i };
  });

  const elements = items.map(it => {
    return `<div class="d3-item" data-z="${it.z}" style="transform: translate3d(${it.x}px, ${it.y}px, ${it.z}px);" data-project="${it.name}">
      <span class="d3-name">${it.name}</span>
      <span class="d3-meta">${it.count}</span>
    </div>`;
  }).join('\n      ');

  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AlessioOS — Depth Lab</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500&family=DM+Mono:wght@300;400&display=swap');

  :root {
    --bg: #FAF8F5;
    --text: #2C2926;
    --text-secondary: #6B6560;
    --dim: #9E9891;
    --accent: #8B7355;
    --font: 'DM Sans', 'Helvetica Neue', sans-serif;
    --mono: 'DM Mono', 'SF Mono', monospace;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--font);
    height: 100vh;
    overflow: hidden;
    cursor: grab;
    -webkit-font-smoothing: antialiased;
  }
  body:active { cursor: grabbing; }

  /* ── VIEWPORT — la finestra sulla scena 3D ── */
  .d3-viewport {
    width: 100vw;
    height: 100vh;
    perspective: 800px;
    perspective-origin: 50% 45%;
    overflow: hidden;
    position: relative;
  }

  /* ── SCENE — il volume 3D che contiene tutto ── */
  .d3-scene {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 0;
    height: 0;
    transform-style: preserve-3d;
    transition: transform 0.8s cubic-bezier(0.16, 1, 0.3, 1);
  }

  /* ── ITEM — testo puro nello spazio ── */
  .d3-item {
    position: absolute;
    transform-style: preserve-3d;
    white-space: nowrap;
    cursor: pointer;
    transition:
      filter 0.6s ease,
      opacity 0.6s ease,
      color 0.2s ease;
    /* DoF blur applicato via JS in base alla distanza dal focal plane */
  }

  .d3-name {
    font-family: var(--font);
    font-size: 15px;
    font-weight: 400;
    letter-spacing: -0.01em;
    display: block;
    transition: color 0.15s ease;
  }

  .d3-meta {
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 300;
    color: var(--dim);
    letter-spacing: 0.02em;
    margin-top: 2px;
    display: block;
  }

  /* Hover — item si illumina */
  .d3-item:hover .d3-name {
    color: var(--accent);
  }
  .d3-item:hover .d3-meta {
    color: var(--text-secondary);
  }

  /* Focus ring — item nel piano focale */
  .d3-item.in-focus .d3-name {
    font-weight: 500;
  }
  .d3-item.in-focus .d3-meta {
    color: var(--text-secondary);
  }

  /* ── HUD — info overlay ── */
  .d3-hud {
    position: fixed;
    bottom: 34px;
    left: 34px;
    font-family: var(--mono);
    font-size: 10px;
    color: var(--dim);
    letter-spacing: 0.04em;
    z-index: 10;
    line-height: 1.8;
    pointer-events: none;
  }
  .d3-hud strong {
    color: var(--text-secondary);
    font-weight: 400;
  }

  /* ── FOCAL PLANE INDICATOR ── */
  .d3-focal-line {
    position: fixed;
    left: 0;
    right: 0;
    top: 50%;
    height: 1px;
    background: var(--accent);
    opacity: 0;
    transition: opacity 0.5s ease;
    pointer-events: none;
    z-index: 5;
  }
  .d3-viewport.moving .d3-focal-line { opacity: 0.15; }

  /* ── THEMES ── */
  .night {
    --bg: #1C1A17;
    --text: #D8D2CA;
    --text-secondary: #9E978E;
    --dim: #6B655D;
    --accent: #C4A478;
  }
  .primavera {
    --bg: #F7FAF5;
    --text: #2A332A;
    --text-secondary: #5E6E58;
    --dim: #8E9E88;
    --accent: #C8887A;
  }
  .estate {
    --bg: #F8F6F0;
    --text: #2C3038;
    --text-secondary: #5C6670;
    --dim: #8C96A0;
    --accent: #3E8EA0;
  }
  .ellenica {
    --bg: #F5F6FA;
    --text: #1E2440;
    --text-secondary: #5A6080;
    --dim: #8890A8;
    --accent: #2E5E9E;
  }
  .benessere {
    --bg: #F5F8F6;
    --text: #2A3430;
    --text-secondary: #5A6E64;
    --dim: #8AA098;
    --accent: #5E9E88;
  }

  /* Crosshair sottile al centro — indica il punto focale */
  .d3-crosshair {
    position: fixed;
    top: 50%;
    left: 50%;
    width: 20px;
    height: 20px;
    margin: -10px 0 0 -10px;
    pointer-events: none;
    z-index: 5;
    opacity: 0;
    transition: opacity 0.4s ease;
  }
  .d3-viewport.moving .d3-crosshair { opacity: 0.3; }
  .d3-crosshair::before,
  .d3-crosshair::after {
    content: '';
    position: absolute;
    background: var(--accent);
  }
  .d3-crosshair::before {
    left: 50%;
    top: 0;
    width: 0.5px;
    height: 100%;
    margin-left: -0.25px;
  }
  .d3-crosshair::after {
    top: 50%;
    left: 0;
    height: 0.5px;
    width: 100%;
    margin-top: -0.25px;
  }

  /* Title overlay */
  .d3-title {
    position: fixed;
    top: 34px;
    left: 34px;
    font-family: var(--font);
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--dim);
    z-index: 10;
    pointer-events: none;
  }

  /* Theme switcher */
  .d3-controls {
    position: fixed;
    top: 34px;
    right: 34px;
    z-index: 10;
    display: flex;
    gap: 8px;
  }
  .d3-controls button {
    background: none;
    border: 1px solid var(--dim);
    color: var(--dim);
    font-family: var(--mono);
    font-size: 9px;
    padding: 4px 8px;
    cursor: pointer;
    border-radius: 2px;
    letter-spacing: 0.04em;
    transition: all 0.2s ease;
  }
  .d3-controls button:hover {
    color: var(--accent);
    border-color: var(--accent);
  }

  /* ── APERTURE CONTROL ── */
  .d3-aperture {
    position: fixed;
    bottom: 34px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 12px;
    font-family: var(--mono);
    font-size: 9px;
    color: var(--dim);
    letter-spacing: 0.04em;
    user-select: none;
  }
  .d3-aperture label {
    opacity: 0.6;
  }
  .d3-aperture input[type="range"] {
    -webkit-appearance: none;
    appearance: none;
    width: 160px;
    height: 1px;
    background: var(--dim);
    outline: none;
    opacity: 0.5;
    transition: opacity 0.2s;
  }
  .d3-aperture input[type="range"]:hover { opacity: 1; }
  .d3-aperture input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--accent);
    cursor: pointer;
    border: none;
  }
  .d3-aperture .aperture-val {
    min-width: 28px;
    color: var(--text-secondary);
    font-weight: 400;
  }
  /* Aperture iris icon — scales with f-stop */
  .d3-iris {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 1px solid var(--dim);
    position: relative;
    transition: all 0.3s ease;
  }
  .d3-iris::after {
    content: '';
    position: absolute;
    border-radius: 50%;
    background: var(--accent);
    opacity: 0.3;
    transition: all 0.3s ease;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
  }

  /* ── CONTEXT MENU ── */
  .d3-ctx {
    position: fixed;
    z-index: 100;
    background: var(--bg);
    border: 1px solid var(--dim);
    border-radius: 4px;
    padding: 4px 0;
    min-width: 160px;
    font-family: var(--font);
    font-size: 12px;
    color: var(--text);
    box-shadow:
      0 2px 8px rgba(0,0,0,0.08),
      0 8px 24px rgba(0,0,0,0.06);
    display: none;
    opacity: 0;
    transform: scale(0.96) translateY(-4px);
    transition: opacity 0.15s ease, transform 0.15s ease;
  }
  .d3-ctx.open {
    display: block;
    opacity: 1;
    transform: scale(1) translateY(0);
  }
  .d3-ctx-item {
    padding: 6px 16px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 8px;
    transition: background 0.1s;
    letter-spacing: 0.01em;
  }
  .d3-ctx-item:hover {
    background: var(--accent);
    color: var(--bg);
  }
  .d3-ctx-sep {
    height: 1px;
    background: var(--dim);
    opacity: 0.2;
    margin: 4px 0;
  }
  .d3-ctx-label {
    font-family: var(--mono);
    font-size: 9px;
    color: var(--dim);
    padding: 4px 16px 2px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .night .d3-ctx {
    box-shadow:
      0 2px 8px rgba(0,0,0,0.25),
      0 8px 24px rgba(0,0,0,0.20);
  }

  /* Back link */
  .d3-back {
    position: fixed;
    bottom: 34px;
    right: 34px;
    font-family: var(--mono);
    font-size: 10px;
    color: var(--dim);
    text-decoration: none;
    letter-spacing: 0.04em;
    z-index: 10;
    transition: color 0.2s;
  }
  .d3-back:hover { color: var(--accent); }
</style>
</head>
<body>
<div class="d3-viewport" id="viewport">
  <div class="d3-focal-line"></div>
  <div class="d3-crosshair"></div>
  <div class="d3-scene" id="scene">
    ${elements}
  </div>
</div>

<div class="d3-title">ALESSIO-OS &mdash; DEPTH LAB</div>

<div class="d3-controls">
  <button onclick="setTheme('default')">Luce</button>
  <button onclick="setTheme('night')">Notte</button>
  <button onclick="setTheme('primavera')">Primavera</button>
  <button onclick="setTheme('estate')">Estate</button>
  <button onclick="setTheme('ellenica')">Ellenica</button>
  <button onclick="setTheme('benessere')">Benessere</button>
</div>

<div class="d3-hud" id="hud">
  <div>Z <strong id="hud-z">0</strong></div>
  <div>FOCAL <strong id="hud-focal">0</strong></div>
  <div>F-STOP <strong id="hud-fstop">2.8</strong></div>
  <div>ITEMS <strong>${items.length}</strong></div>
</div>

<!-- Aperture control -->
<div class="d3-aperture" id="aperture">
  <label>APERTURE</label>
  <div class="d3-iris" id="iris"></div>
  <input type="range" id="fstop-slider" min="1.0" max="16" step="0.1" value="2.8">
  <span class="aperture-val" id="fstop-val">f/2.8</span>
</div>

<!-- Context menu -->
<div class="d3-ctx" id="ctx-menu">
  <div class="d3-ctx-label" id="ctx-title">project</div>
  <div class="d3-ctx-item" data-action="focus">Focus here</div>
  <div class="d3-ctx-item" data-action="open">Open in dashboard</div>
  <div class="d3-ctx-sep"></div>
  <div class="d3-ctx-item" data-action="chat">Open chat</div>
  <div class="d3-ctx-item" data-action="sessions">View sessions</div>
  <div class="d3-ctx-sep"></div>
  <div class="d3-ctx-item" data-action="graph">PTI Graph</div>
</div>

<a href="/" class="d3-back">&larr; dashboard</a>

<script>
(function() {
  var scene = document.getElementById('scene');
  var viewport = document.getElementById('viewport');
  var items = document.querySelectorAll('.d3-item');

  // Camera state
  var camera = { x: 0, y: 0, z: 0 };
  var target = { x: 0, y: 0, z: 0 };
  var focalDistance = 0; // Z distance where things are sharp
  var fStop = 2.8;      // Lower = more blur, higher = less blur
  var maxBlur = 12;     // Max blur in px

  // Smooth camera interpolation
  var animating = false;
  function animate() {
    var dx = target.x - camera.x;
    var dy = target.y - camera.y;
    var dz = target.z - camera.z;
    camera.x += dx * 0.08;
    camera.y += dy * 0.08;
    camera.z += dz * 0.08;

    // Apply camera transform to scene
    scene.style.transform =
      'translate3d(' + camera.x + 'px, ' + camera.y + 'px, ' + camera.z + 'px)';

    // Update depth of field
    updateDoF();

    // Update HUD
    document.getElementById('hud-z').textContent = Math.round(-camera.z);
    document.getElementById('hud-focal').textContent = Math.round(focalDistance - camera.z);

    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5 || Math.abs(dz) > 0.5) {
      requestAnimationFrame(animate);
    } else {
      animating = false;
      viewport.classList.remove('moving');
    }
  }

  function startAnimate() {
    if (!animating) {
      animating = true;
      viewport.classList.add('moving');
      animate();
    }
  }

  // Depth of Field — simula f-stop reale
  // Blur = |distanza dal piano focale| / f-stop
  function updateDoF() {
    var focalZ = focalDistance;
    for (var i = 0; i < items.length; i++) {
      var itemZ = parseFloat(items[i].dataset.z) || 0;
      var relativeZ = itemZ + camera.z; // posizione relativa alla camera
      var distance = Math.abs(relativeZ - focalZ);
      var blur = Math.min(distance / (fStop * 30), maxBlur);
      var opacity = Math.max(0.15, 1 - blur / (maxBlur * 1.5));

      items[i].style.filter = blur > 0.3 ? 'blur(' + blur.toFixed(1) + 'px)' : 'none';
      items[i].style.opacity = opacity.toFixed(2);

      // Mark items near focal plane
      if (blur < 1) {
        items[i].classList.add('in-focus');
      } else {
        items[i].classList.remove('in-focus');
      }
    }
  }

  // Scroll → Z movement (trackpad/mouse wheel)
  viewport.addEventListener('wheel', function(e) {
    e.preventDefault();
    // Pinch zoom (ctrlKey) → change f-stop
    if (e.ctrlKey) {
      fStop = Math.max(1.0, Math.min(16, fStop + e.deltaY * 0.02));
      document.getElementById('hud-fstop').textContent = fStop.toFixed(1);
      startAnimate();
      return;
    }
    // Vertical scroll → Z movement
    target.z += e.deltaY * 2;
    // Horizontal scroll → X movement
    target.x -= e.deltaX * 1.5;
    startAnimate();
  }, { passive: false });

  // Mouse drag → X/Y pan
  var dragging = false;
  var dragStart = { x: 0, y: 0 };

  viewport.addEventListener('mousedown', function(e) {
    if (e.target.closest('.d3-controls') || e.target.closest('.d3-back')) return;
    dragging = true;
    dragStart.x = e.clientX;
    dragStart.y = e.clientY;
  });

  window.addEventListener('mousemove', function(e) {
    if (!dragging) return;
    var dx = e.clientX - dragStart.x;
    var dy = e.clientY - dragStart.y;
    target.x += dx * 1.2;
    target.y += dy * 1.2;
    dragStart.x = e.clientX;
    dragStart.y = e.clientY;
    startAnimate();
  });

  window.addEventListener('mouseup', function() { dragging = false; });

  // ── APERTURE SLIDER ──
  var slider = document.getElementById('fstop-slider');
  var fstopVal = document.getElementById('fstop-val');
  var iris = document.getElementById('iris');

  function updateApertureUI() {
    fstopVal.textContent = 'f/' + fStop.toFixed(1);
    slider.value = fStop;
    document.getElementById('hud-fstop').textContent = fStop.toFixed(1);
    // Iris size: f/1 = large opening, f/16 = tiny
    var pct = 1 - (fStop - 1) / 15; // 1→1, 16→0
    var size = 4 + pct * 10; // 4px→14px
    iris.style.width = (10 + pct * 8) + 'px';
    iris.style.height = (10 + pct * 8) + 'px';
    var irisAfter = document.styleSheets[0];
    // Inline: set CSS custom property for iris
    iris.style.setProperty('--iris-size', size + 'px');
    iris.setAttribute('style',
      'width:' + (10 + pct * 8) + 'px;height:' + (10 + pct * 8) + 'px;' +
      'border-color:' + (pct > 0.5 ? 'var(--accent)' : 'var(--dim)'));
  }

  slider.addEventListener('input', function() {
    fStop = parseFloat(slider.value);
    updateApertureUI();
    startAnimate();
  });

  // ── CONTEXT MENU ──
  var ctxMenu = document.getElementById('ctx-menu');
  var ctxProject = null; // currently right-clicked project name

  function showCtx(x, y, projectName) {
    ctxProject = projectName;
    document.getElementById('ctx-title').textContent = projectName;
    // Position — keep within viewport
    var mw = ctxMenu.offsetWidth || 160;
    var mh = ctxMenu.offsetHeight || 180;
    if (x + mw > window.innerWidth) x = window.innerWidth - mw - 8;
    if (y + mh > window.innerHeight) y = window.innerHeight - mh - 8;
    ctxMenu.style.left = x + 'px';
    ctxMenu.style.top = y + 'px';
    ctxMenu.classList.add('open');
  }

  function hideCtx() {
    ctxMenu.classList.remove('open');
    ctxProject = null;
  }

  // Right-click on item → context menu
  items.forEach(function(item) {
    item.addEventListener('contextmenu', function(e) {
      e.preventDefault();
      e.stopPropagation();
      showCtx(e.clientX, e.clientY, item.dataset.project);
    });
  });

  // Click on item → fly to it
  items.forEach(function(item) {
    item.addEventListener('click', function(e) {
      if (Math.abs(e.clientX - dragStart.x) > 5) return; // ignore drag-clicks
      hideCtx();
      var z = parseFloat(item.dataset.z) || 0;
      target.z = -z;
      focalDistance = 0;
      startAnimate();
    });
  });

  // Context menu actions
  document.querySelectorAll('.d3-ctx-item').forEach(function(el) {
    el.addEventListener('click', function() {
      var action = el.dataset.action;
      var proj = ctxProject;
      hideCtx();
      if (!proj) return;
      switch (action) {
        case 'focus':
          // Find the item and fly to it
          for (var i = 0; i < items.length; i++) {
            if (items[i].dataset.project === proj) {
              target.z = -(parseFloat(items[i].dataset.z) || 0);
              focalDistance = 0;
              startAnimate();
              break;
            }
          }
          break;
        case 'open':
          window.location.href = '/?project=' + encodeURIComponent(proj);
          break;
        case 'chat':
          window.location.href = '/?view=chat&project=' + encodeURIComponent(proj);
          break;
        case 'sessions':
          window.location.href = '/?view=sessions&project=' + encodeURIComponent(proj);
          break;
        case 'graph':
          window.location.href = '/?view=graph&project=' + encodeURIComponent(proj);
          break;
      }
    });
  });

  // Close context menu on click outside or escape
  document.addEventListener('click', function(e) {
    if (!e.target.closest('.d3-ctx')) hideCtx();
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') hideCtx();
  });

  // Right-click on viewport background → close menu
  viewport.addEventListener('contextmenu', function(e) {
    if (!e.target.closest('.d3-item')) {
      e.preventDefault();
      hideCtx();
    }
  });

  // ── KEYBOARD ──
  document.addEventListener('keydown', function(e) {
    var step = e.shiftKey ? 300 : 100;
    if (e.key === 'ArrowUp') { target.z += step; e.preventDefault(); }
    if (e.key === 'ArrowDown') { target.z -= step; e.preventDefault(); }
    if (e.key === 'ArrowLeft') { target.x += step; e.preventDefault(); }
    if (e.key === 'ArrowRight') { target.x -= step; e.preventDefault(); }
    // [ and ] → f-stop
    if (e.key === '[') { fStop = Math.max(1.0, fStop - 0.5); updateApertureUI(); }
    if (e.key === ']') { fStop = Math.min(16, fStop + 0.5); updateApertureUI(); }
    // r → reset camera
    if (e.key === 'r') { target.x = 0; target.y = 0; target.z = 0; }
    startAnimate();
  });

  // ── THEME ──
  window.setTheme = function(name) {
    var classes = ['night', 'primavera', 'estate', 'ellenica', 'benessere'];
    classes.forEach(function(c) { document.documentElement.classList.remove(c); });
    if (name !== 'default') document.documentElement.classList.add(name);
  };

  // Initial state
  updateApertureUI();
  updateDoF();
})();
</script>
</body>
</html>`;
}
