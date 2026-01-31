/**
 * ALESSIO-OS Dashboard Server v2
 *
 * PTI: dashboard := [agents.*, tasks.*, session_ctx, chat_log, logs] → materializzato
 *
 * Interactive workspace: chat browsing, OCR drag&drop, STT, terminal.
 * Nessuna dipendenza frontend — HTML/CSS/JS inline.
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { execFileSync, execSync } from 'child_process';
import { writeFileSync, unlinkSync, mkdirSync, readFileSync } from 'fs';
import { tmpdir, homedir } from 'os';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { surqlQuery } from '../pti/surreal-bridge.js';
import { Orchestrator } from '../agents/orchestrator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT ?? '3777', 10);

// --- Orchestrator singleton (started in startDashboard) ---
let orchestrator: Orchestrator | null = null;
const OCR_BINARY = resolve(__dirname, '..', 'tools', 'ocr-vision');

// --- SSE clients ---
const sseClients: Set<ServerResponse> = new Set();

function broadcast(event: string, data: unknown): void {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(msg);
  }
}

// --- API: stato completo ---
async function getFullState(): Promise<Record<string, unknown>> {
  const [agents, tasks, sessions, kbStats, recentChat] = await Promise.all([
    surqlQuery('SELECT * FROM agent_state ORDER BY updated_at DESC LIMIT 20'),
    surqlQuery('SELECT * FROM task_queue ORDER BY created_at DESC LIMIT 30'),
    surqlQuery('SELECT * FROM session_ctx ORDER BY updated_at DESC LIMIT 5'),
    surqlQuery('fn::kb_stats_v4()'),
    surqlQuery(`
      SELECT project, count() AS msg_count,
        array::group(session_id) AS session_ids
      FROM chat_log
      GROUP BY project
      ORDER BY msg_count DESC
      LIMIT 30
    `),
  ]);

  return {
    agents: agents[0]?.result ?? [],
    tasks: tasks[0]?.result ?? [],
    sessions: sessions[0]?.result ?? [],
    kb: kbStats[0]?.result ?? {},
    chatProjects: recentChat[0]?.result ?? [],
    timestamp: new Date().toISOString(),
  };
}

// --- API: sessions per project ---
async function getSessions(project: string): Promise<unknown[]> {
  // SurrealDB GROUP BY non supporta math::min/max su datetime — uso subquery
  const res = await surqlQuery(`
    SELECT session_id, count() AS msg_count
    FROM chat_log
    WHERE project = $project
    GROUP BY session_id
  `, { project });
  const grouped = Array.isArray(res[0]?.result) ? res[0].result as Array<Record<string, unknown>> : [];

  // Per ogni sessione, prendi first/last msg con query separata
  const enriched = await Promise.all(grouped.map(async (s) => {
    const dates = await surqlQuery(`
      SELECT created_at FROM chat_log
      WHERE project = $project AND session_id = $sid
      ORDER BY created_at DESC LIMIT 1
    `, { project, sid: s.session_id });
    const last = (dates[0]?.result as Array<Record<string, unknown>>)?.[0]?.created_at ?? null;
    return { ...s, last_msg: last };
  }));

  return enriched.sort((a, b) => {
    const ta = a.last_msg ? new Date(a.last_msg as string).getTime() : 0;
    const tb = b.last_msg ? new Date(b.last_msg as string).getTime() : 0;
    return tb - ta;
  });
}

// --- API: messages per session ---
async function getMessages(project: string, session: string): Promise<unknown[]> {
  const res = await surqlQuery(`
    SELECT role, content, created_at
    FROM chat_log
    WHERE project = $project AND session_id = $session
    ORDER BY created_at ASC
    LIMIT 300
  `, { project, session });
  const result = res[0]?.result;
  return Array.isArray(result) ? result : [];
}

// --- API: timeline (all chats chronological) ---
async function getTimeline(page: number): Promise<unknown[]> {
  const offset = page * 50;
  const res = await surqlQuery(`
    SELECT role, content, project, session_id, created_at
    FROM chat_log
    ORDER BY created_at DESC
    LIMIT 50 START $offset
  `, { offset });
  const result = res[0]?.result;
  return Array.isArray(result) ? result : [];
}

// --- API: search chats ---
async function searchChats(query: string): Promise<unknown[]> {
  // Use CONTAINS for simple text search (full-text search may not be indexed on chat_log)
  const res = await surqlQuery(`
    SELECT role, content, project, session_id, created_at
    FROM chat_log
    WHERE content CONTAINS $query
    ORDER BY created_at DESC
    LIMIT 50
  `, { query });
  const result = res[0]?.result;
  return Array.isArray(result) ? result : [];
}

// --- API: command (PTI reactive — setta fatti, il grafo fa il resto) ---
async function handleCommand(req: IncomingMessage): Promise<unknown> {
  const body = await readBody(req);
  const { text, project } = JSON.parse(body);
  if (!text) throw new Error('No text');

  broadcast('log', { text: `> ${text}`, cls: 'agent-name' });

  if (!orchestrator) {
    throw new Error('Orchestrator not started');
  }

  // Preview route (per la UI)
  const route = orchestrator.route(text);
  broadcast('log', { text: `[PTI] route → ${route.roles.join(', ')} — priority ${route.priority}`, cls: 'event' });

  // Setta i fatti nel grafo PTI → propagazione reattiva fa tutto
  // input.text → derivato 'route' → azione 'act:route' → fatto 'queue.version'
  //   → derivato 'can.dispatch' → azione 'act:dispatch' → spawn claude
  orchestrator.input(text, project || 'alessio-os');

  return { status: 'streaming', route: route.roles, pti: orchestrator.grafo.stats() };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: Buffer) => { data += chunk.toString(); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// --- API: MCP status ---
function getMcpStatus(): Record<string, unknown> {
  try {
    const mcpPath = join(homedir(), '.mcp.json');
    const raw = readFileSync(mcpPath, 'utf-8');
    const config = JSON.parse(raw);
    const servers = config.mcpServers ?? {};

    const result: Record<string, unknown> = {};
    for (const [name, cfg] of Object.entries(servers)) {
      const c = cfg as Record<string, unknown>;
      result[name] = {
        command: c.command,
        args: c.args,
        env: c.env ? Object.keys(c.env as Record<string, string>) : [],
      };
    }
    return result;
  } catch {
    return {};
  }
}

// --- Multipart parser (zero deps) ---
interface UploadedFile {
  filename: string;
  contentType: string;
  buffer: Buffer;
}

function parseMultipart(req: IncomingMessage): Promise<UploadedFile[]> {
  return new Promise((resolve, reject) => {
    const ct = req.headers['content-type'] ?? '';
    const match = ct.match(/boundary=(?:"([^"]+)"|([^\s;]+))/);
    if (!match) return reject(new Error('No boundary'));
    const boundary = match[1] || match[2];

    const chunks: Buffer[] = [];
    let totalSize = 0;
    const MAX_SIZE = 50 * 1024 * 1024; // 50MB

    req.on('data', (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > MAX_SIZE) {
        req.destroy();
        return reject(new Error('Upload too large (max 50MB)'));
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      try {
        const buf = Buffer.concat(chunks);
        const files: UploadedFile[] = [];
        const sep = Buffer.from('--' + boundary);

        let pos = 0;
        while (true) {
          const start = buf.indexOf(sep, pos);
          if (start === -1) break;
          const nextStart = buf.indexOf(sep, start + sep.length);
          if (nextStart === -1) break;

          const part = buf.slice(start + sep.length, nextStart);
          const headerEnd = part.indexOf('\r\n\r\n');
          if (headerEnd === -1) { pos = nextStart; continue; }

          const headers = part.slice(0, headerEnd).toString();
          const body = part.slice(headerEnd + 4);
          // Remove trailing \r\n
          const cleanBody = body.length >= 2 && body[body.length - 2] === 0x0d && body[body.length - 1] === 0x0a
            ? body.slice(0, -2) : body;

          const fnMatch = headers.match(/filename="([^"]+)"/);
          const ctMatch = headers.match(/Content-Type:\s*([^\r\n]+)/i);

          if (fnMatch) {
            files.push({
              filename: fnMatch[1],
              contentType: ctMatch ? ctMatch[1].trim() : 'application/octet-stream',
              buffer: cleanBody,
            });
          }
          pos = nextStart;
        }
        resolve(files);
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

// --- Temp file helpers ---
function tempPath(prefix: string, ext: string): string {
  const dir = join(tmpdir(), 'alessio-os');
  mkdirSync(dir, { recursive: true });
  const name = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  return join(dir, name);
}

// --- OCR handler ---
async function handleOCR(req: IncomingMessage): Promise<unknown[]> {
  const files = await parseMultipart(req);
  const results: unknown[] = [];

  for (const f of files) {
    const ext = f.filename.match(/\.[^.]+$/)?.[0] ?? '.png';
    const tmp = tempPath('ocr', ext);
    writeFileSync(tmp, f.buffer);
    try {
      const out = execFileSync(OCR_BINARY, [tmp], { timeout: 30000, encoding: 'utf-8' });
      const parsed = JSON.parse(out);
      results.push({ file: f.filename, ...parsed });
    } catch (err) {
      results.push({ file: f.filename, error: String(err) });
    } finally {
      try { unlinkSync(tmp); } catch { /* ok */ }
    }
  }
  return results;
}

