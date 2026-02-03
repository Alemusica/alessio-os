/**
 * Depth Lab — Tessuto: Membrana Visiva (CSS)
 *
 * PTI livello: tessuto
 * Ruolo: definisce l'aspetto visivo dell'intero spazio 3D.
 * Contiene: variabili CSS, tipografia, HUD, controlli, temi, context menu.
 * Zero logica — pura estetica strutturale.
 */

export function depthLabCSS(): string {
  return `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500&family=DM+Mono:wght@300;400&display=swap');

  :root {
    --bg: #FAF8F5;
    --text: #2C2926;
    --text-secondary: #6B6560;
    --dim: #9E9891;
    --accent: #8B7355;
    --font: 'DM Sans', 'Helvetica Neue', sans-serif;
    --mono: 'DM Mono', 'SF Mono', monospace;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--font);
    height: 100vh;
    overflow: hidden;
    cursor: grab;
    -webkit-font-smoothing: antialiased;
  }
  body:active { cursor: grabbing; }

  .d3-viewport {
    width: 100vw;
    height: 100vh;
    perspective: 1400px;
    perspective-origin: 50% 45%;
    overflow: hidden;
    position: relative;
  }

  .d3-scene {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 0;
    height: 0;
    transform-style: preserve-3d;
    transition: transform 0.8s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .d3-item {
    position: absolute;
    transform-style: preserve-3d;
    white-space: nowrap;
    cursor: pointer;
    text-align: center;
    /* No CSS transform transition — handled by rAF for organic movement */
    transition:
      filter 0.6s ease,
      opacity 0.6s ease,
      font-size 0.8s ease;
  }

  .d3-name {
    font-family: var(--font);
    font-weight: 400;
    letter-spacing: -0.01em;
    display: block;
    transition: color 0.15s ease, font-size 0.8s ease, font-weight 0.4s ease;
  }

  .d3-meta {
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 300;
    color: var(--dim);
    letter-spacing: 0.02em;
    margin-top: 2px;
    display: block;
  }

  .d3-item:hover .d3-name { color: var(--accent); }
  .d3-item:hover .d3-meta { color: var(--text-secondary); }

  .d3-item.in-focus .d3-name { font-weight: 500; }
  .d3-item.in-focus .d3-meta { color: var(--text-secondary); }

  /* ── HUD ── */
  .d3-hud {
    position: fixed;
    bottom: 34px;
    left: 34px;
    font-family: var(--mono);
    font-size: 10px;
    color: var(--dim);
    letter-spacing: 0.04em;
    z-index: 10;
    line-height: 1.8;
    pointer-events: none;
  }
  .d3-hud strong { color: var(--text-secondary); font-weight: 400; }

  /* ── FOCAL PLANE ── */
  .d3-focal-line {
    position: fixed;
    left: 0; right: 0; top: 50%;
    height: 1px;
    background: var(--accent);
    opacity: 0;
    transition: opacity 0.5s ease;
    pointer-events: none;
    z-index: 5;
  }
  .d3-viewport.moving .d3-focal-line { opacity: 0.15; }

  /* ── THEMES ── */
  .night {
    --bg: #1C1A17; --text: #D8D2CA;
    --text-secondary: #9E978E; --dim: #6B655D; --accent: #C4A478;
  }
  .primavera {
    --bg: #F7FAF5; --text: #2A332A;
    --text-secondary: #5E6E58; --dim: #8E9E88; --accent: #C8887A;
  }
  .estate {
    --bg: #F8F6F0; --text: #2C3038;
    --text-secondary: #5C6670; --dim: #8C96A0; --accent: #3E8EA0;
  }
  .ellenica {
    --bg: #F5F6FA; --text: #1E2440;
    --text-secondary: #5A6080; --dim: #8890A8; --accent: #2E5E9E;
  }
  .benessere {
    --bg: #F5F8F6; --text: #2A3430;
    --text-secondary: #5A6E64; --dim: #8AA098; --accent: #5E9E88;
  }

  /* ── CROSSHAIR ── */
  .d3-crosshair {
    position: fixed; top: 50%; left: 50%;
    width: 20px; height: 20px;
    margin: -10px 0 0 -10px;
    pointer-events: none; z-index: 5;
    opacity: 0; transition: opacity 0.4s ease;
  }
  .d3-viewport.moving .d3-crosshair { opacity: 0.3; }
  .d3-crosshair::before, .d3-crosshair::after {
    content: ''; position: absolute; background: var(--accent);
  }
  .d3-crosshair::before {
    left: 50%; top: 0; width: 0.5px; height: 100%; margin-left: -0.25px;
  }
  .d3-crosshair::after {
    top: 50%; left: 0; height: 0.5px; width: 100%; margin-top: -0.25px;
  }

  /* ── TITLE ── */
  .d3-title {
    position: fixed; top: 34px; left: 34px;
    font-family: var(--font); font-size: 11px;
    font-weight: 500; letter-spacing: 0.12em;
    text-transform: uppercase; color: var(--dim);
    z-index: 10; pointer-events: none;
  }

  /* ── CONTROLS BAR (themes + layouts) ── */
  .d3-controls {
    position: fixed; top: 34px; right: 34px;
    z-index: 10; display: flex; gap: 8px;
    flex-wrap: wrap; justify-content: flex-end;
    max-width: 400px;
  }
  .d3-controls button {
    background: none;
    border: 1px solid var(--dim);
    color: var(--dim);
    font-family: var(--mono);
    font-size: 9px;
    padding: 4px 8px;
    cursor: pointer;
    border-radius: 2px;
    letter-spacing: 0.04em;
    transition: all 0.2s ease;
  }
  .d3-controls button:hover {
    color: var(--accent);
    border-color: var(--accent);
  }
  .d3-controls button.active {
    color: var(--bg);
    background: var(--accent);
    border-color: var(--accent);
  }
  .d3-controls .sep {
    width: 1px;
    background: var(--dim);
    opacity: 0.3;
    align-self: stretch;
  }

  /* ── APERTURE ── */
  .d3-aperture {
    position: fixed; bottom: 34px; left: 50%;
    transform: translateX(-50%);
    z-index: 10; display: flex; align-items: center;
    gap: 12px; font-family: var(--mono);
    font-size: 9px; color: var(--dim);
    letter-spacing: 0.04em; user-select: none;
  }
  .d3-aperture label { opacity: 0.6; }
  .d3-aperture input[type="range"] {
    -webkit-appearance: none; appearance: none;
    width: 160px; height: 1px;
    background: var(--dim); outline: none;
    opacity: 0.5; transition: opacity 0.2s;
  }
  .d3-aperture input[type="range"]:hover { opacity: 1; }
  .d3-aperture input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none; appearance: none;
    width: 10px; height: 10px; border-radius: 50%;
    background: var(--accent); cursor: pointer; border: none;
  }
  .d3-aperture .aperture-val {
    min-width: 28px; color: var(--text-secondary); font-weight: 400;
  }
  .d3-iris {
    width: 18px; height: 18px; border-radius: 50%;
    border: 1px solid var(--dim); position: relative;
    transition: all 0.3s ease;
  }

  /* ── CONTEXT MENU ── */
  .d3-ctx {
    position: fixed; z-index: 100;
    background: var(--bg); border: 1px solid var(--dim);
    border-radius: 4px; padding: 4px 0;
    min-width: 160px; font-family: var(--font);
    font-size: 12px; color: var(--text);
    box-shadow: 0 2px 8px rgba(0,0,0,0.08), 0 8px 24px rgba(0,0,0,0.06);
    display: none; opacity: 0;
    transform: scale(0.96) translateY(-4px);
    transition: opacity 0.15s ease, transform 0.15s ease;
  }
  .d3-ctx.open { display: block; opacity: 1; transform: scale(1) translateY(0); }
  .d3-ctx-item {
    padding: 6px 16px; cursor: pointer;
    display: flex; align-items: center; gap: 8px;
    transition: background 0.1s; letter-spacing: 0.01em;
  }
  .d3-ctx-item:hover { background: var(--accent); color: var(--bg); }
  .d3-ctx-sep { height: 1px; background: var(--dim); opacity: 0.2; margin: 4px 0; }
  .d3-ctx-label {
    font-family: var(--mono); font-size: 9px; color: var(--dim);
    padding: 4px 16px 2px; letter-spacing: 0.06em; text-transform: uppercase;
  }
  .night .d3-ctx {
    box-shadow: 0 2px 8px rgba(0,0,0,0.25), 0 8px 24px rgba(0,0,0,0.20);
  }

  .d3-back {
    position: fixed; bottom: 34px; right: 34px;
    font-family: var(--mono); font-size: 10px;
    color: var(--dim); text-decoration: none;
    letter-spacing: 0.04em; z-index: 10; transition: color 0.2s;
  }
  .d3-back:hover { color: var(--accent); }`;
}
