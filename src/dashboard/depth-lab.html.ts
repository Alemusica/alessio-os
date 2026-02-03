/**
 * Depth Lab — 3D Swiss-Japanese Minimal Typography Space
 *
 * Testo puro nello spazio 3D con depth of field reale.
 * Niente card, niente bordi — solo tipografia che vive in un volume.
 * Tre layout: Fibonacci spirale aurea, Cluster tematici, Alfabetico.
 * F-stop simulato via CSS blur() basato sulla distanza dal piano focale.
 */

export function depthLabPage(projects: Array<{project: string; msg_count: number; session_ids?: string[]}>): string {
  // Prepara dati per il client — posizionamento avviene in JS
  const projectData = projects.map(p => ({
    name: p.project || 'home',
    count: p.msg_count || 0,
    sessions: Array.isArray(p.session_ids) ? [...new Set(p.session_ids)].length : 0,
  }));

  // Genera HTML items senza posizioni (le applica il JS)
  const elements = projectData.map((p, i) =>
    `<div class="d3-item" data-index="${i}" data-project="${p.name}" data-count="${p.count}">
      <span class="d3-name">${p.name}</span>
      <span class="d3-meta">${p.count}</span>
    </div>`
  ).join('\n      ');

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

  .d3-viewport {
    width: 100vw;
    height: 100vh;
    perspective: 1400px;
    perspective-origin: 50% 45%;
    overflow: hidden;
    position: relative;
  }

  .d3-scene {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 0;
    height: 0;
    transform-style: preserve-3d;
    transition: transform 0.8s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .d3-item {
    position: absolute;
    transform-style: preserve-3d;
    white-space: nowrap;
    cursor: pointer;
    /* Smooth layout transitions */
    transition:
      transform 1.2s cubic-bezier(0.16, 1, 0.3, 1),
      filter 0.6s ease,
      opacity 0.6s ease,
      font-size 0.8s ease;
  }

  .d3-name {
    font-family: var(--font);
    font-weight: 400;
    letter-spacing: -0.01em;
    display: block;
    transition: color 0.15s ease, font-size 0.8s ease, font-weight 0.4s ease;
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

  .d3-item:hover .d3-name { color: var(--accent); }
  .d3-item:hover .d3-meta { color: var(--text-secondary); }

  .d3-item.in-focus .d3-name { font-weight: 500; }
  .d3-item.in-focus .d3-meta { color: var(--text-secondary); }

  /* ── HUD ── */
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
  .d3-hud strong { color: var(--text-secondary); font-weight: 400; }

  /* ── FOCAL PLANE ── */
  .d3-focal-line {
    position: fixed;
    left: 0; right: 0; top: 50%;
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
    --bg: #1C1A17; --text: #D8D2CA;
    --text-secondary: #9E978E; --dim: #6B655D; --accent: #C4A478;
  }
  .primavera {
    --bg: #F7FAF5; --text: #2A332A;
    --text-secondary: #5E6E58; --dim: #8E9E88; --accent: #C8887A;
  }
  .estate {
    --bg: #F8F6F0; --text: #2C3038;
    --text-secondary: #5C6670; --dim: #8C96A0; --accent: #3E8EA0;
  }
  .ellenica {
    --bg: #F5F6FA; --text: #1E2440;
    --text-secondary: #5A6080; --dim: #8890A8; --accent: #2E5E9E;
  }
  .benessere {
    --bg: #F5F8F6; --text: #2A3430;
    --text-secondary: #5A6E64; --dim: #8AA098; --accent: #5E9E88;
  }

  /* ── CROSSHAIR ── */
  .d3-crosshair {
    position: fixed; top: 50%; left: 50%;
    width: 20px; height: 20px;
    margin: -10px 0 0 -10px;
    pointer-events: none; z-index: 5;
    opacity: 0; transition: opacity 0.4s ease;
  }
  .d3-viewport.moving .d3-crosshair { opacity: 0.3; }
  .d3-crosshair::before, .d3-crosshair::after {
    content: ''; position: absolute; background: var(--accent);
  }
  .d3-crosshair::before {
    left: 50%; top: 0; width: 0.5px; height: 100%; margin-left: -0.25px;
  }
  .d3-crosshair::after {
    top: 50%; left: 0; height: 0.5px; width: 100%; margin-top: -0.25px;
  }

  /* ── TITLE ── */
  .d3-title {
    position: fixed; top: 34px; left: 34px;
    font-family: var(--font); font-size: 11px;
    font-weight: 500; letter-spacing: 0.12em;
    text-transform: uppercase; color: var(--dim);
    z-index: 10; pointer-events: none;
  }

  /* ── CONTROLS BAR (themes + layouts) ── */
  .d3-controls {
    position: fixed; top: 34px; right: 34px;
    z-index: 10; display: flex; gap: 8px;
    flex-wrap: wrap; justify-content: flex-end;
    max-width: 400px;
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
  .d3-controls button.active {
    color: var(--bg);
    background: var(--accent);
    border-color: var(--accent);
  }
  .d3-controls .sep {
    width: 1px;
    background: var(--dim);
    opacity: 0.3;
    align-self: stretch;
  }

  /* ── APERTURE ── */
  .d3-aperture {
    position: fixed; bottom: 34px; left: 50%;
    transform: translateX(-50%);
    z-index: 10; display: flex; align-items: center;
    gap: 12px; font-family: var(--mono);
    font-size: 9px; color: var(--dim);
    letter-spacing: 0.04em; user-select: none;
  }
  .d3-aperture label { opacity: 0.6; }
  .d3-aperture input[type="range"] {
    -webkit-appearance: none; appearance: none;
    width: 160px; height: 1px;
    background: var(--dim); outline: none;
    opacity: 0.5; transition: opacity 0.2s;
  }
  .d3-aperture input[type="range"]:hover { opacity: 1; }
  .d3-aperture input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none; appearance: none;
    width: 10px; height: 10px; border-radius: 50%;
    background: var(--accent); cursor: pointer; border: none;
  }
  .d3-aperture .aperture-val {
    min-width: 28px; color: var(--text-secondary); font-weight: 400;
  }
  .d3-iris {
    width: 18px; height: 18px; border-radius: 50%;
    border: 1px solid var(--dim); position: relative;
    transition: all 0.3s ease;
  }

  /* ── CONTEXT MENU ── */
  .d3-ctx {
    position: fixed; z-index: 100;
    background: var(--bg); border: 1px solid var(--dim);
    border-radius: 4px; padding: 4px 0;
    min-width: 160px; font-family: var(--font);
    font-size: 12px; color: var(--text);
    box-shadow: 0 2px 8px rgba(0,0,0,0.08), 0 8px 24px rgba(0,0,0,0.06);
    display: none; opacity: 0;
    transform: scale(0.96) translateY(-4px);
    transition: opacity 0.15s ease, transform 0.15s ease;
  }
  .d3-ctx.open { display: block; opacity: 1; transform: scale(1) translateY(0); }
  .d3-ctx-item {
    padding: 6px 16px; cursor: pointer;
    display: flex; align-items: center; gap: 8px;
    transition: background 0.1s; letter-spacing: 0.01em;
  }
  .d3-ctx-item:hover { background: var(--accent); color: var(--bg); }
  .d3-ctx-sep { height: 1px; background: var(--dim); opacity: 0.2; margin: 4px 0; }
  .d3-ctx-label {
    font-family: var(--mono); font-size: 9px; color: var(--dim);
    padding: 4px 16px 2px; letter-spacing: 0.06em; text-transform: uppercase;
  }
  .night .d3-ctx {
    box-shadow: 0 2px 8px rgba(0,0,0,0.25), 0 8px 24px rgba(0,0,0,0.20);
  }

  .d3-back {
    position: fixed; bottom: 34px; right: 34px;
    font-family: var(--mono); font-size: 10px;
    color: var(--dim); text-decoration: none;
    letter-spacing: 0.04em; z-index: 10; transition: color 0.2s;
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
  <div class="sep"></div>
  <button id="btn-fibonacci" class="active" onclick="switchLayout('fibonacci')">Fibonacci</button>
  <button id="btn-cluster" onclick="switchLayout('cluster')">Cluster</button>
  <button id="btn-alpha" onclick="switchLayout('alpha')">A — Z</button>
</div>

<div class="d3-hud" id="hud">
  <div>Z <strong id="hud-z">0</strong></div>
  <div>FOCAL <strong id="hud-focal">0</strong></div>
  <div>F-STOP <strong id="hud-fstop">2.8</strong></div>
  <div>LAYOUT <strong id="hud-layout">fibonacci</strong></div>
  <div>ITEMS <strong>${projectData.length}</strong></div>
</div>

<div class="d3-aperture" id="aperture">
  <label>APERTURE</label>
  <div class="d3-iris" id="iris"></div>
  <input type="range" id="fstop-slider" min="1.0" max="16" step="0.1" value="2.8">
  <span class="aperture-val" id="fstop-val">f/2.8</span>
</div>

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
  var items = Array.from(document.querySelectorAll('.d3-item'));
  var n = items.length;

  // ── PROJECT DATA ──
  var DATA = ${JSON.stringify(projectData)};
  var maxCount = Math.max.apply(null, DATA.map(function(d) { return d.count; })) || 1;

  // ── CAMERA ──
  var camera = { x: 0, y: 0, z: 0 };
  var target = { x: 0, y: 0, z: 0 };
  var baseTarget = { x: 0, y: 0, z: 0 }; // position without hover offset
  var hoverOffset = { x: 0, y: 0, z: 0 }; // subtle parallax from hover
  var focalDistance = 0;
  var focalTarget = 0;  // smoothly interpolated focal Z
  var fStop = 2.8;
  var maxBlur = 12;
  var hoveredItem = null;

  // ── GOLDEN RATIO ──
  var PHI = (1 + Math.sqrt(5)) / 2;       // 1.618...
  var GOLDEN_ANGLE = 2.399963; // 137.508° — the exact golden angle in radians

  // ── THEMATIC CLUSTERS ──
  // Auto-classify by name patterns
  function classifyProject(name) {
    var nm = name.toLowerCase();
    if (/ableton|djset|music/.test(nm)) return 'music';
    if (/social|mcp|cli/.test(nm)) return 'social';
    if (/dag|consult|startup|scouting|excel|work/.test(nm)) return 'business';
    if (/ui|canvas|gui|test/.test(nm)) return 'interface';
    if (/pti|graph|alessio-os|innesti/.test(nm)) return 'core';
    return 'other';
  }

  var CLUSTER_NAMES = ['core', 'music', 'business', 'social', 'interface', 'other'];
  var CLUSTER_Z = { core: 0, music: -400, business: -800, social: -1200, interface: -1600, other: -2000 };

  // ═══════════════════════════════════════════
  // LAYOUT 1: FIBONACCI SPIRAL (sezione aurea)
  // ═══════════════════════════════════════════
  function layoutFibonacci() {
    // Sort by activity (most active = center)
    var sorted = DATA.map(function(d, i) { return { d: d, i: i }; })
      .sort(function(a, b) { return b.d.count - a.d.count; });

    sorted.forEach(function(entry, rank) {
      var el = items[entry.i];
      var d = entry.d;

      // Fibonacci phyllotaxis: angle = rank * golden_angle, radius = c * sqrt(rank)
      var angle = rank * GOLDEN_ANGLE;
      var radius = 200 * Math.sqrt(rank + 0.5); // +0.5 avoids center stacking

      var x = Math.cos(angle) * radius;
      var y = Math.sin(angle) * radius;
      // Z: gentle depth — not too aggressive to avoid perspective compression
      var z = -rank * 20;

      // Font size: logarithmic scale based on activity
      var fs = 12 + Math.log(1 + d.count) * 2.5;
      fs = Math.min(fs, 28);

      el.style.transform = 'translate3d(' + x.toFixed(0) + 'px, ' + y.toFixed(0) + 'px, ' + z + 'px)';
      el.dataset.z = z;
      el.querySelector('.d3-name').style.fontSize = fs.toFixed(1) + 'px';
      el.querySelector('.d3-name').style.fontWeight = rank < 5 ? '500' : '400';
    });
  }

  // ═══════════════════════════════════════════
  // LAYOUT 2: THEMATIC CLUSTERS (piani Z)
  // ═══════════════════════════════════════════
  function layoutCluster() {
    // Group projects by theme
    var groups = {};
    CLUSTER_NAMES.forEach(function(c) { groups[c] = []; });
    DATA.forEach(function(d, i) {
      var cat = classifyProject(d.name);
      groups[cat].push({ d: d, i: i });
    });

    CLUSTER_NAMES.forEach(function(cat) {
      var group = groups[cat];
      if (!group.length) return;
      var baseZ = CLUSTER_Z[cat];

      // Sort within cluster by activity
      group.sort(function(a, b) { return b.d.count - a.d.count; });

      // Fibonacci sub-spiral within each cluster plane
      group.forEach(function(entry, rank) {
        var el = items[entry.i];
        var d = entry.d;
        var angle = rank * GOLDEN_ANGLE;
        var radius = 160 * Math.sqrt(rank + 0.5);
        var x = Math.cos(angle) * radius;
        var y = Math.sin(angle) * radius;
        var z = baseZ - rank * 15; // slight depth within cluster

        var fs = 12 + Math.log(1 + d.count) * 2;
        fs = Math.min(fs, 24);

        el.style.transform = 'translate3d(' + x.toFixed(0) + 'px, ' + y.toFixed(0) + 'px, ' + z + 'px)';
        el.dataset.z = z;
        el.querySelector('.d3-name').style.fontSize = fs.toFixed(1) + 'px';
        el.querySelector('.d3-name').style.fontWeight = rank === 0 ? '500' : '400';
      });
    });
  }

  // ═══════════════════════════════════════════
  // LAYOUT 3: ALPHABETICAL (griglia aurea)
  // ═══════════════════════════════════════════
  function layoutAlpha() {
    // Sort alphabetically
    var sorted = DATA.map(function(d, i) { return { d: d, i: i }; })
      .sort(function(a, b) { return a.d.name.localeCompare(b.d.name); });

    // Golden rectangle grid: cols based on PHI ratio
    var cols = Math.round(Math.sqrt(n * PHI));
    var cellW = 260;
    var cellH = cellW / PHI; // golden rectangle
    var totalW = cols * cellW;
    var totalH = Math.ceil(n / cols) * cellH;

    sorted.forEach(function(entry, rank) {
      var el = items[entry.i];
      var d = entry.d;
      var col = rank % cols;
      var row = Math.floor(rank / cols);

      var x = -totalW / 2 + col * cellW + cellW / 2;
      var y = -totalH / 2 + row * cellH + cellH / 2;
      // Each row slightly recedes in Z for depth
      var z = -row * 80;

      var fs = 13 + Math.log(1 + d.count) * 1.5;
      fs = Math.min(fs, 22);

      el.style.transform = 'translate3d(' + x.toFixed(0) + 'px, ' + y.toFixed(0) + 'px, ' + z + 'px)';
      el.dataset.z = z;
      el.querySelector('.d3-name').style.fontSize = fs.toFixed(1) + 'px';
      el.querySelector('.d3-name').style.fontWeight = '400';
    });
  }

  // ── LAYOUT SWITCH ──
  var currentLayout = 'fibonacci';
  var layoutFns = {
    fibonacci: layoutFibonacci,
    cluster: layoutCluster,
    alpha: layoutAlpha
  };

  window.switchLayout = function(name) {
    currentLayout = name;
    document.getElementById('hud-layout').textContent = name;
    // Update buttons
    ['fibonacci', 'cluster', 'alpha'].forEach(function(l) {
      document.getElementById('btn-' + l).classList.toggle('active', l === name);
    });
    // Apply layout
    layoutFns[name]();
    // Reset camera to origin to see the new layout
    baseTarget.x = 0; baseTarget.y = 0; baseTarget.z = 0;
    hoverOffset.x = 0; hoverOffset.y = 0; hoverOffset.z = 0;
    focalTarget = 0;
    startAnimate();
  };

  // ── ANIMATION ──
  var animating = false;
  function animate() {
    // Compose target from base + hover parallax
    target.x = baseTarget.x + hoverOffset.x;
    target.y = baseTarget.y + hoverOffset.y;
    target.z = baseTarget.z + hoverOffset.z;

    var dx = target.x - camera.x;
    var dy = target.y - camera.y;
    var dz = target.z - camera.z;
    camera.x += dx * 0.08;
    camera.y += dy * 0.08;
    camera.z += dz * 0.08;

    // Smooth focal distance interpolation
    var df = focalTarget - focalDistance;
    focalDistance += df * 0.12;

    scene.style.transform =
      'translate3d(' + camera.x + 'px, ' + camera.y + 'px, ' + camera.z + 'px)';

    updateDoF();

    document.getElementById('hud-z').textContent = Math.round(-camera.z);
    document.getElementById('hud-focal').textContent = Math.round(focalDistance);

    var moving = Math.abs(dx) > 0.3 || Math.abs(dy) > 0.3 || Math.abs(dz) > 0.3 || Math.abs(df) > 0.5;
    if (moving) {
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

  // ── DEPTH OF FIELD ──
  function updateDoF() {
    var focalZ = focalDistance;
    for (var i = 0; i < items.length; i++) {
      var itemZ = parseFloat(items[i].dataset.z) || 0;
      var relativeZ = itemZ + camera.z;
      var distance = Math.abs(relativeZ - focalZ);
      var blur = Math.min(distance / (fStop * 30), maxBlur);
      var opacity = Math.max(0.15, 1 - blur / (maxBlur * 1.5));

      items[i].style.filter = blur > 0.3 ? 'blur(' + blur.toFixed(1) + 'px)' : 'none';
      items[i].style.opacity = opacity.toFixed(2);

      if (blur < 1) {
        items[i].classList.add('in-focus');
      } else {
        items[i].classList.remove('in-focus');
      }
    }
  }

  // ── SCROLL → Z ──
  viewport.addEventListener('wheel', function(e) {
    e.preventDefault();
    if (e.ctrlKey) {
      fStop = Math.max(1.0, Math.min(16, fStop + e.deltaY * 0.02));
      updateApertureUI();
      startAnimate();
      return;
    }
    baseTarget.z += e.deltaY * 2;
    baseTarget.x -= e.deltaX * 1.5;
    startAnimate();
  }, { passive: false });

  // ── DRAG ──
  var dragging = false;
  var dragStart = { x: 0, y: 0 };

  viewport.addEventListener('mousedown', function(e) {
    if (e.target.closest('.d3-controls') || e.target.closest('.d3-back') || e.target.closest('.d3-aperture')) return;
    dragging = true;
    dragStart.x = e.clientX;
    dragStart.y = e.clientY;
  });

  window.addEventListener('mousemove', function(e) {
    if (!dragging) return;
    baseTarget.x += (e.clientX - dragStart.x) * 1.2;
    baseTarget.y += (e.clientY - dragStart.y) * 1.2;
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
    var pct = 1 - (fStop - 1) / 15;
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
  var ctxProject = null;

  function showCtx(x, y, projectName) {
    ctxProject = projectName;
    document.getElementById('ctx-title').textContent = projectName;
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

  items.forEach(function(item) {
    // Hover → focus shifts to this item (focal plane + subtle parallax)
    item.addEventListener('mouseenter', function() {
      hoveredItem = item;
      var z = parseFloat(item.dataset.z) || 0;
      // Move focal plane to the item's Z (relative to camera)
      focalTarget = z + camera.z;
      // Subtle parallax: scene shifts 10% toward item
      // Parse transform values without regex (template literal safe)
      var tf = item.style.transform || '';
      var p1 = tf.indexOf('(');
      var p2 = tf.indexOf(')');
      var parts = (p1 > -1 && p2 > p1) ? tf.substring(p1 + 1, p2).split(',') : [];
      var ix = parseFloat(parts[0]) || 0;
      var iy = parseFloat(parts[1]) || 0;
      hoverOffset.x = ix * 0.10;
      hoverOffset.y = iy * 0.10;
      hoverOffset.z = -z * 0.10;
      startAnimate();
    });

    item.addEventListener('mouseleave', function() {
      if (hoveredItem === item) {
        hoveredItem = null;
        // Return parallax to zero, keep focal where it was
        hoverOffset.x = 0;
        hoverOffset.y = 0;
        hoverOffset.z = 0;
        startAnimate();
      }
    });

    item.addEventListener('contextmenu', function(e) {
      e.preventDefault();
      e.stopPropagation();
      showCtx(e.clientX, e.clientY, item.dataset.project);
    });

    item.addEventListener('click', function(e) {
      if (Math.abs(e.clientX - dragStart.x) > 5) return;
      hideCtx();
      // Click opens context menu instead of flying
      showCtx(e.clientX + 10, e.clientY, item.dataset.project);
    });
  });

  document.querySelectorAll('.d3-ctx-item').forEach(function(el) {
    el.addEventListener('click', function() {
      var action = el.dataset.action;
      var proj = ctxProject;
      hideCtx();
      if (!proj) return;
      if (action === 'focus') {
        for (var i = 0; i < items.length; i++) {
          if (items[i].dataset.project === proj) {
            var iz = parseFloat(items[i].dataset.z) || 0;
            baseTarget.z = -iz;
            focalTarget = 0;
            startAnimate();
            break;
          }
        }
      } else {
        var views = { open: '', chat: 'chat', sessions: 'sessions', graph: 'graph' };
        var v = views[action] || '';
        window.location.href = '/?project=' + encodeURIComponent(proj) + (v ? '&view=' + v : '');
      }
    });
  });

  document.addEventListener('click', function(e) {
    if (!e.target.closest('.d3-ctx')) hideCtx();
  });

  viewport.addEventListener('contextmenu', function(e) {
    if (!e.target.closest('.d3-item')) { e.preventDefault(); hideCtx(); }
  });

  // ── KEYBOARD ──
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') { hideCtx(); return; }
    var step = e.shiftKey ? 300 : 100;
    if (e.key === 'ArrowUp') { baseTarget.z += step; e.preventDefault(); }
    if (e.key === 'ArrowDown') { baseTarget.z -= step; e.preventDefault(); }
    if (e.key === 'ArrowLeft') { baseTarget.x += step; e.preventDefault(); }
    if (e.key === 'ArrowRight') { baseTarget.x -= step; e.preventDefault(); }
    if (e.key === '[') { fStop = Math.max(1.0, fStop - 0.5); updateApertureUI(); }
    if (e.key === ']') { fStop = Math.min(16, fStop + 0.5); updateApertureUI(); }
    if (e.key === 'r') { baseTarget.x = 0; baseTarget.y = 0; baseTarget.z = 0; focalTarget = 0; }
    // 1/2/3 → switch layout
    if (e.key === '1') window.switchLayout('fibonacci');
    if (e.key === '2') window.switchLayout('cluster');
    if (e.key === '3') window.switchLayout('alpha');
    startAnimate();
  });

  // ── THEME ──
  window.setTheme = function(name) {
    var classes = ['night', 'primavera', 'estate', 'ellenica', 'benessere'];
    classes.forEach(function(c) { document.documentElement.classList.remove(c); });
    if (name !== 'default') document.documentElement.classList.add(name);
  };

  // ── INIT ──
  layoutFibonacci();
  updateApertureUI();
  updateDoF();
})();
</script>
</body>
</html>`;
}
