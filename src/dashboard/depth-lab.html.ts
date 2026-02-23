/**
 * Depth Lab — Organo: Composizione Pagina
 *
 * PTI livello: organo
 * Ruolo: assembla i tessuti (CSS, layout, camera, interazione) in una pagina HTML completa.
 *
 * Tessuti:
 *   depth-lab.css.ts         → membrana visiva
 *   depth-lab.layout.ts      → motore posizionamento (strategy pattern)
 *   depth-lab.camera.ts      → camera + DoF + animazione + organic attraction
 *   depth-lab.interaction.ts → hover/drag/scroll/keyboard/ctx/theme
 */

import { depthLabCSS } from './depth-lab.css';
import { depthLabLayoutJS } from './depth-lab.layout';
import { depthLabCameraJS } from './depth-lab.camera';
import { depthLabInteractionJS } from './depth-lab.interaction';
import { depthLabFocusJS } from './depth-lab.focus';
import { depthLabBreathJS } from './depth-lab.breath';
import { depthLabChatJS } from './depth-lab.chat';

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
<style>${depthLabCSS()}</style>
</head>
<body>
<div class="d3-viewport" id="viewport">
  <div id="d3-bg"></div>
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
  <button id="btn-fibonacci" onclick="switchLayout('fibonacci')">Fibonacci</button>
  <button id="btn-cluster" onclick="switchLayout('cluster')">Cluster</button>
  <button id="btn-alpha" class="active" onclick="switchLayout('alpha')">A — Z</button>
  <div class="sep"></div>
  <button id="btn-params" onclick="toggleParamsPanel()">P</button>
</div>

<div class="d3-hud" id="hud">
  <div>Z <strong id="hud-z">0</strong></div>
  <div>FOCAL <strong id="hud-focal">0</strong></div>
  <div>F-STOP <strong id="hud-fstop">2.8</strong></div>
  <div>LAYOUT <strong id="hud-layout">alpha</strong></div>
  <div>PULL <strong id="hud-pull">0.06</strong></div>
  <div>ITEMS <strong>${projectData.length}</strong></div>
</div>

<!-- ── DEBUG PROBE (toggle with D key) ── -->
<div class="d3-probe" id="probe" style="display:none">
  <div class="d3-probe-title">PROBE</div>
  <div>mouse <strong id="pr-mouse">0, 0</strong></div>
  <div>baseTarget <strong id="pr-base">0, 0, 0</strong></div>
  <div>camera <strong id="pr-cam">0, 0, 0</strong></div>
  <div>delta <strong id="pr-delta">0, 0</strong></div>
  <div>hovered <strong id="pr-hovered">—</strong></div>
  <div>aura <strong id="pr-aura">0</strong></div>
  <div>screenXY <strong id="pr-screen">0, 0</strong></div>
  <div>auraR <strong id="pr-aura-r">0</strong></div>
  <div>dist <strong id="pr-dist">0</strong></div>
  <div>scale <strong id="pr-scale">0</strong></div>
  <div>top3 <strong id="pr-top3">—</strong></div>
</div>
<div class="d3-probe-dot" id="probe-dot" style="display:none"></div>
<div class="d3-probe-ring" id="probe-ring" style="display:none"></div>

<div class="d3-aperture" id="aperture">
  <label>APERTURE</label>
  <div class="d3-iris" id="iris"></div>
  <input type="range" id="fstop-slider" min="1.0" max="16" step="0.1" value="2.8">
  <span class="aperture-val" id="fstop-val">f/2.8</span>
  <div class="sep" style="width:1px;height:14px;background:var(--dim);opacity:0.3;margin:0 4px"></div>
  <label>PULL</label>
  <input type="range" id="pull-slider" min="0" max="0.20" step="0.01" value="0.06">
  <span class="aperture-val" id="pull-val">0.06</span>
</div>

