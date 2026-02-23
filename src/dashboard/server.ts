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
import { resolveProjectPath, PROJECT_ROOT, PROJECT_PATHS } from '../utils/paths.js';
import { surqlQuery } from '../pti/surreal-bridge.js';
import { Orchestrator } from '../agents/orchestrator.js';
import { syncTopology, attachDeltaLogger, saveSnapshot, getSnapshots, getDeltaHistory } from '../pti/graph-persistence.js';
import { diffStrutturale, type NodoSnapshot } from '../pti/diff.js';
import { analyzeCodebase } from '../pti/registry.js';
import { generaPtig, type PtigFile } from '../pti/ptig-generator.js';
import { PTI_MANIFESTO, PTI_VERSION } from '../pti/manifesto.js';
import { listParadigms, getParadigm, createParadigm, deleteParadigm, assignParadigm, getAssignment, removeAssignment, seedDefaultParadigm } from '../pti/paradigm-registry.js';
import { listAgentDefinitions, getAgentDefinition, createAgentDefinition, updateAgentDefinition, deleteAgentDefinition } from '../agents/agent-definitions.js';
import { resolveRepo, resolveProjectPath as ghProjectPath, getIssues, getPRs, getDiscussions, getIssueBody, getGithubConfig, setGithubConfig, generateBranchName, createBranch, branchExists, checkoutBranch } from '../integrations/github.js';
import { logAction, onAction, getActionHistory } from '../agents/action-logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT ?? '3777', 10);

// --- Orchestrator singleton (started in startDashboard) ---
let orchestrator: Orchestrator | null = null;
const OCR_BINARY = resolve(__dirname, '..', 'tools', 'ocr-vision');

// --- Codebase topology cache (30s TTL, per-project) ---
const LEVEL_MAP: Record<string, number> = { atomo: 5, molecola: 6, cellula: 7, tessuto: 8, organo: 9 };
const topologyCache = new Map<string, { nodi: unknown[]; edges: unknown[]; ts: number }>();
const CACHE_TTL = 30_000;
const PTIG_CACHE_TTL = 60_000;
const ptigCache = new Map<string, { data: PtigFile; ts: number }>();

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

// SSE heartbeat — prevent proxy/browser timeout disconnects
setInterval(() => {
  for (const client of sseClients) {
    try { client.write(': ping\n\n'); } catch { sseClients.delete(client); }
  }
}, 15_000);

