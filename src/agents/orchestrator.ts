/**
 * ALESSIO-OS Orchestratore v4 — PTI Reattivo Puro
 *
 * Refactor v3 → v4:
 * - route è un derivato REALE che ritorna RouteResult (non counter hack)
 * - act:route spezzato in 3 azioni atomiche dichiarate
 * - agent lifecycle modellato come fatti nel grafo (agent.{id}.*)
 * - act:persist e act:broadcast triggerati da fatti agent
 *
 * FATTI (stato osservabile):
 *   input.text, input.project, input.type, input.seq
 *   agents.running (conteggio attivi)
 *   tasks.pending.seq (bump dopo creazione task)
 *   agent.done.last (ultimo agente completato — trigger persist/broadcast)
 *
 * DERIVATI (computati automaticamente):
 *   route := { roles, priority, text, project, seq }
 *   capacity := maxParallel - agents.running
 *
 * AZIONI (side-effect atomiche):
 *   act:save-chat → salva messaggio utente su chat_log
 *   act:create-tasks → crea task in SurrealDB, bumpa tasks.pending.seq
 *   act:save-context → salva contesto sessione
 *   act:dispatch → spawna agent quando ci sono pending e capacity
 *   act:persist → salva risultato agent su DB
 *   act:broadcast → emette SSE response
 *
 * ASSERT (invarianti):
 *   assert:max_parallel → agents.running <= maxParallel
 *
 * Flow:
 *   fatto('input.text', 'fix bug')
 *     → derivato 'route' = { roles: ['coder'], priority: 10, ... }
 *       → act:save-chat (salva su chat_log)
 *       → act:create-tasks (crea task) → fatto('tasks.pending.seq', n+1)
 *       → act:save-context (salva sessione)
 *         → act:dispatch (spawna claude) → fatto('agents.running', 1)
 *           → derivato 'capacity' = 1
 *             → assert:max_parallel OK
 *   ...agent finisce...
 *   fatto('agent.done.last', { agentId, taskId, result, ... })
 *     → act:persist (salva su DB)
 *     → act:broadcast (emette SSE)
 *     → fatto('agents.running', n-1)
 *       → derivato 'capacity' ricalcola
 *         → act:dispatch spawna prossimo
 */

import { GrafoPTI } from '../pti/graph.js';
import {
  surqlQuery,
  createTask,
  assignTask,
  completeTask,
  upsertAgentState,
  saveSessionContext,
  surrealHealthCheck,
} from '../pti/surreal-bridge.js';
import { buildContext, detectProject } from './context-builder.js';
import type { AgentRole } from './context-builder.js';
import { spawn, execSync, ChildProcess } from 'child_process';
import { unlinkSync, existsSync } from 'fs';
import { homedir } from 'os';

