/**
 * State Timeline — Actions timeline + Chat timeline
 * switchTimelineMode, loadActionTimeline, loadTimeline
 */

export const stateTimelineJs = `
// ── TIMELINE ──
var timelineMode = 'actions';
let timelinePage = 0;
let timelineLoading = false;
var actionsPage = 0;

function switchTimelineMode(mode) {
  timelineMode = mode;
  document.querySelectorAll('.tl-mode').forEach(function(t) {
    t.classList.toggle('active', t.dataset.mode === mode);
  });
  document.getElementById('actions-timeline').style.display = mode === 'actions' ? 'block' : 'none';
  document.getElementById('chat-timeline').style.display = mode === 'chat' ? 'block' : 'none';
  if (mode === 'actions') loadActionTimeline(true);
  if (mode === 'chat') loadTimeline(true);
}

var ACTION_ICONS = {
  task_created: '\u25CF',      // blue dot
  agent_spawned: '\u25B6',     // green play
  agent_completed: '\u2713',   // green check
  branch_created: '\u2387',    // git branch
  pr_created: '\u2387',        // merge
  paradigm_changed: '\u21C4',  // swap
  agent_defined: '\u002B',     // plus
  agent_updated: '\u270E',     // edit
  agent_removed: '\u2715',     // x
  command_sent: '\u25B8',      // terminal
  error: '\u2717'              // red x
};

var ACTION_COLORS = {
  task_created: 'var(--blue)',
  agent_spawned: 'var(--green)',
  agent_completed: 'var(--green)',
  branch_created: 'var(--accent)',
  pr_created: 'var(--accent)',
  error: 'var(--rose)',
  command_sent: 'var(--dim)',
  paradigm_changed: 'var(--amber)',
  agent_defined: 'var(--blue)',
  agent_updated: 'var(--blue)',
  agent_removed: 'var(--rose)'
};

async function loadActionTimeline(reset) {
  if (reset) actionsPage = 0;
  var project = S.project;
  if (!project) { document.getElementById('actions-timeline').innerHTML = '<div class="empty">Seleziona un progetto</div>'; return; }
  try {
    var res = await fetch('/api/actions?project=' + encodeURIComponent(project) + '&limit=50&offset=' + (actionsPage * 50));
    var actions = await res.json();
    var el = document.getElementById('actions-timeline');
    if (reset) el.innerHTML = '';
    if (!actions.length && actionsPage === 0) {
      el.innerHTML = '<div class="empty" style="padding:var(--s2)">Nessuna azione registrata</div>';
      return;
    }
    var html = actions.map(function(a) {
      var icon = ACTION_ICONS[a.action_type] || '\u25CF';
      var color = ACTION_COLORS[a.action_type] || 'var(--dim)';
      var time = a.created_at ? fmtTime(a.created_at, 'time') : '';
      return '<div class="action-entry">' +
        '<span class="action-icon" style="color:' + color + '">' + icon + '</span>' +
        '<div class="action-content">' +
          '<div class="action-title">' + esc(a.title) + '</div>' +
          (a.details ? '<div class="action-details">' + esc(a.details).slice(0, 120) + '</div>' : '') +
          '<div class="action-meta">' + (a.agent_id ? esc(a.agent_id) + ' | ' : '') + time + '</div>' +
        '</div>' +
      '</div>';
    }).join('');
    el.insertAdjacentHTML('beforeend', html);
    actionsPage++;
  } catch (err) {
    console.error('loadActionTimeline:', err);
  }
}

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
`;
