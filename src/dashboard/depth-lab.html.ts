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
</div>

<div class="d3-hud" id="hud">
  <div>Z <strong id="hud-z">0</strong></div>
  <div>FOCAL <strong id="hud-focal">0</strong></div>
  <div>F-STOP <strong id="hud-fstop">2.8</strong></div>
  <div>LAYOUT <strong id="hud-layout">alpha</strong></div>
  <div>PULL <strong id="hud-pull">0.06</strong></div>
  <div>ITEMS <strong>${projectData.length}</strong></div>
</div>

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

  // ── GOLDEN RATIO (dichiarato prima del seed loop!) ──
  var PHI = (1 + Math.sqrt(5)) / 2;
  var GOLDEN_ANGLE = 2.399963;

  // ── ORGANIC CONSTANTS ──
  var PULL_FACTOR = 0.06;
  var MAX_RIPPLE = 2500;

  // ── PER-ITEM ORGANIC STATE ──
  var itemBasePos = [];
  var itemOffset = [];
  var itemOffsetTarget = [];
  var itemSeed = [];
  for (var i = 0; i < n; i++) {
    itemBasePos.push({ x: 0, y: 0, z: 0 });
    itemOffset.push({ x: 0, y: 0 });
    itemOffsetTarget.push({ x: 0, y: 0 });
    itemSeed.push(0.8 + ((i * PHI) % 1) * 0.4);
  }
  var layoutTransitioning = false;

  // ── TESSUTO: Camera + DoF + Animazione ──
  ${depthLabCameraJS()}

  // ── TESSUTO: Motore Posizionamento ──
  ${depthLabLayoutJS()}

  // ── TESSUTO: Interazione ──
  ${depthLabInteractionJS()}

  // ── INIT ──
  layoutAlpha();
  updateApertureUI();
  updatePullUI();
  updateDoF();
})();
</script>
</body>
</html>`;
}