// --- STT handler ---
async function handleTranscribe(req: IncomingMessage): Promise<unknown> {
  const files = await parseMultipart(req);
  if (files.length === 0) throw new Error('No audio file');

  const f = files[0];
  const ext = f.filename.match(/\.[^.]+$/)?.[0] ?? '.wav';
  const tmp = tempPath('stt', ext);
  const outDir = join(tmpdir(), 'alessio-os', 'stt-out');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(tmp, f.buffer);

  try {
    execSync(
      `whisper "${tmp}" --model tiny --language it --output_format json --output_dir "${outDir}"`,
      {
        timeout: 120000,
        encoding: 'utf-8',
        env: {
          ...process.env,
          // Fix Python 3.13 macOS SSL cert issue
          SSL_CERT_FILE: process.env.SSL_CERT_FILE
            || join(homedir(), 'miniforge3/ssl/cert.pem'),
        },
      }
    );
    // whisper outputs <basename>.json
    const baseName = tmp.split('/').pop()!.replace(/\.[^.]+$/, '');
    const jsonPath = join(outDir, baseName + '.json');
    const result = JSON.parse(readFileSync(jsonPath, 'utf-8'));
    try { unlinkSync(jsonPath); } catch { /* ok */ }
    return { text: result.text ?? '', segments: result.segments ?? [], file: f.filename };
  } catch (err) {
    return { error: String(err), file: f.filename };
  } finally {
    try { unlinkSync(tmp); } catch { /* ok */ }
  }
}

// --- Polling loop per SSE ---
let lastHash = '';
async function pollAndBroadcast(): Promise<void> {
  try {
    const state = await getFullState();
    // Include chatProjects nel hash — così la sidebar aggiorna msg_count
    const hash = JSON.stringify(state.agents) + JSON.stringify(state.tasks) + JSON.stringify(state.chatProjects);
    if (hash !== lastHash) {
      lastHash = hash;
      broadcast('state', state);
    }
  } catch {
    // skip
  }
}

// --- URL query parser ---
function parseQuery(url: string): Record<string, string> {
  const idx = url.indexOf('?');
  if (idx === -1) return {};
  const params: Record<string, string> = {};
  url.slice(idx + 1).split('&').forEach(p => {
    const [k, v] = p.split('=');
    if (k) params[decodeURIComponent(k)] = decodeURIComponent(v ?? '');
  });
  return params;
}

function urlPath(url: string): string {
  const idx = url.indexOf('?');
  return idx === -1 ? url : url.slice(0, idx);
}

