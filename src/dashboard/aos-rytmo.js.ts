/**
 * AOS (Action Operating System) + Rytmo Gestures + Design Tokens
 * Extracted from server.ts T4 tissue
 *
 * Exposes globally: window.AOS, window.applyTokens, window.toggleNight, window.renderRytmoPanel
 * Dependencies: addLog (from state.js), DOM elements
 */

export const aosJs = `
// ══════════════════════════════════════════════════════════════
// AOS — AlessioOS Action System (API interna, PTI-compatibile)
// Ogni azione: { name, label, fn, group, shortcut? }
// Swift bridge chiama: window.AOS.run('action.name')
// Rytmo mappa a: AOS config → azione double-tap
// ══════════════════════════════════════════════════════════════
var AOS = (function() {
  var _actions = {};
  var _config = {
    rytmoGap: 400,
    rytmoMappings: [
      { taps: 2, action: 'stt.toggle' },
      { taps: 3, action: 'stt.stop_send' },
    ],
  };

  // Load persisted config
  var saved = store.load('alessio-os-aos');
  if (saved) {
    if (saved.rytmoGap) _config.rytmoGap = saved.rytmoGap;
    if (Array.isArray(saved.rytmoMappings)) _config.rytmoMappings = saved.rytmoMappings;
  }

  function register(name, label, fn, group) {
    _actions[name] = { name: name, label: label, fn: fn, group: group || 'app' };
  }

  function run(name, params) {
    var a = _actions[name];
    if (!a) {
      if (typeof addLog === 'function') addLog('[AOS] azione sconosciuta: ' + name, 'error');
      return false;
    }
    if (typeof addLog === 'function') addLog('[AOS] ' + name, 'dim');
    try { a.fn(params); } catch(e) {
      if (typeof addLog === 'function') addLog('[AOS] errore: ' + e.message, 'error');
    }
    return true;
  }

  function list() { return Object.values(_actions); }
  function groups() {
    var g = {};
    Object.values(_actions).forEach(function(a) {
      if (!g[a.group]) g[a.group] = [];
      g[a.group].push(a);
    });
    return g;
  }

  function save() {
    store.save('alessio-os-aos', _config);
  }

  function setConfig(key, value) { _config[key] = value; save(); }
  function getConfig(key) { return _config[key]; }

  // Rytmo: resolve tap count → action name
  function rytmoResolve(tapCount) {
    var m = _config.rytmoMappings || [];
    for (var i = 0; i < m.length; i++) { if (m[i].taps === tapCount) return m[i].action; }
    return null;
  }

  // Rytmo: set mapping
  function rytmoSet(tapCount, actionName) {
    var m = _config.rytmoMappings || [];
    var found = false;
    for (var i = 0; i < m.length; i++) {
      if (m[i].taps === tapCount) {
        if (actionName) m[i].action = actionName;
        else m.splice(i, 1);
        found = true; break;
      }
    }
    if (!found && actionName) {
      m.push({ taps: tapCount, action: actionName });
      m.sort(function(a, b) { return a.taps - b.taps; });
    }
    _config.rytmoMappings = m;
    save();
  }

  // Rytmo: add a new mapping slot
  function rytmoAdd(tapCount, actionName) {
    rytmoSet(tapCount, actionName);
  }

  // Rytmo: remove mapping
  function rytmoRemove(tapCount) {
    rytmoSet(tapCount, null);
  }

  return {
    register: register,
    run: run,
    list: list,
    groups: groups,
    config: { set: setConfig, get: getConfig },
    rytmo: {
      resolve: rytmoResolve,
      set: rytmoSet,
      add: rytmoAdd,
      remove: rytmoRemove,
      mappings: function() { return _config.rytmoMappings; },
      gap: function(v) { if (v !== undefined) { _config.rytmoGap = v; save(); } return _config.rytmoGap; },
    },
    _actions: _actions,
    _config: _config,
  };
})();

// Expose globally for Swift bridge
window.AOS = AOS;


// ── PTI PROBE ──
function toggleProbe() {
  var html = document.documentElement;
  html.classList.toggle('pti-probe');
  var on = html.classList.contains('pti-probe');

  if (on) {
    // Set data-probe labels on key areas
    var areas = {
      'header': 'header — --fs-body, --s4, --s5',
      '.sidebar': 'sidebar — --fs-sm, --fs-2xs, --s4',
      '.main': 'main — --fs-body',
      '.terminal-panel': 'terminal — --fs-sm, --mono',
      '.breadcrumb': 'breadcrumb — --fs-sm, --mono',
      '.drop-zone': 'drop-zone — --fs-sm, --s4',
    };
    Object.keys(areas).forEach(function(sel) {
      var el = document.querySelector(sel);
      if (el) {
        el.style.position = el.style.position || 'relative';
        el.setAttribute('data-probe', areas[sel]);
      }
    });
    // Messages get labels too
    document.querySelectorAll('.msg').forEach(function(m, i) {
      m.style.position = 'relative';
      m.setAttribute('data-probe', 'msg — --fs-body, --fs-xs');
    });

    // Render probe bar with current token values
    updateProbeBar();
  } else {
    document.querySelectorAll('[data-probe]').forEach(function(el) {
      el.removeAttribute('data-probe');
    });
    document.getElementById('pti-probe-bar').innerHTML = '';
  }
}

function updateProbeBar() {
  var r = getComputedStyle(document.documentElement);
  var tokens = ['--font','--mono','--fs-2xs','--fs-xs','--fs-sm','--fs-body','--fs-lg','--fs-xl',
    '--s1','--s2','--s3','--s4','--s5','--s6','--s7'];
  var bar = document.getElementById('pti-probe-bar');
  bar.innerHTML = tokens.map(function(t) {
    return '<span>' + t + '=<strong>' + r.getPropertyValue(t).trim() + '</strong></span>';
  }).join('');
}

// ── AOS: REGISTER CORE ACTIONS ──
(function registerCoreActions() {
  // --- App ---
  AOS.register('app.reload', 'Ricarica pagina', function() {
    location.reload();
  }, 'app');
  AOS.register('app.send', 'Invia comando', function() {
    sendCommand();
  }, 'app');
  AOS.register('app.home', 'Vai a Home', function() {
    goHome();
  }, 'app');

  // --- STT ---
  AOS.register('stt.toggle', 'Toggle STT', function() {
    toggleMic();
  }, 'stt');
  AOS.register('stt.stop_send', 'Stop STT + Invia', function() {
    // If recording, stop and send immediately after text is captured
    if (typeof speechActive !== 'undefined' && speechActive) {
      speechActive = false;
      if (speechRec) speechRec.stop();
      // Wait for onend to populate input, then send
      setTimeout(function() { sendCommand(); }, 300);
    } else {
      // Not recording — just send what's in the input
      sendCommand();
    }
  }, 'stt');

  // --- View ---
  AOS.register('view.chat', 'Vista Chat', function() { switchView('chat'); }, 'view');
  AOS.register('view.timeline', 'Vista Timeline', function() { switchView('timeline'); }, 'view');
  AOS.register('view.agents', 'Vista Agenti', function() { switchView('agents'); }, 'view');
  AOS.register('view.tasks', 'Vista Tasks', function() { switchView('tasks'); }, 'view');
  AOS.register('view.kb', 'Vista Knowledge Base', function() { switchView('kb'); }, 'view');
  AOS.register('view.mcp', 'Vista MCP', function() { switchView('mcp'); }, 'view');
  AOS.register('view.graph', 'Vista PTI Graph', function() { switchView('graph'); }, 'view');

  // --- Terminal ---
  AOS.register('terminal.toggle', 'Toggle Terminal', function() {
    toggleTerminal();
  }, 'terminal');

  // --- Design ---
  AOS.register('design.tokens', 'Apri Design Tokens', function() {
    document.getElementById('typo-popover').classList.add('open');
  }, 'design');
  AOS.register('design.night', 'Toggle Night Mode', function() {
    toggleNight();
  }, 'design');
  AOS.register('design.probe', 'Toggle PTI Probe', function() {
    toggleProbe();
  }, 'design');

  // --- Debug ---
  AOS.register('debug.toggle', 'Toggle Debug Panel', function() {
    toggleDebug();
  }, 'debug');
  AOS.register('debug.state', 'Log stato AOS', function() {
    var actions = AOS.list();
    if (typeof addLog === 'function') {
      addLog('[AOS] ' + actions.length + ' azioni registrate:', 'event');
      var groups = AOS.groups();
      Object.keys(groups).forEach(function(g) {
        addLog('  ' + g + ': ' + groups[g].map(function(a) { return a.name; }).join(', '), 'dim');
      });
      // Log rytmo mappings
      var mappings = AOS.rytmo.mappings();
      addLog('  rytmo (' + AOS.rytmo.gap() + 'ms):', 'dim');
      mappings.forEach(function(m) {
        addLog('    ' + m.taps + '-tap → ' + m.action, 'dim');
      });
    }
  }, 'debug');

  // --- Rytmo config ---
  AOS.register('rytmo.config', 'Apri Rytmo Config', function() {
    renderRytmoPanel();
    document.getElementById('typo-popover').classList.add('open');
  }, 'rytmo');
})();

// ── RYTMO CONFIG PANEL ──
function renderRytmoPanel() {
  var panel = document.getElementById('rytmo-panel');
  var mappings = AOS.rytmo.mappings();
  var actions = AOS.list();

  var html = '';
  mappings.forEach(function(m, idx) {
    html += '<div class="rytmo-row">';
    html += '<input type="number" class="rytmo-taps" min="2" max="6" value="' + m.taps + '" onchange="rytmoUpdateTaps(' + idx + ', this.value)">';
    html += '<select onchange="rytmoUpdateAction(' + idx + ', this.value)">';
    actions.forEach(function(a) {
      var sel = (a.name === m.action) ? ' selected' : '';
      html += '<option value="' + a.name + '"' + sel + '>' + a.name + '</option>';
    });
    html += '</select>';
    html += '<button class="rytmo-del" onclick="rytmoDeleteSlot(' + idx + ')">\\u00d7</button>';
    html += '</div>';
  });

  panel.innerHTML = html;

  // Update gap slider
  var gapEl = document.getElementById('rytmo-gap');
  var gapVal = document.getElementById('rytmo-gap-val');
  if (gapEl) { gapEl.value = AOS.rytmo.gap(); }
  if (gapVal) { gapVal.textContent = AOS.rytmo.gap() + 'ms'; }
}

function rytmoUpdateTaps(idx, newTaps) {
  var mappings = AOS.rytmo.mappings();
  var m = mappings[idx];
  if (!m) return;
  AOS.rytmo.remove(m.taps);
  AOS.rytmo.set(parseInt(newTaps), m.action);
  renderRytmoPanel();
}

function rytmoUpdateAction(idx, newAction) {
  var mappings = AOS.rytmo.mappings();
  var m = mappings[idx];
  if (!m) return;
  AOS.rytmo.set(m.taps, newAction);
}

function rytmoDeleteSlot(idx) {
  var mappings = AOS.rytmo.mappings();
  var m = mappings[idx];
  if (!m) return;
  AOS.rytmo.remove(m.taps);
  renderRytmoPanel();
}

function rytmoAddSlot() {
  var mappings = AOS.rytmo.mappings();
  // Find next unused tap count
  var used = {};
  mappings.forEach(function(m) { used[m.taps] = true; });
  var next = 2;
  while (used[next]) next++;
  if (next > 6) return; // max 6 taps
  AOS.rytmo.set(next, 'app.home');
  renderRytmoPanel();
}

function rytmoGapChange() {
  var v = parseInt(document.getElementById('rytmo-gap').value);
  AOS.rytmo.gap(v);
  document.getElementById('rytmo-gap-val').textContent = v + 'ms';
}

// Init Rytmo panel on first popover open
(function() {
  var observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(mut) {
      if (mut.target.classList && mut.target.classList.contains('open')) {
        renderRytmoPanel();
      }
    });
  });
  var pop = document.getElementById('typo-popover');
  if (pop) observer.observe(pop, { attributes: true, attributeFilter: ['class'] });
})();

// ── RYTMO: GESTURE → AOS ACTION (N-tap mapping) ──
(function initRytmo() {
  var taps = [];
  var tapTimer = null;

  document.getElementById('chat-view').addEventListener('pointerup', function(e) {
    if (e.target.closest('textarea, button, input, a, select')) return;

    taps.push(Date.now());
    clearTimeout(tapTimer);

    var gap = AOS.rytmo.gap();
    tapTimer = setTimeout(function() {
      var now = Date.now();
      var recent = taps.filter(function(t) { return now - t < gap * 2; });
      taps = [];

      if (recent.length < 2) return;

      // Find highest matching tap count (greedy: 4-tap wins over 3-tap)
      var tapCount = recent.length;
      var action = null;
      while (tapCount >= 2 && !action) {
        action = AOS.rytmo.resolve(tapCount);
        if (!action) tapCount--;
      }

      if (action) {
        AOS.run(action);
        // Visual feedback
        var dz = document.getElementById('drop-zone');
        dz.style.borderColor = 'var(--accent)';
        setTimeout(function() { dz.style.borderColor = ''; }, 600);
      }
    }, gap);
  });
})();


// ── THEME SYSTEM ──
var THEME_CLASSES = ['night', 'primavera', 'estate', 'ellenica', 'benessere'];

function applyTheme(val) {
  var theme = val || fieldVal('theme-select') || 'default';
  var root = document.documentElement;
  // Batch class swap in single rAF to prevent intermediate flash
  requestAnimationFrame(function() {
    THEME_CLASSES.forEach(function(c) { root.classList.remove(c); });
    if (theme !== 'default') root.classList.add(theme);
    // Sync granim immediately (same paint frame)
    applyGranim();
  });
  store.save('alessio-os-theme', theme);
}
// Legacy: keep toggleNight for backward compat (mapped in AOS)
function toggleNight() {
  var cur = store.load('alessio-os-theme') || 'default';
  applyTheme(cur === 'night' ? 'default' : 'night');
  setField('theme-select', cur === 'night' ? 'default' : 'night');
}
(function initTheme() {
  var saved = store.load('alessio-os-theme');
  // Migrate from old night-only store
  if (!saved && store.load('alessio-os-night')) saved = 'night';
  if (saved && saved !== 'default') {
    setField('theme-select', saved);
    applyTheme(saved);
  }
})();

// ── DESIGN TOKENS (PTI fatto → cascata CSS) ──
// Spacing scale presets
const SPACING_SCALES = {
  phi:     [8, 13, 21, 34, 55, 89, 144],
  compact: [4, 8, 12, 16, 24, 32, 48],
  relaxed: [8, 16, 24, 32, 48, 64, 96],
};

function toggleTypoMenu() {
  document.getElementById('typo-popover').classList.toggle('open');
}
document.addEventListener('click', function(e) {
  const pop = document.getElementById('typo-popover');
  if (pop.classList.contains('open') && !e.target.closest('.typo-popover') && !e.target.closest('.typo-gear')) {
    pop.classList.remove('open');
  }
});

function applyTokens() {
  const r = document.documentElement.style;
  const font = fieldVal('typo-font');
  const mono = fieldVal('typo-mono');
  const size = parseFloat(fieldVal('typo-size'));
  const lh = fieldVal('typo-lh');
  const weight = fieldVal('typo-weight');
  const tracking = fieldVal('typo-tracking');
  const spacingKey = fieldVal('typo-spacing');
  const scale = SPACING_SCALES[spacingKey] || SPACING_SCALES.phi;

  // PTI: fatto → derivati CSS custom properties → cascata a tutto il DOM
  r.setProperty('--font', font);
  r.setProperty('--mono', mono);
  r.setProperty('--s1', scale[0] + 'px');
  r.setProperty('--s2', scale[1] + 'px');
  r.setProperty('--s3', scale[2] + 'px');
  r.setProperty('--s4', scale[3] + 'px');
  r.setProperty('--s5', scale[4] + 'px');
  r.setProperty('--s6', scale[5] + 'px');
  r.setProperty('--s7', scale[6] + 'px');

  // Type scale: derive all sizes from base
  var fs2xs = Math.round(size * 0.6 * 10) / 10;   // ~9px @ 15
  var fsXs  = Math.round(size * 0.667 * 10) / 10;  // ~10px @ 15
  var fsSm  = Math.round(size * 0.767 * 10) / 10;  // ~11.5px @ 15
  var fsBody = Math.round(size * 0.933 * 10) / 10;  // ~14px @ 15
  var fsLg  = Math.round(size * 1.2 * 10) / 10;    // ~18px @ 15
  var fsXl  = Math.round(size * 1.467 * 10) / 10;   // ~22px @ 15

  r.setProperty('--fs-base', size + 'px');
  r.setProperty('--fs-2xs', fs2xs + 'px');
  r.setProperty('--fs-xs', fsXs + 'px');
  r.setProperty('--fs-sm', fsSm + 'px');
  r.setProperty('--fs-body', fsBody + 'px');
  r.setProperty('--fs-lg', fsLg + 'px');
  r.setProperty('--fs-xl', fsXl + 'px');

  // Body-level tokens
  document.body.style.fontSize = size + 'px';
  document.body.style.fontFamily = font;
  document.body.style.lineHeight = lh;
  document.body.style.fontWeight = weight;
  document.body.style.letterSpacing = tracking;
  r.setProperty('--tracking', tracking);

  // Update display
  document.getElementById('typo-size-val').textContent = size + 'px';

  // Persist all tokens
  store.save('alessio-os-tokens', { font, mono, size, lh, weight, tracking, spacing: spacingKey });

  // Update probe bar if active
  if (document.documentElement.classList.contains('pti-probe')) {
    updateProbeBar();
  }
}

// Load saved tokens on init
(function loadTokens() {
  const t = store.load('alessio-os-tokens');
  if (!t) return;
  if (t.font) setField('typo-font', t.font);
  if (t.mono) setField('typo-mono', t.mono);
  if (t.size) setField('typo-size', t.size);
  if (t.lh) setField('typo-lh', t.lh);
  if (t.weight) setField('typo-weight', t.weight);
  if (t.tracking) setField('typo-tracking', t.tracking);
  if (t.spacing) setField('typo-spacing', t.spacing);
  applyTokens();
})();

// ── CHAT FONT SCOPING ──
function applyChatFont() {
  var chatView = document.getElementById('chat-view');
  var font = fieldVal('chat-font-select');
  var size = fieldVal('chat-size-select');
  chatView.style.setProperty('--chat-font', font);
  chatView.style.setProperty('--chat-size', size || 'inherit');
  store.save('alessio-os-chat-font', { font: font, size: size });
}
(function loadChatFont() {
  var c = store.load('alessio-os-chat-font');
  if (!c) return;
  if (c.font) setField('chat-font-select', c.font);
  if (c.size) setField('chat-size-select', c.size);
  applyChatFont();
})();

// ── GRANIM AMBIENT GRADIENT ──
// Granim uses SATURATED colors — the actual tinting comes from
// low opacity + mix-blend-mode on the canvas, not from pale colors.
// Palette = pure hue pairs that blend via soft-light at 5-30% opacity.
var GRANIM_PALETTES_UNIVERSAL = {
  warm:  [['#D4A050', '#C88040'], ['#C88040', '#D4A050']],
  cool:  [['#4080C0', '#3068A8'], ['#3068A8', '#5090D0']],
  earth: [['#508040', '#607830'], ['#607830', '#408838']],
  rose:  [['#C06880', '#B85070'], ['#B85070', '#D07888']],
};
var granimInstance = null;

function applyGranim() {
  var palette = fieldVal('granim-palette');
  var opacity = parseInt(fieldVal('granim-opacity'), 10);
  document.getElementById('granim-opacity-val').textContent = opacity + '%';
  document.documentElement.style.setProperty('--granim-opacity', (opacity / 100).toFixed(2));

  var canvas = document.getElementById('granim-canvas');
  if (!canvas) return;

  if (palette === 'off' || opacity === 0) {
    canvas.style.display = 'none';
    if (granimInstance) { granimInstance.destroy(); granimInstance = null; }
    store.save('alessio-os-granim', { palette: palette, opacity: opacity });
    return;
  }
  canvas.style.display = '';

  // Universal saturated colors — blend mode + opacity handle adaptation
  var colors = GRANIM_PALETTES_UNIVERSAL[palette];
  if (!colors) colors = GRANIM_PALETTES_UNIVERSAL.warm;

  if (granimInstance) { granimInstance.destroy(); granimInstance = null; }
  try {
    granimInstance = new Granim({
      element: '#granim-canvas',
      direction: 'diagonal',
      isPausedWhenNotInView: true,
      stateTransitionSpeed: 3000,
      states: { 'default-state': { gradients: colors, transitionSpeed: 7000 } }
    });
  } catch(e) { /* Granim not loaded */ }

  store.save('alessio-os-granim', { palette: palette, opacity: opacity });
}
(function initGranim() {
  var g = store.load('alessio-os-granim');
  if (g) {
    if (g.palette) setField('granim-palette', g.palette);
    if (g.opacity != null) setField('granim-opacity', g.opacity);
  }
  setTimeout(applyGranim, 100);
})();

// ── FULL CHAT MODE (Cmd+Shift+C) ──
var fullChatActive = false;
function toggleFullChat() {
  fullChatActive = !fullChatActive;
  document.body.classList.toggle('full-chat', fullChatActive);
  if (fullChatActive) switchView('chat');
}
document.addEventListener('keydown', function(e) {
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'C' || e.key === 'c' || e.code === 'KeyC')) {
    e.preventDefault();
    toggleFullChat();
  }
});

// ── GRANIM.JS GRADIENT ──
(function initGranim() {
  if (typeof Granim === 'undefined') return;
  try {
    new Granim({
      element: '#granim-canvas',
      direction: 'diagonal',
      isPausedWhenNotInView: true,
      stateTransitionSpeed: 1200,
      states: {
        'default-state': {
          gradients: [
            ['#F5E6D3', '#E8D5C4'],
            ['#E8D5C4', '#D4C4B0'],
            ['#D4C4B0', '#F0E0D0'],
            ['#F0E0D0', '#F5E6D3']
          ],
          transitionSpeed: 4000
        }
      }
    });
  } catch (err) { console.warn('[granim] init error:', err); }
})();
`;
