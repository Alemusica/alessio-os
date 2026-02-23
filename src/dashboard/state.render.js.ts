/**
 * State Render — Rendering liste e griglie
 * Usa renderList() da pti-utils per ogni lista
 */

export const stateRenderJs = `
// ── RENDER PROJECTS LIST ──
function renderProjectsList() {
  var el = document.getElementById('sessions-grid');
  var msgs = document.getElementById('messages-area');
  msgs.style.display = 'none';
  el.style.display = 'grid';

  // Outreach shortcut card (prepended if actions due)
  var outreachCard = '';
  if (typeof outreachActionsDue !== 'undefined' && outreachActionsDue.length > 0) {
    outreachCard = '<div class="session-card" onclick="switchView(\\'outreach\\')" style="border-left:3px solid var(--warning);grid-column:1/-1">' +
      '<div class="sc-id">FLUTUR Outreach</div>' +
      '<div class="sc-meta"><span>' + outreachActionsDue.length + ' azioni oggi</span><span>vai &rarr;</span></div>' +
    '</div>';
  }

  renderList('sessions-grid', S.projects, function(p) {
    var name = p.project || 'home';
    var count = p.msg_count || 0;
    var sessions = Array.isArray(p.session_ids) ? [...new Set(p.session_ids)] : [];
    return '<div class="session-card" onclick="selectProject(\\'' + esc(name).replace(/'/g, "\\\\'") + '\\')">' +
      '<div class="sc-id">' + esc(name) + '</div>' +
      '<div class="sc-meta"><span>' + count + ' msg</span><span>' + sessions.length + ' sessioni</span></div>' +
    '</div>';
  }, 'Nessun progetto. Esegui npm run auto-save');

  // Prepend outreach card
  if (outreachCard) {
    el.innerHTML = outreachCard + el.innerHTML;
  }
}

// ── RENDER SIDEBAR PROJECTS ──
function renderSidebarProjects(projects) {
  S.projects = projects || [];
  renderList('projects-nav', S.projects, function(p) {
    var name = p.project || 'home';
    var count = p.msg_count || 0;
    var isActive = S.project === name ? ' active' : '';
    return '<button class="nav-item' + isActive + '" data-project="' + esc(name) + '" onclick="selectProject(\\'' + esc(name).replace(/'/g, "\\\\'") + '\\')">' +
      esc(name) +
      '<span class="nav-count">' + count + '</span>' +
    '</button>';
  }, 'Nessun progetto');

  // Also render projects grid if no project selected
  if (!S.project && !S.session && S.view === 'chat') {
    renderProjectsList();
  }
}

// ── LOAD SESSIONS ──
async function loadSessions(project) {
  assert(project, 'loadSessions: project richiesto');
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
  assert(project && session, 'loadMessages: project e session richiesti');
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
      var copyBtn = isUser ? '' : '<button class="msg-copy" onclick="copyMessage(this)" title="Copy">' + COPY_ICON + '</button>';
      html += '<div class="msg ' + (isUser ? 'msg-user' : 'msg-assistant') + '">' +
        '<div class="msg-header">' +
          '<span class="msg-role">' + (isUser ? 'tu' : 'assistant') + '</span>' +
          '<span class="msg-time">' + time + '</span>' +
          copyBtn +
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
  document.getElementById('agent-count').textContent = agents.length;
  document.getElementById('sidebar-agent-count').textContent = agents.length;
  renderList('agents-list', agents, function(a) {
    return '<div class="agent">' +
      '<div class="status status-' + (a.status || 'idle') + '"></div>' +
      '<span class="role">' + esc(a.role || 'agent') + '</span>' +
      '<span class="task">' + esc(a.current_task || '-') + '</span>' +
    '</div>';
  }, 'Nessun agente attivo');
  // Update fixed strip in breadcrumb
  renderAgentsStrip(agents);
}

/** Render compact agent indicators in the breadcrumb bar — always visible */
function renderAgentsStrip(agents) {
  var strip = document.getElementById('agents-strip');
  if (!strip) return;
  if (!agents.length) { strip.innerHTML = ''; return; }
  // Filter: show only agents for current project (or all if no project selected)
  var filtered = S.project ? agents.filter(function(a) {
    return !a.project || a.project === S.project;
  }) : agents;
  var maxShow = 4;
  var shown = filtered.slice(0, maxShow);
  var extra = filtered.length - maxShow;
  strip.innerHTML = shown.map(function(a) {
    var status = a.status || 'idle';
    var role = a.role || 'agent';
    var task = a.current_task ? a.current_task.slice(0, 50) : '';
    return '<div class="as-agent ' + status + '" title="' + esc(role) + ': ' + esc(a.current_task || '-') + '">' +
      '<span class="as-dot"></span>' +
      '<span class="as-role">' + esc(role) + '</span>' +
      (task ? '<span class="as-task">' + esc(task) + '</span>' : '') +
    '</div>';
  }).join('') + (extra > 0 ? '<span class="as-more">+' + extra + '</span>' : '');
}

// ── TASKS ──
function renderTasks(tasks) {
  document.getElementById('task-count').textContent = tasks.length;
  document.getElementById('sidebar-task-count').textContent = tasks.length;
  renderList('tasks-list', tasks, function(t) {
    return '<div class="task-item">' +
      '<span class="badge badge-' + (t.status || 'pending') + '">' + (t.status || '?') + '</span>' +
      '<span class="desc">' + esc(t.task || '-') + '</span>' +
      '<span class="prio">P' + (t.priority || 0) + '</span>' +
    '</div>';
  }, 'Nessun task');
}

// ── KB ──
function renderKB(kb) {
  document.getElementById('kb-knowledge').textContent = kb.knowledge_count ?? '-';
  document.getElementById('kb-papers').textContent = kb.paper_count ?? '-';
  document.getElementById('kb-exp').textContent = kb.experience_count ?? '-';
  document.getElementById('kb-entities').textContent = kb.entity_count ?? '-';
}
`;
