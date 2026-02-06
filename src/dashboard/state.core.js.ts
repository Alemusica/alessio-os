/**
 * State Core — FATTI + Infrastruttura
 * SSE, sidebar, drag-drop, keyboard, resize
 *
 * FATTI: S object (state singleton)
 * SALTI: registered in initSalti() at end
 */

export const stateCoreJs = `
// ── STATE ──
const S = {
  view: 'chat',
  project: null,       // null = show all projects
  session: null,
  projects: [],        // from SSE
  logCount: 0,
};


// ── SEARCH BRIDGE (Swift wrapper Cmd+F) ──
window.alessioOSSearch = function(query) {
  const nav = document.getElementById('projects-nav');
  if (!nav) return;
  const buttons = nav.querySelectorAll('.nav-item[data-project]');
  const q = (query || '').toLowerCase();
  buttons.forEach(function(btn) {
    const name = (btn.getAttribute('data-project') || '').toLowerCase();
    btn.style.display = (!q || name.includes(q)) ? '' : 'none';
  });
};

// ── NATIVE BRIDGE (Swift ← JS) ──
window.alessioOSBridge = function(action, data) {
  if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.alessioOS) {
    window.webkit.messageHandlers.alessioOS.postMessage(Object.assign({ action: action }, data || {}));
  }
};

// ── SSE (with auto-reconnect) ──
var sse;
var sseRetries = 0;
function connectSSE() {
  sse = new EventSource('/events');
  sseRetries = 0;
  setupSSEListeners(sse);
}
function reconnectSSE() {
  sseRetries++;
  var delay = Math.min(1000 * Math.pow(1.5, sseRetries), 10000);
  setTimeout(connectSSE, delay);
}
connectSSE();

// ── SIDEBAR ORGANIC TOGGLE ──
var _sidebarRaf = 0;
var _sidebarShaderCtx = null;

function toggleSidebar() {
  var sb = document.getElementById('sidebar');
  var btn = document.getElementById('sidebar-toggle');
  if (!sb) return;
  var isOpen = !sb.classList.contains('sb-collapsed');
  if (isOpen) {
    sb.classList.add('sb-dissolving');
    if (btn) btn.classList.add('active');
    startSidebarShader('close');
    setTimeout(function() {
      sb.classList.add('sb-collapsed');
      sb.classList.remove('sb-dissolving');
    }, 400);
  } else {
    sb.classList.remove('sb-collapsed');
    if (btn) btn.classList.remove('active');
    startSidebarShader('open');
  }
}

function startSidebarShader(mode) {
  var canvas = document.getElementById('sidebar-shader');
  if (!canvas) return;
  var sb = document.getElementById('sidebar');
  canvas.width = sb.offsetWidth || 233;
  canvas.height = sb.offsetHeight || 600;
  if (!_sidebarShaderCtx) _sidebarShaderCtx = canvas.getContext('2d');
  var ctx = _sidebarShaderCtx;
  if (!ctx) return;

  if (_sidebarRaf) cancelAnimationFrame(_sidebarRaf);

  var start = performance.now();
  var duration = 400;

  function draw(now) {
    var elapsed = now - start;
    var progress = Math.min(elapsed / duration, 1);

    // Easing: cubic ease-out
    var ease = 1 - Math.pow(1 - progress, 3);
    var w = canvas.width;
    var h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Breathing pulse: continuous sine wave
    var breathe = Math.sin(now * 0.003) * 0.3 + 0.7;

    // Intensity based on mode + progress
    var intensity;
    if (mode === 'open') {
      intensity = ease * 0.15 * breathe;
    } else {
      intensity = (1 - ease) * 0.25 * breathe;
    }

    // Radial gradient — organic red membrane from right edge
    var cx = w * 0.85;
    var cy = h * 0.4;
    var radius = Math.max(w, h) * 0.9;
    var grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0, 'rgba(139, 32, 32, ' + intensity + ')');
    grad.addColorStop(0.4, 'rgba(139, 32, 32, ' + (intensity * 0.5) + ')');
    grad.addColorStop(1, 'rgba(139, 32, 32, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Second organic blob — lower left, subtler
    var cx2 = w * 0.2;
    var cy2 = h * 0.7;
    var radius2 = Math.max(w, h) * 0.6;
    var breathe2 = Math.sin(now * 0.002 + 1.5) * 0.2 + 0.5;
    var int2 = intensity * 0.4 * breathe2;
    var grad2 = ctx.createRadialGradient(cx2, cy2, 0, cx2, cy2, radius2);
    grad2.addColorStop(0, 'rgba(160, 40, 40, ' + int2 + ')');
    grad2.addColorStop(1, 'rgba(160, 40, 40, 0)');
    ctx.fillStyle = grad2;
    ctx.fillRect(0, 0, w, h);

    // Continue breathing loop after transition completes (open mode only)
    if (mode === 'open' || progress < 1) {
      _sidebarRaf = requestAnimationFrame(draw);
    } else {
      _sidebarRaf = 0;
      ctx.clearRect(0, 0, w, h);
    }
  }

  _sidebarRaf = requestAnimationFrame(draw);
}

// Auto-start breathing on load
setTimeout(function() { startSidebarShader('open'); }, 300);

// ── DRAG AND DROP ──
const dropZone = document.getElementById('drop-zone');

document.body.addEventListener('dragover', function(e) {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
document.body.addEventListener('dragleave', function(e) {
  if (!e.relatedTarget || e.relatedTarget === document.documentElement) {
    dropZone.classList.remove('drag-over');
  }
});
dropZone.addEventListener('dragover', function(e) { e.preventDefault(); });
dropZone.addEventListener('drop', function(e) {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  handleFiles(Array.from(e.dataTransfer.files));
});
document.getElementById('file-input').addEventListener('change', function(e) {
  handleFiles(Array.from(e.target.files));
  e.target.value = '';
});

// ── AUTO-RESIZE TEXTAREA ──
function resizeInput(el) {
  el.style.height = '34px';
  var maxH = Math.min(window.innerHeight * 0.5, 400);
  el.style.height = Math.min(el.scrollHeight, maxH) + 'px';
}

// Auto-resize listeners (resizeInput definito sopra, prima di STT)
var cmdInput = document.getElementById('cmd-input');
cmdInput.addEventListener('input', function() { resizeInput(this); });
cmdInput.addEventListener('paste', function() {
  var self = this;
  setTimeout(function() { resizeInput(self); }, 0);
});

// ── ORGANIC SCROLL GLOW — on inner scrollable blocks (code, msg-body) ──
var _glowTimers = new WeakMap();
function attachScrollGlow(el) {
  if (_glowTimers.has(el)) return;
  _glowTimers.set(el, null);
  el.addEventListener('scroll', function() {
    el.classList.add('scrolling');
    var prev = _glowTimers.get(el);
    if (prev) clearTimeout(prev);
    _glowTimers.set(el, setTimeout(function() {
      el.classList.remove('scrolling');
      _glowTimers.set(el, null);
    }, 800));
  }, { passive: true });
}
// Attach to existing + observe new ones (messages load dynamically)
new MutationObserver(function(muts) {
  muts.forEach(function(m) {
    m.addedNodes.forEach(function(n) {
      if (n.nodeType !== 1) return;
      if (n.classList && (n.classList.contains('md-code') || n.classList.contains('msg-body'))) {
        attachScrollGlow(n);
      }
      if (n.querySelectorAll) {
        n.querySelectorAll('.md-code, .msg-body').forEach(attachScrollGlow);
      }
    });
  });
}).observe(document.body, { childList: true, subtree: true });
document.querySelectorAll('.md-code, .msg-body').forEach(attachScrollGlow);

// ── SHIFT+ARROW VIEW NAVIGATION ──
var VIEW_ORDER = ['chat', 'timeline', 'agents', 'tasks', 'kb', 'github', 'mcp', 'graph'];
document.addEventListener('keydown', function(e) {
  if (!e.shiftKey) return;
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  // Don't intercept if focus is in an input/textarea
  var tag = document.activeElement && document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  e.preventDefault();
  var idx = VIEW_ORDER.indexOf(S.view);
  if (idx === -1) idx = 0;
  if (e.key === 'ArrowRight') idx = (idx + 1) % VIEW_ORDER.length;
  else idx = (idx - 1 + VIEW_ORDER.length) % VIEW_ORDER.length;
  switchView(VIEW_ORDER[idx]);
});

// ── RESTART SERVER ──
function restartServer() {
  if (!confirm('Riavviare il server?')) return;
  addLog('[server] Riavvio richiesto...', 'event');
  apiCall('/api/restart', { method: 'POST' }).catch(function() {});
  setTimeout(function() { location.reload(); }, 2000);
}

// ── SALTI MAP — propagazione esplicita ──
function initSalti() {
  // S.project → breadcrumb
  registraSalto('S.project', updateBreadcrumb);
  // S.project → sidebar active state
  registraSalto('S.project', function(name) {
    document.querySelectorAll('[data-project]').forEach(function(b) {
      b.classList.toggle('active', b.dataset.project === name);
    });
  });
  // S.project → Swift bridge title bar
  registraSalto('S.project', function(name) {
    alessioOSBridge('setTitle', { title: name || 'Alessio OS' });
  });
  // S.project → auto-switch PTI Graph
  registraSalto('S.project', function(name) {
    var graphSelect = document.getElementById('graph-project-select');
    if (!graphSelect) return;
    var found = false;
    for (var i = 0; i < graphSelect.options.length; i++) {
      if (graphSelect.options[i].value === name) { found = true; break; }
    }
    graphSelect.value = found ? name : '';
    if (typeof GraphRenderer !== 'undefined' && GraphRenderer.load) {
      GraphRenderer.load(found ? name : '');
    }
  });
  // S.session → breadcrumb
  registraSalto('S.session', updateBreadcrumb);
}
initSalti();
`;
