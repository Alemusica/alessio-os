/**
 * Terminal Tissue — PTI T5
 * Handles: log rendering, copy-to-clipboard, collapsible code blocks, terminal toggle
 *
 * Dependencies: S.logCount (from state.js — but only writes to DOM, not reads)
 * Provides: addLog, copyLog, addCodeBlock, toggleCodeBlock, copyCodeBlock, toggleTerminal, esc
 */

export const terminalJs = `
// ── TERMINAL TISSUE ──
var terminal = document.getElementById('terminal');
var COPY_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
var CHECK_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';

function esc(s) {
  var d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function addLog(text, cls) {
  S.logCount++;
  document.getElementById('log-count').textContent = S.logCount;
  var ts = new Date().toLocaleTimeString('it-IT', { hour12: false });
  var d = document.createElement('div');
  d.className = 'log-line';
  d.innerHTML = '<span class="ts">' + ts + '</span> ' +
    (cls ? '<span class="' + cls + '">' + text + '</span>' : text) +
    '<button class="log-copy" onclick="copyLog(this)" title="Copy">' + COPY_ICON + '</button>';
  terminal.appendChild(d);
  terminal.scrollTop = terminal.scrollHeight;
  while (terminal.children.length > 200) terminal.removeChild(terminal.firstChild);
}

function copyLog(btn) {
  var line = btn.parentElement;
  var spans = line.querySelectorAll('span:not(.ts)');
  var text = '';
  spans.forEach(function(s) { text += s.textContent; });
  if (!text) text = line.textContent;
  navigator.clipboard.writeText(text.trim()).then(function() {
    btn.innerHTML = CHECK_ICON;
    btn.classList.add('copied');
    setTimeout(function() {
      btn.innerHTML = COPY_ICON;
      btn.classList.remove('copied');
    }, 1500);
  });
}

function addCodeBlock(code, title) {
  S.logCount++;
  document.getElementById('log-count').textContent = S.logCount;
  var ts = new Date().toLocaleTimeString('it-IT', { hour12: false });
  var d = document.createElement('div');
  d.className = 'log-code';
  d.innerHTML = '<div class="log-code-header" onclick="toggleCodeBlock(this)">' +
    '<span class="ts">' + ts + '</span> ' +
    '<span class="log-code-chevron">&#x25B6;</span> ' +
    '<span class="agent-name">' + (title || 'output') + '</span>' +
    '<button class="log-copy" onclick="event.stopPropagation();copyCodeBlock(this)" title="Copy">' + COPY_ICON + '</button>' +
    '</div>' +
    '<div class="log-code-body"><pre><code>' + esc(code) + '</code></pre></div>';
  terminal.appendChild(d);
  terminal.scrollTop = terminal.scrollHeight;
  while (terminal.children.length > 200) terminal.removeChild(terminal.firstChild);
}

function toggleCodeBlock(header) {
  var body = header.nextElementSibling;
  var chevron = header.querySelector('.log-code-chevron');
  if (body.classList.contains('expanded')) {
    body.classList.remove('expanded');
    chevron.innerHTML = '&#x25B6;';
  } else {
    body.classList.add('expanded');
    chevron.innerHTML = '&#x25BC;';
  }
}

function copyCodeBlock(btn) {
  var block = btn.closest('.log-code');
  var code = block.querySelector('code');
  navigator.clipboard.writeText(code.textContent).then(function() {
    btn.innerHTML = CHECK_ICON;
    btn.classList.add('copied');
    setTimeout(function() {
      btn.innerHTML = COPY_ICON;
      btn.classList.remove('copied');
    }, 1500);
  });
}

function toggleTerminal() {
  var panel = document.getElementById('terminal-panel');
  var toggle = document.getElementById('tp-toggle');
  if (panel.classList.contains('collapsed')) {
    panel.classList.remove('collapsed');
    toggle.innerHTML = '&minus;';
  } else {
    panel.classList.add('collapsed');
    toggle.innerHTML = '+';
  }
}
`;
