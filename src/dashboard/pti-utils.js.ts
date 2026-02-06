/**
 * PTI Utils — Nodi atomici riusabili
 * Livello: atomo (0 dipendenze interne)
 *
 * Ogni utility è un nodo PTI puro:
 *   - Riceve contesto alla chiamata (dinamismo)
 *   - Nessuno stato interno
 *   - Nome descrive il cosa, parametri il dove
 */

export const ptiUtilsJs = `
// ── PTI UTILS — Nodi atomici ──

/** Fetch JSON con error handling unificato */
function apiCall(url, opts) {
  return fetch(url, opts || {}).then(function(r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }).catch(function(err) {
    if (typeof addLog === 'function') addLog('[api] ' + url + ' — ' + err, 'error');
    throw err;
  });
}

/** Scroll un elemento al fondo */
function scrollToBottom(elementId, delay) {
  setTimeout(function() {
    var el = document.getElementById(elementId);
    if (el) el.scrollTop = el.scrollHeight;
  }, delay || 50);
}

/** Stato vuoto — messaggio placeholder */
function emptyState(msg) {
  return '<div class="empty">' + esc(msg) + '</div>';
}

/** Render lista: dati → HTML via template, con fallback vuoto */
function renderList(elementId, items, templateFn, emptyMsg) {
  var el = document.getElementById(elementId);
  if (!el) return;
  el.innerHTML = items.length ? items.map(templateFn).join('') : emptyState(emptyMsg || 'Nessun elemento');
}

/** Toggle panel (classList.toggle) */
function togglePanel(elementId, cls) {
  var el = document.getElementById(elementId);
  if (el) el.classList.toggle(cls || 'open');
}

/** localStorage: nodo unico save/load */
var store = {
  save: function(key, data) { localStorage.setItem(key, JSON.stringify(data)); },
  load: function(key) { try { var r = localStorage.getItem(key); return r ? JSON.parse(r) : null; } catch(e) { return null; } }
};

/** Mostra/nascondi elemento per ID */
function showEl(id, visible) {
  var el = document.getElementById(id);
  if (el) el.style.display = visible === false ? 'none' : '';
}

/** Set active class su un gruppo di elementi */
function setActive(selector, matchId, cls) {
  cls = cls || 'active';
  document.querySelectorAll(selector).forEach(function(el) {
    el.classList.toggle(cls, el.dataset.id === matchId || el.dataset.view === matchId);
  });
}

/** Timestamp formattato (it-IT) */
function fmtTime(date, mode) {
  var opts;
  if (mode === 'time') opts = { hour: '2-digit', minute: '2-digit' };
  else if (mode === 'date') opts = { day: '2-digit', month: 'short', year: 'numeric' };
  else opts = { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' };
  return new Date(date).toLocaleString('it-IT', opts);
}

/** Attach click handler a tutti gli elementi di un selector */
function onClickAll(selector, handler) {
  document.querySelectorAll(selector).forEach(function(el) {
    el.addEventListener('click', function() { handler(el); });
  });
}

/** Leggi valore di un campo */
function fieldVal(id) { var el = document.getElementById(id); return el ? el.value : ''; }

/** Imposta valore di un campo */
function setField(id, val) { var el = document.getElementById(id); if (el) el.value = val; }

/** SSE event parser con default */
function parseSSE(e, fallback) {
  try { return JSON.parse(e.data); } catch(err) { return fallback || {}; }
}

// ── PTI INFRASTRUTTURA — assert, SALTI, propaga ──

/** Assert PTI — guardia strutturale, non-throwing (log + console.error) */
function assert(cond, msg) {
  if (!cond) {
    var error = '[PTI assert] ' + (msg || 'assertion failed');
    if (typeof addLog === 'function') addLog(error, 'error');
    console.error(error);
  }
}

/** SALTI — mappa esplicita di propagazione */
var SALTI = {};

/** Registra un salto: quando nodo cambia, chiama fn */
function registraSalto(nodo, fn) {
  if (!SALTI[nodo]) SALTI[nodo] = [];
  SALTI[nodo].push(fn);
}

/** Propaga delta attraverso la mappa SALTI */
function propaga(nodo, delta) {
  var fns = SALTI[nodo] || [];
  for (var i = 0; i < fns.length; i++) {
    try { fns[i](delta); } catch (e) {
      if (typeof addLog === 'function') addLog('[propaga] ' + nodo + ' errore: ' + e, 'error');
    }
  }
}
`;