// --- JSON response helper ---
function jsonResponse(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// --- HTML Dashboard ---
function dashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ALESSIO-OS</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;1,9..40,300&family=DM+Mono:wght@300;400&display=swap" rel="stylesheet">
<style>
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
    --font: 'DM Sans', 'Helvetica Neue', -apple-system, sans-serif;
    --mono: 'DM Mono', 'SF Mono', monospace;
    --phi: 1.618;
    --s1: 4px; --s2: 6px; --s3: 10px; --s4: 16px; --s5: 26px; --s6: 42px; --s7: 68px;
    --radius: 8px; --radius-sm: 5px;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: var(--font);
    background: var(--bg);
    color: var(--text);
    font-size: 15px;
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
    padding: var(--s4) var(--s5);
    border-bottom: 1.5px solid var(--text);
    flex-shrink: 0;
  }
  h1 {
    font-size: 14px;
    font-weight: 500;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  .subtitle {
    font-size: 12px;
    font-weight: 300;
    color: var(--dim);
    letter-spacing: 0.04em;
  }
  .health-indicator {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: var(--s2);
    font-size: 11px;
    color: var(--green);
  }
  .health-indicator .dot {
    width: 7px; height: 7px;
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
    width: 210px;
    background: var(--surface);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    flex-shrink: 0;
  }
  .sidebar::-webkit-scrollbar { width: 3px; }
  .sidebar::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

  .nav-section {
    padding: var(--s4) var(--s4) var(--s2);
  }
  .nav-label {
    font-size: 9.5px;
    font-weight: 500;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--dim);
    margin-bottom: var(--s2);
  }
  .nav-item {
    display: flex;
    align-items: center;
    gap: var(--s2);
    width: 100%;
    padding: var(--s2) var(--s3);
    margin-bottom: 1px;
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    font-family: var(--font);
    font-size: 12.5px;
    color: var(--text-secondary);
    text-align: left;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .nav-item:hover { background: var(--accent-bg); color: var(--text); }
  .nav-item.active {
    background: var(--accent-bg);
    color: var(--accent);
    font-weight: 500;
    border-left: 2px solid var(--accent);
  }
  .nav-item .nav-count {
    margin-left: auto;
    font-family: var(--mono);
    font-size: 9px;
    color: var(--dim);
    flex-shrink: 0;
  }
  .nav-divider {
    height: 1px;
    background: var(--border);
    margin: var(--s2) var(--s4);
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
    padding: var(--s3) var(--s5);
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    font-family: var(--mono);
    font-size: 11px;
    color: var(--dim);
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: var(--s2);
  }
  .breadcrumb .bc-link {
    color: var(--accent);
    cursor: pointer;
    text-decoration: none;
  }
  .breadcrumb .bc-link:hover { text-decoration: underline; }
  .breadcrumb .bc-sep { color: var(--border-strong); }

  /* ── VIEWS ── */
  .view { display: none; flex: 1; overflow: hidden; flex-direction: column; }
  .view.active { display: flex; }

  .view-scroll { flex: 1; overflow-y: auto; padding: var(--s5); }
  .view-scroll::-webkit-scrollbar { width: 4px; }
  .view-scroll::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

  /* ── SESSIONS GRID ── */
  .sessions-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: var(--s3);
  }
  .session-card {
    padding: var(--s4);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: all 0.2s ease;
  }
  .session-card:hover {
    background: var(--accent-bg);
    border-color: var(--accent-light);
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(0,0,0,0.04);
  }
  .session-card .sc-id {
    font-family: var(--mono);
    font-size: 10px;
    color: var(--accent);
    margin-bottom: var(--s1);
  }
  .session-card .sc-meta {
    font-size: 11px;
    color: var(--dim);
    display: flex;
    gap: var(--s4);
  }
  .session-card .sc-preview {
    font-size: 11.5px;
    color: var(--text-secondary);
    margin-top: var(--s2);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  /* ── MESSAGES ── */
  .messages-list {
    display: flex;
    flex-direction: column;
    gap: var(--s3);
  }
  .msg {
    max-width: 780px;
    padding: var(--s4) var(--s5);
    border-radius: var(--radius);
    border: 1px solid var(--border);
    position: relative;
  }
  .msg-user {
    align-self: flex-end;
    background: var(--accent-bg);
    border-color: var(--accent-light);
    border-left: 3px solid var(--accent);
  }
  .msg-assistant {
    align-self: flex-start;
    background: var(--blue-bg);
    border-color: var(--blue);
    border-left: 3px solid var(--blue);
  }
  .msg-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: var(--s1);
  }
  .msg-role {
    font-family: var(--mono);
    font-size: 9.5px;
    font-weight: 400;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .msg-user .msg-role { color: var(--accent); }
  .msg-assistant .msg-role { color: var(--blue); }
  .msg-time {
    font-family: var(--mono);
    font-size: 9px;
    color: var(--dim);
    opacity: 0.6;
  }
  .msg-body {
    font-size: 13px;
    line-height: calc(1em * var(--phi));
    color: var(--text);
    white-space: pre-wrap;
    word-wrap: break-word;
    max-height: 400px;
    overflow-y: auto;
  }
  .msg-body::-webkit-scrollbar { width: 3px; }
  .msg-body::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

  /* ── RESULT CARD (OCR/STT) ── */
  .result-card {
    margin: var(--s3) 0;
    padding: var(--s4) var(--s5);
    background: var(--green-bg);
    border: 1px solid var(--green);
    border-radius: var(--radius-sm);
    border-left: 3px solid var(--green);
  }
  .result-card.error {
    background: var(--rose-bg);
    border-color: var(--rose);
  }
  .result-card .rc-title {
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 400;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--green);
    margin-bottom: var(--s2);
  }
  .result-card.error .rc-title { color: var(--rose); }
  .result-card .rc-body {
    font-size: 13px;
    line-height: calc(1em * var(--phi));
    white-space: pre-wrap;
    word-wrap: break-word;
    color: var(--text);
  }
  .result-card .rc-meta {
    font-family: var(--mono);
    font-size: 9.5px;
    color: var(--dim);
    margin-top: var(--s2);
  }

  /* ── DROP ZONE ── */
  .drop-zone {
    padding: var(--s4) var(--s5);
    background: var(--surface);
    border-top: 1px solid var(--border);
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: var(--s4);
    transition: all 0.2s ease;
  }
  .drop-zone.drag-over {
    background: var(--green-bg);
    border-top-color: var(--green);
  }
  .drop-zone.drag-over .dz-prompt { color: var(--green); }
  .dz-prompt {
    font-size: 11.5px;
    color: var(--dim);
    flex: 1;
  }
  .dz-actions { display: flex; gap: var(--s2); flex-shrink: 0; }
  .btn {
    padding: var(--s2) var(--s4);
    border-radius: var(--radius-sm);
    font-family: var(--font);
    font-size: 11.5px;
    font-weight: 500;
    cursor: pointer;
    border: 1px solid;
    transition: all 0.15s ease;
    display: flex;
    align-items: center;
    gap: var(--s2);
  }
  .btn-ghost {
    background: none;
    border-color: var(--border);
    color: var(--text-secondary);
  }
  .btn-ghost:hover { background: var(--bg); border-color: var(--border-strong); }
  .btn-accent {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .btn-accent:hover { background: var(--accent-light); border-color: var(--accent-light); }
  .btn-rec {
    background: none;
    border-color: var(--rose);
    color: var(--rose);
  }
  .btn-rec:hover { background: var(--rose-bg); }
  .btn-rec.recording {
    background: var(--rose);
    color: #fff;
    animation: pulse 1.5s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.04); }
  }
  .loading-spinner {
    display: inline-block;
    width: 14px; height: 14px;
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

  /* ── TERMINAL PANEL ── */
  .terminal-panel {
    background: var(--surface);
    border-top: 1px solid var(--border);
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    height: 240px;
    transition: height 0.25s ease;
    overflow: hidden;
  }
  .terminal-panel.collapsed { height: 36px; }
  .tp-header {
    display: flex;
    align-items: center;
    padding: var(--s2) var(--s5);
    background: var(--bg);
    border-bottom: 1px solid var(--border);
    cursor: pointer;
    user-select: none;
    flex-shrink: 0;
  }
  .tp-title {
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--dim);
    flex: 1;
  }
  .tp-badge {
    font-family: var(--mono);
    font-size: 9px;
    color: var(--green);
    background: var(--green-bg);
    padding: 1px 6px;
    border-radius: 8px;
    margin-right: var(--s3);
  }
  .tp-toggle {
    background: none;
    border: none;
    font-size: 14px;
    color: var(--dim);
    cursor: pointer;
    width: 20px;
    text-align: center;
  }
  #terminal {
    flex: 1;
    overflow-y: auto;
    padding: var(--s3) var(--s5);
    font-family: var(--mono);
    font-size: 11px;
    font-weight: 300;
    line-height: 1.7;
    color: var(--text-secondary);
  }
  #terminal::-webkit-scrollbar { width: 3px; }
  #terminal::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
  .log-line { margin-bottom: 2px; }
  .log-line .ts { color: var(--dim); opacity: 0.4; font-size: 10px; }
  .log-line .event { color: var(--green); }
  .log-line .agent-name { color: var(--accent); }
  .log-line .error { color: var(--rose); }

  /* ── AGENTS VIEW ── */
  .agent {
    display: flex;
    align-items: center;
    gap: var(--s3);
    padding: var(--s3) var(--s4);
    border-radius: var(--radius-sm);
    margin-bottom: var(--s2);
    background: var(--bg);
    transition: background 0.2s ease;
  }
  .agent:hover { background: var(--accent-bg); }
  .agent .status { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
  .status-working { background: var(--green); box-shadow: 0 0 6px var(--green); }
  .status-idle { background: var(--border-strong); }
  .status-blocked { background: var(--rose); }
  .status-done { background: var(--blue); }
  .agent .role {
    font-family: var(--mono); font-size: 10px; color: var(--accent);
    letter-spacing: 0.06em; text-transform: uppercase; min-width: 55px;
  }
  .agent .task {
    font-size: 12.5px; color: var(--text-secondary);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1;
  }

  /* ── TASKS VIEW ── */
  .task-item {
    display: flex; align-items: center; gap: var(--s3);
    padding: var(--s2) var(--s4); margin-bottom: var(--s1);
    border-radius: var(--radius-sm); border-left: 3px solid transparent;
  }
  .task-item:hover { background: var(--bg); }
  .badge {
    font-family: var(--mono); font-size: 9.5px; padding: 2px 8px;
    border-radius: 10px; text-transform: lowercase; letter-spacing: 0.04em; flex-shrink: 0;
  }
  .badge-pending { background: var(--amber-bg); color: var(--amber); }
  .badge-running { background: var(--green-bg); color: var(--green); }
  .badge-done { background: var(--blue-bg); color: var(--blue); }
  .badge-failed { background: var(--rose-bg); color: var(--rose); }
  .task-item .desc {
    font-size: 12.5px; color: var(--text-secondary); flex: 1;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .task-item .prio { font-family: var(--mono); font-size: 10px; color: var(--dim); opacity: 0.6; }

  /* ── KB VIEW ── */
  .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--s3); }
  .stat {
    text-align: center; padding: var(--s4) var(--s3);
    background: var(--bg); border-radius: var(--radius-sm);
    border: 1px solid transparent;
  }
  .stat:hover { border-color: var(--border); }
  .stat .num {
    font-family: var(--mono); font-size: 22px; font-weight: 300;
    color: var(--text); letter-spacing: -0.02em;
  }
  .stat .label {
    font-size: 9.5px; font-weight: 500; color: var(--dim);
    text-transform: uppercase; letter-spacing: 0.1em; margin-top: var(--s1);
  }
  .file-link {
    display: inline-block; color: var(--accent); text-decoration: none;
    font-family: var(--mono); font-size: 11px; padding: 3px 10px;
    border-radius: 12px; margin: 2px 3px 2px 0; background: var(--accent-bg);
    border: 1px solid transparent; transition: all 0.2s ease;
  }
  .file-link:hover { border-color: var(--accent-light); background: #EDE6DD; color: var(--text); }

  .empty {
    color: var(--dim); font-weight: 300; font-style: italic;
    padding: var(--s5); text-align: center; font-size: 12px;
  }
  .section-title {
    font-size: 10.5px; font-weight: 500; letter-spacing: 0.12em;
    text-transform: uppercase; color: var(--dim); margin-bottom: var(--s4);
    display: flex; justify-content: space-between; align-items: center;
  }
  .section-title .count {
    font-family: var(--mono); font-size: 10px; color: var(--accent);
    background: var(--accent-bg); padding: 2px 8px; border-radius: 10px;
  }
  .section-gap { margin-top: var(--s5); }

  /* ── TYPOGRAPHY MENU ── */
  .typo-gear {
    background: none; border: none; cursor: pointer; color: var(--dim);
    font-size: 14px; padding: 0 4px; transition: color 0.15s; line-height: 1;
  }
  .typo-gear:hover { color: var(--accent); }
  .typo-popover {
    display: none; position: absolute; top: 100%; right: 0; z-index: 100;
    background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
    padding: var(--s4); min-width: 200px; box-shadow: 0 4px 16px rgba(0,0,0,0.08);
  }
  .typo-popover.open { display: block; }
  .typo-popover label {
    display: block; font-size: 10px; font-weight: 500; letter-spacing: 0.08em;
    text-transform: uppercase; color: var(--dim); margin-bottom: var(--s1); margin-top: var(--s3);
  }
  .typo-popover label:first-child { margin-top: 0; }
  .typo-popover input[type="range"] { width: 100%; accent-color: var(--accent); }
  .typo-popover select {
    width: 100%; padding: var(--s1) var(--s2); border: 1px solid var(--border);
    border-radius: var(--radius-sm); font-family: var(--font); font-size: 12px;
    background: var(--bg); color: var(--text);
  }
  .typo-size-display { font-family: var(--mono); font-size: 11px; color: var(--accent); float: right; }

  /* ── SEARCH BOX ── */
  .bc-search {
    margin-left: auto; display: flex; align-items: center; gap: var(--s1);
  }
  .bc-search input {
    width: 180px; padding: var(--s1) var(--s3); border: 1px solid var(--border);
    border-radius: var(--radius-sm); font-family: var(--font); font-size: 11.5px;
    background: var(--bg); color: var(--text); transition: all 0.2s;
  }
  .bc-search input:focus { outline: none; border-color: var(--accent); width: 260px; background: var(--surface); }
  .bc-search input::placeholder { color: var(--dim); }

  /* ── COMMAND INPUT ── */
  .cmd-area {
    display: flex; gap: var(--s2); align-items: flex-end; flex: 1; margin-right: var(--s3);
  }
  .cmd-input {
    flex: 1; resize: none; padding: var(--s2) var(--s3); border: 1px solid var(--border);
    border-radius: var(--radius-sm); font-family: var(--font); font-size: 12.5px;
    background: var(--bg); color: var(--text); min-height: 34px; max-height: 80px;
    line-height: 1.5; transition: border-color 0.2s;
  }
  .cmd-input:focus { outline: none; border-color: var(--accent); background: var(--surface); }
  .cmd-input::placeholder { color: var(--dim); }
  .btn-send {
    padding: var(--s2) var(--s3); background: var(--accent); color: #fff;
    border: none; border-radius: var(--radius-sm); font-family: var(--font);
    font-size: 11px; font-weight: 500; cursor: pointer; white-space: nowrap;
    transition: background 0.15s; height: 34px;
  }
  .btn-send:hover { background: var(--accent-light); }

  /* ── TIMELINE VIEW ── */
  .tl-msg {
    padding: var(--s3) var(--s4); border-radius: var(--radius-sm);
    border-left: 3px solid var(--border); margin-bottom: var(--s2);
    background: var(--bg); transition: background 0.15s; cursor: pointer;
  }
  .tl-msg:hover { background: var(--accent-bg); }
  .tl-header {
    display: flex; align-items: center; gap: var(--s3); margin-bottom: var(--s1);
  }
  .tl-project {
    font-family: var(--mono); font-size: 9.5px; padding: 1px 8px;
    border-radius: 10px; font-weight: 500; letter-spacing: 0.04em;
  }
  .tl-role {
    font-family: var(--mono); font-size: 9px; letter-spacing: 0.08em;
    text-transform: uppercase; color: var(--dim);
  }
  .tl-time {
    font-family: var(--mono); font-size: 9px; color: var(--dim);
    opacity: 0.5; margin-left: auto;
  }
  .tl-body {
    font-size: 13px; line-height: calc(1em * var(--phi)); color: var(--text-secondary);
    white-space: pre-wrap; word-wrap: break-word;
    display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
  }
  .tl-load-more {
    display: block; margin: var(--s4) auto; padding: var(--s2) var(--s5);
    background: none; border: 1px solid var(--border); border-radius: var(--radius-sm);
    font-family: var(--font); font-size: 12px; color: var(--text-secondary);
    cursor: pointer; transition: all 0.15s;
  }
  .tl-load-more:hover { background: var(--accent-bg); border-color: var(--accent-light); }

  /* ── MCP PANEL ── */
  .mcp-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: var(--s4);
  }
  .mcp-card {
    padding: var(--s5); background: var(--bg); border: 1px solid var(--border);
    border-radius: var(--radius-sm); transition: border-color 0.2s;
  }
  .mcp-card:hover { border-color: var(--accent-light); }
  .mcp-name {
    font-family: var(--mono); font-size: 14px; font-weight: 500;
    color: var(--text); margin-bottom: var(--s2);
    display: flex; align-items: center; gap: var(--s3);
  }
  .mcp-badge {
    font-size: 9px; padding: 2px 8px; border-radius: 10px;
    background: var(--green-bg); color: var(--green); font-family: var(--mono);
  }
  .mcp-cmd {
    font-family: var(--mono); font-size: 11px; color: var(--text-secondary);
    background: var(--surface); padding: var(--s2) var(--s3);
    border-radius: var(--radius-sm); margin: var(--s2) 0; word-break: break-all;
  }
  .mcp-section-label {
    font-size: 9.5px; font-weight: 500; letter-spacing: 0.08em;
    text-transform: uppercase; color: var(--dim); margin-top: var(--s3); margin-bottom: var(--s1);
  }
  .mcp-pills {
    display: flex; flex-wrap: wrap; gap: var(--s1);
  }
  .mcp-pill {
    font-family: var(--mono); font-size: 10px; padding: 2px 8px;
    background: var(--accent-bg); color: var(--accent); border-radius: 10px;
  }

  /* ── PROJECT COLOR HASH ── */
  .proj-sage { background: var(--green-bg); color: var(--green); }
  .proj-amber { background: var(--amber-bg); color: var(--amber); }
  .proj-rose { background: var(--rose-bg); color: var(--rose); }
  .proj-blue { background: var(--blue-bg); color: var(--blue); }
  .proj-accent { background: var(--accent-bg); color: var(--accent); }

  /* ── MARKDOWN IN BUBBLES ── */
  .md-code {
    display: block; background: var(--bg); border: 1px solid var(--border);
    border-radius: var(--radius-sm); padding: var(--s3) var(--s4); margin: var(--s2) 0;
    font-family: var(--mono); font-size: 12px; overflow-x: auto; white-space: pre;
  }
  .md-inline {
    background: var(--bg); padding: 1px 5px; border-radius: 3px;
    font-family: var(--mono); font-size: 0.9em;
  }
  .md-h1 { font-size: 16px; font-weight: 700; margin: var(--s3) 0 var(--s2); }
  .md-h2 { font-size: 14px; font-weight: 600; margin: var(--s3) 0 var(--s1); }
  .md-h3 { font-size: 13px; font-weight: 600; margin: var(--s2) 0 var(--s1); color: var(--text-secondary); }
  .md-li { padding-left: var(--s4); position: relative; }
  .md-li::before { content: '•'; position: absolute; left: var(--s2); color: var(--dim); }
  .md-hr { border: none; border-top: 1px solid var(--border); margin: var(--s3) 0; }

  /* ── DEBUG PANEL ── */
  .debug-panel {
    position: fixed; bottom: 0; right: 0; width: 360px; max-height: 50vh;
    background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius) 0 0 0;
    z-index: 200; display: none; flex-direction: column; font-size: 11px;
    box-shadow: -2px -2px 12px rgba(0,0,0,0.06);
  }
  .debug-panel.open { display: flex; }
  .debug-header {
    padding: var(--s2) var(--s3); background: var(--bg); border-bottom: 1px solid var(--border);
    display: flex; align-items: center; gap: var(--s2); cursor: pointer;
    font-weight: 500; letter-spacing: 0.06em; text-transform: uppercase; font-size: 9px;
    color: var(--dim);
  }
  .debug-header .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--green); }
  .debug-body {
    overflow-y: auto; flex: 1; padding: var(--s2) var(--s3); max-height: 40vh;
  }
  .debug-entry {
    padding: var(--s1) 0; border-bottom: 1px solid var(--border);
    font-family: var(--mono); font-size: 10px; line-height: 1.5;
  }
  .debug-entry .de-time { color: var(--dim); margin-right: var(--s2); }
  .debug-entry .de-type {
    display: inline-block; padding: 0 4px; border-radius: 3px;
    font-size: 9px; font-weight: 500; margin-right: var(--s1);
  }
  .de-route { background: var(--blue-bg); color: var(--blue); }
  .de-context { background: var(--green-bg); color: var(--green); }
  .de-spawn { background: var(--amber-bg); color: var(--amber); }
  .de-done { background: var(--accent-bg); color: var(--accent); }
  .de-error { background: var(--rose-bg); color: var(--rose); }
  .debug-toggle {
    position: fixed; bottom: var(--s3); right: var(--s3); z-index: 201;
    width: 32px; height: 32px; border-radius: 50%; border: 1px solid var(--border);
    background: var(--surface); cursor: pointer; display: flex; align-items: center;
    justify-content: center; font-size: 14px; color: var(--dim); transition: all 0.15s;
    box-shadow: 0 2px 8px rgba(0,0,0,0.05);
  }
  .debug-toggle:hover { color: var(--accent); border-color: var(--accent-light); }

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
  .night header { border-bottom-color: var(--dim); }
  .night .file-link:hover { background: #352F28; }
  .night .session-card:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.2); }
  .night .debug-panel { box-shadow: -2px -2px 12px rgba(0,0,0,0.3); }
  .night .debug-toggle { box-shadow: 0 2px 8px rgba(0,0,0,0.2); }
  .night .typo-popover { box-shadow: 0 4px 16px rgba(0,0,0,0.3); }
  .night .btn-accent { color: #1C1A17; }
  .night .btn-send { color: #1C1A17; }
  .night ::selection { background: rgba(196, 164, 120, 0.3); }

  /* Night mode toggle (inside typo popover) */
  .night-toggle {
    width: 100%; padding: var(--s2) var(--s3); border: 1px solid var(--border);
    border-radius: var(--radius-sm); font-family: var(--font); font-size: 12px;
    background: var(--bg); color: var(--text); cursor: pointer;
    transition: all 0.15s; text-align: left; display: flex; align-items: center; gap: var(--s2);
  }
  .night-toggle:hover { border-color: var(--accent-light); background: var(--accent-bg); }
  .night .night-toggle { background: var(--accent); color: #1C1A17; border-color: var(--accent); }
  .night .night-toggle:hover { background: var(--accent-light); }
</style>
</head>
<body>

<header>
  <h1>Alessio-OS</h1>
  <span class="subtitle">PTI Multi-Agent Hub</span>
  <div style="position:relative;margin-left:auto;display:flex;align-items:center;gap:var(--s3)">
    <button class="typo-gear" onclick="toggleTypoMenu()" title="Typography">&#9881;</button>
    <div class="typo-popover" id="typo-popover">
      <label>Font size <span class="typo-size-display" id="typo-size-val">15px</span></label>
      <input type="range" min="10" max="20" step="0.5" value="15" id="typo-size" oninput="applyTypo()">
      <label>Font family</label>
      <select id="typo-font" onchange="applyTypo()">
        <option value="'DM Sans', 'Helvetica Neue', -apple-system, sans-serif">DM Sans</option>
        <option value="'Helvetica Neue', Helvetica, -apple-system, sans-serif">Helvetica Neue</option>
        <option value="-apple-system, BlinkMacSystemFont, sans-serif">System</option>
      </select>
      <label>Line height</label>
      <select id="typo-lh" onchange="applyTypo()">
        <option value="1.4">1.4 (compact)</option>
        <option value="1.618" selected>&#966; 1.618 (golden)</option>
        <option value="1.8">1.8 (spacious)</option>
      </select>
      <label>Theme</label>
      <button class="night-toggle" id="night-btn" onclick="toggleNight()">
        <span id="night-icon">&#9790;</span> Night view
      </button>
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
      <div class="nav-label">Viste</div>
      <button class="nav-item active" data-view="chat" onclick="switchView('chat')">Chat</button>
      <button class="nav-item" data-view="timeline" onclick="switchView('timeline')">Timeline</button>
      <button class="nav-item" data-view="agents" onclick="switchView('agents')">Agenti <span class="nav-count" id="sidebar-agent-count">0</span></button>
      <button class="nav-item" data-view="tasks" onclick="switchView('tasks')">Tasks <span class="nav-count" id="sidebar-task-count">0</span></button>
      <button class="nav-item" data-view="kb" onclick="switchView('kb')">Knowledge Base</button>
      <button class="nav-item" data-view="mcp" onclick="switchView('mcp')">MCP</button>
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
    <!-- Breadcrumb -->
    <div class="breadcrumb">
      <span class="bc-link" id="bc-home" onclick="goHome()">home</span>
      <span class="bc-sep" id="bc-sep1" style="display:none">/</span>
      <span class="bc-link" id="bc-project" style="display:none" onclick="goProject()"></span>
      <span class="bc-sep" id="bc-sep2" style="display:none">/</span>
      <span id="bc-session" style="display:none"></span>
      <div class="bc-search">
        <input type="text" id="search-input" placeholder="Cerca nelle chat..." onkeydown="if(event.key==='Enter')doSearch()">
      </div>
    </div>

    <!-- CHAT VIEW -->
    <div id="chat-view" class="view active">
      <div class="view-scroll" id="chat-content">
        <div id="sessions-grid" class="sessions-grid"></div>
        <div id="messages-area" class="messages-list" style="display:none;"></div>
        <div id="results-area"></div>
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
        <div class="section-title">Agenti <span class="count" id="agent-count">0</span></div>
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
        <div class="section-title">Timeline <span class="count" id="tl-count">tutte le chat</span></div>
        <div id="timeline-list"></div>
        <button class="tl-load-more" id="tl-load-more" onclick="loadMoreTimeline()">Carica altri</button>
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
  document.querySelectorAll('[data-view]').forEach(b => {
    b.classList.toggle('active', b.dataset.view === name);
  });
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
  S.project = name;
  S.session = null;
  switchView('chat');
  loadSessions(name);
  updateBreadcrumb();
  // Swift wrapper: update title bar
  alessioOSBridge('setTitle', { title: name });

  // Update sidebar active
  document.querySelectorAll('[data-project]').forEach(b => {
    b.classList.toggle('active', b.dataset.project === name);
  });
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
    el.innerHTML = '<div class="empty">Nessun progetto. Esegui npm run auto-save</div>';
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
      el.innerHTML = '<div class="empty">Nessuna sessione</div>';
      return;
    }

    el.innerHTML = sessions.map(s => {
      const date = s.last_msg ? new Date(s.last_msg).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
      return '<div class="session-card" onclick="selectSession(\\'' + esc(s.session_id).replace(/'/g, "\\\\'") + '\\')">' +
        '<div class="sc-id">' + esc(s.session_id).slice(0, 16) + '...</div>' +
        '<div class="sc-meta"><span>' + (s.msg_count || 0) + ' msg</span><span>' + date + '</span></div>' +
      '</div>';
    }).join('');
  } catch (err) {
    el.innerHTML = '<div class="empty">Errore: ' + esc(String(err)) + '</div>';
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
      el.innerHTML = '<div class="empty">Nessun messaggio</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      var isUser = m.role === 'user';
      var time = m.created_at ? new Date(m.created_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '';
      var body = renderMd(String(m.content || ''));
      html += '<div class="msg ' + (isUser ? 'msg-user' : 'msg-assistant') + '">' +
        '<div class="msg-header">' +
          '<span class="msg-role">' + (m.role || '?') + '</span>' +
          '<span class="msg-time">' + time + '</span>' +
        '</div>' +
        '<div class="msg-body">' + body + '</div>' +
      '</div>';
    }
    el.innerHTML = html;

    // Scroll to bottom
    var scroll = document.getElementById('chat-content');
    setTimeout(function() { scroll.scrollTop = scroll.scrollHeight; }, 50);
  } catch (err) {
    console.error('loadMessages error:', err);
    el.innerHTML = '<div class="empty">Errore: ' + esc(String(err)) + '</div>';
  }
}

