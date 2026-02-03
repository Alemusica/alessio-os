/**
 * Depth Lab — Tessuto: Motore Posizionamento (Layout)
 *
 * PTI livello: tessuto
 * Ruolo: calcola le coordinate spaziali degli item nel volume 3D.
 * Contiene: strategy pattern per Fibonacci/Cluster/Alpha.
 * Dipende da: variabili globali IIFE (items, n, DATA, itemBasePos, PHI, GOLDEN_ANGLE).
 *
 * L'eliminazione della duplicazione avviene tramite applyLayout() condiviso:
 * ogni strategia calcola solo { x, y, z, fs, fw } per entry.
 */

export function depthLabLayoutJS(): string {
  return `
  // ═══════════════════════════════════════════
  // TESSUTO: MOTORE POSIZIONAMENTO
  // Strategy pattern — ogni layout produce entries,
  // applyLayout() le materializza nel DOM.
  // ═══════════════════════════════════════════

  // ── THEMATIC CLUSTERS ──
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

  // ── SHARED LAYOUT APPLICATOR ──
  // PTI: cellula condivisa — ogni strategia produce dati, questa li applica.
  // entries: [{ i, x, y, z, fs, fw }]
  function applyLayout(entries) {
    for (var k = 0; k < entries.length; k++) {
      var e = entries[k];
      var el = items[e.i];
      itemBasePos[e.i] = { x: e.x, y: e.y, z: e.z };
      el.style.transform = 'translate3d(' + e.x.toFixed(0) + 'px, ' + e.y.toFixed(0) + 'px, ' + e.z + 'px) translate(-50%, -50%)';
      el.dataset.z = String(e.z);
      el.querySelector('.d3-name').style.fontSize = e.fs.toFixed(1) + 'px';
      el.querySelector('.d3-name').style.fontWeight = e.fw || '400';
    }
  }

  // ═══════════════════════════════════════════
  // STRATEGIA 1: FIBONACCI SPIRAL (sezione aurea)
  // ═══════════════════════════════════════════
  function layoutFibonacci() {
    var sorted = DATA.map(function(d, i) { return { d: d, i: i }; })
      .sort(function(a, b) { return b.d.count - a.d.count; });

    var entries = [];
    for (var k = 0; k < sorted.length; k++) {
      var entry = sorted[k];
      var angle = k * GOLDEN_ANGLE;
      var radius = 200 * Math.sqrt(k + 0.5);
      entries.push({
        i: entry.i,
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        z: -k * 20,
        fs: Math.min(28, 12 + Math.log(1 + entry.d.count) * 2.5),
        fw: k < 5 ? '500' : '400'
      });
    }
    applyLayout(entries);
  }

  // ═══════════════════════════════════════════
  // STRATEGIA 2: THEMATIC CLUSTERS (piani Z)
  // ═══════════════════════════════════════════
  function layoutCluster() {
    var groups = {};
    CLUSTER_NAMES.forEach(function(c) { groups[c] = []; });
    DATA.forEach(function(d, i) {
      var cat = classifyProject(d.name);
      groups[cat].push({ d: d, i: i });
    });

    var entries = [];
    CLUSTER_NAMES.forEach(function(cat) {
      var group = groups[cat];
      if (!group.length) return;
      var baseZ = CLUSTER_Z[cat];
      group.sort(function(a, b) { return b.d.count - a.d.count; });

      for (var k = 0; k < group.length; k++) {
        var entry = group[k];
        var angle = k * GOLDEN_ANGLE;
        var radius = 160 * Math.sqrt(k + 0.5);
        entries.push({
          i: entry.i,
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius,
          z: baseZ - k * 15,
          fs: Math.min(24, 12 + Math.log(1 + entry.d.count) * 2),
          fw: k === 0 ? '500' : '400'
        });
      }
    });
    applyLayout(entries);
  }

  // ═══════════════════════════════════════════
  // STRATEGIA 3: ALPHABETICAL (griglia aurea)
  // ═══════════════════════════════════════════
  function layoutAlpha() {
    var sorted = DATA.map(function(d, i) { return { d: d, i: i }; })
      .sort(function(a, b) { return a.d.name.localeCompare(b.d.name); });

    var cols = Math.round(Math.sqrt(n * PHI));
    var cellW = 260;
    var cellH = cellW / PHI;
    var totalW = cols * cellW;
    var totalH = Math.ceil(n / cols) * cellH;

    var entries = [];
    for (var k = 0; k < sorted.length; k++) {
      var entry = sorted[k];
      var col = k % cols;
      var row = Math.floor(k / cols);
      entries.push({
        i: entry.i,
        x: -totalW / 2 + col * cellW + cellW / 2,
        y: -totalH / 2 + row * cellH + cellH / 2,
        z: -row * 80,
        fs: Math.min(22, 13 + Math.log(1 + entry.d.count) * 1.5),
        fw: '400'
      });
    }
    applyLayout(entries);
  }

  // ── LAYOUT SWITCH ──
  var currentLayout = 'alpha';
  var layoutFns = { fibonacci: layoutFibonacci, cluster: layoutCluster, alpha: layoutAlpha };

  window.switchLayout = function(name) {
    currentLayout = name;
    document.getElementById('hud-layout').textContent = name;
    ['fibonacci', 'cluster', 'alpha'].forEach(function(l) {
      document.getElementById('btn-' + l).classList.toggle('active', l === name);
    });
    // Transizione CSS temporanea per lo switch layout
    layoutTransitioning = true;
    for (var i = 0; i < n; i++) {
      items[i].style.transition = 'transform 1.2s cubic-bezier(0.16, 1, 0.3, 1), filter 0.6s ease, opacity 0.6s ease, font-size 0.8s ease';
      itemOffset[i].x = 0; itemOffset[i].y = 0;
      itemOffsetTarget[i].x = 0; itemOffsetTarget[i].y = 0;
    }
    layoutFns[name]();
    baseTarget.x = 0; baseTarget.y = 0; baseTarget.z = 0;
    hoverOffset.x = 0; hoverOffset.y = 0; hoverOffset.z = 0;
    focalTarget = 0;
    startAnimate();
    // Dopo la transizione, torna a rAF puro (no CSS transition su transform)
    setTimeout(function() {
      layoutTransitioning = false;
      for (var i = 0; i < n; i++) {
        items[i].style.transition = 'filter 0.6s ease, opacity 0.6s ease, font-size 0.8s ease';
      }
    }, 1300);
  };`;
}
