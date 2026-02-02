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
import { syncTopology, attachDeltaLogger, saveSnapshot, getSnapshots, getDeltaHistory } from '../pti/graph-persistence.js';
import { diffStrutturale, type NodoSnapshot } from '../pti/diff.js';
import { analyzeCodebase } from '../pti/registry.js';
import { PTI_MANIFESTO, PTI_VERSION } from '../pti/manifesto.js';
import { listParadigms, getParadigm, createParadigm, deleteParadigm, assignParadigm, getAssignment, removeAssignment, seedDefaultParadigm } from '../pti/paradigm-registry.js';
import { listAgentDefinitions, getAgentDefinition, createAgentDefinition, updateAgentDefinition, deleteAgentDefinition } from '../agents/agent-definitions.js';
import { resolveRepo, getIssues, getPRs, getDiscussions, getGithubConfig, setGithubConfig } from '../integrations/github.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..');
const PORT = parseInt(process.env.PORT ?? '3777', 10);

// --- Orchestrator singleton (started in startDashboard) ---
let orchestrator: Orchestrator | null = null;
const OCR_BINARY = resolve(__dirname, '..', 'tools', 'ocr-vision');

// --- Codebase topology cache (30s TTL, per-project) ---
const LEVEL_MAP: Record<string, number> = { atomo: 5, molecola: 6, cellula: 7, tessuto: 8, organo: 9 };
const topologyCache = new Map<string, { nodi: unknown[]; edges: unknown[]; ts: number }>();
const CACHE_TTL = 30_000;
const HOME = homedir();

// Project path resolution: name → filesystem path
const PROJECT_PATHS: Record<string, string> = {
  'alessio-os': PROJECT_ROOT,
  'phonon-ui': join(HOME, 'phonon-ui'),
  'nico': join(HOME, 'nico'),
  'rememberance': join(HOME, 'Rememberance'),
  'innesti': join(HOME, 'innesti-revamp-draft'),
  'dag-consulting': join(HOME, 'Documents/Web/Dag Consulting 2.0'),
  'phi-docs': join(HOME, 'phi-docs'),
  'natale-order-manager': join(HOME, 'natale-order-manager-main'),
};

function resolveProjectPath(projectName?: string): string {
  if (!projectName || projectName === 'alessio-os') return PROJECT_ROOT;
  // Exact match in registry
  const registered = PROJECT_PATHS[projectName.toLowerCase()];
  if (registered) return registered;
  // Convention: ~/projectName
  return join(HOME, projectName);
}

