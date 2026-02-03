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
  var expandedModules = {};  // moduleId → { nodi: [], connessioni: [] }
  var SUB_NODE_W = 130, SUB_NODE_H = 24, SUB_GAP = 8;

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

  // Viewport culling: skip nodes outside visible area (with margin)
  function isVisible(p, w, h) {
    if (!p) return false;
    var margin = 100;
    return p.x + w + margin > viewBox.x && p.x - margin < viewBox.x + viewBox.w &&
           p.y + h + margin > viewBox.y && p.y - margin < viewBox.y + viewBox.h;
  }

  var renderPending = false;
  function scheduleRender() {
    if (renderPending) return;
    renderPending = true;
    requestAnimationFrame(function() { renderPending = false; render(); });
  }

  function render() {
    var svgEl = document.getElementById('graph-svg');
    if (!svgEl) return;
    svgEl.setAttribute('viewBox', viewBox.x + ' ' + viewBox.y + ' ' + viewBox.w + ' ' + viewBox.h);
    var parts = [];
    parts.push('<defs><marker id="g-arrow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">');
    parts.push('<path d="M0,0 L8,3 L0,6" class="g-edge-arrow"/></marker></defs>');
    // Edges — only render if both endpoints visible
    edgesData.forEach(function(e) {
      var from = positions[e.da], to = positions[e.a];
      if (!from || !to) return;
      var fw = from.w || NODE_W;
      if (!isVisible(from, fw, NODE_H) && !isVisible(to, to.w || NODE_W, NODE_H)) return;
      var x1 = from.x + fw, y1 = from.y + NODE_H / 2;
      var x2 = to.x, y2 = to.y + NODE_H / 2;
      var cpx = Math.abs(x2 - x1) * 0.4;
      var cls = 'g-edge' + (e.tipo === 'salto' ? ' salto' : '') + (e.tipo === 'modulo-dep' ? ' modulo-dep' : '');
      if (activeNodeId && (e.da === activeNodeId || e.a === activeNodeId)) cls += ' active';
      parts.push('<path class="' + cls + '" d="M' + x1 + ',' + y1 + ' C' + (x1+cpx) + ',' + y1 + ' ' + (x2-cpx) + ',' + y2 + ' ' + x2 + ',' + y2 + '" marker-end="url(#g-arrow)"/>');
    });
    // Nodes — viewport culling
    nodiData.forEach(function(n) {
      var p = positions[n.id];
      if (!p) return;
      var w = p.w || NODE_W;
      var isMod = n.tipo === 'modulo';
      var isExpanded = !!expandedModules[n.id];
      // Skip invisible nodes (unless expanded — always render expanded containers)
      if (!isExpanded && !isVisible(p, w, NODE_H)) return;
      var label;
      if (isMod && n.valore && n.valore.file) {
        var fileParts = n.valore.file.split('/');
        label = fileParts[fileParts.length - 1].replace(/\\.ts$/, '');
      } else {
        label = n.id.length > 18 ? n.id.slice(0, 17) + '\u2026' : n.id;
      }
      var maxChars = Math.floor(w / 7);
      if (label.length > maxChars) label = label.slice(0, maxChars - 1) + '\u2026';
      var cls = 'g-node ' + n.tipo;
      if (n.id === activeNodeId) cls += ' active';
      if (isExpanded) cls += ' expanded';
      parts.push('<g class="' + cls + '" data-id="' + n.id + '" transform="translate(' + p.x + ',' + p.y + ')">');
      parts.push('<rect width="' + w + '" height="' + NODE_H + '"/>');
      parts.push('<text x="' + (w/2) + '" y="' + (NODE_H/2 + 4) + '" text-anchor="middle">' + esc(label) + '</text>');
      if (isMod && n.valore) {
        var levelNames = { 5: 'atomo', 6: 'molecola', 7: 'cellula', 8: 'tessuto', 9: 'organo' };
        var lvName = levelNames[n.livello] || '';
        parts.push('<text x="' + (w/2) + '" y="' + (NODE_H + 12) + '" text-anchor="middle" class="g-mod-sub">' + n.valore.lines + 'L</text>');
        if (lvName) {
          parts.push('<text x="' + (w - 4) + '" y="11" text-anchor="end" class="g-level-badge g-lv-' + lvName + '">' + lvName + '</text>');
        }
      }
      parts.push('</g>');

      // Render expanded sub-nodes (PTIG drill-down)
      if (isExpanded) {
        var subData = expandedModules[n.id];
        var subAll = (subData.nodi || []).filter(function(sn) { return sn.id !== n.id; });
        var MAX_SUB = 40;
        var subNodi = subAll.slice(0, MAX_SUB);
        var subTruncated = subAll.length - subNodi.length;
        var subY = p.y + NODE_H + 18;
        subNodi.forEach(function(sn, si) {
          var snx = p.x + 8;
          var sny = subY + si * (SUB_NODE_H + SUB_GAP);
          positions[sn.id] = { x: snx, y: sny, w: SUB_NODE_W };
          if (!isVisible({ x: snx, y: sny }, SUB_NODE_W, SUB_NODE_H)) return;

          var snLabel = sn.id.split('.').pop() || sn.id;
          if (snLabel.length > 16) snLabel = snLabel.slice(0, 15) + '\u2026';

          var snCls = 'g-node g-sub-node ' + (sn.dna ? sn.dna.tipo : 'fatto');
          if (sn.dna && sn.dna.specializzazione) snCls += ' spec-' + sn.dna.specializzazione;
          if (sn.dna) snCls += ' membrana-' + sn.dna.membrana;
          if (sn.id === activeNodeId) snCls += ' active';

          var cx = (sn.valore && sn.valore.complessita) || 1;
          var strokeW = cx < 5 ? 1 : cx < 10 ? 2 : 3;

          parts.push('<g class="' + snCls + '" data-id="' + sn.id + '" transform="translate(' + snx + ',' + sny + ')">');
          parts.push('<rect width="' + SUB_NODE_W + '" height="' + SUB_NODE_H + '" style="stroke-width:' + strokeW + '"/>');
          parts.push('<text x="' + (SUB_NODE_W/2) + '" y="' + (SUB_NODE_H/2 + 4) + '" text-anchor="middle">' + esc(snLabel) + '</text>');
          parts.push('</g>');
        });
        if (subTruncated > 0) {
          var ty = subY + subNodi.length * (SUB_NODE_H + SUB_GAP);
          parts.push('<text x="' + (p.x + 8 + SUB_NODE_W/2) + '" y="' + (ty + 10) + '" text-anchor="middle" class="g-mod-sub">+ ' + subTruncated + ' altri</text>');
        }
        var subConn = (subData.connessioni || []);
        subConn.forEach(function(c) {
          var fp = positions[c.da], tp = positions[c.a];
          if (!fp || !tp) return;
          var sx1 = fp.x + SUB_NODE_W, sy1 = fp.y + SUB_NODE_H / 2;
          var sx2 = tp.x, sy2 = tp.y + SUB_NODE_H / 2;
          var scls = 'g-edge g-sub-edge' + (c.tipo === 'chiama' ? ' chiama' : '');
          parts.push('<path class="' + scls + '" d="M' + sx1 + ',' + sy1 + ' C' + (sx1+20) + ',' + sy1 + ' ' + (sx2-20) + ',' + sy2 + ' ' + sx2 + ',' + sy2 + '" marker-end="url(#g-arrow)"/>');
        });
      }
    });
    svgEl.innerHTML = parts.join('');
    var totalNodes = nodiData.length;
    Object.keys(expandedModules).forEach(function(k) {
      totalNodes += (expandedModules[k].nodi || []).length - 1;
    });
    document.getElementById('graph-node-count').textContent = totalNodes;
  }

  function initPanZoom() {
    var svgEl = document.getElementById('graph-svg');
    if (!svgEl) return;

    // Event delegation: single click → inspect, double click on module → expand/collapse
    svgEl.addEventListener('click', function(e) {
      var g = e.target.closest('.g-node');
      if (g && g.dataset.id) inspectNode(g.dataset.id);
    });
    svgEl.addEventListener('dblclick', function(e) {
      var g = e.target.closest('.g-node.modulo');
      if (!g) return;
      e.stopPropagation();
      var nid = g.dataset.id;
      if (expandedModules[nid]) { collapseNode(nid); } else { expandNode(nid); }
    });

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
      if (isPanning) { isPanning = false; scheduleRender(); }
      var s = document.getElementById('graph-svg');
      if (s) s.style.cursor = '';
    });
    svgEl.addEventListener('wheel', function(e) {
      e.preventDefault();
      // Dampen zoom for trackpad (small deltaY) vs mouse wheel (large deltaY)
      var raw = Math.abs(e.deltaY);
      var strength = raw < 10 ? 0.02 : raw < 50 ? 0.05 : 0.1;
      var factor = e.deltaY > 0 ? 1 + strength : 1 - strength;
      var rect = svgEl.getBoundingClientRect();
      var mx = (e.clientX - rect.left) / rect.width;
      var my = (e.clientY - rect.top) / rect.height;
      var nw = viewBox.w * factor, nh = viewBox.h * factor;
      viewBox.x += (viewBox.w - nw) * mx;
      viewBox.y += (viewBox.h - nh) * my;
      viewBox.w = nw; viewBox.h = nh;
      svgEl.setAttribute('viewBox', viewBox.x + ' ' + viewBox.y + ' ' + viewBox.w + ' ' + viewBox.h);
      scheduleRender();
    }, { passive: false });
  }

  function loadMetrics(project) {
    var url = '/api/ptig?project=' + encodeURIComponent(project || 'alessio-os');
    apiCall(url).then(function(ptig) {
      var m = ptig && ptig.metriche;
      if (!m) return;
      var el = document.getElementById('ptig-metrics');
      if (!el) return;
      var qCls = m.q < 0.05 ? 'cx-alta' : m.q < 0.15 ? 'cx-media' : 'cx-bassa';
      el.innerHTML =
        '<span class="pm-label">Q</span><span class="pm-val ' + qCls + '">' + m.q.toFixed(3) + '</span>' +
        '<span class="pm-sep">/</span>' +
        '<span class="pm-label">\u03c1</span><span class="pm-val">' + m.rho.toFixed(2) + '</span>' +
        '<span class="pm-sep">/</span>' +
        '<span class="pm-label">CR</span><span class="pm-val">' + m.cr.toFixed(3) + '</span>' +
        '<span class="pm-sep">/</span>' +
        '<span class="pm-label">\u03ba</span><span class="pm-val">' + m.kappa.toFixed(2) + '</span>';
      el.style.display = '';
    }).catch(function() {});
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
      loadMetrics(project);
    }).catch(function() {});
  }

  function expandNode(moduleId) {
    // Convert mod.X to file path ID for PTIG: mod.src.dashboard.server → src.dashboard.server
    var ptigId = moduleId.replace(/^mod\\./, '');
    var url = '/api/ptig/nodo?id=' + encodeURIComponent(ptigId);
    if (currentProject) url += '&project=' + encodeURIComponent(currentProject);
    apiCall(url).then(function(data) {
      expandedModules[moduleId] = data;
      // Recalculate layout to make space for sub-nodes
      var subCount = Math.min((data.nodi || []).filter(function(n) { return n.id !== ptigId; }).length, 40);
      if (positions[moduleId] && subCount > 0) {
        // Push nodes below this one down
        var expandHeight = subCount * (SUB_NODE_H + SUB_GAP) + 18;
        var baseY = positions[moduleId].y;
        Object.keys(positions).forEach(function(k) {
          if (k !== moduleId && positions[k].y > baseY && !k.startsWith(ptigId + '.')) {
            positions[k].y += expandHeight;
          }
        });
        fitAll();
      }
      render();
      if (typeof addLog === 'function') addLog('[PTIG] Espanso: ' + ptigId + ' (' + subCount + ' nodi)', 'event');
    }).catch(function(err) { console.error('[expandNode]', err); });
  }

  function collapseNode(moduleId) {
    var ptigId = moduleId.replace(/^mod\\./, '');
    var subData = expandedModules[moduleId];
    if (!subData) return;
    var subCount = (subData.nodi || []).filter(function(n) { return n.id !== ptigId; }).length;
    // Remove sub-node positions
    (subData.nodi || []).forEach(function(n) { delete positions[n.id]; });
    delete expandedModules[moduleId];
    // Contract space
    var expandHeight = subCount * (SUB_NODE_H + SUB_GAP) + 18;
    var baseY = positions[moduleId] ? positions[moduleId].y : 0;
    Object.keys(positions).forEach(function(k) {
      if (k !== moduleId && positions[k].y > baseY + NODE_H) {
        positions[k].y -= expandHeight;
      }
    });
    fitAll();
    render();
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
    _expanded: function() { return expandedModules; },
    expandNode: expandNode,
    collapseNode: collapseNode,
    toggleModules: function() {
      showModules = !showModules;
      expandedModules = {};
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

  // PTIG sub-node: show DNA info from expanded data
  var ptigNode = null;
  Object.keys(GraphRenderer._expanded()).forEach(function(modId) {
    var exp = GraphRenderer._expanded()[modId];
    if (exp && exp.nodi) {
      var found = exp.nodi.find(function(n) { return n.id === nodeId; });
      if (found) ptigNode = found;
    }
  });
  if (ptigNode) {
    var insp = document.getElementById('graph-inspector');
    insp.style.display = '';
    document.getElementById('gi-title').textContent = nodeId.split('.').pop() || nodeId;
    var h = '';
    // DNA section
    if (ptigNode.dna) {
      h += '<div class="gi-dna">';
      h += '<div class="gi-field"><span class="gi-label">DNA</span></div>';
      h += '<div class="gi-field"><span class="gi-label">LIVELLO</span>' + esc(ptigNode.dna.livelloNome || String(ptigNode.dna.livello)) + '</div>';
      h += '<div class="gi-field"><span class="gi-label">TIPO</span><span class="gi-badge tipo-' + ptigNode.dna.tipo + '">' + esc(ptigNode.dna.tipo) + '</span></div>';
      h += '<div class="gi-field"><span class="gi-label">MEMBRANA</span><span class="gi-badge membrana-' + ptigNode.dna.membrana + '">' + esc(ptigNode.dna.membrana) + '</span></div>';
      if (ptigNode.dna.specializzazione) {
        h += '<div class="gi-field"><span class="gi-label">SPEC</span><span class="gi-badge spec-' + ptigNode.dna.specializzazione + '">' + esc(ptigNode.dna.specializzazione) + '</span></div>';
      }
      h += '</div>';
    }
    h += '<div class="gi-field"><span class="gi-label">FILE</span>' + esc(ptigNode.file) + ':' + ptigNode.rigaInizio + '</div>';
    h += '<div class="gi-field"><span class="gi-label">RIGHE</span>' + ptigNode.righe + '</div>';
    if (ptigNode.valore) {
      var v = ptigNode.valore;
      if (v.complessita != null) {
        var cxCls = v.complessita < 5 ? 'cx-bassa' : v.complessita < 10 ? 'cx-media' : 'cx-alta';
        h += '<div class="gi-field"><span class="gi-label">COMPLESSITA</span><span class="gi-badge ' + cxCls + '">' + v.complessita + '</span></div>';
      }
      if (v.async) h += '<div class="gi-field"><span class="gi-label">ASYNC</span>si</div>';
      if (v.params && v.params.length) {
        h += '<div class="gi-field"><span class="gi-label">PARAMS</span>';
        v.params.forEach(function(p) { h += '<div class="gi-chain-item">' + esc(p.nome) + (p.tipo ? ': ' + esc(p.tipo) : '') + '</div>'; });
        h += '</div>';
      }
      if (v.ritorno) h += '<div class="gi-field"><span class="gi-label">RITORNO</span>' + esc(v.ritorno) + '</div>';
      if (v.estende) h += '<div class="gi-field"><span class="gi-label">EXTENDS</span>' + esc(v.estende) + '</div>';
      if (v.implementa && v.implementa.length) {
        h += '<div class="gi-field"><span class="gi-label">IMPLEMENTS</span>' + v.implementa.map(function(i) { return esc(i); }).join(', ') + '</div>';
      }
      if (v.metodi && v.metodi.length) {
        h += '<div class="gi-field"><span class="gi-label">METODI</span>';
        v.metodi.forEach(function(mid) { h += '<a class="gi-link" data-node="' + esc(mid) + '">' + esc(mid.split('.').pop()) + '</a>'; });
        h += '</div>';
      }
      if (v.proprieta && v.proprieta.length) {
        h += '<div class="gi-field"><span class="gi-label">PROPRIETA</span>';
        v.proprieta.forEach(function(p) { h += '<div class="gi-chain-item">' + esc(p.nome) + (p.tipo ? ': ' + esc(p.tipo) : '') + ' [' + p.membrana + ']</div>'; });
        h += '</div>';
      }
      if (v.campi && v.campi.length) {
        h += '<div class="gi-field"><span class="gi-label">CAMPI</span>';
        v.campi.forEach(function(c) { h += '<div class="gi-chain-item">' + esc(c.nome) + (c.opzionale ? '?' : '') + (c.tipo ? ': ' + esc(c.tipo) : '') + '</div>'; });
        h += '</div>';
      }
      if (v.definizione) h += '<div class="gi-field"><span class="gi-label">DEF</span><pre>' + esc(v.definizione) + '</pre></div>';
    }
    document.getElementById('gi-body').innerHTML = h;
    onClickAll('.gi-link[data-node]', function(a) { inspectNode(a.dataset.node); });
    return;
  }

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
