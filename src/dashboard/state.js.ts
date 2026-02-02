/**
 * Dashboard State + UI Interactions
 * Extracted from server.ts T3 tissue
 *
 * Contains: S (state), SSE, views, navigation, renders, commands, uploads, STT
 * Dependencies: window.AOS (from aos-rytmo.js), window.GraphRenderer (from graph-view.js)
 */

export const stateJs = `
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

// ── SSE ──
const sse = new EventSource('/events');
const terminal = document.getElementById('terminal');

function addLog(text, cls) {
  S.logCount++;
  document.getElementById('log-count').textContent = S.logCount;
  const ts = new Date().toLocaleTimeString('it-IT', { hour12: false });
  const d = document.createElement('div');
  d.className = 'log-line';
  d.innerHTML = '<span class="ts">' + ts + '</span> ' +
    (cls ? '<span class="' + cls + '">' + text + '</span>' : text);
  terminal.appendChild(d);
  terminal.scrollTop = terminal.scrollHeight;
  while (terminal.children.length > 200) terminal.removeChild(terminal.firstChild);
}

// ── ESCAPE HTML ──
function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ── VIEWS ──
function switchView(name) {
  S.view = name;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(name + '-view').classList.add('active');
  // Update inline view tabs
  document.querySelectorAll('.view-tab[data-view]').forEach(function(t) {
    t.classList.toggle('active', t.dataset.view === name);
  });
  // Lazy-load views on first switch
  if (name === 'timeline') loadTimeline(true);
  if (name === 'agents' && S.project) loadAgentDefinitions(S.project);
  if (name === 'mcp') loadMcpStatus();
  if (name === 'graph' && typeof GraphRenderer !== 'undefined') {
    var sel = document.getElementById('graph-project-select');
    GraphRenderer.load(sel ? sel.value : '');
  }
}

// ── NAVIGATION ──
function goHome() {
  S.project = null;
  S.session = null;
  renderProjectsList();
  updateBreadcrumb();
}

function goProject() {
  S.session = null;
  loadSessions(S.project);
  updateBreadcrumb();
}

function selectProject(name) {
  var prevProject = S.project;
  S.project = name;
  S.session = null;
  // Persist current view — don't force back to chat
  // If on chat (or coming from home grid), load sessions for this project
  if (S.view === 'chat' || !prevProject) {
    if (S.view !== 'chat') switchView('chat');
    loadSessions(name);
  } else {
    // Re-trigger current view to reload with new project context
    switchView(S.view);
  }
  // Load agent definitions for the selected project
  if (S.view === 'agents') loadAgentDefinitions(name);
  updateBreadcrumb();
  // Swift wrapper: update title bar
  alessioOSBridge('setTitle', { title: name });

  // Update sidebar active
  document.querySelectorAll('[data-project]').forEach(b => {
    b.classList.toggle('active', b.dataset.project === name);
  });

  // Auto-switch PTI Graph to this project
  var graphSelect = document.getElementById('graph-project-select');
  if (graphSelect) {
    // Set dropdown value if option exists, otherwise use default
    var found = false;
    for (var i = 0; i < graphSelect.options.length; i++) {
      if (graphSelect.options[i].value === name) { found = true; break; }
    }
    graphSelect.value = found ? name : '';
    // Pre-load graph data so it's ready when user switches to Graph view
    if (typeof GraphRenderer !== 'undefined' && GraphRenderer.load) {
      GraphRenderer.load(found ? name : '');
    }
  }
}

function selectSession(sid) {
  S.session = sid;
  loadMessages(S.project, sid);
  updateBreadcrumb();
}

function updateBreadcrumb() {
  const bcProject = document.getElementById('bc-project');
  const bcSession = document.getElementById('bc-session');
  const sep1 = document.getElementById('bc-sep1');
  const sep2 = document.getElementById('bc-sep2');

  if (S.project) {
    bcProject.textContent = S.project;
    bcProject.style.display = '';
    sep1.style.display = '';
  } else {
    bcProject.style.display = 'none';
    sep1.style.display = 'none';
  }

  if (S.session) {
    bcSession.textContent = S.session.slice(0, 12) + '...';
    bcSession.style.display = '';
    sep2.style.display = '';
  } else {
    bcSession.style.display = 'none';
    sep2.style.display = 'none';
  }
}

// ── RENDER PROJECTS LIST ──
function renderProjectsList() {
  const el = document.getElementById('sessions-grid');
  const msgs = document.getElementById('messages-area');
  msgs.style.display = 'none';
  el.style.display = 'grid';

  if (!S.projects.length) {
    el.innerHTML = emptyState('Nessun progetto. Esegui npm run auto-save');
    return;
  }

  el.innerHTML = S.projects.map(p => {
    const name = p.project || 'home';
    const count = p.msg_count || 0;
    const sessions = Array.isArray(p.session_ids) ? [...new Set(p.session_ids)] : [];
    return '<div class="session-card" onclick="selectProject(\\'' + esc(name).replace(/'/g, "\\\\'") + '\\')">' +
      '<div class="sc-id">' + esc(name) + '</div>' +
      '<div class="sc-meta"><span>' + count + ' msg</span><span>' + sessions.length + ' sessioni</span></div>' +
    '</div>';
  }).join('');
}

// ── RENDER SIDEBAR PROJECTS ──
function renderSidebarProjects(projects) {
  S.projects = projects || [];
  const nav = document.getElementById('projects-nav');
  nav.innerHTML = S.projects.map(p => {
    const name = p.project || 'home';
    const count = p.msg_count || 0;
    const isActive = S.project === name ? ' active' : '';
    return '<button class="nav-item' + isActive + '" data-project="' + esc(name) + '" onclick="selectProject(\\'' + esc(name).replace(/'/g, "\\\\'") + '\\')">' +
      esc(name) +
      '<span class="nav-count">' + count + '</span>' +
    '</button>';
  }).join('');

  // Also render projects grid if no project selected
  if (!S.project && !S.session && S.view === 'chat') {
    renderProjectsList();
  }
}

// ── LOAD SESSIONS ──
async function loadSessions(project) {
  const el = document.getElementById('sessions-grid');
  const msgs = document.getElementById('messages-area');
  msgs.style.display = 'none';
  el.style.display = 'grid';
  el.innerHTML = '<div class="empty"><span class="loading-spinner"></span></div>';

  try {
    const res = await fetch('/api/sessions?project=' + encodeURIComponent(project));
    const sessions = await res.json();

    if (!sessions.length) {
      el.innerHTML = emptyState('Nessuna sessione');
      return;
    }

    el.innerHTML = sessions.map(s => {
      const date = s.last_msg ? fmtTime(s.last_msg, 'date') : '';
      return '<div class="session-card" onclick="selectSession(\\'' + esc(s.session_id).replace(/'/g, "\\\\'") + '\\')">' +
        '<div class="sc-id">' + esc(s.session_id).slice(0, 16) + '...</div>' +
        '<div class="sc-meta"><span>' + (s.msg_count || 0) + ' msg</span><span>' + date + '</span></div>' +
      '</div>';
    }).join('');
  } catch (err) {
    el.innerHTML = emptyState('Errore: ' + String(err));
  }
}

// ── LOAD MESSAGES ──
async function loadMessages(project, session) {
  var el = document.getElementById('messages-area');
  var grid = document.getElementById('sessions-grid');
  grid.style.display = 'none';
  el.style.display = 'flex';
  el.innerHTML = '<div class="empty"><span class="loading-spinner"></span></div>';

  try {
    var res = await fetch('/api/messages?project=' + encodeURIComponent(project) + '&session=' + encodeURIComponent(session));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var messages = await res.json();

    if (!messages.length) {
      el.innerHTML = emptyState('Nessun messaggio');
      return;
    }

    var html = '';
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      var isUser = m.role === 'user';
      var time = m.created_at ? fmtTime(m.created_at, 'time') : '';
      var content = String(m.content || '');
      // Extract thinking blocks
      var thinkingHtml = '';
      if (!isUser) {
        var BT3 = String.fromCharCode(96,96,96);
        var thinkRe = new RegExp(BT3 + 'thinking\\n([\\s\\S]*?)' + BT3);
        var thinkMatch = content.match(thinkRe);
        if (!thinkMatch) thinkMatch = content.match(/<thinking>([\\s\\S]*?)<\\/thinking>/);
        if (thinkMatch) {
          content = content.replace(thinkMatch[0], '').trim();
          var thinkText = esc(thinkMatch[1].trim());
          thinkingHtml = '<div class="msg-thinking-label done" onclick="this.nextElementSibling.classList.toggle(\\'collapsed\\')">thinking</div>' +
            '<div class="msg-thinking collapsed">' + thinkText + '</div>';
        }
      }
      var body = renderMd(content);
      html += '<div class="msg ' + (isUser ? 'msg-user' : 'msg-assistant') + '">' +
        '<div class="msg-header">' +
          '<span class="msg-role">' + (isUser ? 'tu' : 'assistant') + '</span>' +
          '<span class="msg-time">' + time + '</span>' +
        '</div>' +
        thinkingHtml +
        '<div class="msg-body">' + body + '</div>' +
      '</div>';
    }
    el.innerHTML = html;

    scrollToBottom('chat-content');
  } catch (err) {
    console.error('loadMessages error:', err);
    el.innerHTML = emptyState('Errore: ' + String(err));
  }
}

// ── AGENTS ──
function renderAgents(agents) {
  const el = document.getElementById('agents-list');
  document.getElementById('agent-count').textContent = agents.length;
  document.getElementById('sidebar-agent-count').textContent = agents.length;
  if (!agents.length) { el.innerHTML = emptyState('Nessun agente attivo'); return; }
  el.innerHTML = agents.map(a =>
    '<div class="agent">' +
      '<div class="status status-' + (a.status || 'idle') + '"></div>' +
      '<span class="role">' + esc(a.role || 'agent') + '</span>' +
      '<span class="task">' + esc(a.current_task || '-') + '</span>' +
    '</div>'
  ).join('');
  // Update fixed strip in breadcrumb
  renderAgentsStrip(agents);
}

/** Render compact agent indicators in the breadcrumb bar — always visible */
function renderAgentsStrip(agents) {
  var strip = document.getElementById('agents-strip');
  if (!strip) return;
  if (!agents.length) { strip.innerHTML = ''; return; }
  strip.innerHTML = agents.map(function(a) {
    var status = a.status || 'idle';
    var role = (a.role || 'agent').slice(0, 3);
    var task = a.current_task ? a.current_task.slice(0, 40) : '';
    return '<div class="as-agent ' + status + '" title="' + esc(a.role || '') + ': ' + esc(a.current_task || '-') + '">' +
      '<span class="as-dot"></span>' +
      '<span>' + esc(role) + '</span>' +
      (task ? '<span class="as-task">' + esc(task) + '</span>' : '') +
    '</div>';
  }).join('');
}

// ── AGENT DEFINITIONS (persistent, per-project) ──

var agentDefs = [];

async function loadAgentDefinitions(project) {
  if (!project) return;
  try {
    var res = await fetch('/api/agents/definitions?project=' + encodeURIComponent(project));
    agentDefs = await res.json();
    renderAgentDefinitions(agentDefs);
  } catch (err) {
    console.error('loadAgentDefinitions:', err);
  }
}

function renderAgentDefinitions(defs) {
  var el = document.getElementById('agent-defs-list');
  var countEl = document.getElementById('agent-def-count');
  if (countEl) countEl.textContent = defs.length;
  if (!el) return;
  if (!defs.length) {
    el.innerHTML = '<div class="empty" style="padding:var(--s2)">Nessun agente definito</div>';
    return;
  }
  el.innerHTML = defs.map(function(d) {
    var active = d.is_active !== false;
    var paradigmBadge = d.paradigm_id ? '<span class="badge badge-pending" style="font-size:7px">' + esc(d.paradigm_id) + '</span>' : '';
    return '<div class="agent-def' + (active ? '' : ' inactive') + '" draggable="true" data-agent-def-id="' + esc(d.agent_def_id) + '" ' +
      'ondragstart="dragAgentDef(event, ' + "'" + esc(d.agent_def_id) + "'" + ', ' + "'" + esc(d.name) + "'" + ', ' + "'" + esc(d.role) + "'" + ')">' +
      '<div class="ad-header">' +
        '<span class="ad-name">' + esc(d.name) + '</span>' +
        '<span class="ad-role">' + esc(d.role) + '</span>' +
        paradigmBadge +
      '</div>' +
      (d.custom_identity ? '<div class="ad-identity">' + esc(d.custom_identity).slice(0, 80) + '</div>' : '') +
      '<div class="ad-actions">' +
        '<button class="btn-tiny" onclick="toggleAgentActive(' + "'" + esc(d.agent_def_id) + "'" + ', ' + !active + ')">' + (active ? 'Disattiva' : 'Attiva') + '</button>' +
        '<button class="btn-tiny" style="color:var(--rose)" onclick="deleteAgentDef(' + "'" + esc(d.agent_def_id) + "'" + ')">Elimina</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

function toggleAgentForm() {
  var form = document.getElementById('agent-form');
  var visible = form.style.display !== 'none';
  form.style.display = visible ? 'none' : 'block';
  if (!visible) loadParadigmSelect();
}

async function loadParadigmSelect() {
  var sel = document.getElementById('adf-paradigm');
  try {
    var res = await fetch('/api/paradigms');
    var paradigms = await res.json();
    sel.innerHTML = '<option value="">Paradigma progetto (default)</option>' +
      paradigms.map(function(p) {
        return '<option value="' + esc(p.paradigm_id) + '">' + esc(p.name) + ' v' + esc(p.version) + '</option>';
      }).join('');
  } catch (err) {
    sel.innerHTML = '<option value="">PTI v4.1 (default)</option>';
  }
}

async function createAgentDef() {
  var name = document.getElementById('adf-name').value.trim();
  var role = document.getElementById('adf-role').value;
  var identity = document.getElementById('adf-identity').value.trim();
  var paradigm = document.getElementById('adf-paradigm').value;
  if (!name) { addLog('Nome agente richiesto', 'error'); return; }

  try {
    var project = S.project || 'alessio-os';
    var res = await fetch('/api/agents/definitions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project: project,
        name: name,
        role: role,
        custom_identity: identity || undefined,
        paradigm_id: paradigm || undefined,
        tags: [],
        is_active: true
      })
    });
    var result = await res.json();
    addLog('Agente "' + name + '" creato: ' + result.agent_def_id, 'event');
    document.getElementById('agent-form').style.display = 'none';
    document.getElementById('adf-name').value = '';
    document.getElementById('adf-identity').value = '';
    loadAgentDefinitions(project);
  } catch (err) {
    addLog('Errore creazione agente: ' + err, 'error');
  }
}

async function toggleAgentActive(id, active) {
  try {
    await fetch('/api/agents/definitions?id=' + encodeURIComponent(id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: active })
    });
    loadAgentDefinitions(S.project);
  } catch (err) {
    addLog('Errore toggle agente: ' + err, 'error');
  }
}

async function deleteAgentDef(id) {
  if (!confirm('Eliminare agente?')) return;
  try {
    await fetch('/api/agents/definitions?id=' + encodeURIComponent(id), { method: 'DELETE' });
    addLog('Agente eliminato', 'event');
    loadAgentDefinitions(S.project);
  } catch (err) {
    addLog('Errore eliminazione: ' + err, 'error');
  }
}

function dragAgentDef(e, id, name, role) {
  e.dataTransfer.setData('application/x-agent-def', JSON.stringify({
    agent_def_id: id, name: name, role: role
  }));
  e.dataTransfer.effectAllowed = 'copy';
}

// ── TASKS ──
function renderTasks(tasks) {
  const el = document.getElementById('tasks-list');
  document.getElementById('task-count').textContent = tasks.length;
  document.getElementById('sidebar-task-count').textContent = tasks.length;
  if (!tasks.length) { el.innerHTML = emptyState('Nessun task'); return; }
  el.innerHTML = tasks.map(t =>
    '<div class="task-item">' +
      '<span class="badge badge-' + (t.status || 'pending') + '">' + (t.status || '?') + '</span>' +
      '<span class="desc">' + esc(t.task || '-') + '</span>' +
      '<span class="prio">P' + (t.priority || 0) + '</span>' +
    '</div>'
  ).join('');
}

// ── KB ──
function renderKB(kb) {
  document.getElementById('kb-knowledge').textContent = kb.knowledge_count ?? '-';
  document.getElementById('kb-papers').textContent = kb.paper_count ?? '-';
  document.getElementById('kb-exp').textContent = kb.experience_count ?? '-';
  document.getElementById('kb-entities').textContent = kb.entity_count ?? '-';
}

// ── SSE EVENTS (incremental — delta, non ricalcolo) ──

// Granular update: agents only
sse.addEventListener('agents:update', function(e) {
  var d = parseSSE(e);
  var agents = d.agents || [];
  renderAgents(agents);
  document.getElementById('kb-agents-count').textContent = agents.length;
  var mainEl = document.querySelector('.main');
  if (agents.length === 0) {
    mainEl.classList.remove('thinking');
    renderAgentsStrip([]);
  }
});

// Granular update: tasks only
sse.addEventListener('tasks:update', function(e) {
  var d = parseSSE(e);
  var tasks = d.tasks || [];
  renderTasks(tasks);
  document.getElementById('kb-tasks-count').textContent = tasks.length;
});

// Granular update: KB stats only
sse.addEventListener('kb:update', function(e) {
  var d = parseSSE(e);
  if (d.kb) renderKB(d.kb);
});

// Granular update: sidebar projects only
sse.addEventListener('projects:update', function(e) {
  var d = parseSSE(e);
  renderSidebarProjects(d.chatProjects || []);
});

// Legacy: full state event (used for initial SSE connection)
sse.addEventListener('state', function(e) {
  var state = parseSSE(e);
  renderAgents(state.agents || []);
  renderTasks(state.tasks || []);
  if (state.kb) renderKB(state.kb);
  document.getElementById('kb-agents-count').textContent = (state.agents || []).length;
  document.getElementById('kb-tasks-count').textContent = (state.tasks || []).length;
  renderSidebarProjects(state.chatProjects || []);
  var mainEl = document.querySelector('.main');
  if ((state.agents || []).length === 0) {
    mainEl.classList.remove('thinking');
    renderAgentsStrip([]);
  }
});

sse.addEventListener('log', function(e) {
  var d = parseSSE(e);
  addLog(d.text, d.cls || '');
  // Agent dispatched → start thinking glow
  if (d.cls === 'agent-name' || (d.text && d.text.indexOf('dispatched') > -1)) {
    document.querySelector('.main').classList.add('thinking');
  }
});

sse.addEventListener('response', function(e) {
  var d = parseSSE(e);
  // Agent responded → stop thinking glow
  document.querySelector('.main').classList.remove('thinking');
  if (d.text) {
    appendChatBubble('assistant', d.text);
  }
  // Auto-reload sessions sidebar count
  if (S.project) {
    refreshSessionsSidebar(S.project);
  }
});

sse.addEventListener('open', function() {
  addLog('Dashboard connessa', 'event');
  document.getElementById('health-dot').style.background = 'var(--green)';
});

sse.addEventListener('error', function() {
  addLog('Connessione persa', 'error');
  document.getElementById('health-dot').style.background = 'var(--rose)';
});

sse.addEventListener('pti:delta', function(e) {
  try {
    var data = parseSSE(e);
    if (S.view !== 'graph') return;
    var entries = data.entries || [];
    entries.forEach(function(entry, i) {
      setTimeout(function() { GraphRenderer.flash(entry.nodoId); }, i * 120);
    });
  } catch (err) { /* skip */ }
});

// ── INITIAL LOAD ──
apiCall('/api/state').then(function(state) {
  renderAgents(state.agents || []);
  renderTasks(state.tasks || []);
  if (state.kb) renderKB(state.kb);
  document.getElementById('kb-agents-count').textContent = (state.agents || []).length;
  document.getElementById('kb-tasks-count').textContent = (state.tasks || []).length;
  renderSidebarProjects(state.chatProjects || []);
  addLog('Stato iniziale caricato', 'event');
});

// ── TERMINAL TOGGLE ──
function toggleTerminal() {
  const panel = document.getElementById('terminal-panel');
  const toggle = document.getElementById('tp-toggle');
  if (panel.classList.contains('collapsed')) {
    panel.classList.remove('collapsed');
    toggle.innerHTML = '&minus;';
  } else {
    panel.classList.add('collapsed');
    toggle.innerHTML = '+';
  }
}

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

async function handleFiles(files) {
  const images = files.filter(f => f.type.startsWith('image/'));
  const audio = files.filter(f => f.type.startsWith('audio/'));
  if (images.length > 0) await uploadOCR(images);
  if (audio.length > 0) await uploadSTT(audio);
}

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
  div.innerHTML = '<div class="msg-header">' +
    '<span class="msg-role">' + (isUser ? 'tu' : 'assistant') + '</span>' +
    '<span class="msg-time">' + time + '</span>' +
  '</div>' +
  '<div class="msg-body">' + body + '</div>';
  el.appendChild(div);
  scrollToBottom('chat-content');
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

// showResult removed — unified into appendChatBubble (PTI: niente duplicazione)

async function uploadOCR(files) {
  const prompt = document.getElementById('dz-prompt');
  prompt.innerHTML = '<span class="loading-spinner"></span> OCR in corso...';
  addLog('OCR: ' + files.map(f => f.name).join(', '), 'agent-name');

  const fd = new FormData();
  files.forEach(f => fd.append('files', f));

  try {
    const res = await fetch('/api/ocr', { method: 'POST', body: fd });
    const results = await res.json();
    results.forEach(r => {
      if (r.error) {
        appendChatBubble('assistant', '**OCR Error:** ' + (r.file || '?') + '\\n' + r.error);
        addLog('OCR errore: ' + r.error, 'error');
      } else {
        var conf = r.confidence ? ' (' + (r.confidence * 100).toFixed(1) + '%)' : '';
        appendChatBubble('assistant', '**OCR: ' + (r.file || '') + conf + '**\\n' + (r.text || ''));
        addLog('OCR completato: ' + (r.file || ''), 'event');
      }
    });
  } catch (err) {
    appendChatBubble('assistant', '**OCR Error:** ' + String(err));
    addLog('OCR fallito: ' + err, 'error');
  }
  prompt.textContent = '| Drop OCR/STT';
}

async function uploadSTT(files) {
  const prompt = document.getElementById('dz-prompt');
  prompt.innerHTML = '<span class="loading-spinner"></span> Trascrizione in corso...';
  addLog('STT: ' + files.map(f => f.name).join(', '), 'agent-name');

  const fd = new FormData();
  files.forEach(f => fd.append('files', f));

  try {
    const res = await fetch('/api/transcribe', { method: 'POST', body: fd });
    const result = await res.json();
    if (result.error) {
      appendChatBubble('assistant', '**STT Error:** ' + (result.file || '?') + '\\n' + result.error);
      addLog('STT errore: ' + result.error, 'error');
    } else {
      appendChatBubble('assistant', '**Trascrizione: ' + (result.file || '') + '**\\n' + (result.text || ''));
      addLog('STT completato: ' + (result.file || ''), 'event');
    }
  } catch (err) {
    appendChatBubble('assistant', '**STT Error:** ' + String(err));
    addLog('STT fallito: ' + err, 'error');
  }
  prompt.textContent = '| Drop OCR/STT';
}

// ── STT: Web Speech API (instant, zero latency) ──
var speechRec = null;
var speechActive = false;
var sttFinal = '';
var sttInterim = '';

function toggleMic() {
  var btn = document.getElementById('mic-btn');
  var prompt = document.getElementById('dz-prompt');

  if (speechActive && speechRec) {
    // Just stop — onend handles everything (including interim text)
    speechRec.stop();
    return;
  }

  var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    addLog('Web Speech API non supportata — usa Chrome/Edge', 'error');
    return;
  }

  sttFinal = '';
  sttInterim = '';
  speechRec = new SpeechRecognition();
  speechRec.lang = 'it-IT';
  speechRec.continuous = true;
  speechRec.interimResults = true;

  speechRec.onstart = function() {
    speechActive = true;
    btn.classList.add('recording');
    btn.textContent = 'Stop';
    prompt.innerHTML = '<span style="color:var(--accent)">&#9679;</span> Ascolto...';
    addLog('STT avviato (Web Speech API)', 'event');
  };

  speechRec.onresult = function(event) {
    sttInterim = '';
    for (var i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        sttFinal += event.results[i][0].transcript;
      } else {
        sttInterim += event.results[i][0].transcript;
      }
    }
    // Show live preview
    var preview = sttFinal + sttInterim;
    if (preview) {
      prompt.innerHTML = '<span style="color:var(--accent)">&#9679;</span> ' + esc(preview).slice(0, 120);
    }
  };

  speechRec.onend = function() {
    speechActive = false;
    btn.classList.remove('recording');
    btn.textContent = 'Registra';
    prompt.textContent = '| Drop OCR/STT';

    // Use final text, or fall back to last interim if user stopped quickly
    var text = (sttFinal || sttInterim).trim();
    if (text) {
      var input = document.querySelector('.cmd-input');
      input.value = text;
      input.focus();
      addLog('STT: "' + text.slice(0, 80) + '"', 'event');
    } else {
      addLog('STT: nessun testo riconosciuto', 'event');
    }
  };

  speechRec.onerror = function(event) {
    speechActive = false;
    btn.classList.remove('recording');
    btn.textContent = 'Registra';
    prompt.textContent = '| Drop OCR/STT';
    if (event.error !== 'aborted') {
      addLog('STT errore: ' + event.error, 'error');
    }
  };

  speechRec.start();
}

// ── SEARCH ──
async function doSearch() {
  const q = document.getElementById('search-input').value.trim();
  if (!q) return;
  switchView('chat');
  S.project = null;
  S.session = null;
  updateBreadcrumb();

  const el = document.getElementById('sessions-grid');
  const msgs = document.getElementById('messages-area');
  msgs.style.display = 'none';
  el.style.display = 'grid';
  el.innerHTML = '<div class="empty"><span class="loading-spinner"></span> Cercando...</div>';

  try {
    const res = await fetch('/api/search?q=' + encodeURIComponent(q));
    const results = await res.json();
    if (!results.length) {
      el.innerHTML = emptyState('Nessun risultato per "' + q + '"');
      return;
    }
    el.innerHTML = '<div class="section-title">Risultati per "' + esc(q) + '" <span class="count">' + results.length + '</span></div>' +
      results.map(function(m) {
        const time = m.created_at ? fmtTime(m.created_at) : '';
        const preview = (m.content || '').slice(0, 200);
        const proj = m.project || 'home';
        return '<div class="tl-msg" onclick="selectProject(\\'' + esc(proj).replace(/'/g, "\\\\'") + '\\')">' +
          '<div class="tl-header">' +
            '<span class="tl-project ' + projColorClass(proj) + '">' + esc(proj) + '</span>' +
            '<span class="tl-role">' + (m.role || '') + '</span>' +
            '<span class="tl-time">' + time + '</span>' +
          '</div>' +
          '<div class="tl-body">' + esc(preview) + '</div>' +
        '</div>';
      }).join('');
  } catch (err) {
    el.innerHTML = emptyState('Errore: ' + String(err));
  }
}

// ── COMMAND INPUT ──
async function sendCommand() {
  const input = document.getElementById('cmd-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.style.height = '34px';

  // Show user message in chat
  appendChatBubble('user', text);

  // Expand terminal if collapsed
  const panel = document.getElementById('terminal-panel');
  if (panel.classList.contains('collapsed')) {
    panel.classList.remove('collapsed');
    document.getElementById('tp-toggle').innerHTML = '&minus;';
  }

  try {
    const project = S.project || 'alessio-os';
    const res = await fetch('/api/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, project })
    });
    const result = await res.json();
    const roles = (result.route || ['coder']).join(', ');
    addLog('[' + roles + '] Agent ' + (result.agentId || '?') + ' dispatched', 'event');
  } catch (err) {
    addLog('Errore comando: ' + err, 'error');
  }
}

// Auto-resize textarea
document.getElementById('cmd-input').addEventListener('input', function() {
  this.style.height = '34px';
  this.style.height = Math.min(this.scrollHeight, 89) + 'px'; /* 89 = Fibonacci */
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

// ── TIMELINE ──
let timelinePage = 0;
let timelineLoading = false;

async function loadTimeline(reset) {
  if (timelineLoading) return;
  if (reset) { timelinePage = 0; }
  timelineLoading = true;

  const list = document.getElementById('timeline-list');
  if (reset) list.innerHTML = '<div class="empty"><span class="loading-spinner"></span></div>';

  try {
    const res = await fetch('/api/timeline?page=' + timelinePage);
    const items = await res.json();
    if (reset) list.innerHTML = '';

    if (!items.length) {
      if (reset) list.innerHTML = emptyState('Nessun messaggio');
      document.getElementById('tl-load-more').style.display = 'none';
      return;
    }

    document.getElementById('tl-load-more').style.display = 'block';
    const html = items.map(function(m) {
      const time = m.created_at ? fmtTime(m.created_at) : '';
      const preview = (m.content || '').slice(0, 300);
      const proj = m.project || 'home';
      const sid = m.session_id || '';
      return '<div class="tl-msg" onclick="goToSession(\\'' + esc(proj).replace(/'/g, "\\\\'") + '\\', \\'' + esc(sid).replace(/'/g, "\\\\'") + '\\')">' +
        '<div class="tl-header">' +
          '<span class="tl-project ' + projColorClass(proj) + '">' + esc(proj) + '</span>' +
          '<span class="tl-role">' + (m.role || '') + '</span>' +
          '<span class="tl-time">' + time + '</span>' +
        '</div>' +
        '<div class="tl-body">' + esc(preview) + '</div>' +
      '</div>';
    }).join('');
    list.insertAdjacentHTML('beforeend', html);
    timelinePage++;
  } catch (err) {
    if (reset) list.innerHTML = emptyState('Errore: ' + String(err));
  } finally {
    timelineLoading = false;
  }
}

function loadMoreTimeline() { loadTimeline(false); }

function goToSession(proj, sid) {
  switchView('chat');
  S.project = proj;
  S.session = sid;
  loadMessages(proj, sid);
  updateBreadcrumb();
  // Update sidebar active
  document.querySelectorAll('[data-project]').forEach(function(b) {
    b.classList.toggle('active', b.dataset.project === proj);
  });
}

// ── PROJECT COLOR HASH ──
const projColors = ['proj-sage', 'proj-amber', 'proj-rose', 'proj-blue', 'proj-accent'];
function projColorClass(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h) + name.charCodeAt(i);
  return projColors[Math.abs(h) % projColors.length];
}

// ── MCP STATUS ──
async function loadMcpStatus() {
  const grid = document.getElementById('mcp-grid');
  try {
    const res = await fetch('/api/mcp-status');
    const servers = await res.json();
    const names = Object.keys(servers);

    if (!names.length) {
      grid.innerHTML = emptyState('Nessun server MCP configurato');
      return;
    }

    grid.innerHTML = names.map(function(name) {
      const s = servers[name];
      const cmd = s.command + ' ' + (s.args || []).join(' ');
      const envKeys = s.env || [];
      return '<div class="mcp-card">' +
        '<div class="mcp-name">' + esc(name) + ' <span class="mcp-badge">configured</span></div>' +
        '<div class="mcp-cmd">' + esc(cmd) + '</div>' +
        (envKeys.length ? '<div class="mcp-section-label">Environment</div><div class="mcp-pills">' + envKeys.map(function(k) { return '<span class="mcp-pill">' + esc(k) + '</span>'; }).join('') + '</div>' : '') +
      '</div>';
    }).join('');
  } catch (err) {
    grid.innerHTML = emptyState('Errore: ' + String(err));
  }
}

// ── SHIFT+ARROW VIEW NAVIGATION ──
var VIEW_ORDER = ['chat', 'timeline', 'agents', 'tasks', 'kb', 'mcp', 'graph'];
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
`;
