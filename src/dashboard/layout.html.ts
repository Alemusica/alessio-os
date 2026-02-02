/**
 * Dashboard HTML Layout — Structure + Components
 * Extracted from server.ts T2 tissue
 */

export function dashboardPage(opts: { css: string; js: string }): string {
  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ALESSIO-OS</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;1,9..40,300&family=DM+Mono:wght@300;400&family=Inter:wght@300;400;500;700&family=JetBrains+Mono:wght@300;400&display=swap" rel="stylesheet">
<style>
${opts.css}
</style>
<script src="https://cdn.jsdelivr.net/npm/granim@2.0.0/dist/granim.min.js"></script>
</head>
<body>

<!-- Ambient gradient — covers entire layout uniformly -->
<canvas id="granim-canvas"></canvas>

<header>
  <h1>Alessio-OS</h1>
  <span class="subtitle">PTI Multi-Agent Hub</span>
  <div style="position:relative;margin-left:auto;display:flex;align-items:center;gap:var(--s3)">
    <button class="typo-gear" onclick="toggleTypoMenu()" title="Design Tokens">&#9881;</button>
    <div class="typo-popover" id="typo-popover">
      <label>Font <span class="typo-size-display" id="typo-font-val"></span></label>
      <select id="typo-font" onchange="applyTokens()">
        <option value="'Helvetica Neue', Helvetica, Arial, sans-serif" selected>Helvetica Neue</option>
        <option value="'DM Sans', 'Helvetica Neue', -apple-system, sans-serif">DM Sans</option>
        <option value="'Inter', -apple-system, sans-serif">Inter</option>
        <option value="-apple-system, BlinkMacSystemFont, sans-serif">System</option>
      </select>
      <label>Mono</label>
      <select id="typo-mono" onchange="applyTokens()">
        <option value="'DM Mono', 'SF Mono', 'Menlo', monospace">DM Mono</option>
        <option value="'SF Mono', 'Menlo', monospace" selected>SF Mono</option>
        <option value="'JetBrains Mono', 'Menlo', monospace">JetBrains Mono</option>
      </select>
      <label>Base size <span class="typo-size-display" id="typo-size-val">13px</span></label>
      <input type="range" min="8" max="21" step="1" value="13" id="typo-size" oninput="applyTokens()">
      <label>Line height</label>
      <select id="typo-lh" onchange="applyTokens()">
        <option value="1.4">1.4 — compatto</option>
        <option value="1.618" selected>&#966; 1.618 — golden</option>
        <option value="1.8">1.8 — arioso</option>
      </select>
      <label>Weight</label>
      <select id="typo-weight" onchange="applyTokens()">
        <option value="300">300 — light</option>
        <option value="400" selected>400 — regular</option>
        <option value="500">500 — medium</option>
      </select>
      <label>Letter-spacing</label>
      <select id="typo-tracking" onchange="applyTokens()">
        <option value="-0.02em">stretto</option>
        <option value="-0.01em" selected>standard</option>
        <option value="0em">neutro</option>
        <option value="0.02em">aperto</option>
      </select>
      <label>Spacing scale</label>
      <select id="typo-spacing" onchange="applyTokens()">
        <option value="phi" selected>&#966; PHI (8 13 21 34 55 89 144)</option>
        <option value="compact">Compact (4 8 12 16 24 32 48)</option>
        <option value="relaxed">Relaxed (8 16 24 32 48 64 96)</option>
      </select>
      <label>Theme</label>
      <button class="night-toggle" id="night-btn" onclick="toggleNight()">
        <span id="night-icon">&#9790;</span> Night view
      </button>
      <label>Ambient</label>
      <select id="granim-palette" onchange="applyGranim()">
        <option value="warm" selected>Warm (amber/gold)</option>
        <option value="cool">Cool (blue/steel)</option>
        <option value="earth">Earth (green/moss)</option>
        <option value="rose">Rose (pink/copper)</option>
        <option value="off">Off</option>
      </select>
      <label>Intensity <span class="typo-size-display" id="granim-opacity-val">10%</span></label>
      <input type="range" min="0" max="30" step="2" value="10" id="granim-opacity" oninput="applyGranim()">
      <label>Debug</label>
      <button class="night-toggle" id="probe-btn" onclick="toggleProbe()">
        PTI Probe
      </button>
      <label style="margin-top:var(--s4);border-top:1px solid var(--border);padding-top:var(--s3)">Rytmo Mapping</label>
      <div id="rytmo-panel"></div>
      <div style="display:flex;gap:var(--s1);margin-top:var(--s2)">
        <button class="night-toggle" style="flex:1" onclick="rytmoAddSlot()">+ Mapping</button>
      </div>
      <label>Tap gap <span class="typo-size-display" id="rytmo-gap-val"></span></label>
      <input type="range" min="200" max="800" step="50" value="400" id="rytmo-gap" oninput="rytmoGapChange()">
      <label style="margin-top:var(--s4);border-top:1px solid var(--border);padding-top:var(--s3)">Server</label>
      <button class="night-toggle" onclick="restartServer()">Riavvia Server</button>
    </div>
    <div class="health-indicator" id="health">
      <span class="dot" id="health-dot"></span>
      <span id="health-text">connesso</span>
    </div>
  </div>
</header>

<div class="layout">

  <!-- SIDEBAR -->
  <aside class="sidebar">
    <div class="nav-section">
      <div class="nav-label">Progetti</div>
      <div id="projects-nav"></div>
    </div>
    <div class="nav-divider"></div>
    <div class="nav-section">
      <div class="nav-label">Files</div>
      <div id="files-nav">
        <a class="file-link" href="vscode://file/Users/alessioivoycazzaniga/alessio-os/src/pti/graph.ts">graph.ts</a>
        <a class="file-link" href="vscode://file/Users/alessioivoycazzaniga/alessio-os/src/pti/surreal-bridge.ts">surreal-bridge.ts</a>
        <a class="file-link" href="vscode://file/Users/alessioivoycazzaniga/alessio-os/src/agents/orchestrator.ts">orchestrator.ts</a>
        <a class="file-link" href="vscode://file/Users/alessioivoycazzaniga/alessio-os/src/dashboard/server.ts">dashboard.ts</a>
      </div>
    </div>
  </aside>

  <!-- MAIN CONTENT -->
  <div class="main">
    <!-- Breadcrumb + Inline Views -->
    <div class="breadcrumb">
      <span class="bc-link" id="bc-home" onclick="goHome()">home</span>
      <span class="bc-sep" id="bc-sep1" style="display:none">/</span>
      <span class="bc-link" id="bc-project" style="display:none" onclick="goProject()"></span>
      <span class="bc-sep" id="bc-sep2" style="display:none">/</span>
      <span id="bc-session" style="display:none"></span>
      <span class="view-tabs" id="view-tabs">
        <span class="view-tab active" data-view="chat" onclick="switchView('chat')">Chat</span>
        <span class="vt-sep">|</span>
        <span class="view-tab" data-view="timeline" onclick="switchView('timeline')">Timeline</span>
        <span class="vt-sep">|</span>
        <span class="view-tab" data-view="agents" onclick="switchView('agents')">Agenti<span class="nav-count" id="sidebar-agent-count">0</span></span>
        <span class="vt-sep">|</span>
        <span class="view-tab" data-view="tasks" onclick="switchView('tasks')">Tasks<span class="nav-count" id="sidebar-task-count">0</span></span>
        <span class="vt-sep">|</span>
        <span class="view-tab" data-view="kb" onclick="switchView('kb')">KB</span>
        <span class="vt-sep">|</span>
        <span class="view-tab" data-view="github" onclick="switchView('github')">GitHub</span>
        <span class="view-tab" data-view="mcp" onclick="switchView('mcp')">MCP</span>
        <span class="vt-sep">|</span>
        <span class="view-tab" data-view="graph" onclick="switchView('graph')">Graph</span>
      </span>
      <div class="agents-strip" id="agents-strip"></div>
      <div class="bc-search">
        <input type="text" id="search-input" placeholder="Cerca nelle chat..." onkeydown="if(event.key==='Enter')doSearch()">
      </div>
    </div>

    <!-- CHAT VIEW -->
    <div id="chat-view" class="view active">
      <div class="view-scroll" id="chat-content">
        <div id="sessions-grid" class="sessions-grid"></div>
        <div id="messages-area" class="messages-list" style="display:none;"></div>
      </div>

      <!-- DROP ZONE + COMMAND INPUT -->
      <div class="drop-zone" id="drop-zone">
        <div class="cmd-area">
          <textarea class="cmd-input" id="cmd-input" rows="1" placeholder="Scrivi un comando o task..." onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendCommand();}"></textarea>
          <button class="btn-send" onclick="sendCommand()">Invia</button>
        </div>
        <span class="dz-prompt" id="dz-prompt">| Drop OCR/STT</span>
        <input type="file" id="file-input" multiple accept="image/*,audio/*" hidden>
        <div class="dz-actions">
          <button class="btn btn-ghost" onclick="document.getElementById('file-input').click()">File</button>
          <button class="btn btn-rec" id="mic-btn" onclick="toggleMic()">Rec</button>
        </div>
      </div>
    </div>

    <!-- AGENTS VIEW -->
    <div id="agents-view" class="view">
      <div class="view-scroll">
        <div class="section-title">Agenti Definiti <span class="count" id="agent-def-count">0</span>
          <button class="btn-inline" onclick="toggleAgentForm()">+ Nuovo</button>
        </div>
        <div id="agent-form" style="display:none;padding:var(--s2);border:1px solid var(--border);border-radius:var(--s1);margin-bottom:var(--s2)">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--s1)">
            <input id="adf-name" placeholder="Nome agente" class="cmd-input" style="height:var(--row)">
            <select id="adf-role" class="cmd-input" style="height:var(--row)">
              <option value="coder">coder</option>
              <option value="tester">tester</option>
              <option value="reviewer">reviewer</option>
              <option value="researcher">researcher</option>
              <option value="auditor">auditor</option>
            </select>
          </div>
          <textarea id="adf-identity" placeholder="Identit\u00e0 custom (opzionale)" class="cmd-input" style="height:55px;margin-top:var(--s1);resize:vertical"></textarea>
          <div style="display:flex;gap:var(--s1);margin-top:var(--s1)">
            <select id="adf-paradigm" class="cmd-input" style="height:var(--row);flex:1"></select>
            <button class="btn-inline" onclick="createAgentDef()">Crea</button>
            <button class="btn-inline" onclick="toggleAgentForm()" style="color:var(--dim)">Annulla</button>
          </div>
        </div>
        <div id="agent-defs-list"></div>
        <div class="section-title" style="margin-top:var(--s3)">In Esecuzione <span class="count" id="agent-count">0</span></div>
        <div id="agents-list"><div class="empty">Nessun agente attivo</div></div>
      </div>
    </div>

    <!-- TASKS VIEW -->
    <div id="tasks-view" class="view">
      <div class="view-scroll">
        <div class="section-title">Task Queue <span class="count" id="task-count">0</span></div>
        <div id="tasks-list"><div class="empty">Nessun task</div></div>
      </div>
    </div>

    <!-- KB VIEW -->
    <div id="kb-view" class="view">
      <div class="view-scroll">
        <div class="section-title">Knowledge Base</div>
        <div class="stats-grid" id="kb-stats">
          <div class="stat"><div class="num" id="kb-knowledge">-</div><div class="label">Knowledge</div></div>
          <div class="stat"><div class="num" id="kb-papers">-</div><div class="label">Papers</div></div>
          <div class="stat"><div class="num" id="kb-exp">-</div><div class="label">Experience</div></div>
          <div class="stat"><div class="num" id="kb-entities">-</div><div class="label">Entities</div></div>
          <div class="stat"><div class="num" id="kb-agents-count">-</div><div class="label">Agents</div></div>
          <div class="stat"><div class="num" id="kb-tasks-count">-</div><div class="label">Tasks</div></div>
        </div>
      </div>
    </div>

    <!-- TIMELINE VIEW -->
    <div id="timeline-view" class="view">
      <div class="view-scroll" id="timeline-scroll">
        <div class="section-title">Timeline
          <span class="tl-mode-tabs">
            <span class="tl-mode active" data-mode="actions" onclick="switchTimelineMode('actions')">Actions</span>
            <span class="tl-mode" data-mode="chat" onclick="switchTimelineMode('chat')">Chat</span>
          </span>
        </div>
        <div id="actions-timeline"></div>
        <div id="chat-timeline" style="display:none">
          <div id="timeline-list"></div>
          <button class="tl-load-more" id="tl-load-more" onclick="loadMoreTimeline()">Carica altri</button>
        </div>
      </div>
    </div>

    <!-- GITHUB VIEW -->
    <div id="github-view" class="view">
      <div class="view-scroll">
        <div class="section-title">GitHub
          <button class="btn-inline" onclick="toggleGhConfig()">Config</button>
          <button class="btn-inline" onclick="loadGitHubData(S.project)">Refresh</button>
        </div>
        <div id="gh-config" style="display:none;padding:var(--s2);border:1px solid var(--border);border-radius:var(--s1);margin-bottom:var(--s2)">
          <div style="display:flex;gap:var(--s1);align-items:center">
            <input id="gh-repo" placeholder="owner/repo" class="cmd-input" style="height:var(--row);flex:1">
            <input id="gh-branch" placeholder="main" class="cmd-input" style="height:var(--row);width:80px" value="main">
            <button class="btn-inline" onclick="saveGhConfig()">Salva</button>
          </div>
        </div>
        <div class="section-title" style="font-size:var(--fs-xs)">Issues <span class="count" id="gh-issues-count">0</span></div>
        <div id="gh-issues-list"></div>
        <div class="section-title" style="font-size:var(--fs-xs);margin-top:var(--s2)">Pull Requests <span class="count" id="gh-prs-count">0</span></div>
        <div id="gh-prs-list"></div>
        <div class="section-title" style="font-size:var(--fs-xs);margin-top:var(--s2)">Discussions <span class="count" id="gh-discussions-count">0</span></div>
        <div id="gh-discussions-list"></div>
      </div>
    </div>

    <!-- MCP VIEW -->
    <div id="mcp-view" class="view">
      <div class="view-scroll">
        <div class="section-title">MCP Servers</div>
        <div class="mcp-grid" id="mcp-grid">
          <div class="empty">Caricamento...</div>
        </div>
      </div>
    </div>

    <!-- GRAPH VIEW -->
    <div id="graph-view" class="view">
      <div class="graph-toolbar">
        <div class="section-title">PTI Graph <span class="count" id="graph-node-count">0</span></div>
        <select id="graph-project-select" onchange="loadGraphProject(this.value)" style="font-family:var(--mono);font-size:var(--fs-xs);padding:var(--s0) 0;border:none;border-bottom:1px solid var(--border);background:transparent;color:var(--text)">
          <option value="">alessio-os</option>
        </select>
        <div class="graph-legend">
          <span class="gl-item"><span class="gl-dot gl-fatto"></span>FATTO</span>
          <span class="gl-item"><span class="gl-dot gl-derivato"></span>DERIVATO</span>
          <span class="gl-item"><span class="gl-dot gl-azione"></span>AZIONE</span>
          <span class="gl-item"><span class="gl-dot gl-assert"></span>ASSERT</span>
          <span class="gl-item"><span class="gl-dot gl-modulo"></span>MODULO</span>
        </div>
        <button class="btn btn-ghost btn-active" id="btn-toggle-code" onclick="toggleCodeGraph()">Code</button>
        <button class="btn btn-ghost" onclick="graphSnapshot()">Snapshot</button>
        <button class="btn btn-ghost" onclick="graphDiff()">Diff</button>
        <button class="btn btn-ghost" onclick="graphFitAll()">Fit</button>
        <div class="diff-summary" id="diff-summary" style="display:none"></div>
      </div>
      <div class="graph-container" id="graph-container">
        <svg id="graph-svg" xmlns="http://www.w3.org/2000/svg"></svg>
      </div>
      <div class="graph-inspector" id="graph-inspector">
        <div class="gi-header">
          <span class="gi-title" id="gi-title"></span>
          <button class="btn-close" onclick="closeInspector()">&times;</button>
        </div>
        <div class="gi-body" id="gi-body"></div>
      </div>
    </div>

    <!-- TERMINAL -->
    <div class="terminal-panel" id="terminal-panel">
      <div class="tp-header" onclick="toggleTerminal()">
        <span class="tp-title">Terminal / Thinking</span>
        <span class="tp-badge" id="log-count">0</span>
        <span class="tp-toggle" id="tp-toggle">&minus;</span>
      </div>
      <div id="terminal"></div>
    </div>
  </div>

</div>

<script>
${opts.js}
</script>

<!-- DEBUG PANEL -->
<button class="debug-toggle" onclick="toggleDebug()" title="Debug Panel">&#9881;</button>
<div class="debug-panel" id="debug-panel">
  <div class="debug-header" onclick="toggleDebug()">
    <span class="dot"></span> Agent Debug Monitor
  </div>
  <div class="debug-body" id="debug-body">
    <div class="debug-entry" style="color:var(--dim)">In attesa di eventi...</div>
  </div>
</div>

<!-- PTI Probe Bar -->
<div class="pti-probe-bar" id="pti-probe-bar"></div>

</body>
</html>`;
}
