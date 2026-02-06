/**
 * State GitHub — Issues, PRs, Discussions, Config
 * Drag-drop agent assignment, GH config
 */

export const stateGithubJs = `
// ── GITHUB ──

async function loadGitHubData(project) {
  if (!project) return;
  try {
    var [issuesRes, prsRes, discussionsRes] = await Promise.all([
      fetch('/api/github/issues?project=' + encodeURIComponent(project)),
      fetch('/api/github/prs?project=' + encodeURIComponent(project)),
      fetch('/api/github/discussions?project=' + encodeURIComponent(project))
    ]);
    var issues = await issuesRes.json();
    var prs = await prsRes.json();
    var discussions = await discussionsRes.json();
    renderGhIssues(Array.isArray(issues) ? issues : []);
    renderGhPRs(Array.isArray(prs) ? prs : []);
    renderGhDiscussions(Array.isArray(discussions) ? discussions : []);
    // Load config
    var configRes = await fetch('/api/github/config?project=' + encodeURIComponent(project));
    var config = await configRes.json();
    if (config.repo) document.getElementById('gh-repo').value = config.repo;
    if (config.default_branch) document.getElementById('gh-branch').value = config.default_branch;
  } catch (err) {
    console.error('loadGitHubData:', err);
  }
}

function renderGhIssues(issues) {
  document.getElementById('gh-issues-count').textContent = issues.length;
  renderList('gh-issues-list', issues, function(i) {
    var labels = (i.labels || []).map(function(l) {
      return '<span class="gh-label">' + esc(l.name) + '</span>';
    }).join('');
    return '<div class="gh-card gh-issue" draggable="true" data-issue-number="' + i.number + '" data-issue-title="' + esc(i.title) + '"' +
      ' ondragover="event.preventDefault();this.classList.add(\\'drop-target\\')"' +
      ' ondragleave="this.classList.remove(\\'drop-target\\')"' +
      ' ondrop="dropAgentOnIssue(event,this)">' +
      '<div class="gh-card-header">' +
        '<span class="gh-number">#' + i.number + '</span>' +
        '<span class="gh-title">' + esc(i.title) + '</span>' +
      '</div>' +
      '<div class="gh-card-meta">' +
        labels +
        '<span class="gh-author">' + esc(i.author?.login || '') + '</span>' +
        '<span class="gh-time">' + fmtTime(i.createdAt, 'date') + '</span>' +
      '</div>' +
    '</div>';
  }, 'Nessun issue');
}

function renderGhPRs(prs) {
  document.getElementById('gh-prs-count').textContent = prs.length;
  renderList('gh-prs-list', prs, function(p) {
    var draft = p.isDraft ? '<span class="gh-label" style="background:var(--dim)">draft</span>' : '';
    var review = p.reviewDecision ? '<span class="gh-label">' + esc(p.reviewDecision) + '</span>' : '';
    return '<div class="gh-card gh-pr">' +
      '<div class="gh-card-header">' +
        '<span class="gh-number">#' + p.number + '</span>' +
        '<span class="gh-title">' + esc(p.title) + '</span>' +
        draft +
      '</div>' +
      '<div class="gh-card-meta">' +
        '<span class="gh-branch">' + esc(p.headRefName) + ' \u2192 ' + esc(p.baseRefName) + '</span>' +
        review +
        '<span class="gh-author">' + esc(p.author?.login || '') + '</span>' +
      '</div>' +
    '</div>';
  }, 'Nessuna PR');
}

function renderGhDiscussions(discussions) {
  document.getElementById('gh-discussions-count').textContent = discussions.length;
  renderList('gh-discussions-list', discussions, function(d) {
    return '<div class="gh-card">' +
      '<div class="gh-card-header">' +
        '<span class="gh-number">#' + d.number + '</span>' +
        '<span class="gh-title">' + esc(d.title) + '</span>' +
      '</div>' +
      '<div class="gh-card-meta">' +
        '<span class="gh-label">' + esc(d.category?.name || '') + '</span>' +
        '<span class="gh-author">' + esc(d.author?.login || '') + '</span>' +
      '</div>' +
    '</div>';
  }, 'Nessuna discussione');
}

function toggleGhConfig() {
  var el = document.getElementById('gh-config');
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

async function saveGhConfig() {
  var repo = document.getElementById('gh-repo').value.trim();
  var branch = document.getElementById('gh-branch').value.trim() || 'main';
  if (!repo) { addLog('Repo richiesto (owner/repo)', 'error'); return; }
  try {
    await fetch('/api/github/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: S.project, repo: repo, default_branch: branch })
    });
    addLog('GitHub config salvato: ' + repo, 'event');
    document.getElementById('gh-config').style.display = 'none';
    loadGitHubData(S.project);
  } catch (err) {
    addLog('Errore config: ' + err, 'error');
  }
}

// Drop agent on issue (Phase 4 prep)
function dropAgentOnIssue(e, card) {
  e.preventDefault();
  card.classList.remove('drop-target');
  var agentData;
  try { agentData = JSON.parse(e.dataTransfer.getData('application/x-agent-def')); } catch { return; }
  var issueNumber = parseInt(card.dataset.issueNumber);
  var issueTitle = card.dataset.issueTitle;
  if (!agentData || !issueNumber) return;
  assignAgentToIssue(agentData.agent_def_id, issueNumber, issueTitle);
}

async function assignAgentToIssue(agentDefId, issueNumber, issueTitle) {
  addLog('[GitHub] Assigning agent to issue #' + issueNumber, 'agent-name');
  try {
    var res = await fetch('/api/github/assign-agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project: S.project,
        agent_def_id: agentDefId,
        issue_number: issueNumber,
        issue_title: issueTitle
      })
    });
    var result = await res.json();
    if (result.error) {
      addLog('[GitHub] ' + result.error, 'error');
    } else {
      addLog('[GitHub] Branch: ' + result.branch + ' — Agent dispatched', 'event');
    }
  } catch (err) {
    addLog('[GitHub] Assignment failed: ' + err, 'error');
  }
}
`;
