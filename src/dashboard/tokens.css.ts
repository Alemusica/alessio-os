/**
 * Dashboard CSS Design System — Swiss Typography + PHI Spacing
 * Extracted from server.ts T1 tissue
 */

export const css = `
  :root {
    --bg: #FAF8F5;
    --surface: #FFFFFF;
    --border: #E8E4DF;
    --border-strong: #D4CFC8;
    --text: #2C2926;
    --text-secondary: #6B6560;
    --dim: #9E9891;
    --accent: #8B7355;
    --accent-light: #B8A48A;
    --accent-bg: #F5F0EB;
    --green: #6B8F71;
    --green-bg: #EFF5F0;
    --amber: #B8923F;
    --amber-bg: #FBF6ED;
    --rose: #B07070;
    --rose-bg: #F9F0F0;
    --blue: #6B839E;
    --blue-bg: #F0F3F7;
    --font: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    --mono: 'SF Mono', 'Menlo', 'DM Mono', monospace;
    /* φ = 1.618 — scala Fibonacci per ogni livello PTI */
    --phi: 1.618;
    /* Spacing: atomo(8)→molecola(13)→cellula(21)→tessuto(34)→organo(55)→sistema(89)→layout(144,233) */
    --s0: 5px; --s1: 8px; --s2: 13px; --s3: 21px; --s4: 34px; --s5: 55px; --s6: 89px; --s7: 144px; --s8: 233px;
    /*
     * ── PTI POSITION DNA ──
     * Ogni elemento porta la sua posizione come codice genetico.
     * --row: unità atomica di riga — tutti gli elementi interattivi
     *        occupano esattamente 1 row (34px = Fibonacci).
     * --gutter: margine interno dei container — identico per sidebar,
     *           breadcrumb, drop-zone, toolbar. Garantisce che la prima
     *           riga di ogni colonna cada sulla stessa linea Y assoluta.
     * Regola: se due elementi condividono --row e il loro container
     * condivide --gutter, si allineano orizzontalmente a prescindere
     * dalla gerarchia DOM. La posizione è deterministica.
     */
    --row: var(--s4);      /* 34px — altezza atomica universale */
    --gutter-v: var(--s2);  /* 13px — padding verticale container */
    --gutter-h: var(--s5);  /* 55px — padding orizzontale container */
    /* Font scale: 8→13→21→34 (Fibonacci puro), intermedi come medie geometriche */
    --fs-base: 13px;
    --fs-2xs: 8px;
    --fs-xs: 10px;
    --fs-sm: 11px;
    --fs-body: 13px;
    --fs-lg: 18px;
    --fs-xl: 21px;
    --fs-2xl: 34px;
    --tracking: -0.01em;
    --radius: 0; --radius-sm: 0;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: var(--font);
    background: var(--bg);
    color: var(--text);
    font-size: var(--fs-base);
    font-weight: 400;
    line-height: calc(1em * var(--phi));
    height: 100vh;
    overflow: hidden;
    -webkit-font-smoothing: antialiased;
    display: flex;
    flex-direction: column;
  }

  /* ── HEADER ── */
  header {
    display: flex;
    align-items: baseline;
    gap: var(--s4);
    padding: var(--gutter-v) var(--gutter-h);
    border-bottom: 1.5px solid var(--text);
    flex-shrink: 0;
  }
  h1 {
    font-size: var(--fs-body);
    font-weight: 500;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  .subtitle {
    font-size: var(--fs-sm);
    font-weight: 300;
    color: var(--dim);
    letter-spacing: 0.04em;
  }
  .health-indicator {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: var(--s2);
    font-size: var(--fs-sm);
    color: var(--green);
  }
  .health-indicator .dot {
    width: var(--s1); height: var(--s1);
    border-radius: 50%;
    background: var(--green);
    animation: breathe 3s ease-in-out infinite;
  }
  @keyframes breathe {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(0.85); }
  }

  /* ── LAYOUT ── */
  .layout {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  /* ── SIDEBAR ── */
  .sidebar {
    width: var(--s8); /* 233px Fibonacci */
    background: transparent;
    border-right: none;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    flex-shrink: 0;
  }
  .sidebar::-webkit-scrollbar { width: 3px; }
  .sidebar::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

  .nav-section {
    padding: 0 var(--gutter-v);
  }
  .nav-section:first-child {
    padding-top: var(--gutter-v);
  }
  .nav-label {
    font-family: var(--mono);
    font-size: var(--fs-sm);
    font-weight: 500;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--dim);
    height: var(--row);
    line-height: var(--row);
    margin-bottom: 0;
  }
  .nav-item {
    display: flex;
    align-items: center;
    gap: var(--s2);
    width: 100%;
    height: var(--row);
    padding: 0 var(--gutter-v);
    margin-bottom: 0;
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    font-family: var(--font);
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    text-align: left;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .nav-item:hover { color: var(--text); }
  .nav-item.active {
    color: var(--accent);
    font-weight: 500;
    border-left: 2px solid var(--accent);
  }
  .nav-item .nav-count {
    margin-left: auto;
    font-family: var(--mono);
    font-size: var(--fs-2xs);
    color: var(--dim);
    flex-shrink: 0;
  }
  .nav-divider {
    height: 0;
    margin: var(--s2) 0;
  }

  /* ── MAIN ── */
  .main {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* ── BREADCRUMB ── */
  .breadcrumb {
    padding: var(--gutter-v) var(--gutter-h);
    background: transparent;
    border-bottom: none;
    font-family: var(--mono);
    font-size: var(--fs-sm);
    color: var(--dim);
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: var(--s2);
    min-height: calc(var(--row) + var(--gutter-v) * 2);
  }
  .breadcrumb .bc-link {
    color: var(--accent);
    cursor: pointer;
    text-decoration: none;
  }
  .breadcrumb .bc-link:hover { text-decoration: underline; }
  .breadcrumb .bc-sep { color: var(--border-strong); }

  /* ── INLINE VIEW TABS (Swiss | pipe separators) ── */
  .view-tabs {
    display: inline-flex;
    align-items: center;
    gap: var(--s1);
    margin-left: var(--s2);
  }
  .view-tab {
    font-family: var(--mono);
    font-size: var(--fs-xs);
    color: var(--dim);
    cursor: pointer;
    transition: color 0.15s ease;
    letter-spacing: 0.02em;
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    gap: var(--s0);
  }
  .view-tab:hover { color: var(--text); }
  .view-tab.active {
    color: var(--accent);
    font-weight: 500;
  }
  .view-tab .nav-count {
    font-family: var(--mono);
    font-size: var(--fs-2xs);
    color: var(--dim);
    margin-left: 2px;
  }
  .vt-sep {
    color: var(--border-strong);
    font-size: var(--fs-xs);
    user-select: none;
  }

  /* ── VIEWS ── */
  .view { display: none; flex: 1; overflow: hidden; flex-direction: column; }
  .view.active { display: flex; }

  .view-scroll { flex: 1; overflow-y: auto; padding: var(--gutter-h); position: relative; }
  .view-scroll::-webkit-scrollbar { width: 4px; }
  .view-scroll::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

  /* ── ORGANIC SCROLL GLOW — on inner scrollable blocks ── */
  .md-code.scrolling,
  .msg-body.scrolling {
    box-shadow: inset 0 0 30px -8px rgba(139, 115, 85, 0.20),
                inset 0 -20px 20px -12px rgba(139, 115, 85, 0.12);
    transition: box-shadow 0.5s ease-in;
  }
  .night .md-code.scrolling,
  .night .msg-body.scrolling {
    box-shadow: inset 0 0 30px -8px rgba(196, 164, 120, 0.18),
                inset 0 -20px 20px -12px rgba(196, 164, 120, 0.10);
  }
  .md-code:not(.scrolling),
  .msg-body:not(.scrolling) {
    transition: box-shadow 1.2s ease-out;
  }
  @keyframes scroll-pulse {
    0%, 100% { opacity: 0; }
    50% { opacity: 0.3; }
  }

  /* ── SESSIONS GRID ── */
  .sessions-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(var(--s8), 1fr));
    gap: var(--s3);
  }
  .session-card {
    padding: var(--s3) 0;
    background: none;
    border: none;
    border-bottom: 1px solid var(--border);
    cursor: pointer;
    transition: color 0.15s ease;
  }
  .session-card:last-child { border-bottom: none; }
  .session-card:hover {
    color: var(--accent);
  }
  .session-card .sc-id {
    font-family: var(--mono);
    font-size: var(--fs-xs);
    color: var(--accent);
    margin-bottom: var(--s1);
  }
  .session-card .sc-meta {
    font-size: var(--fs-sm);
    color: var(--dim);
    display: flex;
    gap: var(--s4);
  }
  .session-card .sc-preview {
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    margin-top: var(--s2);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  /* ── MESSAGES — Swiss Typography, no bubbles ── */
  .messages-list {
    display: flex;
    flex-direction: column;
    gap: 0;
  }
  /* ── MESSAGES — Editorial Dialog (Swiss theater-script) ── */
  .msg {
    max-width: 100%;
    padding: var(--s3) 0;
    border: none;
    border-radius: 0;
    background: none;
    position: relative;
    border-bottom: 1px solid var(--border);
  }
  .msg:last-child { border-bottom: none; }

  /* USER — flush left, lighter, understated */
  .msg-user {
    align-self: stretch;
    padding-left: 0;
  }

  /* ASSISTANT — indented, thick left border, stronger presence */
  .msg-assistant {
    align-self: stretch;
    margin-left: var(--s5);
    padding-left: var(--s3);
    border-left: 3px solid var(--blue);
  }

  .msg-header {
    display: flex;
    justify-content: flex-start;
    align-items: baseline;
    gap: var(--s2);
    margin-bottom: var(--s1);
  }
  .msg-role {
    font-family: var(--font);
    font-size: var(--fs-2xs);
    font-weight: 500;
    letter-spacing: 0.15em;
    text-transform: uppercase;
  }
  .msg-user .msg-role { color: var(--dim); }
  .msg-assistant .msg-role { color: var(--blue); }
  .msg-time {
    font-family: var(--mono);
    font-size: var(--fs-2xs);
    color: var(--dim);
    opacity: 0.4;
  }
  .msg-body {
    font-size: var(--fs-body);
    line-height: calc(1em * var(--phi));
    color: var(--text);
    white-space: pre-wrap;
    word-wrap: break-word;
    max-height: 610px; /* ~377+233 = Fibonacci sum */
    overflow-y: auto;
    letter-spacing: var(--tracking);
  }
  .msg-user .msg-body {
    font-weight: 400;
    color: var(--text);
  }
  .msg-assistant .msg-body {
    font-weight: 300;
  }
  .msg-body::-webkit-scrollbar { width: 2px; }
  .msg-body::-webkit-scrollbar-thumb { background: var(--border); }

  /* THINKING — italic, dimmed, collapsible */
  .msg-thinking {
    font-style: italic;
    color: var(--dim);
    font-size: var(--fs-sm);
    line-height: calc(1em * var(--phi));
    opacity: 0.7;
    max-height: 144px; /* var(--s7) */
    overflow-y: auto;
    margin-bottom: var(--s1);
    padding-left: var(--s2);
    border-left: 1px solid var(--dim);
    cursor: pointer;
    transition: max-height 0.3s ease;
  }
  .msg-thinking.collapsed {
    max-height: calc(var(--fs-sm) * 1.618);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .msg-thinking-label {
    font-family: var(--mono);
    font-size: var(--fs-2xs);
    color: var(--dim);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin-bottom: var(--s0);
    display: flex;
    align-items: center;
    gap: var(--s1);
    cursor: pointer;
  }
  .msg-thinking-label::before {
    content: '';
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--dim);
    animation: think-pulse 1.5s ease-in-out infinite;
  }
  .msg-thinking-label.done::before { animation: none; opacity: 0.4; }
  @keyframes think-pulse {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 1; }
  }

  /* ── RESULT CARD (OCR/STT) — Swiss, no radius ── */
  .result-card {
    margin: var(--s2) 0;
    padding: var(--s2) var(--s3);
    background: none;
    border: none;
    border-left: 2px solid var(--green);
    border-radius: 0;
  }
  .result-card.error {
    border-left-color: var(--rose);
  }
  .result-card .rc-title {
    font-family: var(--font);
    font-size: var(--fs-xs);
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--green);
    margin-bottom: var(--s0);
  }
  .result-card.error .rc-title { color: var(--rose); }
  .result-card .rc-body {
    font-size: var(--fs-body);
    line-height: calc(1em * var(--phi));
    white-space: pre-wrap;
    word-wrap: break-word;
    color: var(--text);
    font-weight: 300;
  }
  .result-card .rc-meta {
    font-family: var(--mono);
    font-size: var(--fs-2xs);
    color: var(--dim);
    margin-top: var(--s0);
  }

  /* ── DROP ZONE ── */
  .drop-zone {
    padding: var(--gutter-v) var(--gutter-h);
    background: transparent;
    border-top: none;
    flex-shrink: 0;
    display: flex;
    align-items: end;
    gap: var(--s2);
    transition: all 0.2s ease;
  }
  .drop-zone.drag-over {
    background: var(--green-bg);
    border-top-color: var(--green);
  }
  .drop-zone.drag-over .dz-prompt { color: var(--green); }
  .dz-prompt {
    font-size: var(--fs-sm);
    color: var(--dim);
    flex: 1;
    min-width: 0;
    height: var(--row);
    line-height: var(--row);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dz-actions { display: flex; gap: var(--s2); flex-shrink: 0; align-items: center; }
  .btn {
    padding: 0 var(--s3);
    height: var(--row);
    border-radius: var(--radius-sm);
    font-family: var(--font);
    font-size: var(--fs-sm);
    font-weight: 500;
    cursor: pointer;
    border: 1px solid;
    transition: all 0.15s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--s2);
  }
  .btn-ghost {
    background: none;
    border-color: transparent;
    color: var(--text-secondary);
  }
  .btn-ghost:hover { color: var(--accent); border-color: transparent; }
  .btn-accent {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .btn-accent:hover { background: var(--accent-light); border-color: var(--accent-light); }
  .btn-rec {
    background: none;
    border-color: transparent;
    color: var(--rose);
  }
  .btn-rec:hover { color: var(--text); }
  .btn-rec.recording {
    color: var(--rose);
    border-bottom: 2px solid var(--rose);
    animation: pulse 1.5s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.04); }
  }
  .loading-spinner {
    display: inline-block;
    width: var(--s2); height: var(--s2);
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── AGENT THINKING GLOW ── */
  .main.thinking {
    position: relative;
    border-left: 2px solid rgba(196, 164, 120, 0.6);
  }
  .main.thinking::before {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 100;
    background: linear-gradient(180deg,
      rgba(196, 164, 120, 0.08) 0%,
      transparent 30%,
      transparent 70%,
      rgba(196, 164, 120, 0.08) 100%);
    box-shadow: inset 0 0 120px -10px rgba(196, 164, 120, 0.15),
                inset 0 0 40px -5px rgba(196, 164, 120, 0.1);
    animation: agent-glow 2s ease-in-out infinite;
  }
  .main.thinking::after {
    content: '';
    position: absolute;
    top: 0; left: -2px;
    width: 2px; height: 100%;
    background: rgba(196, 164, 120, 0.8);
    box-shadow: 0 0 15px 3px rgba(196, 164, 120, 0.4),
                0 0 40px 8px rgba(196, 164, 120, 0.15);
    animation: agent-glow 2s ease-in-out infinite;
    pointer-events: none;
    z-index: 101;
  }
  @keyframes agent-glow {
    0%, 100% { opacity: 0.5; }
    50% { opacity: 1; }
  }
  .main.thinking .cmd-area {
    box-shadow: 0 0 25px -5px rgba(196, 164, 120, 0.25);
    border-color: rgba(196, 164, 120, 0.4);
  }

  /* ── PTI GRAPH VIEW — Swiss, PHI spacing ── */
  .graph-toolbar {
    display: flex; align-items: center; gap: var(--s4);
    padding: var(--gutter-v) var(--gutter-h);
    border-bottom: none; flex-shrink: 0;
  }
  .graph-legend {
    display: flex; gap: var(--s3);
    font-size: var(--fs-2xs); text-transform: uppercase;
    letter-spacing: 0.08em; color: var(--dim);
  }
  .gl-item { display: flex; align-items: center; gap: var(--s0); }
  .gl-dot { display: inline-block; width: var(--s1); height: var(--s1); border-radius: 50%; }
  .gl-fatto { background: var(--blue); }
  .gl-derivato { background: var(--green); }
  .gl-azione { background: var(--amber); }
  .gl-assert { background: var(--rose); }
  .gl-modulo { background: var(--accent); }
  .btn-active { background: var(--accent-bg) !important; color: var(--accent) !important; }
  .graph-container {
    flex: 1; overflow: hidden; position: relative; background: var(--bg);
  }
  #graph-svg { width: 100%; height: 100%; }
  .g-node rect { stroke-width: 1.5; rx: 0; ry: 0; cursor: pointer; }
  .g-node text {
    font-family: var(--mono); font-size: 10px; fill: var(--text);
    pointer-events: none;
  }
  .g-node.fatto rect { fill: var(--blue-bg); stroke: var(--blue); }
  .g-node.derivato rect { fill: var(--green-bg); stroke: var(--green); }
  .g-node.azione rect { fill: var(--amber-bg); stroke: var(--amber); }
  .g-node.assert rect { fill: var(--rose-bg); stroke: var(--rose); }
  .g-node.modulo rect { fill: var(--accent-bg); stroke: var(--accent); rx: 8; ry: 8; }
  .g-node.modulo text { font-size: 9px; }
  .g-mod-sub { font-size: 8px; fill: var(--dim); }
  .g-node.active rect { stroke-width: 3; }
  .g-node:hover rect { filter: brightness(0.93); }
  .g-edge { stroke: var(--border-strong); stroke-width: 1; fill: none; }
  .g-edge.salto { stroke-dasharray: 4 3; stroke: var(--accent-light); }
  .g-edge.modulo-dep { stroke: var(--accent-light); stroke-width: 1; stroke-dasharray: 3 3; }
  .g-edge.active { stroke: var(--accent); stroke-width: 2; }
  .g-edge-arrow { fill: var(--border-strong); }
  .graph-inspector {
    position: absolute; top: var(--s3); right: var(--s3);
    width: calc(var(--s8) + var(--s6)); /* 233+89 = 322 ≈ Fibonacci sum */
    background: var(--bg);
    border: none; border-left: 2px solid var(--accent);
    box-shadow: none;
    z-index: 10; font-size: var(--fs-sm);
    display: none;
  }
  .gi-header {
    display: flex; justify-content: space-between; align-items: center;
    padding: var(--s2) var(--s3);
    border-bottom: none;
    font-weight: 500; text-transform: uppercase;
    letter-spacing: 0.08em; font-size: var(--fs-xs);
  }
  .gi-body { padding: var(--s3); max-height: 400px; overflow-y: auto; }
  .gi-field { margin-bottom: var(--s2); }
  .gi-label {
    font-size: var(--fs-2xs); font-weight: 500; text-transform: uppercase;
    letter-spacing: 0.1em; color: var(--dim); display: block;
    margin-bottom: var(--s0);
  }
  .gi-body pre {
    font-family: var(--mono); font-size: var(--fs-2xs);
    background: var(--bg); padding: var(--s1); overflow-x: auto;
    white-space: pre-wrap; word-break: break-all;
  }
  .gi-link {
    display: block; color: var(--accent); cursor: pointer;
    font-family: var(--mono); font-size: var(--fs-2xs);
    padding: var(--s0) 0;
  }
  .gi-link:hover { text-decoration: underline; }
  .gi-chain-item {
    font-family: var(--mono); font-size: var(--fs-2xs);
    padding: var(--s0) 0; color: var(--text-secondary);
  }
  .gi-chain-item::before { content: '← '; color: var(--dim); }
  @keyframes pti-pulse {
    0% { opacity: 1; }
    50% { opacity: 0.4; }
    100% { opacity: 1; }
  }
  .g-node.propagating rect { animation: pti-pulse 0.6s ease-out; stroke-width: 3; }
  .g-edge.propagating { stroke: var(--accent); stroke-width: 3; animation: pti-pulse 0.6s ease-out; }

  /* ── DIFF STRUTTURALE OVERLAY ── */
  .g-node.diff-aggiunto rect { fill: rgba(52,199,89,0.25); stroke: var(--green); stroke-width: 3; }
  .g-node.diff-rimosso rect { fill: rgba(255,59,48,0.2); stroke: var(--rose); stroke-width: 3; stroke-dasharray: 4 3; }
  .g-node.diff-modificato rect { fill: rgba(255,159,10,0.2); stroke: var(--amber); stroke-width: 3; }
  .diff-summary { display:flex; align-items:center; gap:var(--s2); font:var(--fw) calc(var(--fs-sm) * 1px)/1.4 var(--font-mono); padding:var(--s1) var(--s3); }
  .ds-added { color: var(--green); }
  .ds-removed { color: var(--rose); }
  .ds-modified { color: var(--amber); }
  .ds-unchanged { color: var(--dim); }

  /* ── TERMINAL / THINKING PANEL — Swiss, prominent ── */
  .terminal-panel {
    background: transparent;
    border-top: 1.5px solid var(--text);
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    height: var(--s8); /* 233px Fibonacci */
    transition: height 0.2s cubic-bezier(0.25, 0.1, 0.25, 1);
    overflow: hidden;
  }
  .terminal-panel.collapsed { height: var(--s4); }
  .tp-header {
    display: flex;
    align-items: center;
    padding: var(--gutter-v) var(--gutter-h);
    background: transparent;
    border-bottom: none;
    cursor: pointer;
    user-select: none;
    flex-shrink: 0;
  }
  .tp-title {
    font-family: var(--font);
    font-size: var(--fs-xs);
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--dim);
    flex: 1;
  }
  .tp-badge {
    font-family: var(--mono);
    font-size: var(--fs-2xs);
    color: var(--green);
    background: none;
    border: none;
    padding: 0;
    margin-right: var(--s2);
  }
  .tp-toggle {
    background: none;
    border: none;
    font-size: var(--fs-body);
    color: var(--dim);
    cursor: pointer;
    width: var(--s3);
    text-align: center;
  }
  #terminal {
    flex: 1;
    overflow-y: auto;
    padding: var(--gutter-v) var(--gutter-h);
    font-family: var(--mono);
    font-size: var(--fs-sm);
    font-weight: 300;
    line-height: 1.8;
    color: var(--text-secondary);
  }
  #terminal::-webkit-scrollbar { width: 2px; }
  #terminal::-webkit-scrollbar-thumb { background: var(--border); }
  .log-line { margin-bottom: 0; }
  /* Stream output (agent thinking) — more visible */
  .log-line .stream {
    color: var(--text);
    font-weight: 400;
    opacity: 0.85;
  }
  .log-line .ts { color: var(--dim); opacity: 0.4; font-size: var(--fs-xs); }
  .log-line .event { color: var(--green); }
  .log-line .agent-name { color: var(--accent); }
  .log-line .error { color: var(--rose); }

  /* ── AGENTS VIEW ── */
  .agent {
    display: flex;
    align-items: center;
    gap: var(--s3);
    padding: var(--s2) 0;
    margin-bottom: 0;
    background: none;
    border-bottom: 1px solid var(--border);
    transition: color 0.15s ease;
  }
  .agent:last-child { border-bottom: none; }
  .agent:hover { color: var(--accent); }
  .agent .status { width: var(--s1); height: var(--s1); border-radius: 50%; flex-shrink: 0; }
  .status-working { background: var(--green); box-shadow: 0 0 6px var(--green); }
  .status-idle { background: var(--border-strong); }
  .status-blocked { background: var(--rose); }
  .status-done { background: var(--blue); }
  .agent .role {
    font-family: var(--mono); font-size: var(--fs-xs); color: var(--accent);
    letter-spacing: 0.06em; text-transform: uppercase; min-width: var(--s5);
  }
  .agent .task {
    font-size: var(--fs-sm); color: var(--text-secondary);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1;
  }

  /* ── TASKS VIEW ── */
  .task-item {
    display: flex; align-items: center; gap: var(--s3);
    padding: var(--s2) 0; margin-bottom: 0;
    border-bottom: 1px solid var(--border);
  }
  .task-item:last-child { border-bottom: none; }
  .task-item:hover { color: var(--accent); }
  .badge {
    font-family: var(--mono); font-size: var(--fs-2xs); padding: var(--s0) var(--s1);
    border-radius: 0; text-transform: lowercase; letter-spacing: 0.04em; flex-shrink: 0;
  }
  .badge-pending { background: var(--amber-bg); color: var(--amber); }
  .badge-running { background: var(--green-bg); color: var(--green); }
  .badge-done { background: var(--blue-bg); color: var(--blue); }
  .badge-failed { background: var(--rose-bg); color: var(--rose); }
  .task-item .desc {
    font-size: var(--fs-sm); color: var(--text-secondary); flex: 1;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .task-item .prio { font-family: var(--mono); font-size: var(--fs-xs); color: var(--dim); opacity: 0.6; }

  /* ── KB VIEW ── */
  .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--s3); }
  .stat {
    text-align: center; padding: var(--s3) 0;
    background: none;
  }
  .stat .num {
    font-family: var(--mono); font-size: var(--fs-xl); font-weight: 300;
    color: var(--text); letter-spacing: var(--tracking);
  }
  .stat .label {
    font-size: var(--fs-2xs); font-weight: 500; color: var(--dim);
    text-transform: uppercase; letter-spacing: 0.1em; margin-top: var(--s1);
  }
  .file-link {
    display: inline-block; color: var(--accent); text-decoration: none;
    font-family: var(--mono); font-size: var(--fs-sm); padding: var(--s0) 0;
    margin: var(--s0) var(--s2) var(--s0) 0; background: none;
    border: none; transition: color 0.15s ease;
  }
  .file-link:hover { color: var(--text); text-decoration: underline; }

  .empty {
    color: var(--dim); font-weight: 300; font-style: italic;
    padding: var(--s5); text-align: center; font-size: var(--fs-sm);
  }
  .section-title {
    font-family: var(--mono);
    font-size: var(--fs-sm); font-weight: 500; letter-spacing: 0.12em;
    text-transform: uppercase; color: var(--dim); margin-bottom: var(--s3);
    height: var(--row); line-height: var(--row);
    display: flex; justify-content: space-between; align-items: center;
  }
  .section-title .count {
    font-family: var(--mono); font-size: var(--fs-sm); color: var(--accent);
    background: none; padding: 0;
  }
  .section-gap { margin-top: var(--s5); }

  /* ── TYPOGRAPHY MENU ── */
  .typo-gear {
    background: none; border: none; cursor: pointer; color: var(--dim);
    font-size: var(--fs-body); padding: 0 var(--s0); transition: color 0.15s; line-height: 1;
  }
  .typo-gear:hover { color: var(--accent); }
  .typo-popover {
    display: none; position: absolute; top: 100%; right: 0; z-index: 100;
    background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
    padding: var(--s4); min-width: var(--s8); max-height: 80vh; overflow-y: auto;
    box-shadow: 0 4px 16px rgba(0,0,0,0.08);
  }
  .typo-popover.open { display: block; }
  .typo-popover label {
    display: block; font-size: var(--fs-xs); font-weight: 500; letter-spacing: 0.08em;
    text-transform: uppercase; color: var(--dim); margin-bottom: var(--s1); margin-top: var(--s3);
  }
  .typo-popover label:first-child { margin-top: 0; }
  .typo-popover input[type="range"] { width: 100%; accent-color: var(--accent); }
  .typo-popover select {
    width: 100%; padding: var(--s1) var(--s2); border: 1px solid var(--border);
    border-radius: var(--radius-sm); font-family: var(--font); font-size: var(--fs-sm);
    background: var(--bg); color: var(--text);
  }
  .typo-size-display { font-family: var(--mono); font-size: var(--fs-sm); color: var(--accent); float: right; }

  /* ── SEARCH BOX ── */
  .bc-search {
    margin-left: auto; display: flex; align-items: center; gap: var(--s1);
  }
  .bc-search input {
    width: var(--s7); padding: var(--s1) 0; border: none;
    border-bottom: 1px solid var(--border);
    font-family: var(--font); font-size: var(--fs-sm);
    background: transparent; color: var(--text); transition: all 0.2s;
  }
  .bc-search input:focus { outline: none; border-bottom-color: var(--accent); width: var(--s8); }
  .bc-search input::placeholder { color: var(--dim); }

  /* ── COMMAND INPUT ── */
  .cmd-area {
    display: flex; gap: var(--s2); align-items: end; flex: 1;
  }
  .cmd-input {
    flex: 1; resize: none; padding: var(--s1) 0; border: none;
    border-bottom: 1px solid var(--border);
    font-family: var(--font); font-size: var(--fs-sm);
    background: transparent; color: var(--text); height: var(--row); max-height: var(--s6);
    line-height: 1.4; transition: border-color 0.2s;
  }
  .cmd-input:focus { outline: none; border-bottom-color: var(--accent); }
  .cmd-input::placeholder { color: var(--dim); }
  .btn-send {
    padding: 0 var(--s2); background: none; color: var(--accent);
    border: none; border-bottom: 1px solid var(--accent); font-family: var(--font);
    font-size: var(--fs-sm); font-weight: 500; cursor: pointer; white-space: nowrap;
    transition: color 0.15s; height: var(--row);
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0; letter-spacing: 0.06em; text-transform: uppercase;
  }
  .btn-send:hover { color: var(--text); border-bottom-color: var(--text); }

  /* ── TIMELINE VIEW ── */
  .tl-msg {
    padding: var(--s2) 0;
    border-bottom: 1px solid var(--border); margin-bottom: 0;
    background: none; transition: color 0.15s; cursor: pointer;
  }
  .tl-msg:last-child { border-bottom: none; }
  .tl-msg:hover { color: var(--accent); }
  .tl-header {
    display: flex; align-items: center; gap: var(--s3); margin-bottom: var(--s1);
  }
  .tl-project {
    font-family: var(--mono); font-size: var(--fs-2xs); padding: var(--s0) var(--s1);
    border-radius: 0; font-weight: 500; letter-spacing: 0.04em;
  }
  .tl-role {
    font-family: var(--mono); font-size: var(--fs-2xs); letter-spacing: 0.08em;
    text-transform: uppercase; color: var(--dim);
  }
  .tl-time {
    font-family: var(--mono); font-size: var(--fs-2xs); color: var(--dim);
    opacity: 0.5; margin-left: auto;
  }
  .tl-body {
    font-size: var(--fs-body); line-height: calc(1em * var(--phi)); color: var(--text-secondary);
    white-space: pre-wrap; word-wrap: break-word;
    display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
  }
  .tl-load-more {
    display: block; margin: var(--s4) auto; padding: var(--s2) var(--s5);
    background: none; border: none; border-bottom: 1px solid var(--dim);
    font-family: var(--font); font-size: var(--fs-sm); color: var(--text-secondary);
    cursor: pointer; transition: color 0.15s;
  }
  .tl-load-more:hover { color: var(--accent); border-bottom-color: var(--accent); }

  /* ── MCP PANEL ── */
  .mcp-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(calc(var(--s8) + var(--s7)), 1fr)); gap: var(--s4); /* 233+144=377 Fibonacci */
  }
  .mcp-card {
    padding: var(--s3) 0; background: none; border: none;
    border-bottom: 1px solid var(--border); transition: color 0.15s;
  }
  .mcp-card:last-child { border-bottom: none; }
  .mcp-card:hover { color: var(--accent); }
  .mcp-name {
    font-family: var(--mono); font-size: var(--fs-body); font-weight: 500;
    color: var(--text); margin-bottom: var(--s2);
    display: flex; align-items: center; gap: var(--s3);
  }
  .mcp-badge {
    font-size: var(--fs-2xs); padding: var(--s0) var(--s1); border-radius: 0;
    background: none; color: var(--green); font-family: var(--mono); border: 1px solid var(--green);
  }
  .mcp-cmd {
    font-family: var(--mono); font-size: var(--fs-sm); color: var(--text-secondary);
    background: none; padding: var(--s1) 0;
    margin: var(--s1) 0; word-break: break-all;
  }
  .mcp-section-label {
    font-size: var(--fs-2xs); font-weight: 500; letter-spacing: 0.08em;
    text-transform: uppercase; color: var(--dim); margin-top: var(--s3); margin-bottom: var(--s1);
  }
  .mcp-pills {
    display: flex; flex-wrap: wrap; gap: var(--s1);
  }
  .mcp-pill {
    font-family: var(--mono); font-size: var(--fs-xs); padding: var(--s0) var(--s1);
    background: var(--accent-bg); color: var(--accent); border-radius: 0;
  }

  /* ── PROJECT COLOR HASH ── */
  .proj-sage { background: var(--green-bg); color: var(--green); }
  .proj-amber { background: var(--amber-bg); color: var(--amber); }
  .proj-rose { background: var(--rose-bg); color: var(--rose); }
  .proj-blue { background: var(--blue-bg); color: var(--blue); }
  .proj-accent { background: var(--accent-bg); color: var(--accent); }

  /* ── MARKDOWN — Swiss Typography ── */
  .md-code {
    display: block;
    background: var(--bg);
    border: none;
    border-left: 2px solid var(--border-strong);
    border-radius: 0;
    padding: var(--s2) var(--s3);
    margin: var(--s1) 0;
    font-family: var(--mono);
    font-size: var(--fs-sm);
    font-weight: 300;
    overflow-x: auto;
    white-space: pre;
    line-height: 1.7;
    tab-size: 2;
    -moz-tab-size: 2;
    counter-reset: line;
  }
  .md-code .line-num {
    display: inline-block;
    width: var(--s4);
    text-align: right;
    padding-right: var(--s1);
    margin-right: var(--s1);
    color: var(--dim);
    opacity: 0.4;
    user-select: none;
    font-size: var(--fs-xs);
    border-right: 1px solid var(--border);
  }
  /* Diff line highlighting */
  .md-code .diff-add { background: rgba(107, 143, 113, 0.12); color: var(--green); }
  .md-code .diff-del { background: rgba(176, 112, 112, 0.12); color: var(--rose); text-decoration: line-through; text-decoration-color: rgba(176, 112, 112, 0.3); }
  .md-code .diff-hunk { color: var(--blue); font-weight: 400; }
  /* Syntax tokens */
  .md-code .tok-kw { color: var(--blue); font-weight: 400; }
  .md-code .tok-str { color: var(--green); }
  .md-code .tok-num { color: var(--amber); }
  .md-code .tok-cmt { color: var(--dim); font-style: italic; }
  .md-code .tok-fn { color: var(--accent); }
  .md-code .tok-type { color: var(--rose); }
  .md-inline {
    background: var(--bg);
    padding: var(--s0) var(--s1);
    border-radius: 0;
    font-family: var(--mono);
    font-size: 0.88em;
    font-weight: 400;
    border-bottom: 1px solid var(--border);
  }
  .md-h1 {
    font-size: var(--fs-lg);
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    margin: var(--s3) 0 var(--s2);
    border-bottom: 2px solid var(--text);
    padding-bottom: var(--s0);
  }
  .md-h2 {
    font-size: var(--fs-body);
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin: var(--s3) 0 var(--s1);
  }
  .md-h3 {
    font-size: var(--fs-body);
    font-weight: 400;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    margin: var(--s2) 0 var(--s1);
    color: var(--text-secondary);
  }
  .md-li { padding-left: var(--s3); position: relative; }
  .md-li::before { content: '\\2014'; position: absolute; left: 0; color: var(--dim); font-size: var(--fs-sm); }
  .md-hr { border: none; border-top: 1px solid var(--border); margin: var(--s2) 0; }

  /* ── DEBUG PANEL ── */
  .debug-panel {
    position: fixed; bottom: 0; right: 0; width: 377px; max-height: 50vh; /* 377 = Fibonacci */
    background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius) 0 0 0;
    z-index: 200; display: none; flex-direction: column; font-size: var(--fs-sm);
    box-shadow: -2px -2px 12px rgba(0,0,0,0.06);
  }
  .debug-panel.open { display: flex; }
  .debug-header {
    padding: var(--s2) var(--s3); background: var(--bg); border-bottom: 1px solid var(--border);
    display: flex; align-items: center; gap: var(--s2); cursor: pointer;
    font-weight: 500; letter-spacing: 0.06em; text-transform: uppercase; font-size: var(--fs-2xs);
    color: var(--dim);
  }
  .debug-header .dot { width: var(--s1); height: var(--s1); border-radius: 50%; background: var(--green); }
  .debug-body {
    overflow-y: auto; flex: 1; padding: var(--s2) var(--s3); max-height: 40vh;
  }
  .debug-entry {
    padding: var(--s1) 0; border-bottom: 1px solid var(--border);
    font-family: var(--mono); font-size: var(--fs-xs); line-height: 1.5;
  }
  .debug-entry .de-time { color: var(--dim); margin-right: var(--s2); }
  .debug-entry .de-type {
    display: inline-block; padding: 0 var(--s0); border-radius: 0;
    font-size: var(--fs-2xs); font-weight: 500; margin-right: var(--s1);
  }
  .de-route { background: var(--blue-bg); color: var(--blue); }
  .de-context { background: var(--green-bg); color: var(--green); }
  .de-spawn { background: var(--amber-bg); color: var(--amber); }
  .de-done { background: var(--accent-bg); color: var(--accent); }
  .de-error { background: var(--rose-bg); color: var(--rose); }
  .debug-toggle {
    position: fixed; bottom: var(--s3); right: var(--s3); z-index: 201;
    width: var(--s4); height: var(--s4); border-radius: 50%; border: 1px solid var(--border);
    background: var(--surface); cursor: pointer; display: flex; align-items: center;
    justify-content: center; font-size: var(--fs-body); color: var(--dim); transition: all 0.15s;
    box-shadow: 0 2px 8px rgba(0,0,0,0.05);
  }
  .debug-toggle:hover { color: var(--accent); border-color: var(--accent-light); }

  /* ── RYTMO MAPPING ── */
  .rytmo-row {
    display: flex; align-items: center; gap: var(--s1); margin-bottom: var(--s1);
  }
  .rytmo-row select {
    flex: 1; padding: var(--s0) var(--s1); border: 1px solid var(--border);
    border-radius: 0; font-family: var(--mono); font-size: var(--fs-2xs);
    background: var(--bg); color: var(--text);
  }
  .rytmo-row .rytmo-taps {
    width: var(--s4); font-family: var(--mono); font-size: var(--fs-2xs);
    text-align: center; padding: var(--s0); border: 1px solid var(--border);
    border-radius: 0; background: var(--bg); color: var(--accent);
  }
  .rytmo-row .rytmo-del {
    background: none; border: 1px solid var(--border); color: var(--dim);
    cursor: pointer; font-size: var(--fs-2xs); padding: var(--s0) var(--s1); border-radius: 0;
  }
  .rytmo-row .rytmo-del:hover { color: var(--rose); border-color: var(--rose); }

  /* ── PTI PROBE OVERLAY ── */
  .pti-probe * {
    outline: 1px dashed rgba(139, 115, 85, 0.25) !important;
  }
  .pti-probe [style*="--"] {
    outline-color: rgba(139, 115, 85, 0.5) !important;
  }
  .pti-probe .sidebar::after,
  .pti-probe .main::after,
  .pti-probe header::after,
  .pti-probe .terminal-panel::after,
  .pti-probe .msg::after,
  .pti-probe .breadcrumb::after,
  .pti-probe .drop-zone::after {
    content: attr(data-probe);
    position: absolute;
    top: 2px; right: 2px;
    font-family: var(--mono);
    font-size: 8px;
    color: var(--accent);
    background: var(--surface);
    padding: var(--s0);
    border: 1px solid var(--accent);
    pointer-events: none;
    z-index: 300;
    opacity: 0.8;
    white-space: nowrap;
  }
  .pti-probe-bar {
    display: none;
    position: fixed; bottom: 0; left: 0; right: 0;
    background: var(--surface); border-top: 2px solid var(--accent);
    padding: var(--s0) var(--s2); z-index: 400;
    font-family: var(--mono); font-size: 9px; color: var(--accent);
    overflow-x: auto; white-space: nowrap;
  }
  .pti-probe .pti-probe-bar { display: flex; gap: var(--s2); }
  .pti-probe-bar span { opacity: 0.6; }
  .pti-probe-bar strong { font-weight: 500; color: var(--text); }

  /* ── NIGHT VIEW ── */
  .night {
    --bg: #1C1A17;
    --surface: #242220;
    --border: #3A3632;
    --border-strong: #4A4540;
    --text: #D8D2CA;
    --text-secondary: #9E978E;
    --dim: #6B655D;
    --accent: #C4A478;
    --accent-light: #A08968;
    --accent-bg: #2A2520;
    --green: #7FA882;
    --green-bg: #1E2820;
    --amber: #C9A54A;
    --amber-bg: #282418;
    --rose: #C08080;
    --rose-bg: #281E1E;
    --blue: #8A9EB5;
    --blue-bg: #1C2228;
  }
  /* ── FULL CHAT MODE (Cmd+Shift+C) ── */
  .full-chat header,
  .full-chat .sidebar,
  .full-chat .terminal-panel,
  .full-chat .breadcrumb,
  .full-chat .chat-toolbar { display: none !important; }
  .full-chat .layout { display: flex; flex: 1; }
  .full-chat .main { flex: 1; height: 100vh; }
  .full-chat #chat-view { flex: 1; display: flex !important; flex-direction: column; }
  .full-chat #chat-view .view-scroll { padding: var(--s5) var(--s7); }
  .full-chat .drop-zone { padding: var(--gutter-v) var(--s7); }

  /* ── CHAT FONT SCOPING ── */
  #chat-view { --chat-font: inherit; --chat-size: inherit; position: relative; }
  #chat-view .msg-body { font-family: var(--chat-font); font-size: var(--chat-size); }
  #chat-view .msg-role { font-family: var(--chat-font); }
  .chat-toolbar {
    display: flex; gap: var(--s2); padding: var(--gutter-v) var(--gutter-h);
    border-bottom: none; align-items: center;
    background: transparent; z-index: 2; position: relative;
  }
  .chat-toolbar select {
    font-family: var(--mono); font-size: var(--fs-xs);
    padding: var(--s0) 0; border: none; border-bottom: 1px solid var(--border);
    background: transparent; color: var(--text);
  }

  /* ── GRANIM CANVAS (body-level ambient) ── */
  #granim-canvas {
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    z-index: 0; pointer-events: none;
    opacity: var(--granim-opacity, 0.10);
  }
  header, .layout, .terminal-panel { position: relative; z-index: 1; }

  .night header { border-bottom-color: var(--dim); }
  .night .file-link:hover { color: var(--accent-light); }
  .night .debug-panel { box-shadow: -2px -2px 12px rgba(0,0,0,0.3); }
  .night .debug-toggle { box-shadow: 0 2px 8px rgba(0,0,0,0.2); }
  .night .typo-popover { box-shadow: 0 4px 16px rgba(0,0,0,0.3); }
  .night .btn-accent { color: #1C1A17; }
  .night .btn-send { color: var(--accent); }
  .night .btn-send:hover { color: var(--text); }
  .night ::selection { background: rgba(196, 164, 120, 0.3); }

  /* Night mode toggle (inside typo popover) */
  .night-toggle {
    width: 100%; padding: var(--s2) var(--s3); border: 1px solid var(--border);
    border-radius: var(--radius-sm); font-family: var(--font); font-size: var(--fs-sm);
    background: var(--bg); color: var(--text); cursor: pointer;
    transition: all 0.15s; text-align: left; display: flex; align-items: center; gap: var(--s2);
  }
  .night-toggle:hover { border-color: var(--accent-light); background: var(--accent-bg); }
  .night .night-toggle { background: var(--accent); color: #1C1A17; border-color: var(--accent); }
  .night .night-toggle:hover { background: var(--accent-light); }
`;
