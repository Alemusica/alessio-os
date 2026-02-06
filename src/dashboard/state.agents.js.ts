/**
 * State Agents — Definizioni agenti + MCP status
 * CRUD agenti, paradigm select, MCP grid
 */

export const stateAgentsJs = `
// ── AGENT DEFINITIONS (persistent, per-project) ──

var agentDefs = [];

async function loadAgentDefinitions(project) {
  assert(project, 'loadAgentDefinitions: project richiesto');
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
  var countEl = document.getElementById('agent-def-count');
  if (countEl) countEl.textContent = defs.length;
  renderList('agent-defs-list', defs, function(d) {
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
  }, 'Nessun agente definito');
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
`;