<!-- ── PARAMETERS PANEL ── -->
<div class="d3-params" id="params-panel">
  <div class="d3-params-header">
    <span>PARAMETERS</span>
    <div class="d3-params-actions">
      <button onclick="window.depthLab.resetDefaults()">Reset</button>
      <button onclick="promptExport()">Export</button>
      <button onclick="promptImport()">Import</button>
    </div>
  </div>

  <div class="d3-params-section">
    <div class="d3-params-title" onclick="toggleSection(this)">▸ Camera</div>
    <div class="d3-params-body">
      <div class="d3-param-row"><label>fStop</label><input type="range" data-key="fStop" min="1" max="16" step="0.1"><span class="d3-param-val"></span></div>
      <div class="d3-param-row"><label>maxBlur</label><input type="range" data-key="maxBlur" min="1" max="20" step="0.5"><span class="d3-param-val"></span></div>
      <div class="d3-param-row"><label>cameraLerp</label><input type="range" data-key="cameraLerp" min="0.02" max="0.20" step="0.01"><span class="d3-param-val"></span></div>
      <div class="d3-param-row"><label>focalLerp</label><input type="range" data-key="focalLerp" min="0.02" max="0.30" step="0.01"><span class="d3-param-val"></span></div>
    </div>
  </div>

  <div class="d3-params-section">
    <div class="d3-params-title" onclick="toggleSection(this)">▸ Organic</div>
    <div class="d3-params-body">
      <div class="d3-param-row"><label>pullFactor</label><input type="range" data-key="pullFactor" min="0" max="0.20" step="0.005"><span class="d3-param-val"></span></div>
      <div class="d3-param-row"><label>maxRipple</label><input type="range" data-key="maxRipple" min="500" max="5000" step="100"><span class="d3-param-val"></span></div>
      <div class="d3-param-row"><label>hitRadius</label><input type="range" data-key="hitRadius" min="20" max="200" step="5"><span class="d3-param-val"></span></div>
      <div class="d3-param-row"><label>maxOffset</label><input type="range" data-key="maxOffset" min="20" max="200" step="5"><span class="d3-param-val"></span></div>
      <div class="d3-param-row"><label>lerpBase</label><input type="range" data-key="lerpBase" min="0.01" max="0.10" step="0.005"><span class="d3-param-val"></span></div>
      <div class="d3-param-row"><label>lerpNear</label><input type="range" data-key="lerpNear" min="0.05" max="0.30" step="0.01"><span class="d3-param-val"></span></div>
      <div class="d3-param-row"><label>parallax</label><input type="range" data-key="parallaxStrength" min="0" max="0.20" step="0.005"><span class="d3-param-val"></span></div>
    </div>
  </div>

  <div class="d3-params-section">
    <div class="d3-params-title" onclick="toggleSection(this)">▸ Fibonacci</div>
    <div class="d3-params-body">
      <div class="d3-param-row"><label>fibRadius</label><input type="range" data-key="fibonacciRadius" min="50" max="500" step="10"><span class="d3-param-val"></span></div>
      <div class="d3-param-row"><label>fibZDepth</label><input type="range" data-key="fibonacciZDepth" min="5" max="100" step="1"><span class="d3-param-val"></span></div>
    </div>
  </div>

  <div class="d3-params-section">
    <div class="d3-params-title" onclick="toggleSection(this)">▸ Cluster</div>
    <div class="d3-params-body">
      <div class="d3-param-row"><label>clRadius</label><input type="range" data-key="clusterRadius" min="50" max="500" step="10"><span class="d3-param-val"></span></div>
      <div class="d3-param-row"><label>clZGap</label><input type="range" data-key="clusterZGap" min="100" max="1000" step="50"><span class="d3-param-val"></span></div>
      <div class="d3-param-row"><label>clZDepth</label><input type="range" data-key="clusterZDepth" min="5" max="50" step="1"><span class="d3-param-val"></span></div>
    </div>
  </div>

  <div class="d3-params-section">
    <div class="d3-params-title" onclick="toggleSection(this)">▸ Alpha Grid</div>
    <div class="d3-params-body">
      <div class="d3-param-row"><label>colWidth</label><input type="range" data-key="alphaColWidth" min="100" max="500" step="10"><span class="d3-param-val"></span></div>
      <div class="d3-param-row"><label>zDepth</label><input type="range" data-key="alphaZDepth" min="20" max="200" step="5"><span class="d3-param-val"></span></div>
    </div>
  </div>

  <div class="d3-params-section">
    <div class="d3-params-title" onclick="toggleSection(this)">▸ Zoom</div>
    <div class="d3-params-body">
      <div class="d3-param-row"><label>zoomSpeed</label><input type="range" data-key="zoomSpeed" min="0.5" max="5" step="0.1"><span class="d3-param-val"></span></div>
      <div class="d3-param-row"><label>smartPull</label><input type="range" data-key="smartZoomPull" min="0" max="0.01" step="0.0005"><span class="d3-param-val"></span></div>
    </div>
  </div>

  <div class="d3-params-section">
    <div class="d3-params-title" onclick="toggleSection(this)">▸ Boundaries</div>
    <div class="d3-params-body">
      <div class="d3-param-row"><label>spring</label><input type="range" data-key="boundarySpring" min="0.01" max="0.20" step="0.01"><span class="d3-param-val"></span></div>
      <div class="d3-param-row"><label>padding</label><input type="range" data-key="boundaryPadding" min="0.1" max="2.0" step="0.1"><span class="d3-param-val"></span></div>
    </div>
  </div>

  <div class="d3-params-section">
    <div class="d3-params-title" onclick="toggleSection(this)">▸ Fog</div>
    <div class="d3-params-body">
      <div class="d3-param-row"><label>fogStart</label><input type="range" data-key="fogStart" min="200" max="2000" step="10"><span class="d3-param-val"></span></div>
      <div class="d3-param-row"><label>fogEnd</label><input type="range" data-key="fogEnd" min="1000" max="6000" step="100"><span class="d3-param-val"></span></div>
      <div class="d3-param-row"><label>desaturation</label><input type="range" data-key="fogDesaturation" min="0" max="1" step="0.05"><span class="d3-param-val"></span></div>
      <div class="d3-param-row"><label>opacity</label><input type="range" data-key="fogOpacity" min="0" max="1" step="0.05"><span class="d3-param-val"></span></div>
    </div>
  </div>

  <div class="d3-params-section">
    <div class="d3-params-title" onclick="toggleSection(this)">▸ Font</div>
    <div class="d3-params-body">
      <div class="d3-param-row"><label>base</label><input type="range" data-key="fontScaleBase" min="8" max="20" step="0.5"><span class="d3-param-val"></span></div>
      <div class="d3-param-row"><label>logScale</label><input type="range" data-key="fontScaleLog" min="0.5" max="5" step="0.1"><span class="d3-param-val"></span></div>
      <div class="d3-param-row"><label>max</label><input type="range" data-key="fontMax" min="16" max="48" step="1"><span class="d3-param-val"></span></div>
    </div>
  </div>
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