// Resolve claude CLI path at startup — avoid hardcoded path ENOENT
const CLAUDE_BIN = (() => {
  const candidates = [
    '/usr/local/bin/claude',
    `${homedir()}/.claude/local/bin/claude`,
    `${homedir()}/Library/Application Support/Claude/claude-code/2.1.20/claude`,
    '/opt/homebrew/bin/claude',
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  // Fallback: ask shell
  try {
    return execSync('which claude', { encoding: 'utf8' }).trim();
  } catch {
    return 'claude'; // last resort — rely on PATH
  }
})();
import { join } from 'path';
import { randomUUID } from 'crypto';
import { logAction } from './action-logger.js';

// ==================== TIPI ====================

export interface OrchestratorConfig {
  project: string;
  sessionId?: string;
  maxParallelAgents?: number;
  onLog?: (text: string, cls: string) => void;
  onResponse?: (text: string, taskId: string) => void;
}

interface RouteResult {
  roles: AgentRole[];
  priority: number;
  text: string;
  project: string;
  seq: number;
}

interface AgentDoneEvent {
  agentId: string;
  taskId: string;
  project: string;
  role: AgentRole;
  result: string;
  seq: number;
}

interface RunningAgent {
  agentId: string;
  taskId: string;
  project: string;
  role: AgentRole;
  process: ChildProcess;
  output: string;
  promptFile: string;
}

// ==================== ROUTING PATTERNS ====================

const ROUTE_PATTERNS: Array<{ test: (s: string) => boolean; roles: AgentRole[]; priority: number }> = [
  { test: s => s.includes('[image]') || s.includes('[screenshot]') || s.includes('screenshot'),
    roles: ['coder', 'reviewer'], priority: 9 },
  { test: s => /\b(fix|fixa|bug|errore|ancora|broken|rotto|non funziona|crash)\b/.test(s),
    roles: ['coder'], priority: 10 },
  { test: s => /\b(audit|controlla|red.?team|verifica sicurezza|security|vulnerability)\b/.test(s),
    roles: ['reviewer', 'tester'], priority: 7 },
  { test: s => /\b(ricerca|cerca online|research|brainstorm|analizza|esplora|paper)\b/.test(s),
    roles: ['researcher'], priority: 6 },
  { test: s => /\b(parallelo|paralleli|tutti|fixa tutto|fai tutto)\b/.test(s),
    roles: ['coder', 'coder', 'reviewer'], priority: 8 },
  { test: s => /\b(deploy|push|commit|release|pubblica)\b/.test(s),
    roles: ['coder'], priority: 9 },
  { test: s => /\b(piano|pianifica|progetta|architettura|design)\b/.test(s),
    roles: ['researcher'], priority: 7 },
  { test: s => /\b(test|testa|coverage|spec)\b/.test(s),
    roles: ['tester'], priority: 7 },
];

function computeRoute(text: string): { roles: AgentRole[]; priority: number } {
  const lower = text.toLowerCase();
  for (const p of ROUTE_PATTERNS) {
    if (p.test(lower)) return { roles: p.roles, priority: p.priority };
  }
  return { roles: ['coder'], priority: 5 };
}

function detectRole(text: string): AgentRole {
  const t = text.toLowerCase();
  if (t.includes('audit') || t.includes('controlla') || t.includes('red team')) return 'reviewer';
  if (t.includes('test') || t.includes('verifica') || t.includes('coverage')) return 'tester';
  if (t.includes('ricerca') || t.includes('research') || t.includes('brainstorm')) return 'researcher';
  return 'coder';
}

function resolveProjectCwd(project: string): string {
  const home = homedir();
  const paths: Record<string, string> = {
    'alessio-os': join(home, 'alessio-os'),
    'trovatore': join(home, 'trovatore'),
    'social-cli-mcp': join(home, 'social-cli-mcp'),
    'ui-canvas-mcp': join(home, 'ui-canvas-mcp'),
    'gestionale-nautica-main': join(home, 'gestionale-nautica-main'),
    'ricchexxa-main': join(home, 'ricchexxa-main'),
    'dag-consulting-2-0': join(home, 'Documents/Web/Dag Consulting 2.0'),
    'nico': join(home, 'nico'),
    'looperpedal': join(home, 'looperpedal'),
    'abletonscripts': join(home, 'abletonscripts'),
    'innesti-revamp-draft': join(home, 'innesti-revamp-draft'),
    'phonon-ui': join(home, 'phonon-ui'),
    'xyl-excel': join(home, 'xyl-excel'),
  };
  return paths[project] ?? join(home, project);
}

// ==================== ORCHESTRATORE PTI v4 ====================

export class Orchestrator {
  readonly grafo: GrafoPTI;
  private sessionId: string;
  private project: string;
  private maxParallel: number;
  private running: Map<string, RunningAgent> = new Map();
  private dispatching = false;
  private agentDoneSeq = 0;
  private log: (text: string, cls: string) => void;
  private onResponse: (text: string, taskId: string) => void;

  constructor(config: OrchestratorConfig) {
    this.sessionId = config.sessionId ?? randomUUID();
    this.project = config.project;
    this.maxParallel = config.maxParallelAgents ?? 2;
    this.log = config.onLog ?? ((t, c) => console.log(`[orch:${c}] ${t}`));
    this.onResponse = config.onResponse ?? (() => {});

    this.grafo = new GrafoPTI({
      onViolation: (v) => {
        this.log(`[ASSERT] ${v.messaggio}`, 'error');
      },
    });

    this.costruisciGrafo();
  }

  // ==================== COSTRUZIONE GRAFO ====================

  private costruisciGrafo(): void {
    // === FATTI ===
    this.grafo.fatto('input.text', '');
    this.grafo.fatto('input.project', this.project);
    this.grafo.fatto('input.type', 'text');
    this.grafo.fatto('input.seq', 0);
    this.grafo.fatto('agents.running', 0);
    this.grafo.fatto('tasks.pending.seq', 0);
    this.grafo.fatto('session.id', this.sessionId);
    this.grafo.fatto('error.last', null);
    this.grafo.fatto('error.count', 0);
    this.grafo.fatto('agent.done.last', null);

    // === DERIVATI ===

    // route := RouteResult reale (non counter hack)
    // Include seq per garantire unicità anche con testo identico
    this.grafo.derivato(
      'route',
      ['input.text', 'input.seq', 'input.project'],
      (s) => {
        const text = s.get('input.text') as string;
        const seq = s.get('input.seq') as number;
        const project = s.get('input.project') as string;
        if (!text || seq === 0) return null;
        const { roles, priority } = computeRoute(text);
        return { roles, priority, text, project, seq } as RouteResult;
      },
    );

    // capacity := maxParallel - agents.running
    this.grafo.derivato(
      'capacity',
      ['agents.running'],
      (s) => this.maxParallel - (s.get('agents.running') as number ?? 0),
    );

    // === AZIONI ATOMICHE (ex-monolite act:route) ===

    // act:save-chat — salva messaggio utente su chat_log
    this.grafo.azione(
      'act:save-chat',
      ['route'],
      async (s) => {
        const route = s.get('route') as RouteResult | null;
        if (!route) return;
        try {
          await surqlQuery(`
            CREATE chat_log SET
              session_id = 'dashboard-live',
              role = 'user',
              content = $content,
              project = $project,
              created_at = time::now()
          `, { content: route.text, project: route.project });
        } catch (err) {
          this.propagaErrore('act:save-chat', err);
        }
      },
    );

    // act:create-tasks — crea task in SurrealDB, poi bumpa tasks.pending.seq
    this.grafo.azione(
      'act:create-tasks',
      ['route'],
      async (s) => {
        const route = s.get('route') as RouteResult | null;
        if (!route) return;
        try {
          this.log(`[route] ${route.roles.join(', ')} — priority ${route.priority}`, 'event');
          for (let i = 0; i < route.roles.length; i++) {
            const role = route.roles[i];
            const taskDesc = route.roles.length > 1
              ? `[${role}] ${route.text}`
              : route.text;
            await createTask({
              task: taskDesc,
              project: route.project,
              priority: route.priority - i,
            });
            logAction({
              project: route.project,
              action_type: 'task_created',
              title: `Task creato: ${role}`,
              details: taskDesc.slice(0, 200),
            }).catch(() => {});
          }
          // Bump → triggera act:dispatch
          this.grafo.fatto(
            'tasks.pending.seq',
            (this.grafo.leggi('tasks.pending.seq') as number) + 1,
          );
        } catch (err) {
          this.propagaErrore('act:create-tasks', err);
        }
      },
    );

    // act:save-context — salva contesto sessione
    this.grafo.azione(
      'act:save-context',
      ['route'],
      async (s) => {
        const route = s.get('route') as RouteResult | null;
        if (!route) return;
        try {
          await saveSessionContext({
            session_id: this.sessionId,
            project: route.project,
            decisions: [`Routed: ${route.roles.join(', ')} — priority ${route.priority}`],
            agent_roles: route.roles,
          });
        } catch (err) {
          this.propagaErrore('act:save-context', err);
        }
      },
    );

    // act:dispatch — spawna agent quando ci sono pending + capacity
    // Dipende da tasks.pending.seq (nuovi task) e capacity (slot liberi)
    this.grafo.azione(
      'act:dispatch',
      ['capacity', 'tasks.pending.seq'],
      async (s) => {
        const capacity = s.get('capacity') as number;
        if (capacity <= 0) return;
        if (this.dispatching) return;

        const slots = Math.min(capacity, this.maxParallel - this.running.size);
        if (slots <= 0) return;

        this.dispatching = true;
        try {
          const selRes = await surqlQuery(`
            SELECT * FROM task_queue
            WHERE status = 'pending'
            ORDER BY priority DESC
            LIMIT $limit
          `, { limit: slots });
          const pending = (selRes[0]?.result as Array<{ id: string; task: string; project: string }>) ?? [];
          if (pending.length === 0) return;

          const ids = pending.map(t => t.id);
          await surqlQuery(`
            UPDATE task_queue SET status = 'claimed'
            WHERE id INSIDE $ids AND status = 'pending'
          `, { ids });

          const spawns = pending.map(task => {
            const role = detectRole(task.task);
            return this.spawnAgent(task.id, task.task, task.project, role);
          });
          await Promise.all(spawns);
        } catch (err) {
          this.propagaErrore('act:dispatch', err);
        } finally {
          this.dispatching = false;
        }
      },
    );

    // act:persist — salva risultato agent su DB quando agent finisce
    this.grafo.azione(
      'act:persist',
      ['agent.done.last'],
      async (s) => {
        const evt = s.get('agent.done.last') as AgentDoneEvent | null;
        if (!evt) return;
        try {
          await completeTask(evt.taskId, evt.result);
          await upsertAgentState(evt.agentId, {
            session_id: 'dashboard-live',
            project: evt.project,
            role: evt.role,
            status: 'done',
            current_task: evt.result ? evt.result.slice(0, 500) : '',
            findings: evt.result ? [evt.result.slice(0, 500)] : [],
          });
          if (evt.result) {
            await surqlQuery(`
              CREATE chat_log SET
                session_id = 'dashboard-live',
                role = 'assistant',
                content = $content,
                project = $project,
                created_at = time::now()
            `, { content: evt.result, project: evt.project });
          }
        } catch (err) {
          this.propagaErrore('act:persist', err);
        }
      },
    );

    // act:broadcast — emette SSE response quando agent finisce
    this.grafo.azione(
      'act:broadcast',
      ['agent.done.last'],
      async (s) => {
        const evt = s.get('agent.done.last') as AgentDoneEvent | null;
        if (!evt || !evt.result) return;
        this.onResponse(evt.result, evt.taskId);
      },
    );

    // === ASSERT ===

    this.grafo.assert(
      'assert:max_parallel',
      ['agents.running'],
      (s) => (s.get('agents.running') as number) <= this.maxParallel,
      `Max ${this.maxParallel} agenti paralleli superato`,
    );
  }

  // ==================== HELPER ====================

  private propagaErrore(source: string, err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    this.log(`[${source}] ERROR: ${msg}`, 'error');
    this.grafo.fatto('error.last', { source, msg, ts: Date.now() });
    this.grafo.fatto('error.count', (this.grafo.leggi('error.count') as number) + 1);
  }

  // ==================== INPUT ====================

  input(text: string, project?: string): void {
    const proj = project ?? this.project;
    this.grafo.fatto('input.project', proj);
    this.grafo.fatto('input.text', text);
    this.grafo.fatto('input.seq', (this.grafo.leggi('input.seq') as number) + 1);
  }

  route(text: string): { roles: AgentRole[]; priority: number } {
    return computeRoute(text);
  }

  // ==================== SPAWN AGENT (lifecycle nel grafo) ====================

  private async spawnAgent(taskId: string, task: string, project: string, role: AgentRole): Promise<void> {
    const agentId = `agent-${randomUUID().slice(0, 8)}`;

    // Registra agent nel grafo come fatti
    this.grafo.fatto(`agent.${agentId}.status`, 'starting');
    this.grafo.fatto(`agent.${agentId}.role`, role);
    this.grafo.fatto(`agent.${agentId}.task`, taskId);

    // DB state
    await assignTask(taskId, agentId);
    await upsertAgentState(agentId, {
      session_id: 'dashboard-live',
      project,
      role,
      status: 'working',
      current_task: task,
    });

    this.log(`[${agentId}] ${role} → "${task.slice(0, 80)}"`, 'agent-name');

    // agents.running++ nel grafo
    this.grafo.fatto('agents.running', this.running.size + 1);
    this.grafo.fatto(`agent.${agentId}.status`, 'working');

    // Build enriched context
    let systemPrompt = '';
    let promptFile = '';
    try {
      const ctx = await buildContext({ project, role, task });
      systemPrompt = ctx.systemPrompt;
      promptFile = ctx.promptFile;
      this.log(`[${agentId}] Context: ${ctx.sections.projectMemory} chat, ${ctx.sections.experiences} exp, ${ctx.sections.knowledge} kb`, 'dim');
    } catch (err) {
      this.log(`[${agentId}] Context build failed: ${err} — proceeding without`, 'error');
    }

    // Spawn claude process — MCP isolato: agenti non ereditano MCP globali
    // Evita confusione code-catalog/phonon-kb vs SurrealDB
    const cwd = resolveProjectCwd(project);
    const args: string[] = [
      '--mcp-config', '{"mcpServers":{}}', // nessun MCP server
      '--strict-mcp-config',      // ignora config globale
      '--allowedTools', 'Read,Write,Edit,Bash,Glob,Grep,WebSearch,WebFetch',  // abilita tool essenziali + ricerca web
    ];
    if (systemPrompt) {
      args.push('--system-prompt', systemPrompt);
    }
    args.push('-p', task);

    this.log(`[spawn] ${CLAUDE_BIN}`, 'dim');
    logAction({
      project, agent_id: agentId,
      action_type: 'agent_spawned',
      title: `Agent ${role} spawned`,
      details: task.slice(0, 200),
    }).catch(() => {});
    const child = spawn(CLAUDE_BIN, args, {
      cwd,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const agent: RunningAgent = {
      agentId, taskId, project, role,
      process: child,
      output: '',
      promptFile,
    };
    this.running.set(agentId, agent);

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      agent.output += text;
      // cls 'stream' → UI lo mostra in log area, non come risposta chat
      this.log(text, 'stream');
    });

    child.stderr.on('data', (chunk: Buffer) => {
      this.log(chunk.toString(), 'error');
    });

    child.on('error', (err) => {
      this.log(`[${agentId}] spawn error: ${err.message}`, 'error');
      this.running.delete(agentId);
      this.grafo.fatto(`agent.${agentId}.status`, 'error');
      this.grafo.fatto('agents.running', this.running.size);
      this.propagaErrore(`agent:${agentId}`, err);
      completeTask(taskId, `ERROR: ${err.message}`).catch(() => {});
      if (agent.promptFile) {
        try { unlinkSync(agent.promptFile); } catch { /* ok */ }
      }
    });

    // On close → fatto agent.done.last → triggera act:persist + act:broadcast
    child.on('close', async (code) => {
      this.log(`[${agentId}] exit: ${code}`, 'event');
      this.running.delete(agentId);

      const result = agent.output.trim();

      // Aggiorna stato agent nel grafo
      this.grafo.fatto(`agent.${agentId}.status`, 'done');

      // Cleanup prompt file
      if (agent.promptFile) {
        try { unlinkSync(agent.promptFile); } catch { /* ok */ }
      }

      // Emetti evento completamento → act:persist + act:broadcast
      this.agentDoneSeq++;
      const doneEvent: AgentDoneEvent = {
        agentId, taskId, project, role, result,
        seq: this.agentDoneSeq,
      };
      this.grafo.fatto('agent.done.last', doneEvent);

      logAction({
        project, agent_id: agentId,
        action_type: 'agent_completed',
        title: `Agent ${role} completed (exit ${code})`,
        details: result.slice(0, 200),
      }).catch(() => {});

      // agents.running-- → capacity ricalcola → act:dispatch può ripartire
      this.grafo.fatto('agents.running', this.running.size);
    });
  }

  // ==================== PUBLIC API ====================

  get activeCount(): number {
    return this.running.size;
  }

  get activeAgents(): Array<{ agentId: string; taskId: string; project: string; role: string }> {
    return [...this.running.values()].map(a => ({
      agentId: a.agentId,
      taskId: a.taskId,
      project: a.project,
      role: a.role,
    }));
  }

  stato(): {
    session: string;
    project: string;
    grafo: ReturnType<GrafoPTI['stato']>;
    stats: ReturnType<GrafoPTI['stats']>;
    active: number;
    agents: Array<{ agentId: string; taskId: string; project: string; role: string }>;
  } {
    return {
      session: this.sessionId,
      project: this.project,
      grafo: this.grafo.stato(),
      stats: this.grafo.stats(),
      active: this.running.size,
      agents: this.activeAgents,
    };
  }

  async health(): Promise<{ surreal: boolean; agents: number; pti: ReturnType<GrafoPTI['stats']>; violations: number }> {
    const surrealOk = await surrealHealthCheck();
    return {
      surreal: surrealOk,
      agents: this.running.size,
      pti: this.grafo.stats(),
      violations: this.grafo.getViolations().length,
    };
  }
}
