/**
 * State Navigation — Vista + Progetto + Sessione
 * AZIONI: switchView, selectProject, selectSession, goHome, goProject
 * Ogni azione muta S.* poi propaga() — i SALTI gestiscono effetti collaterali
 */

export const stateNavJs = `
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
  if (name === 'timeline') {
    if (timelineMode === 'actions') loadActionTimeline(true);
    else loadTimeline(true);
  }
  if (name === 'agents' && S.project) loadAgentDefinitions(S.project);
  if (name === 'github' && S.project) loadGitHubData(S.project);
  if (name === 'mcp') loadMcpStatus();
  if (name === 'graph' && typeof GraphRenderer !== 'undefined') {
    var sel = document.getElementById('graph-project-select');
    GraphRenderer.load(sel ? sel.value : '');
  }
  propaga('S.view', name);
}

// ── NAVIGATION ──
function goHome() {
  S.project = null;
  S.session = null;
  renderProjectsList();
  propaga('S.project', null);
  propaga('S.session', null);
}

function goProject() {
  S.session = null;
  loadSessions(S.project);
  propaga('S.session', null);
}

function selectProject(name) {
  assert(name, 'selectProject: name richiesto');
  var prevProject = S.project;
  S.project = name;
  S.session = null;
  // Persist current view — don't force back to chat
  if (S.view === 'chat' || !prevProject) {
    if (S.view !== 'chat') switchView('chat');
    loadSessions(name);
  } else {
    switchView(S.view);
  }
  propaga('S.project', name);
}

function selectSession(sid) {
  assert(sid, 'selectSession: sid richiesto');
  S.session = sid;
  loadMessages(S.project, sid);
  propaga('S.session', sid);
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

// ── SEARCH ──
async function doSearch() {
  const q = document.getElementById('search-input').value.trim();
  if (!q) return;
  switchView('chat');
  S.project = null;
  S.session = null;
  propaga('S.project', null);
  propaga('S.session', null);

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

// ── TIMELINE NAVIGATION ──
function goToSession(proj, sid) {
  switchView('chat');
  S.project = proj;
  S.session = sid;
  loadMessages(proj, sid);
  propaga('S.project', proj);
  propaga('S.session', sid);
}

// ── PROJECT COLOR HASH ──
const projColors = ['proj-sage', 'proj-amber', 'proj-rose', 'proj-blue', 'proj-accent'];
function projColorClass(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h) + name.charCodeAt(i);
  return projColors[Math.abs(h) % projColors.length];
}
`;