// ── AGENTS ──
function renderAgents(agents) {
  const el = document.getElementById('agents-list');
  document.getElementById('agent-count').textContent = agents.length;
  document.getElementById('sidebar-agent-count').textContent = agents.length;
  if (!agents.length) { el.innerHTML = '<div class="empty">Nessun agente attivo</div>'; return; }
  el.innerHTML = agents.map(a =>
    '<div class="agent">' +
      '<div class="status status-' + (a.status || 'idle') + '"></div>' +
      '<span class="role">' + esc(a.role || 'agent') + '</span>' +
      '<span class="task">' + esc(a.current_task || '-') + '</span>' +
    '</div>'
  ).join('');
}

// ── TASKS ──
function renderTasks(tasks) {
  const el = document.getElementById('tasks-list');
  document.getElementById('task-count').textContent = tasks.length;
  document.getElementById('sidebar-task-count').textContent = tasks.length;
  if (!tasks.length) { el.innerHTML = '<div class="empty">Nessun task</div>'; return; }
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

// ── SSE EVENTS ──
sse.addEventListener('state', function(e) {
  var state = JSON.parse(e.data);
  renderAgents(state.agents || []);
  renderTasks(state.tasks || []);
  if (state.kb) renderKB(state.kb);
  document.getElementById('kb-agents-count').textContent = (state.agents || []).length;
  document.getElementById('kb-tasks-count').textContent = (state.tasks || []).length;
  renderSidebarProjects(state.chatProjects || []);
  // Toggle thinking glow based on active agents
  var mainEl = document.querySelector('.main');
  if ((state.agents || []).length === 0) {
    mainEl.classList.remove('thinking');
  }
});

sse.addEventListener('log', function(e) {
  var d = JSON.parse(e.data);
  addLog(d.text, d.cls || '');
  // Agent dispatched → start thinking glow
  if (d.cls === 'agent-name' || (d.text && d.text.indexOf('dispatched') > -1)) {
    document.querySelector('.main').classList.add('thinking');
  }
});

sse.addEventListener('response', function(e) {
  var d = JSON.parse(e.data);
  // Agent responded → stop thinking glow
  document.querySelector('.main').classList.remove('thinking');
  if (d.text) {
    appendChatBubble('assistant', d.text);
    showResult('Assistant', d.text, null, false);
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

// ── INITIAL LOAD ──
fetch('/api/state').then(r => r.json()).then(state => {
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

// ── SIMPLE MARKDOWN RENDERER ──
function renderMd(text) {
  var BT = String.fromCharCode(96); // backtick
  var BT3 = BT + BT + BT;
  var html = esc(text);
  // Code blocks
  var cbRe = new RegExp(BT3 + '(\\\\w*)\\n([\\\\s\\\\S]*?)' + BT3, 'g');
  html = html.replace(cbRe, function(_, lang, code) {
    return '<pre class="md-code"><code>' + code.trim() + '</code></pre>';
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
  // List items
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
  var time = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  var body = isUser ? esc(content) : renderMd(String(content));
  var div = document.createElement('div');
  div.className = 'msg ' + (isUser ? 'msg-user' : 'msg-assistant');
  div.innerHTML = '<div class="msg-header">' +
    '<span class="msg-role">' + role + '</span>' +
    '<span class="msg-time">' + time + '</span>' +
  '</div>' +
  '<div class="msg-body">' + body + '</div>';
  el.appendChild(div);
  var scroll = document.getElementById('chat-content');
  setTimeout(function() { scroll.scrollTop = scroll.scrollHeight; }, 50);
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

function showResult(title, body, meta, isError) {
  const area = document.getElementById('results-area');
  const card = document.createElement('div');
  card.className = 'result-card' + (isError ? ' error' : '');
  const renderedBody = (title === 'Assistant') ? renderMd(body) : esc(body);
  card.innerHTML = '<div class="rc-title">' + esc(title) + '</div>' +
    '<div class="rc-body">' + renderedBody + '</div>' +
    (meta ? '<div class="rc-meta">' + esc(meta) + '</div>' : '');
  area.appendChild(card);
  const scroll = document.getElementById('chat-content');
  setTimeout(() => { scroll.scrollTop = scroll.scrollHeight; }, 50);
}

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
        showResult('OCR Error: ' + (r.file || '?'), r.error, null, true);
        addLog('OCR errore: ' + r.error, 'error');
      } else {
        const conf = r.confidence ? (r.confidence * 100).toFixed(1) + '%' : '';
        showResult('OCR: ' + (r.file || ''), r.text || '', conf, false);
        addLog('OCR completato: ' + (r.file || ''), 'event');
      }
    });
  } catch (err) {
    showResult('OCR Error', String(err), null, true);
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
      showResult('STT Error: ' + (result.file || '?'), result.error, null, true);
      addLog('STT errore: ' + result.error, 'error');
    } else {
      showResult('Trascrizione: ' + (result.file || ''), result.text || '', null, false);
      addLog('STT completato: ' + (result.file || ''), 'event');
    }
  } catch (err) {
    showResult('STT Error', String(err), null, true);
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

// ── RYTMO: DOUBLE-TAP TO RECORD ──
(function initRytmo() {
  var lastTap = 0;
  var tapTimeout = null;
  var TAP_GAP = 400; // max ms between taps

  document.getElementById('chat-view').addEventListener('pointerup', function(e) {
    // Ignore taps on interactive elements
    if (e.target.closest('textarea, button, input, a, select')) return;

    var now = Date.now();
    if (now - lastTap < TAP_GAP) {
      // Double-tap detected
      clearTimeout(tapTimeout);
      lastTap = 0;
      toggleMic();
      // Visual feedback
      var dz = document.getElementById('drop-zone');
      dz.style.borderColor = 'var(--accent)';
      setTimeout(function() { dz.style.borderColor = ''; }, 600);
    } else {
      lastTap = now;
      tapTimeout = setTimeout(function() { lastTap = 0; }, TAP_GAP);
    }
  });
})();

// ── NIGHT VIEW ──
function toggleNight() {
  document.documentElement.classList.toggle('night');
  const on = document.documentElement.classList.contains('night');
  localStorage.setItem('alessio-os-night', on ? '1' : '0');
  const icon = document.getElementById('night-icon');
  if (icon) icon.innerHTML = on ? '\\u2600' : '\\u263E';
}
(function initNight() {
  if (localStorage.getItem('alessio-os-night') === '1') {
    document.documentElement.classList.add('night');
    const icon = document.getElementById('night-icon');
    if (icon) icon.innerHTML = '\\u2600';
  }
})();

// ── TYPOGRAPHY PREFS ──
function toggleTypoMenu() {
  document.getElementById('typo-popover').classList.toggle('open');
}
// Close popover on outside click
document.addEventListener('click', function(e) {
  const pop = document.getElementById('typo-popover');
  if (pop.classList.contains('open') && !e.target.closest('.typo-popover') && !e.target.closest('.typo-gear')) {
    pop.classList.remove('open');
  }
});

function applyTypo() {
  const size = document.getElementById('typo-size').value;
  const font = document.getElementById('typo-font').value;
  const lh = document.getElementById('typo-lh').value;
  document.getElementById('typo-size-val').textContent = size + 'px';
  document.body.style.fontSize = size + 'px';
  document.body.style.fontFamily = font;
  document.body.style.lineHeight = lh;
  // Persist
  localStorage.setItem('alessio-os-prefs', JSON.stringify({ size, font, lh }));
}

// Load saved prefs
(function loadTypoPrefs() {
  try {
    const raw = localStorage.getItem('alessio-os-prefs');
    if (!raw) return;
    const p = JSON.parse(raw);
    if (p.size) {
      document.getElementById('typo-size').value = p.size;
      document.getElementById('typo-size-val').textContent = p.size + 'px';
      document.body.style.fontSize = p.size + 'px';
    }
    if (p.font) {
      document.getElementById('typo-font').value = p.font;
      document.body.style.fontFamily = p.font;
    }
    if (p.lh) {
      document.getElementById('typo-lh').value = p.lh;
      document.body.style.lineHeight = p.lh;
    }
  } catch {}
})();

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
      el.innerHTML = '<div class="empty">Nessun risultato per "' + esc(q) + '"</div>';
      return;
    }
    el.innerHTML = '<div class="section-title">Risultati per "' + esc(q) + '" <span class="count">' + results.length + '</span></div>' +
      results.map(function(m) {
        const time = m.created_at ? new Date(m.created_at).toLocaleString('it-IT', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '';
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
    el.innerHTML = '<div class="empty">Errore: ' + esc(String(err)) + '</div>';
  }
}

// ── COMMAND INPUT ──
async function sendCommand() {
  const input = document.getElementById('cmd-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.style.height = '34px';

  // Show user message in chat + results
  appendChatBubble('user', text);
  showResult('Tu', text, null, false);

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
  this.style.height = Math.min(this.scrollHeight, 80) + 'px';
});

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
      if (reset) list.innerHTML = '<div class="empty">Nessun messaggio</div>';
      document.getElementById('tl-load-more').style.display = 'none';
      return;
    }

    document.getElementById('tl-load-more').style.display = 'block';
    const html = items.map(function(m) {
      const time = m.created_at ? new Date(m.created_at).toLocaleString('it-IT', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '';
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
    if (reset) list.innerHTML = '<div class="empty">Errore: ' + esc(String(err)) + '</div>';
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
      grid.innerHTML = '<div class="empty">Nessun server MCP configurato</div>';
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
    grid.innerHTML = '<div class="empty">Errore: ' + esc(String(err)) + '</div>';
  }
}

// ── ENHANCED VIEW SWITCH ──
const origSwitchView = switchView;
switchView = function(name) {
  origSwitchView(name);
  if (name === 'timeline') loadTimeline(true);
  if (name === 'mcp') loadMcpStatus();
};

// ── DEBUG PANEL ──
function toggleDebug() {
  document.getElementById('debug-panel').classList.toggle('open');
}

const debugEntries = [];
function addDebug(type, text) {
  const now = new Date().toLocaleTimeString('it-IT', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  debugEntries.push({ time: now, type, text });
  if (debugEntries.length > 100) debugEntries.shift();
  renderDebug();
}

function renderDebug() {
  const body = document.getElementById('debug-body');
  if (!body) return;
  body.innerHTML = debugEntries.slice().reverse().map(function(e) {
    const cls = e.type === 'route' ? 'de-route' : e.type === 'context' ? 'de-context' :
                e.type === 'spawn' ? 'de-spawn' : e.type === 'done' ? 'de-done' : 'de-error';
    return '<div class="debug-entry"><span class="de-time">' + e.time + '</span>' +
      '<span class="de-type ' + cls + '">' + e.type + '</span>' + esc(e.text) + '</div>';
  }).join('');
}

// Hook into SSE log events to capture debug info
const origLogHandler = sse.addEventListener;
sse.addEventListener('log', function(e) {
  const d = JSON.parse(e.data);
  const t = d.text || '';
  // Classify log entries for debug panel
  if (t.includes('[route]')) addDebug('route', t);
  else if (t.includes('Context:')) addDebug('context', t);
  else if (t.includes('dispatched') || t.includes('coder →') || t.includes('tester →') || t.includes('reviewer →') || t.includes('researcher →')) addDebug('spawn', t);
  else if (t.includes('exit:')) addDebug('done', t);
  else if (d.cls === 'error') addDebug('error', t);
});
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

</body>
</html>`;
}

// --- HTTP Server ---
async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url ?? '/';
  const path = urlPath(url);
  const query = parseQuery(url);

  // SSE
  if (path === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    try {
      const state = await getFullState();
      res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
    } catch { /* skip */ }
    return;
  }

  // API: full state
  if (path === '/api/state') {
    try {
      jsonResponse(res, await getFullState());
    } catch (err) {
      jsonResponse(res, { error: String(err) }, 500);
    }
    return;
  }

  // API: sessions
  if (path === '/api/sessions' && query.project) {
    try {
      jsonResponse(res, await getSessions(query.project));
    } catch (err) {
      jsonResponse(res, { error: String(err) }, 500);
    }
    return;
  }

  // API: messages
  if (path === '/api/messages' && query.project && query.session) {
    try {
      jsonResponse(res, await getMessages(query.project, query.session));
    } catch (err) {
      jsonResponse(res, { error: String(err) }, 500);
    }
    return;
  }

  // API: OCR upload
  if (path === '/api/ocr' && req.method === 'POST') {
    try {
      const results = await handleOCR(req);
      jsonResponse(res, results);
    } catch (err) {
      jsonResponse(res, { error: String(err) }, 500);
    }
    return;
  }

  // API: STT upload
  if (path === '/api/transcribe' && req.method === 'POST') {
    try {
      const result = await handleTranscribe(req);
      jsonResponse(res, result);
    } catch (err) {
      jsonResponse(res, { error: String(err) }, 500);
    }
    return;
  }

  // API: timeline
  if (path === '/api/timeline') {
    try {
      const page = parseInt(query.page ?? '0', 10);
      jsonResponse(res, await getTimeline(page));
    } catch (err) {
      jsonResponse(res, { error: String(err) }, 500);
    }
    return;
  }

  // API: search
  if (path === '/api/search' && query.q) {
    try {
      jsonResponse(res, await searchChats(query.q));
    } catch (err) {
      jsonResponse(res, { error: String(err) }, 500);
    }
    return;
  }

  // API: command
  if (path === '/api/command' && req.method === 'POST') {
    try {
      jsonResponse(res, await handleCommand(req));
    } catch (err) {
      jsonResponse(res, { error: String(err) }, 500);
    }
    return;
  }

  // API: mcp-status
  if (path === '/api/mcp-status') {
    try {
      jsonResponse(res, getMcpStatus());
    } catch (err) {
      jsonResponse(res, { error: String(err) }, 500);
    }
    return;
  }

  // Default: dashboard HTML
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(dashboardHTML());
}

// --- Start ---
export function startDashboard(): void {
  // Initialize orchestrator with SSE callbacks
  orchestrator = new Orchestrator({
    project: 'alessio-os',
    maxParallelAgents: 2,
    onLog: (text, cls) => broadcast('log', { text, cls }),
    onResponse: (text, taskId) => broadcast('response', { text, taskId }),
  });
  // No start() needed — PTI è reattivo, niente polling
  console.log('[Dashboard] Orchestrator PTI v4 pronto (reattivo, zero polling)');

  const server = createServer((req, res) => {
    handleRequest(req, res).catch(() => {
      if (!res.headersSent) {
        res.writeHead(500);
        res.end('Internal error');
      }
    });
  });

  server.listen(PORT, () => {
    console.log(`[Dashboard] http://localhost:${PORT}`);
  });

  // Polling ogni 2s
  setInterval(pollAndBroadcast, 2000);
}

// --- Log broadcast helper ---
export function dashboardLog(text: string, cls = ''): void {
  broadcast('log', { text, cls });
}
