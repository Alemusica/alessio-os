/**
 * PTI Graph Renderer + Inspector + Debug Panel
 * Extracted from server.ts T5 tissue
 *
 * Exposes globally: window.GraphRenderer, inspectNode, closeInspector
 * Dependencies: esc() and addLog() from state.js, switchView from state.js, SSE from state.js
 */

export const graphJs = `
// ── PTI GRAPH RENDERER ──
var GraphRenderer = (function() {
  var nodiData = [], edgesData = [];
  var positions = {};
  var viewBox = { x: 0, y: 0, w: 1200, h: 800 };
  var NODE_W = 140, NODE_H = 34, MOD_W = 180;
  var LAYER_GAP = 89, NODE_GAP = 55;
  var activeNodeId = null;
  var showModules = true;
  var isPanning = false, panStart = null, vbStart = null;

  function layout() {
    var layers = {};
    var tipoOrd = { fatto: 0, derivato: 1, assert: 2, azione: 3 };
    nodiData.forEach(function(n) {
      if (n.tipo === 'modulo' && !showModules) return;
      var lv = n.livello;
      if (!layers[lv]) layers[lv] = [];
      layers[lv].push(n);
    });
    Object.keys(layers).forEach(function(lv) {
      layers[lv].sort(function(a, b) { return (tipoOrd[a.tipo]||0) - (tipoOrd[b.tipo]||0); });
      layers[lv].forEach(function(n, i) {
        var w = n.tipo === 'modulo' ? MOD_W : NODE_W;
        positions[n.id] = {
          x: 55 + parseInt(lv) * (NODE_W + LAYER_GAP),
          y: 55 + i * (NODE_H + NODE_GAP),
          w: w
        };
      });
    });
    fitAll();
  }

  function fitAll() {
    var maxX = 0, maxY = 0;
    var vals = Object.keys(positions).map(function(k) { return positions[k]; });
    vals.forEach(function(p) {
      var w = p.w || NODE_W;
      if (p.x + w > maxX) maxX = p.x + w;
      if (p.y + NODE_H > maxY) maxY = p.y + NODE_H;
    });
    viewBox = { x: -34, y: -34, w: Math.max(maxX + 89, 400), h: Math.max(maxY + 89, 300) };
  }

  function render() {
    var svgEl = document.getElementById('graph-svg');
    if (!svgEl) return;
    svgEl.setAttribute('viewBox', viewBox.x + ' ' + viewBox.y + ' ' + viewBox.w + ' ' + viewBox.h);
    var h = '';
    h += '<defs><marker id="g-arrow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">';
    h += '<path d="M0,0 L8,3 L0,6" class="g-edge-arrow"/></marker></defs>';
    edgesData.forEach(function(e) {
      var from = positions[e.da], to = positions[e.a];
      if (!from || !to) return;
      var fw = from.w || NODE_W;
      var x1 = from.x + fw, y1 = from.y + NODE_H / 2;
      var x2 = to.x, y2 = to.y + NODE_H / 2;
      var cpx = Math.abs(x2 - x1) * 0.4;
      var cls = 'g-edge' + (e.tipo === 'salto' ? ' salto' : '') + (e.tipo === 'modulo-dep' ? ' modulo-dep' : '');
      if (activeNodeId && (e.da === activeNodeId || e.a === activeNodeId)) cls += ' active';
      h += '<path class="' + cls + '" d="M' + x1 + ',' + y1 + ' C' + (x1+cpx) + ',' + y1 + ' ' + (x2-cpx) + ',' + y2 + ' ' + x2 + ',' + y2 + '" marker-end="url(#g-arrow)"/>';
    });
    nodiData.forEach(function(n) {
      var p = positions[n.id];
      if (!p) return;
      var w = p.w || NODE_W;
      var isMod = n.tipo === 'modulo';
      var label;
      if (isMod && n.valore && n.valore.file) {
        var parts = n.valore.file.split('/');
        label = parts[parts.length - 1].replace(/\.ts$/, '');
      } else {
        label = n.id.length > 18 ? n.id.slice(0, 17) + '\u2026' : n.id;
      }
      var maxChars = Math.floor(w / 7);
      if (label.length > maxChars) label = label.slice(0, maxChars - 1) + '\u2026';
      var cls = 'g-node ' + n.tipo;
      if (n.id === activeNodeId) cls += ' active';
      h += '<g class="' + cls + '" data-id="' + n.id + '" transform="translate(' + p.x + ',' + p.y + ')">';
      h += '<rect width="' + w + '" height="' + NODE_H + '"/>';
      h += '<text x="' + (w/2) + '" y="' + (NODE_H/2 + 4) + '" text-anchor="middle">' + esc(label) + '</text>';
      if (isMod && n.valore) {
        h += '<text x="' + (w/2) + '" y="' + (NODE_H + 12) + '" text-anchor="middle" class="g-mod-sub">' + n.valore.lines + 'L</text>';
      }
      h += '</g>';
    });
    svgEl.innerHTML = h;
    document.getElementById('graph-node-count').textContent = nodiData.length;
    onClickAll('.g-node', function(g) { inspectNode(g.dataset.id); });
  }

  function initPanZoom() {
    var svgEl = document.getElementById('graph-svg');
    if (!svgEl) return;
    svgEl.addEventListener('mousedown', function(e) {
      if (e.target.closest('.g-node')) return;
      isPanning = true;
      panStart = { x: e.clientX, y: e.clientY };
      vbStart = { x: viewBox.x, y: viewBox.y };
      svgEl.style.cursor = 'grabbing';
    });
    svgEl.addEventListener('mousemove', function(e) {
      if (!isPanning) return;
      var scale = viewBox.w / svgEl.clientWidth;
      viewBox.x = vbStart.x - (e.clientX - panStart.x) * scale;
      viewBox.y = vbStart.y - (e.clientY - panStart.y) * scale;
      svgEl.setAttribute('viewBox', viewBox.x + ' ' + viewBox.y + ' ' + viewBox.w + ' ' + viewBox.h);
    });
    window.addEventListener('mouseup', function() {
      isPanning = false;
      var s = document.getElementById('graph-svg');
      if (s) s.style.cursor = '';
    });
    svgEl.addEventListener('wheel', function(e) {
      e.preventDefault();
      var factor = e.deltaY > 0 ? 1.1 : 0.9;
      var rect = svgEl.getBoundingClientRect();
      var mx = (e.clientX - rect.left) / rect.width;
      var my = (e.clientY - rect.top) / rect.height;
      var nw = viewBox.w * factor, nh = viewBox.h * factor;
      viewBox.x += (viewBox.w - nw) * mx;
      viewBox.y += (viewBox.h - nh) * my;
      viewBox.w = nw; viewBox.h = nh;
      svgEl.setAttribute('viewBox', viewBox.x + ' ' + viewBox.y + ' ' + viewBox.w + ' ' + viewBox.h);
    }, { passive: false });
  }

  var panZoomInited = false;
  var currentProject = '';
  function load(project) {
    var url = '/api/pti/topology';
    if (project) url += '?project=' + encodeURIComponent(project);
    currentProject = project || '';
    apiCall(url).then(function(data) {
      nodiData = data.nodi || [];
      edgesData = data.edges || [];
      layout();
      render();
      if (!panZoomInited) { initPanZoom(); panZoomInited = true; }
    }).catch(function() {});
  }

  return {
    load: load,
    currentProject: function() { return currentProject; },
    render: render,
    fitAll: function() { fitAll(); render(); },
    flash: function(nodeId) {
      var el = document.querySelector('.g-node[data-id="' + nodeId + '"]');
      if (el) { el.classList.add('propagating'); setTimeout(function() { el.classList.remove('propagating'); }, 600); }
    },
    _nodi: function() { return nodiData; },
    _edges: function() { return edgesData; },
    toggleModules: function() {
      showModules = !showModules;
      positions = {};
      layout();
      render();
      return showModules;
    }
  };
})();

function inspectNode(nodeId) {
  document.querySelectorAll('.g-node').forEach(function(g) {
    g.classList.toggle('active', g.dataset.id === nodeId);
  });
  document.querySelectorAll('.g-edge').forEach(function(e) {
    e.classList.toggle('active', false);
  });
  // Modulo nodes: show file info directly from topology data
  if (nodeId.startsWith('mod.')) {
    var nodo = GraphRenderer._nodi().find(function(n) { return n.id === nodeId; });
    if (!nodo) return;
    var insp = document.getElementById('graph-inspector');
    insp.style.display = '';
    document.getElementById('gi-title').textContent = nodo.valore.file || nodeId;
    var levelNames = { 5: 'atomo', 6: 'molecola', 7: 'cellula', 8: 'tessuto', 9: 'organo' };
    var h = '';
    h += '<div class="gi-field"><span class="gi-label">TIPO</span>modulo</div>';
    h += '<div class="gi-field"><span class="gi-label">LIVELLO</span>' + (levelNames[nodo.livello] || nodo.livello) + '</div>';
    h += '<div class="gi-field"><span class="gi-label">FILE</span>' + esc(nodo.valore.file) + '</div>';
    h += '<div class="gi-field"><span class="gi-label">RIGHE</span>' + nodo.valore.lines + '</div>';
    if (nodo.valore.exports && nodo.valore.exports.length) {
      h += '<div class="gi-field"><span class="gi-label">EXPORTS</span>';
      nodo.valore.exports.forEach(function(ex) { h += '<div class="gi-chain-item">' + esc(ex) + '</div>'; });
      h += '</div>';
    }
    // Show dependencies from edges
    var deps = GraphRenderer._edges().filter(function(e) { return e.da === nodeId && e.tipo === 'modulo-dep'; });
    if (deps.length) {
      h += '<div class="gi-field"><span class="gi-label">DIPENDENZE</span>';
      deps.forEach(function(d) { h += '<a class="gi-link" data-node="' + esc(d.a) + '">' + esc(d.a.replace('mod.','')) + '</a>'; });
      h += '</div>';
    }
    var dependents = GraphRenderer._edges().filter(function(e) { return e.a === nodeId && e.tipo === 'modulo-dep'; });
    if (dependents.length) {
      h += '<div class="gi-field"><span class="gi-label">DIPENDENTI</span>';
      dependents.forEach(function(d) { h += '<a class="gi-link" data-node="' + esc(d.da) + '">' + esc(d.da.replace('mod.','')) + '</a>'; });
      h += '</div>';
    }
    document.getElementById('gi-body').innerHTML = h;
    onClickAll('.gi-link[data-node]', function(a) { inspectNode(a.dataset.node); });
    return;
  }
  fetch('/api/pti/trace?node=' + encodeURIComponent(nodeId))
    .then(function(r) { return r.json(); })
    .then(function(trace) {
      var insp = document.getElementById('graph-inspector');
      insp.style.display = '';
      document.getElementById('gi-title').textContent = trace.id || nodeId;
      var h = '';
      h += '<div class="gi-field"><span class="gi-label">TIPO</span>' + esc(trace.tipo || '?') + '</div>';
      h += '<div class="gi-field"><span class="gi-label">LIVELLO</span>' + (trace.livello != null ? trace.livello : '?') + '</div>';
      h += '<div class="gi-field"><span class="gi-label">VALORE</span><pre>' + esc(JSON.stringify(trace.valore, null, 2)) + '</pre></div>';
      h += '<div class="gi-field"><span class="gi-label">ACCESS COUNT</span>' + (trace.accessCount || 0) + '</div>';
      if (trace.sorgenti && trace.sorgenti.length) {
        h += '<div class="gi-field"><span class="gi-label">SORGENTI</span>';
        trace.sorgenti.forEach(function(s) {
          h += '<a class="gi-link" data-node="' + esc(s.id) + '">' + esc(s.id) + ' = ' + esc(JSON.stringify(s.valore)) + '</a>';
        });
        h += '</div>';
      }
      if (trace.dipendenti && trace.dipendenti.length) {
        h += '<div class="gi-field"><span class="gi-label">DIPENDENTI</span>';
        trace.dipendenti.forEach(function(d) {
          h += '<a class="gi-link" data-node="' + esc(d) + '">' + esc(d) + '</a>';
        });
        h += '</div>';
      }
      if (trace.salti && trace.salti.length) {
        h += '<div class="gi-field"><span class="gi-label">SALTI</span>';
        trace.salti.forEach(function(s) {
          h += '<a class="gi-link" data-node="' + esc(s) + '">' + esc(s) + '</a>';
        });
        h += '</div>';
      }
      if (trace.catena && trace.catena.length > 1) {
        h += '<div class="gi-field"><span class="gi-label">CATENA CAUSALE</span>';
        trace.catena.forEach(function(c) {
          h += '<div class="gi-chain-item">' + esc(c.id) + '</div>';
        });
        h += '</div>';
      }
      if (trace.ultimoCausa) {
        h += '<div class="gi-field"><span class="gi-label">ULTIMO DELTA</span><pre>' + esc(JSON.stringify(trace.ultimoCausa.delta, null, 2)) + '</pre></div>';
      }
      document.getElementById('gi-body').innerHTML = h;
      document.querySelectorAll('.gi-link[data-node]').forEach(function(a) {
        a.addEventListener('click', function() { inspectNode(a.dataset.node); });
      });
    }).catch(function(err) { console.error('[inspectNode] error:', err); });
}

function closeInspector() {
  document.getElementById('graph-inspector').style.display = 'none';
  document.querySelectorAll('.g-node.active').forEach(function(g) { g.classList.remove('active'); });
}

function graphSnapshot() {
  apiCall('/api/pti/snapshot', { method: 'POST' })
    .then(function() { if (typeof addLog === 'function') addLog('[PTI] Snapshot salvato', 'event'); })
    .catch(function() {});
}

function graphFitAll() { GraphRenderer.fitAll(); }

function toggleCodeGraph() {
  var on = GraphRenderer.toggleModules();
  var btn = document.getElementById('btn-toggle-code');
  if (btn) btn.classList.toggle('btn-active', on);
}

// ── DIFF STRUTTURALE ──
var diffActive = false;
function graphDiff() {
  if (diffActive) {
    // Toggle off — reload normal graph
    diffActive = false;
    document.querySelectorAll('.g-node').forEach(function(g) {
      g.classList.remove('diff-aggiunto', 'diff-rimosso', 'diff-modificato');
    });
    document.getElementById('diff-summary').style.display = 'none';
    GraphRenderer.load();
    return;
  }
  // Fetch diff (latest snapshot vs live)
  apiCall('/api/pti/diff').then(function(diff) {
    if (diff.error) { if (typeof addLog === 'function') addLog('[PTI] Diff: ' + diff.error, 'error'); return; }
    diffActive = true;
    // Apply diff classes to existing nodes
    (diff.nodi || []).forEach(function(d) {
      var el = document.querySelector('.g-node[data-id="' + d.id + '"]');
      if (!el) return;
      if (d.cambiamento === 'aggiunto') el.classList.add('diff-aggiunto');
      else if (d.cambiamento === 'rimosso') el.classList.add('diff-rimosso');
      else if (d.cambiamento === 'modificato') el.classList.add('diff-modificato');
    });
    // Show summary bar
    var s = diff.sommario || {};
    var sumEl = document.getElementById('diff-summary');
    if (sumEl) {
      sumEl.style.display = '';
      sumEl.innerHTML =
        '<span class="ds-added">+' + (s.aggiunti || 0) + '</span> ' +
        '<span class="ds-removed">-' + (s.rimossi || 0) + '</span> ' +
        '<span class="ds-modified">~' + (s.modificati || 0) + '</span> ' +
        '<span class="ds-unchanged">=' + (s.invariati || 0) + '</span>';
    }
    if (typeof addLog === 'function') addLog('[PTI] Diff: +' + (s.aggiunti||0) + ' -' + (s.rimossi||0) + ' ~' + (s.modificati||0), 'event');
  }).catch(function(err) { console.error('[graphDiff] error:', err); });
}

// ── ENHANCED VIEW SWITCH ──
var origSwitchView = switchView;
switchView = function(name) {
  origSwitchView(name);
  if (name === 'timeline') loadTimeline(true);
  if (name === 'mcp') loadMcpStatus();
  if (name === 'graph') { loadGraphProjectList(); GraphRenderer.load(GraphRenderer.currentProject()); }
};

// ── DEBUG PANEL ──
function toggleDebug() { togglePanel('debug-panel'); }

const debugEntries = [];
function addDebug(type, text) {
  const now = new Date().toLocaleTimeString('it-IT', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  debugEntries.push({ time: now, type, text });
  if (debugEntries.length > 100) debugEntries.shift();
  renderDebug();
}

function renderDebug() {
  const body = document.getElementById('debug-body');
  if (!body) return;
  body.innerHTML = debugEntries.slice().reverse().map(function(e) {
    const cls = e.type === 'route' ? 'de-route' : e.type === 'context' ? 'de-context' :
                e.type === 'spawn' ? 'de-spawn' : e.type === 'done' ? 'de-done' : 'de-error';
    return '<div class="debug-entry"><span class="de-time">' + e.time + '</span>' +
      '<span class="de-type ' + cls + '">' + e.type + '</span>' + esc(e.text) + '</div>';
  }).join('');
}

// ── PTI GRAPH: MULTI-PROJECT ──
function loadGraphProject(projectName) {
  GraphRenderer.load(projectName || '');
}

var graphProjectListLoaded = false;
function loadGraphProjectList() {
  if (graphProjectListLoaded) return;
  graphProjectListLoaded = true;
  apiCall('/api/pti/projects').then(function(projects) {
    var sel = document.getElementById('graph-project-select');
    if (!sel || !projects.length) return;
    sel.innerHTML = '';
    projects.forEach(function(p) {
      var opt = document.createElement('option');
      opt.value = p.name;
      opt.textContent = p.name;
      sel.appendChild(opt);
    });
    // After loading, try loading each to detect which have topology
    projects.forEach(function(p) {
      apiCall('/api/pti/topology?project=' + encodeURIComponent(p.name)).then(function(data) {
        var modCount = (data.nodi || []).filter(function(n) { return n.tipo === 'modulo'; }).length;
        var opt = sel.querySelector('option[value="' + p.name + '"]');
        if (opt) {
          opt.textContent = p.name + (modCount > 0 ? ' (' + modCount + ')' : ' — nessun grafo');
        }
      }).catch(function() {});
    });
  }).catch(function() {});
}

// Hook into SSE log events to capture debug info
const origLogHandler = sse.addEventListener;
sse.addEventListener('log', function(e) {
  const d = parseSSE(e);
  const t = d.text || '';
  // Classify log entries for debug panel
  if (t.includes('[route]')) addDebug('route', t);
  else if (t.includes('Context:')) addDebug('context', t);
  else if (t.includes('dispatched') || t.includes('coder →') || t.includes('tester →') || t.includes('reviewer →') || t.includes('researcher →')) addDebug('spawn', t);
  else if (t.includes('exit:')) addDebug('done', t);
  else if (d.cls === 'error') addDebug('error', t);
});
`;