<!-- ── CHAT INPUT (2D fixed — unica eccezione al 3D) ── -->
<div class="d3-chat-input-wrap" id="chat-input-wrap">
  <input type="text" class="d3-chat-input" id="chat-input" placeholder="ask about this project..." autocomplete="off" spellcheck="false">
</div>

<!-- ── API KEY OVERLAY ── -->
<div class="d3-api-overlay" id="api-key-overlay">
  <div class="d3-api-box">
    <label>ANTHROPIC API KEY</label>
    <input type="password" id="api-key-input" placeholder="sk-ant-..." autocomplete="off">
    <button id="api-key-save">Save</button>
  </div>
</div>

<script>
(function() {
  // ── ASSERT — guardia PTI (non-throwing) ──
  function assert(cond, msg) {
    if (!cond) console.error('[assert]', msg);
  }

  var scene = document.getElementById('scene');
  var viewport = document.getElementById('viewport');
  var items = Array.from(document.querySelectorAll('.d3-item'));
  var n = items.length;

  // ── PROJECT DATA ──
  var DATA = ${JSON.stringify(projectData)};
  var maxCount = Math.max.apply(null, DATA.map(function(d) { return d.count; })) || 1;

  // ── GOLDEN RATIO (dichiarato prima del seed loop!) ──
  var PHI = (1 + Math.sqrt(5)) / 2;
  var GOLDEN_ANGLE = 2.399963;

  // ═══════════════════════════════════════════
  // PROFILO UTENTE PERSISTENTE
  // Ogni parametro visivo/interattivo è salvabile, ricaricabile,
  // e esposto come API PTI per il futuro LLM interno.
  // ═══════════════════════════════════════════
  var DEFAULTS = {
    // Camera
    fStop: 2.8,
    maxBlur: 12,
    cameraLerp: 0.08,
    focalLerp: 0.12,
    // Organic
    pullFactor: 0.12,
    maxRipple: 1500,
    hitRadius: 25,
    maxOffset: 80,
    lerpBase: 0.04,
    lerpNear: 0.20,
    parallaxStrength: 0.08,
    // Fibonacci
    fibonacciRadius: 200,
    fibonacciZDepth: 20,
    // Cluster
    clusterRadius: 160,
    clusterZGap: 400,
    clusterZDepth: 15,
    // Alpha Grid
    alphaColWidth: 260,
    alphaZDepth: 80,
    // Zoom
    zoomSpeed: 2,
    smartZoomPull: 0.003,
    // Boundaries
    boundarySpring: 0.06,
    boundaryPadding: 0.5,
    // Fog (atmospheric perspective)
    fogStart: 840,
    fogEnd: 3500,
    fogDesaturation: 0.4,
    fogOpacity: 0.5,
    // Font
    fontScaleBase: 12,
    fontScaleLog: 2.5,
    fontMax: 28,
    // Layout + Theme (metadata)
    layout: 'alpha',
    theme: 'default'
  };

  var profile = {};
  for (var k in DEFAULTS) profile[k] = DEFAULTS[k];

  // ── MUTABLE VARS (synced from profile by syncMutables) ──
  var fStop, maxBlur, PULL_FACTOR, MAX_RIPPLE, HIT_RADIUS, MAX_OFFSET;

  function syncMutables() {
    fStop = profile.fStop;
    maxBlur = profile.maxBlur;
    PULL_FACTOR = profile.pullFactor;
    MAX_RIPPLE = profile.maxRipple;
    HIT_RADIUS = profile.hitRadius;
    MAX_OFFSET = profile.maxOffset;
  }
  syncMutables();

  // ── PERSISTENCE ──
  var _saveTimer = null;
  function saveProfile() {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(function() {
      try { localStorage.setItem('depth-lab-profile', JSON.stringify(profile)); } catch(e) {}
    }, 500);
  }

  function loadProfile() {
    try {
      var saved = localStorage.getItem('depth-lab-profile');
      if (saved) {
        var parsed = JSON.parse(saved);
        for (var k in DEFAULTS) {
          if (parsed.hasOwnProperty(k)) profile[k] = parsed[k];
        }
      }
    } catch(e) {}
  }

  function applyProfile() {
    syncMutables();
    // Re-layout + update UI
    if (typeof layoutFns !== 'undefined' && layoutFns[currentLayout]) {
      layoutFns[currentLayout]();
    }
    if (typeof updateApertureUI === 'function') updateApertureUI();
    if (typeof updatePullUI === 'function') updatePullUI();
    if (typeof updateParamsUI === 'function') updateParamsUI();
    startAnimate();
  }

  // Load saved profile at boot
  loadProfile();
  syncMutables();

  // ── PER-ITEM ORGANIC STATE ──
  var itemBasePos = [];
  var itemOffset = [];
  var itemOffsetTarget = [];
  var itemSeed = [];
  var itemHalfW = [];  // half-width in 3D space (for box aura)
  var itemHalfH = [];  // half-height in 3D space
  for (var i = 0; i < n; i++) {
    itemBasePos.push({ x: 0, y: 0, z: 0 });
    itemOffset.push({ x: 0, y: 0 });
    itemOffsetTarget.push({ x: 0, y: 0 });
    itemSeed.push(0.8 + ((i * PHI) % 1) * 0.4);
    itemHalfW.push(items[i].offsetWidth / 2);
    itemHalfH.push(items[i].offsetHeight / 2);
  }
  var layoutTransitioning = false;

  // ── TESSUTO: Camera + DoF + Animazione ──
  ${depthLabCameraJS()}

  // ── TESSUTO: Motore Posizionamento ──
  ${depthLabLayoutJS()}

  // ── TESSUTO: Interazione ──
  ${depthLabInteractionJS()}

  // ── TESSUTO: Focus Mode 3D ──
  ${depthLabFocusJS()}

  // ── TESSUTO: Breathing Text ──
  ${depthLabBreathJS()}

  // ── TESSUTO: LLM Chat ──
  ${depthLabChatJS()}

  // ── INIT ──
  var savedLayout = profile.layout || 'alpha';
  if (profile.theme && profile.theme !== 'default') {
    window.setTheme(profile.theme);
  }
  window.switchLayout(savedLayout);
  updateApertureUI();
  updatePullUI();
  updateDoF();
  updateBackgroundGradient();
  updateParamsUI();
})();
</script>
</body>
</html>`;
}
