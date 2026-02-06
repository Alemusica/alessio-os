/**
 * State Chat — Markdown rendering + chat bubbles + thinking stream
 * highlightSyntax, renderMd, appendChatBubble, thinking UI
 */

export const stateChatJs = `
// ── MARKDOWN RENDERER — Swiss Typography + Syntax Highlighting ──

/** Minimal syntax highlighter for code blocks */
function highlightSyntax(code, lang) {
  // Diff highlighting
  if (lang === 'diff' || code.indexOf('+++ ') > -1 && code.indexOf('--- ') > -1) {
    return code.split('\\n').map(function(line, i) {
      var num = '<span class="line-num">' + (i + 1) + '</span>';
      if (line.indexOf('@@') === 0) return '<span class="diff-hunk">' + num + line + '</span>';
      if (line.indexOf('+') === 0 && line.indexOf('+++') !== 0) return '<span class="diff-add">' + num + line + '</span>';
      if (line.indexOf('-') === 0 && line.indexOf('---') !== 0) return '<span class="diff-del">' + num + line + '</span>';
      return num + line;
    }).join('\\n');
  }
  // General syntax tokens
  var lines = code.split('\\n');
  return lines.map(function(line, i) {
    var num = '<span class="line-num">' + (i + 1) + '</span>';
    var h = line;
    // Comments (// and #)
    h = h.replace(new RegExp('(\\/\\/.*$)', 'gm'), '<span class="tok-cmt">$1</span>');
    h = h.replace(new RegExp('(#.*$)', 'gm'), '<span class="tok-cmt">$1</span>');
    // Strings
    h = h.replace(new RegExp("('(?:[^'\\\\\\\\]|\\\\\\\\.)*')", 'g'), '<span class="tok-str">$1</span>');
    h = h.replace(new RegExp('("(?:[^"\\\\\\\\]|\\\\\\\\.)*")', 'g'), '<span class="tok-str">$1</span>');
    // Numbers
    h = h.replace(new RegExp('\\\\b(\\\\d+\\\\.?\\\\d*)\\\\b', 'g'), '<span class="tok-num">$1</span>');
    // Keywords
    h = h.replace(new RegExp('\\\\b(const|let|var|function|class|import|export|from|return|if|else|for|while|async|await|new|this|type|interface|enum|struct|func|def|self|fn|pub|mut|use|mod)\\\\b', 'g'), '<span class="tok-kw">$1</span>');
    // Types
    h = h.replace(new RegExp('\\\\b(string|number|boolean|void|null|undefined|any|never|String|Int|Bool|Float|Array|Promise|Record)\\\\b', 'g'), '<span class="tok-type">$1</span>');
    return num + h;
  }).join('\\n');
}

function renderMd(text) {
  var BT = String.fromCharCode(96); // backtick
  var BT3 = BT + BT + BT;
  var html = esc(text);
  // Code blocks — with syntax highlighting + line numbers
  var cbRe = new RegExp(BT3 + '(\\\\w*)\\n([\\\\s\\\\S]*?)' + BT3, 'g');
  html = html.replace(cbRe, function(_, lang, code) {
    var highlighted = highlightSyntax(code.trim(), lang);
    var langLabel = lang ? '<span class="md-h3" style="margin:0 0 4px;font-size:9px">' + lang.toUpperCase() + '</span>' : '';
    return langLabel + '<pre class="md-code"><code>' + highlighted + '</code></pre>';
  });
  // Inline code
  var icRe = new RegExp(BT + '([^' + BT + ']+)' + BT, 'g');
  html = html.replace(icRe, '<code class="md-inline">$1</code>');
  // Bold + Italic — use [*] character class (literal * in regex, no escaping issues)
  html = html.replace(new RegExp('[*][*]([^*]+)[*][*]', 'g'), '<strong>$1</strong>');
  html = html.replace(new RegExp('[*]([^*]+)[*]', 'g'), '<em>$1</em>');
  // Headers
  html = html.replace(new RegExp('^### (.+)$', 'gm'), '<div class="md-h3">$1</div>');
  html = html.replace(new RegExp('^## (.+)$', 'gm'), '<div class="md-h2">$1</div>');
  html = html.replace(new RegExp('^# (.+)$', 'gm'), '<div class="md-h1">$1</div>');
  // Tables (pipe-delimited)
  html = html.replace(new RegExp('((?:^\\\\|.+\\\\|\\n?)+)', 'gm'), function(block) {
    var rows = block.trim().split('\\n').filter(function(r) { return r.trim(); });
    if (rows.length < 2) return block;
    // Skip separator row (|---|---|)
    var isHeader = true;
    var out = '<table style="border-collapse:collapse;width:100%;font-size:var(--fs-sm);margin:var(--s1) 0">';
    for (var ri = 0; ri < rows.length; ri++) {
      var row = rows[ri].trim();
      if (row.match(/^\\|[\\s\\-:]+\\|$/)) { isHeader = false; continue; }
      var cells = row.split('|').filter(function(c,i,a) { return i > 0 && i < a.length - 1; });
      var tag = (ri === 0) ? 'th' : 'td';
      out += '<tr>' + cells.map(function(c) {
        return '<' + tag + ' style="padding:var(--s1) var(--s2);border-bottom:1px solid var(--border);text-align:left;font-weight:' + (tag === 'th' ? '500' : '300') + '">' + c.trim() + '</' + tag + '>';
      }).join('') + '</tr>';
    }
    out += '</table>';
    return out;
  });
  // Numbered lists
  html = html.replace(new RegExp('^(\\\\d+)\\\\.\\\\s+(.+)$', 'gm'), '<div class="md-li" style="padding-left:var(--s4)"><span style="position:absolute;left:0;color:var(--dim);font-family:var(--mono);font-size:var(--fs-2xs)">$1.</span>$2</div>');
  // Unordered list items
  html = html.replace(new RegExp('^- (.+)$', 'gm'), '<div class="md-li">$1</div>');
  // Horizontal rule
  html = html.replace(new RegExp('^---$', 'gm'), '<hr class="md-hr">');
  // Line breaks
  html = html.replace(new RegExp('\\n', 'g'), '<br>');
  return html;
}

// ── CHAT BUBBLE HELPERS ──

/** Append a message bubble to messages-area (live, no DB reload) */
function appendChatBubble(role, content) {
  assert(role, 'appendChatBubble: role richiesto');
  var el = document.getElementById('messages-area');
  // Make messages-area visible if not already
  if (el.style.display === 'none') {
    el.style.display = 'flex';
    document.getElementById('sessions-grid').style.display = 'none';
  }
  var isUser = role === 'user';
  var time = fmtTime(new Date(), 'time');
  var body = isUser ? esc(content) : renderMd(String(content));
  var div = document.createElement('div');
  div.className = 'msg ' + (isUser ? 'msg-user' : 'msg-assistant');
  // Copy button only for assistant messages
  var copyBtn = isUser ? '' : '<button class="msg-copy" onclick="copyMessage(this)" title="Copy">' + COPY_ICON + '</button>';
  div.innerHTML = '<div class="msg-header">' +
    '<span class="msg-role">' + (isUser ? 'tu' : 'assistant') + '</span>' +
    '<span class="msg-time">' + time + '</span>' +
    copyBtn +
  '</div>' +
  '<div class="msg-body">' + body + '</div>';
  el.appendChild(div);
  scrollToBottom('chat-content');
}

function copyMessage(btn) {
  var msg = btn.closest('.msg');
  var body = msg.querySelector('.msg-body');
  // Get text content (strips HTML)
  var text = body.innerText || body.textContent;
  navigator.clipboard.writeText(text.trim()).then(function() {
    btn.innerHTML = CHECK_ICON;
    btn.classList.add('copied');
    setTimeout(function() {
      btn.innerHTML = COPY_ICON;
      btn.classList.remove('copied');
    }, 1500);
  });
}

/** Append or update a thinking indicator for streaming */
function showThinking(sessionId) {
  var el = document.getElementById('messages-area');
  var existing = document.getElementById('thinking-live');
  if (existing) return;
  var div = document.createElement('div');
  div.className = 'msg msg-assistant';
  div.id = 'thinking-live';
  div.innerHTML = '<div class="msg-thinking-label">thinking</div>' +
    '<div class="msg-thinking"></div>';
  el.appendChild(div);
  scrollToBottom('chat-content');
}

function updateThinking(text) {
  var el = document.querySelector('#thinking-live .msg-thinking');
  if (el) el.textContent = text;
}

function hideThinking() {
  var el = document.getElementById('thinking-live');
  if (el) el.remove();
}

/** Refresh sessions sidebar project counts */
async function refreshSessionsSidebar(project) {
  try {
    var res = await fetch('/api/sessions?project=' + encodeURIComponent(project));
    var sessions = await res.json();
    var btn = document.querySelector('[data-project="' + project + '"] .count');
    if (btn) {
      var total = sessions.reduce(function(sum, s) { return sum + (s.msg_count || 0); }, 0);
      btn.textContent = total;
    }
  } catch (e) { /* silent */ }
}
`;