// --- API: stato completo ---
async function getFullState(): Promise<Record<string, unknown>> {
  const [agents, tasks, sessions, kbStats, recentChat] = await Promise.all([
    surqlQuery("SELECT * FROM agent_state WHERE status IN ['working', 'starting'] ORDER BY updated_at DESC LIMIT 20"),
    surqlQuery('SELECT * FROM task_queue ORDER BY created_at DESC LIMIT 30'),
    surqlQuery('SELECT * FROM session_ctx ORDER BY updated_at DESC LIMIT 5'),
    surqlQuery('fn::kb_stats_v4()'),
    surqlQuery(`
      SELECT project, count() AS msg_count,
        array::group(session_id) AS session_ids
      FROM chat_log
      GROUP BY project
      ORDER BY msg_count DESC
      LIMIT 100
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
  const proj = project || 'alessio-os';
  orchestrator.input(text, proj);

  logAction({
    project: proj,
    action_type: 'command_sent',
    title: `Comando: ${text.slice(0, 80)}`,
    details: text.slice(0, 500),
    metadata: { routes: route.roles, priority: route.priority },
  }).catch(() => {});

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
      surqlQuery("SELECT * FROM agent_state WHERE status IN ['working', 'starting'] ORDER BY updated_at DESC LIMIT 20"),
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
import { terminalJs } from './terminal.js.js';
import { stateCoreJs } from './state.core.js.js';
import { stateNavJs } from './state.nav.js.js';
import { stateRenderJs } from './state.render.js.js';
import { stateSttJs } from './state.stt.js.js';
import { stateChatJs } from './state.chat.js.js';
import { stateTimelineJs } from './state.timeline.js.js';
import { stateGithubJs } from './state.github.js.js';
import { stateAgentsJs } from './state.agents.js.js';
import { stateOutreachJs } from './state.outreach.js.js';
import { stateFisJs } from './state.fis.js.js';
import { graphJs } from './graph-view.js.js';
import { depthLabPage } from './depth-lab.html.js';

// --- HTML Dashboard (composed from tissues — PTI concat order) ---
function dashboardHTML(): string {
  const js = ptiUtilsJs + '\n' + aosJs + '\n' + terminalJs + '\n'
    + stateCoreJs + '\n' + stateNavJs + '\n' + stateRenderJs + '\n'
    + stateSttJs + '\n' + stateChatJs + '\n' + stateTimelineJs + '\n'
    + stateGithubJs + '\n' + stateAgentsJs + '\n' + stateOutreachJs + '\n' + stateFisJs + '\n' + graphJs;
  return dashboardPage({ css, js });
}

// --- Route handler type ---
type RouteHandler = (req: IncomingMessage, res: ServerResponse, query: Record<string, string>) => Promise<void>;

// Wrap an async data function as a route handler with try/catch → jsonResponse
function api(fn: (q: Record<string, string>, req: IncomingMessage) => Promise<unknown>, errStatus = 500): RouteHandler {
  return async (req, res, query) => {
    try { jsonResponse(res, await fn(query, req)); }
    catch (err) { jsonResponse(res, { error: String(err) }, errStatus); }
  };
}

// Require query param, return 400 if missing
function requireParam(query: Record<string, string>, key: string, res: ServerResponse): string | null {
  const val = query[key];
  if (!val) { jsonResponse(res, { error: `Missing ${key}` }, 400); return null; }
  return val;
}

// --- Route: SSE ---
async function handleSSE(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*' });
  sseClients.add(res);
  _req.on('close', () => sseClients.delete(res));
  try { res.write(`event: state\ndata: ${JSON.stringify(await getFullState())}\n\n`); } catch { /* skip */ }
}

// --- Route: PTI topology ---
async function handleTopology(_req: IncomingMessage, res: ServerResponse, query: Record<string, string>): Promise<void> {
  const projectRoot = resolveProjectPath(query.project);
  const runtimeNodi = orchestrator ? orchestrator.grafo.stato() : [];
  const runtimeEdges: Array<{ da: string; a: string; tipo: string }> = [];
  for (const n of runtimeNodi) {
    for (const s of n.sorgenti) runtimeEdges.push({ da: s, a: n.id, tipo: 'dipendenza' });
    for (const s of n.salti) runtimeEdges.push({ da: n.id, a: s, tipo: 'salto' });
  }
  const codebase = getCodebaseTopology(projectRoot);
  jsonResponse(res, { nodi: [...runtimeNodi, ...codebase.nodi], edges: [...runtimeEdges, ...codebase.edges], stats: orchestrator?.grafo.stats() ?? {}, project: query.project || 'alessio-os' });
}

// --- Route: PTI trace ---
async function handleTrace(_req: IncomingMessage, res: ServerResponse, query: Record<string, string>): Promise<void> {
  const node = requireParam(query, 'node', res); if (!node) return;
  if (!orchestrator) { jsonResponse(res, { error: 'No orchestrator' }, 503); return; }
  const grafo = orchestrator.grafo;
  const trace = grafo.trace(node), catena = grafo.catena(node), nodoBase = grafo.nodo(node);
  jsonResponse(res, { id: node, tipo: nodoBase?.tipo, valore: nodoBase?.valore, livello: nodoBase?.livello, sorgenti: trace.sorgenti, dipendenti: trace.dipendenti, salti: trace.salti, catena, ultimoCausa: trace.ultimoCausa, accessCount: nodoBase?.accessCount });
}

// --- Route: PTI diff ---
async function handleDiff(_req: IncomingMessage, res: ServerResponse, query: Record<string, string>): Promise<void> {
  if (!orchestrator) { jsonResponse(res, { error: 'No orchestrator' }, 503); return; }
  const snapshots = await getSnapshots('orchestrator', 20);
  let before: NodoSnapshot[], after: NodoSnapshot[];
  if (query.before) {
    const snap = snapshots.find(s => String(s.id) === query.before);
    if (!snap) { jsonResponse(res, { error: 'Snapshot "before" not found' }, 404); return; }
    before = ((snap.snapshot as { nodi?: NodoSnapshot[] })?.nodi ?? []) as NodoSnapshot[];
  } else {
    before = snapshots.length > 0 ? ((snapshots[0].snapshot as { nodi?: NodoSnapshot[] })?.nodi ?? []) as NodoSnapshot[] : [];
  }
  if (query.after) {
    const snap = snapshots.find(s => String(s.id) === query.after);
    if (!snap) { jsonResponse(res, { error: 'Snapshot "after" not found' }, 404); return; }
    after = ((snap.snapshot as { nodi?: NodoSnapshot[] })?.nodi ?? []) as NodoSnapshot[];
  } else {
    after = orchestrator.grafo.stato() as NodoSnapshot[];
  }
  jsonResponse(res, diffStrutturale(before, after));
}

// --- Route: PTIG cached ---
function getPtigCached(query: Record<string, string>): PtigFile {
  const projectRoot = resolveProjectPath(query.project);
  const now = Date.now();
  const cached = ptigCache.get(projectRoot);
  if (cached && (now - cached.ts) < PTIG_CACHE_TTL) return cached.data;
  const ptig = generaPtig(query.project || 'alessio-os', projectRoot);
  ptigCache.set(projectRoot, { data: ptig, ts: now });
  return ptig;
}

// --- Route: assign agent to GitHub issue ---
async function handleAssignAgent(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req);
  const { project, agent_def_id, issue_number, issue_title } = JSON.parse(body);
  if (!project || !agent_def_id || !issue_number) { jsonResponse(res, { error: 'Missing project, agent_def_id, or issue_number' }, 400); return; }
  const repo = await resolveRepo(project);
  if (!repo) { jsonResponse(res, { error: 'No GitHub repo configured for ' + project }, 400); return; }
  const agentDef = await getAgentDefinition(agent_def_id);
  if (!agentDef) { jsonResponse(res, { error: 'Agent definition not found' }, 404); return; }
  const branch = generateBranchName(issue_number, issue_title || `issue-${issue_number}`);
  const projectPath = ghProjectPath(project);
  try {
    if (!branchExists(repo, branch)) createBranch(projectPath, branch);
    else checkoutBranch(projectPath, branch);
  } catch (err) { broadcast('log', { text: `[GitHub] Branch error: ${err}`, cls: 'error' }); }
  const issueBody = getIssueBody(repo, issue_number);
  await surqlQuery(`CREATE agent_issue_assignment SET agent_def_id=$agent_def_id, project=$project, issue_number=$issue_number, issue_title=$issue_title, branch_name=$branch_name, status='working', created_at=time::now()`, { agent_def_id, project, issue_number, issue_title: issue_title || '', branch_name: branch } as Record<string, unknown>);
  const taskDescription = [`Risolvi GitHub issue #${issue_number}: ${issue_title}`, `Branch: ${branch}`, issueBody ? `\nDescrizione issue:\n${issueBody.slice(0, 2000)}` : '', `\nQuando hai finito, committa le modifiche con un messaggio che referenzia l'issue (#${issue_number}).`].join('\n');
  if (orchestrator) { orchestrator.input(taskDescription, project); broadcast('log', { text: `[GitHub] Agent "${agentDef.name}" assigned to #${issue_number} on branch ${branch}`, cls: 'event' }); }
  jsonResponse(res, { ok: true, branch, agent: agentDef.name });
}

// --- Route table: path → { method → handler } ---
// --- Cross-namespace query: social/analytics (outreach data lives there) ---
async function outreachQuery(sql: string): Promise<Record<string, unknown>[]> {
  const auth = Buffer.from(`${process.env.SURREAL_USER ?? 'root'}:${process.env.SURREAL_PASS ?? 'root'}`).toString('base64');
  const r = await fetch('http://127.0.0.1:8000/sql', {
    method: 'POST', body: sql,
    headers: { 'Content-Type': 'text/plain', Accept: 'application/json',
      Authorization: `Basic ${auth}`, 'surreal-ns': 'social', 'surreal-db': 'analytics' },
  });
  const rows = await r.json() as Array<{ result: unknown }>;
  return Array.isArray(rows[0]?.result) ? rows[0].result as Record<string, unknown>[] : [];
}

const ROUTE_TABLE: Record<string, Record<string, RouteHandler>> = {
  '/depth-lab':                   { GET: async (_, res) => {
    try {
      const state = await getFullState();
      const cp = (state as any).chatProjects ?? [];
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(depthLabPage(cp));
    } catch (err) {
      console.error('[depth-lab] ERROR:', err);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(depthLabPage([]));
    }
  } },
  '/events':                     { GET: handleSSE },
  '/api/state':                  { GET: api(async () => getFullState()) },
  '/api/sessions':               { GET: api(async (q) => getSessions(q.project)) },
  '/api/messages':               { GET: api(async (q) => getMessages(q.project, q.session)) },
  '/api/ocr':                    { POST: api(async (_, req) => handleOCR(req)) },
  '/api/transcribe':             { POST: api(async (_, req) => handleTranscribe(req)) },
  '/api/timeline':               { GET: api(async (q) => getTimeline(parseInt(q.page ?? '0', 10))) },
  '/api/search':                 { GET: api(async (q) => searchChats(q.q)) },
  '/api/command':                { POST: api(async (_, req) => handleCommand(req)) },
  '/api/restart':                { POST: async (_, res) => { jsonResponse(res, { ok: true, message: 'Riavvio in corso...' }); broadcast('log', { text: '[server] Riavvio richiesto dalla dashboard', cls: 'event' }); setTimeout(() => process.exit(0), 500); } },
  '/api/mcp-status':             { GET: api(async () => getMcpStatus()) },
  '/api/pti/topology':           { GET: handleTopology },
  '/api/pti/projects':           { GET: async (_, res) => jsonResponse(res, Object.keys(PROJECT_PATHS).map(name => ({ name, path: PROJECT_PATHS[name] }))) },
  '/api/pti/manifesto':          { GET: async (_, res) => jsonResponse(res, { version: PTI_VERSION, manifesto: PTI_MANIFESTO }) },
  '/api/pti/trace':              { GET: handleTrace },
  '/api/pti/delta-log':          { GET: api(async (q) => getDeltaHistory('orchestrator', parseInt(q.limit ?? '50', 10))) },
  '/api/pti/snapshots':          { GET: api(async (q) => { const limit = parseInt(q.limit ?? '10', 10); const snaps = await getSnapshots('orchestrator', limit); return snaps.map(s => ({ id: s.id, label: s.label, created_at: s.created_at })); }) },
  '/api/pti/diff':               { GET: handleDiff },
  '/api/pti/snapshot':           { POST: api(async () => { if (!orchestrator) throw new Error('No orchestrator'); await saveSnapshot(orchestrator.grafo, 'orchestrator'); return { ok: true }; }) },
  '/api/ptig':                   { GET: api(async (q) => getPtigCached(q)) },
  '/api/ptig/nodo':              { GET: api(async (q) => { if (!q.id) throw new Error('Missing id'); const ptig = getPtigCached(q); const nodi = ptig.nodi.filter(n => n.id === q.id || n.id.startsWith(q.id + '.')); const connessioni = ptig.connessioni.filter(c => nodi.some(n => n.id === c.da) || nodi.some(n => n.id === c.a)); return { nodi, connessioni }; }) },
  '/api/ptig/genera':            { POST: api(async (q) => { const root = resolveProjectPath(q.project); const ptig = generaPtig(q.project || 'alessio-os', root); ptigCache.set(root, { data: ptig, ts: Date.now() }); return { ok: true, stats: ptig.metriche }; }) },
  '/api/actions':                { GET: async (req, res, q) => { const project = requireParam(q, 'project', res); if (!project) return; try { jsonResponse(res, await getActionHistory(project, { limit: parseInt(q.limit) || 50, offset: parseInt(q.offset) || 0, type: q.type })); } catch (err) { jsonResponse(res, { error: String(err) }, 500); } } },
  '/api/github/issues':          { GET: async (_, res, q) => { const project = requireParam(q, 'project', res); if (!project) return; try { const repo = await resolveRepo(project); jsonResponse(res, repo ? getIssues(repo, q.state || 'open') : []); } catch (err) { jsonResponse(res, { error: String(err) }, 500); } } },
  '/api/github/prs':             { GET: async (_, res, q) => { const project = requireParam(q, 'project', res); if (!project) return; try { const repo = await resolveRepo(project); jsonResponse(res, repo ? getPRs(repo, q.state || 'open') : []); } catch (err) { jsonResponse(res, { error: String(err) }, 500); } } },
  '/api/github/discussions':     { GET: async (_, res, q) => { const project = requireParam(q, 'project', res); if (!project) return; try { const repo = await resolveRepo(project); jsonResponse(res, repo ? getDiscussions(repo) : []); } catch (err) { jsonResponse(res, { error: String(err) }, 500); } } },
  '/api/github/config':          { GET: async (_, res, q) => { const project = requireParam(q, 'project', res); if (!project) return; try { const config = await getGithubConfig(project); const repo = await resolveRepo(project); jsonResponse(res, config ?? { repo: repo ?? '', default_branch: 'main' }); } catch (err) { jsonResponse(res, { error: String(err) }, 500); } }, POST: api(async (_, req) => { const data = JSON.parse(await readBody(req)); await setGithubConfig(data.project, data.repo, data.default_branch); return { ok: true }; }, 400) },
  '/api/github/assign-agent':    { POST: async (req, res) => { try { await handleAssignAgent(req, res); } catch (err) { jsonResponse(res, { error: String(err) }, 500); } } },
  '/api/github/assignments':     { GET: async (_, res, q) => { const project = requireParam(q, 'project', res); if (!project) return; try { const r = await surqlQuery(`SELECT * FROM agent_issue_assignment WHERE project = $project ORDER BY created_at DESC`, { project }); jsonResponse(res, Array.isArray(r[0]?.result) ? r[0].result : []); } catch (err) { jsonResponse(res, { error: String(err) }, 500); } } },
  '/api/agents/definitions':     { GET: async (_, res, q) => { const project = requireParam(q, 'project', res); if (!project) return; try { jsonResponse(res, await listAgentDefinitions(project)); } catch (err) { jsonResponse(res, { error: String(err) }, 500); } }, POST: api(async (_, req) => { const data = JSON.parse(await readBody(req)); return { agent_def_id: await createAgentDefinition(data) }; }, 400), PUT: async (_, res, q) => { const id = requireParam(q, 'id', res); if (!id) return; try { const data = JSON.parse(await readBody(_)); await updateAgentDefinition(id, data); jsonResponse(res, { ok: true }); } catch (err) { jsonResponse(res, { error: String(err) }, 400); } }, DELETE: async (_, res, q) => { const id = requireParam(q, 'id', res); if (!id) return; try { await deleteAgentDefinition(id); jsonResponse(res, { ok: true }); } catch (err) { jsonResponse(res, { error: String(err) }, 400); } } },
  '/api/paradigms':              { GET: api(async () => listParadigms()) },
  '/api/paradigm':               { GET: async (_, res, q) => { const id = requireParam(q, 'id', res); if (!id) return; try { const p = await getParadigm(id); if (!p) { jsonResponse(res, { error: 'Not found' }, 404); return; } jsonResponse(res, p); } catch (err) { jsonResponse(res, { error: String(err) }, 500); } }, POST: api(async (_, req) => { const data = JSON.parse(await readBody(req)); return { paradigm_id: await createParadigm(data) }; }, 400), DELETE: async (_, res, q) => { const id = requireParam(q, 'id', res); if (!id) return; try { await deleteParadigm(id); jsonResponse(res, { ok: true }); } catch (err) { jsonResponse(res, { error: String(err) }, 400); } } },
  '/api/paradigm/assign':        { POST: api(async (_, req) => { await assignParadigm(JSON.parse(await readBody(req))); return { ok: true }; }, 400) },
  '/api/paradigm/assignment':    { GET: async (_, res, q) => { const type = requireParam(q, 'type', res); if (!type) return; const id = requireParam(q, 'id', res); if (!id) return; try { jsonResponse(res, await getAssignment(type, id) ?? { paradigm_id: null }); } catch (err) { jsonResponse(res, { error: String(err) }, 500); } }, DELETE: async (_, res, q) => { const type = requireParam(q, 'type', res); if (!type) return; const id = requireParam(q, 'id', res); if (!id) return; try { await removeAssignment(type, id); jsonResponse(res, { ok: true }); } catch (err) { jsonResponse(res, { error: String(err) }, 400); } } },

  // --- Outreach (cross-namespace: social/analytics) ---
  // oq() = query helper for social/analytics namespace
  '/api/outreach/pipeline':      { GET: api(async () => {
    const [snaps, replies] = await Promise.all([
      outreachQuery('SELECT * FROM outreach_snapshot ORDER BY date DESC LIMIT 1'),
      outreachQuery('SELECT * FROM outreach_reply ORDER BY received_at DESC'),
    ]);
    const snap = snaps[0] as Record<string, unknown> | undefined;
    const stats = snap ? {
      sent: snap.total_sent ?? 0, delivered: snap.delivered ?? 0,
      replied: snap.human_replies ?? 0, bounced: snap.bounced ?? 0,
      responseRate: snap.response_rate ?? 0, followUpDue: 0,
    } : null;
    const replyList = (replies as Record<string, unknown>[]).map(r => ({
      venue: r.venue_name ?? r.from_domain, type: r.reply_type,
      received_at: r.received_at, preview: (r.subject as string ?? '').slice(0, 120),
      from_domain: r.from_domain,
    }));
    return { stats, replies: replyList, insights: [], byVideo: [], byCountry: [] };
  }) },

  '/api/outreach/actions':       { GET: api(async () => {
    const [due, upcoming] = await Promise.all([
      outreachQuery('RETURN fn::actions_due_today()'),
      outreachQuery('RETURN fn::actions_upcoming()'),
    ]);
    return { due, upcoming };
  }) },

  '/api/outreach/actions/complete': { POST: api(async (_, req) => {
    const { id } = JSON.parse(await readBody(req));
    if (!id) throw new Error('id required');
    await outreachQuery(`UPDATE type::thing("outreach_action", "${id}") SET status = "sent", completed_at = time::now()`);
    return { ok: true };
  }, 400) },

  '/api/outreach/actions/skip': { POST: api(async (_, req) => {
    const { id } = JSON.parse(await readBody(req));
    if (!id) throw new Error('id required');
    await outreachQuery(`UPDATE type::thing("outreach_action", "${id}") SET status = "skipped", completed_at = time::now()`);
    return { ok: true };
  }, 400) },

  '/api/outreach/threads':       { GET: api(async () => {
    const [emails, replies] = await Promise.all([
      outreachQuery('SELECT venue_name, to_address, gmail_thread_id, sent_at, email_type FROM email ORDER BY sent_at DESC'),
      outreachQuery('SELECT venue, reply_type, received_at, gmail_thread_id FROM outreach_reply ORDER BY received_at DESC'),
    ]);
    return { emails, replies };
  }) },

  // --- FIS: Flutur Intelligence System (cross-namespace: social/analytics) ---
  '/api/fis/availability':       { GET: api(async () => {
    const dates = await outreachQuery('SELECT * FROM availability ORDER BY date');
    return { dates };
  }) },

  '/api/fis/briefing':           { GET: api(async () => {
    const [replies, actions, sigma2] = await Promise.all([
      outreachQuery('SELECT * FROM outreach_reply WHERE received_at > time::now() - 7d ORDER BY received_at DESC'),
      outreachQuery('RETURN fn::actions_due_today()'),
      outreachQuery("SELECT content FROM memory_link WHERE sigma = 'σ₂' ORDER BY created_at DESC LIMIT 10"),
    ]);
    return { replies, actions, sigma2 };
  }) },

  '/api/fis/gmail':              { GET: api(async () => {
    const threads = await outreachQuery(`
      SELECT venue_name, from_email, reply_type, received_at, preview
      FROM outreach_reply ORDER BY received_at DESC LIMIT 20
    `);
    return { threads };
  }) },

  '/api/fis/command':            { POST: api(async (_, req) => {
    const { text } = JSON.parse(await readBody(req));
    if (!text) return { error: 'No text provided' };
    try {
      const result = execSync(
        `npx tsx scripts/fis-handle.ts ${JSON.stringify(text)}`,
        { cwd: '/Users/alessioivoycazzaniga/Projects/social-cli-mcp', timeout: 60000, encoding: 'utf-8' },
      );
      return JSON.parse(result);
    } catch (err: any) {
      return { error: err.stderr || err.message || String(err) };
    }
  }) },
};

// --- HTTP dispatcher (cx ≈ 5, was 190) ---
async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url ?? '/';
  const path = urlPath(url);
  const query = parseQuery(url);
  const method = req.method ?? 'GET';

  const methods = ROUTE_TABLE[path];
  if (methods) {
    const handler = methods[method] ?? methods['GET'];
    if (handler) { await handler(req, res, query); return; }
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
    onThinking: (text, agentId) => broadcast('thinking', { text, agentId }),
    onToolUse: (toolName, input, agentId) => broadcast('tool_use', { toolName, input, agentId }),
  });
  // Cleanup stale agents from previous sessions
  surqlQuery("UPDATE agent_state SET status = 'done' WHERE status IN ['working', 'starting']")
    .then(() => console.log('[Dashboard] Stale agents cleaned up'))
    .catch(() => {});
  // No start() needed — PTI è reattivo, niente polling
  console.log('[Dashboard] Orchestrator PTI v4 pronto (reattivo, zero polling)');

  // Action logger → SSE broadcast
  onAction((entry) => broadcast('action:new', entry));

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