function getCodebaseTopology(projectRoot?: string): { nodi: unknown[]; edges: unknown[] } {
  const root = projectRoot ?? PROJECT_ROOT;
  const now = Date.now();
  const cached = topologyCache.get(root);
  if (cached && (now - cached.ts) < CACHE_TTL) {
    return { nodi: cached.nodi, edges: cached.edges };
  }
  let modules;
  try {
    modules = analyzeCodebase(root);
  } catch {
    return { nodi: [], edges: [] };
  }
  if (!modules.length) return { nodi: [], edges: [] };
  const nodi: unknown[] = [];
  const edges: unknown[] = [];
  for (const mod of modules) {
    const id = `mod.${mod.file.replace(/[\\/]/g, '.').replace(/\.ts$/, '')}`;
    nodi.push({
      id,
      tipo: 'modulo',
      livello: LEVEL_MAP[mod.level] ?? 5,
      valore: { file: mod.file, lines: mod.lines, exports: mod.exports },
      sorgenti: [],
      salti: [],
    });
  }
  // Build dependency edges from imports
  const fileToId = new Map(modules.map(m => [m.file.replace(/\.ts$/, ''), `mod.${m.file.replace(/[\\/]/g, '.').replace(/\.ts$/, '')}`]));
  for (const mod of modules) {
    const srcId = `mod.${mod.file.replace(/[\\/]/g, '.').replace(/\.ts$/, '')}`;
    for (const imp of mod.imports) {
      const modDir = mod.file.includes('/') ? mod.file.slice(0, mod.file.lastIndexOf('/')) : '';
      const resolved = imp.startsWith('./') || imp.startsWith('../')
        ? join(modDir, imp).replace(/\\/g, '/')
        : imp;
      const normalised = resolved.replace(/^\.\//, '');
      const targetId = fileToId.get(normalised) ?? fileToId.get(`src/${normalised}`);
      if (targetId) {
        edges.push({ da: srcId, a: targetId, tipo: 'modulo-dep' });
      }
    }
  }
  topologyCache.set(root, { nodi, edges, ts: now });
  return { nodi, edges };
}

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

// --- Incremental SSE polling (delta, non ricalcolo) ---
let prevAgents = '';
let prevTasks = '';
let prevKb = '';
let prevProjects = '';

async function pollAndBroadcast(): Promise<void> {
  try {
    const [agents, tasks, , kbStats, recentChat] = await Promise.all([
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

    const agentsData = agents[0]?.result ?? [];
    const tasksData = tasks[0]?.result ?? [];
    const kbData = kbStats[0]?.result ?? {};
    const projectsData = recentChat[0]?.result ?? [];

    const agentsHash = JSON.stringify(agentsData);
    const tasksHash = JSON.stringify(tasksData);
    const kbHash = JSON.stringify(kbData);
    const projectsHash = JSON.stringify(projectsData);

    if (agentsHash !== prevAgents) {
      prevAgents = agentsHash;
      broadcast('agents:update', { agents: agentsData });
    }
    if (tasksHash !== prevTasks) {
      prevTasks = tasksHash;
      broadcast('tasks:update', { tasks: tasksData });
    }
    if (kbHash !== prevKb) {
      prevKb = kbHash;
      broadcast('kb:update', { kb: kbData });
    }
    if (projectsHash !== prevProjects) {
      prevProjects = projectsHash;
      broadcast('projects:update', { chatProjects: projectsData });
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


// --- Dashboard UI modules (extracted tissues) ---
import { css } from './tokens.css.js';
import { dashboardPage } from './layout.html.js';
import { ptiUtilsJs } from './pti-utils.js.js';
import { aosJs } from './aos-rytmo.js.js';
import { stateJs } from './state.js.js';
import { graphJs } from './graph-view.js.js';

// --- HTML Dashboard (composed from tissues) ---
function dashboardHTML(): string {
  const js = ptiUtilsJs + '\n' + aosJs + '\n' + stateJs + '\n' + graphJs;
  return dashboardPage({ css, js });
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

  // API: restart server
  if (path === '/api/restart' && req.method === 'POST') {
    jsonResponse(res, { ok: true, message: 'Riavvio in corso...' });
    broadcast('log', { text: '[server] Riavvio richiesto dalla dashboard', cls: 'event' });
    setTimeout(() => process.exit(0), 500);
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

  // API: PTI graph topology (unified: runtime + codebase, multi-project)
  if (path === '/api/pti/topology') {
    const projectRoot = resolveProjectPath(query.project);
    const runtimeNodi = orchestrator ? orchestrator.grafo.stato() : [];
    const runtimeEdges: Array<{ da: string; a: string; tipo: string }> = [];
    for (const n of runtimeNodi) {
      for (const s of n.sorgenti) runtimeEdges.push({ da: s, a: n.id, tipo: 'dipendenza' });
      for (const s of n.salti) runtimeEdges.push({ da: n.id, a: s, tipo: 'salto' });
    }
    const codebase = getCodebaseTopology(projectRoot);
    const nodi = [...runtimeNodi, ...codebase.nodi];
    const edges = [...runtimeEdges, ...codebase.edges];
    jsonResponse(res, { nodi, edges, stats: orchestrator?.grafo.stats() ?? {}, project: query.project || 'alessio-os' });
    return;
  }

  // API: list available projects for PTI graph
  if (path === '/api/pti/projects') {
    const projects = Object.keys(PROJECT_PATHS).map(name => ({ name, path: PROJECT_PATHS[name] }));
    jsonResponse(res, projects);
    return;
  }

  // API: PTI manifesto (imprinting universale)
  if (path === '/api/pti/manifesto') {
    jsonResponse(res, { version: PTI_VERSION, manifesto: PTI_MANIFESTO });
    return;
  }

  // API: PTI node trace
  if (path === '/api/pti/trace' && query.node) {
    if (!orchestrator) { jsonResponse(res, { error: 'No orchestrator' }, 503); return; }
    const grafo = orchestrator.grafo;
    const trace = grafo.trace(query.node);
    const catena = grafo.catena(query.node);
    const nodoBase = grafo.nodo(query.node);
    jsonResponse(res, {
      id: query.node,
      tipo: nodoBase?.tipo,
      valore: nodoBase?.valore,
      livello: nodoBase?.livello,
      sorgenti: trace.sorgenti,
      dipendenti: trace.dipendenti,
      salti: trace.salti,
      catena,
      ultimoCausa: trace.ultimoCausa,
      accessCount: nodoBase?.accessCount,
    });
    return;
  }

  // API: PTI delta log (from DB)
  if (path === '/api/pti/delta-log') {
    try {
      const limit = parseInt(query.limit ?? '50', 10);
      jsonResponse(res, await getDeltaHistory('orchestrator', limit));
    } catch (err) {
      jsonResponse(res, { error: String(err) }, 500);
    }
    return;
  }

  // API: PTI snapshots list
  if (path === '/api/pti/snapshots') {
    try {
      const limit = parseInt(query.limit ?? '10', 10);
      const snapshots = await getSnapshots('orchestrator', limit);
      jsonResponse(res, snapshots.map(s => ({ id: s.id, label: s.label, created_at: s.created_at })));
    } catch (err) {
      jsonResponse(res, { error: String(err) }, 500);
    }
    return;
  }

  // API: PTI diff between two snapshots (or snapshot vs live)
  if (path === '/api/pti/diff') {
    if (!orchestrator) { jsonResponse(res, { error: 'No orchestrator' }, 503); return; }
    try {
      const snapshots = await getSnapshots('orchestrator', 20);

      let before: NodoSnapshot[];
      let after: NodoSnapshot[];

      if (query.before) {
        const snap = snapshots.find(s => String(s.id) === query.before);
        if (!snap) { jsonResponse(res, { error: 'Snapshot "before" not found' }, 404); return; }
        before = ((snap.snapshot as { nodi?: NodoSnapshot[] })?.nodi ?? []) as NodoSnapshot[];
      } else if (snapshots.length > 0) {
        // Default: use latest snapshot as "before"
        before = ((snapshots[0].snapshot as { nodi?: NodoSnapshot[] })?.nodi ?? []) as NodoSnapshot[];
      } else {
        before = [];
      }

      if (query.after) {
        const snap = snapshots.find(s => String(s.id) === query.after);
        if (!snap) { jsonResponse(res, { error: 'Snapshot "after" not found' }, 404); return; }
        after = ((snap.snapshot as { nodi?: NodoSnapshot[] })?.nodi ?? []) as NodoSnapshot[];
      } else {
        // Default: live state
        after = orchestrator.grafo.stato() as NodoSnapshot[];
      }

      const diff = diffStrutturale(before, after);
      jsonResponse(res, diff);
    } catch (err) {
      jsonResponse(res, { error: String(err) }, 500);
    }
    return;
  }

  // API: PTI snapshot
  if (path === '/api/pti/snapshot' && req.method === 'POST') {
    if (!orchestrator) { jsonResponse(res, { error: 'No orchestrator' }, 503); return; }
    try {
      await saveSnapshot(orchestrator.grafo, 'orchestrator');
      jsonResponse(res, { ok: true });
    } catch (err) {
      jsonResponse(res, { error: String(err) }, 500);
    }
    return;
  }

  // ==================== GITHUB API ====================

  if (path === '/api/github/issues') {
    const project = query.project as string;
    const state = (query.state as string) || 'open';
    if (!project) { jsonResponse(res, { error: 'Missing project' }, 400); return; }
    try {
      const repo = await resolveRepo(project);
      if (!repo) { jsonResponse(res, []); return; }
      jsonResponse(res, getIssues(repo, state));
    } catch (err) {
      jsonResponse(res, { error: String(err) }, 500);
    }
    return;
  }

  if (path === '/api/github/prs') {
    const project = query.project as string;
    const state = (query.state as string) || 'open';
    if (!project) { jsonResponse(res, { error: 'Missing project' }, 400); return; }
    try {
      const repo = await resolveRepo(project);
      if (!repo) { jsonResponse(res, []); return; }
      jsonResponse(res, getPRs(repo, state));
    } catch (err) {
      jsonResponse(res, { error: String(err) }, 500);
    }
    return;
  }

  if (path === '/api/github/discussions') {
    const project = query.project as string;
    if (!project) { jsonResponse(res, { error: 'Missing project' }, 400); return; }
    try {
      const repo = await resolveRepo(project);
      if (!repo) { jsonResponse(res, []); return; }
      jsonResponse(res, getDiscussions(repo));
    } catch (err) {
      jsonResponse(res, { error: String(err) }, 500);
    }
    return;
  }

  if (path === '/api/github/config' && req.method === 'GET') {
    const project = query.project as string;
    if (!project) { jsonResponse(res, { error: 'Missing project' }, 400); return; }
    try {
      const config = await getGithubConfig(project);
      const repo = await resolveRepo(project);
      jsonResponse(res, config ?? { repo: repo ?? '', default_branch: 'main' });
    } catch (err) {
      jsonResponse(res, { error: String(err) }, 500);
    }
    return;
  }

  if (path === '/api/github/config' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const data = JSON.parse(body);
      await setGithubConfig(data.project, data.repo, data.default_branch);
      jsonResponse(res, { ok: true });
    } catch (err) {
      jsonResponse(res, { error: String(err) }, 400);
    }
    return;
  }

  // ==================== AGENT DEFINITIONS API ====================

  if (path === '/api/agents/definitions' && req.method === 'GET') {
    const project = query.project as string;
    if (!project) { jsonResponse(res, { error: 'Missing project' }, 400); return; }
    try {
      const defs = await listAgentDefinitions(project);
      jsonResponse(res, defs);
    } catch (err) {
      jsonResponse(res, { error: String(err) }, 500);
    }
    return;
  }

  if (path === '/api/agents/definitions' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const data = JSON.parse(body);
      const id = await createAgentDefinition(data);
      jsonResponse(res, { agent_def_id: id });
    } catch (err) {
      jsonResponse(res, { error: String(err) }, 400);
    }
    return;
  }

  if (path === '/api/agents/definitions' && req.method === 'PUT') {
    const id = query.id as string;
    if (!id) { jsonResponse(res, { error: 'Missing id' }, 400); return; }
    try {
      const body = await readBody(req);
      const data = JSON.parse(body);
      await updateAgentDefinition(id, data);
      jsonResponse(res, { ok: true });
    } catch (err) {
      jsonResponse(res, { error: String(err) }, 400);
    }
    return;
  }

  if (path === '/api/agents/definitions' && req.method === 'DELETE') {
    const id = query.id as string;
    if (!id) { jsonResponse(res, { error: 'Missing id' }, 400); return; }
    try {
      await deleteAgentDefinition(id);
      jsonResponse(res, { ok: true });
    } catch (err) {
      jsonResponse(res, { error: String(err) }, 400);
    }
    return;
  }

  // ==================== PARADIGM REGISTRY API ====================

  if (path === '/api/paradigms') {
    try {
      const paradigms = await listParadigms();
      jsonResponse(res, paradigms);
    } catch (err) {
      jsonResponse(res, { error: String(err) }, 500);
    }
    return;
  }

  if (path === '/api/paradigm' && req.method === 'GET') {
    const id = query.id as string;
    if (!id) { jsonResponse(res, { error: 'Missing id' }, 400); return; }
    try {
      const p = await getParadigm(id);
      if (!p) { jsonResponse(res, { error: 'Not found' }, 404); return; }
      jsonResponse(res, p);
    } catch (err) {
      jsonResponse(res, { error: String(err) }, 500);
    }
    return;
  }

  if (path === '/api/paradigm' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const data = JSON.parse(body);
      const id = await createParadigm(data);
      jsonResponse(res, { paradigm_id: id });
    } catch (err) {
      jsonResponse(res, { error: String(err) }, 400);
    }
    return;
  }

  if (path === '/api/paradigm' && req.method === 'DELETE') {
    const id = query.id as string;
    if (!id) { jsonResponse(res, { error: 'Missing id' }, 400); return; }
    try {
      await deleteParadigm(id);
      jsonResponse(res, { ok: true });
    } catch (err) {
      jsonResponse(res, { error: String(err) }, 400);
    }
    return;
  }

  if (path === '/api/paradigm/assign' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const data = JSON.parse(body);
      await assignParadigm(data);
      jsonResponse(res, { ok: true });
    } catch (err) {
      jsonResponse(res, { error: String(err) }, 400);
    }
    return;
  }

  if (path === '/api/paradigm/assignment') {
    const type = query.type as string;
    const id = query.id as string;
    if (!type || !id) { jsonResponse(res, { error: 'Missing type or id' }, 400); return; }
    try {
      const assignment = await getAssignment(type, id);
      jsonResponse(res, assignment ?? { paradigm_id: null });
    } catch (err) {
      jsonResponse(res, { error: String(err) }, 500);
    }
    return;
  }

  if (path === '/api/paradigm/assignment' && req.method === 'DELETE') {
    const type = query.type as string;
    const id = query.id as string;
    if (!type || !id) { jsonResponse(res, { error: 'Missing type or id' }, 400); return; }
    try {
      await removeAssignment(type, id);
      jsonResponse(res, { ok: true });
    } catch (err) {
      jsonResponse(res, { error: String(err) }, 400);
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

  // Seed default PTI paradigm
  seedDefaultParadigm().catch(err =>
    console.warn('[Dashboard] Paradigm seed failed:', err));

  // PTI Graph persistence: sync topology + delta logger
  syncTopology(orchestrator.grafo, 'orchestrator').catch(err =>
    console.error('[pti-persist] sync error:', err)
  );
  attachDeltaLogger(orchestrator.grafo, 'orchestrator', (entries) => {
    broadcast('pti:delta', { entries });
  });

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
