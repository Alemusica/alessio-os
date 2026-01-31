/**
 * ALESSIO-OS Orchestratore v3 — PTI Reattivo Puro
 *
 * Il grafo PTI È il control flow. Niente polling. Niente imperativi.
 *
 * FATTI (stato osservabile):
 *   input.text, input.project, input.type
 *   agents.running (conteggio attivi)
 *   queue.version (bump ad ogni cambio coda)
 *
 * DERIVATI (computati automaticamente):
 *   route := analyze(input.text) → { roles, priority }
 *   capacity := maxParallel - agents.running
 *   can.dispatch := capacity > 0
 *
 * AZIONI (side-effect, fire-and-forget):
 *   act:route → crea task in SurrealDB quando route cambia
 *   act:dispatch → spawna agent quando can.dispatch è true e ci sono pending
 *   act:persist → salva risultato su chat_log e SurrealDB
 *   act:broadcast → emette SSE response event
 *
 * ASSERT (invarianti):
 *   assert:max_parallel → agents.running <= maxParallel
 *
 * Flow:
 *   fatto('input.text', 'fix bug')
 *     → derivato 'route' ricalcola { roles: ['coder'], priority: 10 }
 *       → azione 'act:route' crea task in SurrealDB
 *         → fatto('queue.version', n+1)
 *           → derivato 'can.dispatch' = true
 *             → azione 'act:dispatch' spawna claude
 *               → fatto('agents.running', 1)
 *                 → derivato 'capacity' = 1
 *                   → assert:max_parallel OK
 *   ...claude finisce...
 *   fatto('agent.{id}.done', result)
 *     → azione 'act:persist' salva su DB
 *     → azione 'act:broadcast' emette SSE
 *     → fatto('agents.running', 0)
 *       → derivato 'capacity' = 2
 */

import { GrafoPTI } from '../pti/graph.js';
import type { DeltaValore } from '../pti/graph.js';
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
import { spawn, ChildProcess } from 'child_process';
import { unlinkSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

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
// Derivati dall'analisi di 7000+ messaggi

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

// ==================== ORCHESTRATORE PTI ====================

export class Orchestrator {
  readonly grafo: GrafoPTI;
  private sessionId: string;
  private project: string;
  private maxParallel: number;
  private running: Map<string, RunningAgent> = new Map();
  private log: (text: string, cls: string) => void;
  private onResponse: (text: string, taskId: string) => void;

  constructor(config: OrchestratorConfig) {
    this.sessionId = config.sessionId ?? randomUUID();
    this.project = config.project;
    this.maxParallel = config.maxParallelAgents ?? 2;
    this.log = config.onLog ?? ((t, c) => console.log(`[orch:${c}] ${t}`));
    this.onResponse = config.onResponse ?? (() => {});

    // Crea grafo con handler violazioni
    this.grafo = new GrafoPTI({
      onViolation: (v) => {
        this.log(`[ASSERT] ${v.messaggio}`, 'error');
      },
    });

    this.costruisciGrafo();
  }

  // ==================== COSTRUZIONE GRAFO ====================

  private costruisciGrafo(): void {
    // === FATTI (stato osservabile) ===
    this.grafo.fatto('input.text', '');
    this.grafo.fatto('input.project', this.project);
    this.grafo.fatto('input.type', 'text');
    this.grafo.fatto('input.seq', 0);        // sequenza input (per triggerare ricalcolo)
    this.grafo.fatto('agents.running', 0);
    this.grafo.fatto('queue.version', 0);
    this.grafo.fatto('session.id', this.sessionId);

    // === DERIVATI (computati automaticamente) ===

    // route := analyze(input.text) → { roles, priority }
    this.grafo.derivato(
      'route',
      ['input.text', 'input.seq'],
      (s) => {
        const text = s.get('input.text') as string;
        if (!text) return null;
        const route = computeRoute(text);
        return JSON.stringify({ ...route, text, project: s.get('input.project') ?? this.project });
      },
    );

    // capacity := maxParallel - agents.running
    this.grafo.derivato(
      'capacity',
      ['agents.running'],
      (s) => this.maxParallel - (s.get('agents.running') as number ?? 0),
    );

    // === AZIONI (side-effect, fire-and-forget) ===

    // act:route — quando route cambia, crea task in SurrealDB
    this.grafo.azione(
      'act:route',
      ['route'],
      async (s) => {
        const routeJson = s.get('route') as string | null;
        if (!routeJson) return;
        let route: RouteResult;
        try { route = JSON.parse(routeJson); } catch { return; }
        if (!route.text) return;

        this.log(`[route] ${route.roles.join(', ')} — priority ${route.priority}`, 'event');

        // Salva messaggio utente
        await surqlQuery(`
          CREATE chat_log SET
            session_id = 'dashboard-live',
            role = 'user',
            content = $content,
            project = $project,
            created_at = time::now()
        `, { content: route.text, project: route.project });

        // Crea task per ogni role
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
        }

        // Salva contesto sessione
        await saveSessionContext({
          session_id: this.sessionId,
          project: route.project,
          decisions: [`Routed: ${route.roles.join(', ')} — priority ${route.priority}`],
          agent_roles: route.roles,
        });

        // Bump queue version → triggera can.dispatch
        this.grafo.fatto('queue.version', (this.grafo.leggi('queue.version') as number) + 1);
      },
    );

    // act:dispatch — quando queue.version o capacity cambiano, spawna se possibile
    // Dipende da capacity + queue.version direttamente (non da un derivato booleano
    // che non cambierebbe valore e non propagherebbe)
    this.grafo.azione(
      'act:dispatch',
      ['capacity', 'queue.version'],
      async (s) => {
        const capacity = s.get('capacity') as number;
        if (capacity <= 0) return;
        if (this.running.size >= this.maxParallel) return;

        // Cerca prossimo task pending
        const res = await surqlQuery(`
          SELECT * FROM task_queue
          WHERE status = 'pending'
          ORDER BY priority DESC
          LIMIT 1
        `);
        const tasks = res[0]?.result as Array<{ id: string; task: string; project: string }>;
        if (!tasks || tasks.length === 0) return;

        const task = tasks[0];
        const role = detectRole(task.task);
        await this.spawnAgent(task.id, task.task, task.project, role);
      },
    );

    // === ASSERT (invarianti) ===

    this.grafo.assert(
      'assert:max_parallel',
      ['agents.running'],
      (s) => (s.get('agents.running') as number) <= this.maxParallel,
      `Max ${this.maxParallel} agenti paralleli superato`,
    );
  }

  // ==================== INPUT (unico entry point) ====================

  /**
   * Ricevi input — setta fatti, il grafo fa tutto il resto.
   * Questo è l'unico metodo che il dashboard deve chiamare.
   */
  input(text: string, project?: string): void {
    const proj = project ?? this.project;
    this.grafo.fatto('input.project', proj);
    this.grafo.fatto('input.text', text);
    // Bump seq per garantire ri-propagazione anche se testo identico
    this.grafo.fatto('input.seq', (this.grafo.leggi('input.seq') as number) + 1);
  }

  /**
   * Route senza side effects (per la dashboard che vuole mostrare la route)
   */
  route(text: string): { roles: AgentRole[]; priority: number } {
    return computeRoute(text);
  }

  // ==================== SPAWN AGENT ====================

  private async spawnAgent(taskId: string, task: string, project: string, role: AgentRole): Promise<void> {
    const agentId = `agent-${randomUUID().slice(0, 8)}`;

    // Mark task running in DB
    await assignTask(taskId, agentId);
    await upsertAgentState(agentId, {
      session_id: 'dashboard-live',
      project,
      role,
      status: 'working',
      current_task: task,
    });

    this.log(`[${agentId}] ${role} → "${task.slice(0, 80)}"`, 'agent-name');

    // Aggiorna fatto: agents.running++
    this.grafo.fatto('agents.running', this.running.size + 1);

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

    // Spawn claude
    const cwd = resolveProjectCwd(project);
    const args: string[] = [];
    if (systemPrompt) {
      args.push('--system-prompt', systemPrompt);
    }
    args.push('-p', task);

    const child = spawn('/usr/local/bin/claude', args, {
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

    // Stream stdout → SSE
    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      agent.output += text;
      this.log(text, '');
    });

    child.stderr.on('data', (chunk: Buffer) => {
      this.log(chunk.toString(), 'error');
    });

    // Handle spawn errors
    child.on('error', (err) => {
      this.log(`[${agentId}] spawn error: ${err.message}`, 'error');
      this.running.delete(agentId);
      this.grafo.fatto('agents.running', this.running.size);
      completeTask(taskId, `ERROR: ${err.message}`).catch(() => {});
      if (agent.promptFile) {
        try { unlinkSync(agent.promptFile); } catch { /* ok */ }
      }
    });

    // On close → fatto('agent.{id}.done') → azioni di persist e broadcast
    child.on('close', async (code) => {
      this.log(`[${agentId}] exit: ${code}`, 'event');
      this.running.delete(agentId);

      const result = agent.output.trim();

      // Persist result
      try { await completeTask(taskId, result); } catch { /* ok */ }
      try {
        await upsertAgentState(agentId, {
          session_id: 'dashboard-live',
          project,
          role,
          status: 'done',
          current_task: task,
          findings: result ? [result.slice(0, 500)] : [],
        });
      } catch { /* ok */ }

      // Save assistant response
      if (result) {
        try {
          await surqlQuery(`
            CREATE chat_log SET
              session_id = 'dashboard-live',
              role = 'assistant',
              content = $content,
              project = $project,
              created_at = time::now()
          `, { content: result, project });
        } catch { /* ok */ }

        // Broadcast response
        this.onResponse(result, taskId);
      }

      // Cleanup prompt file
      if (agent.promptFile) {
        try { unlinkSync(agent.promptFile); } catch { /* ok */ }
      }

      // === KEY PTI: agents.running-- triggera il grafo ===
      // capacity ricalcola → can.dispatch potrebbe diventare true
      // → act:dispatch spawna prossimo agent dalla coda
      this.grafo.fatto('agents.running', this.running.size);
    });
  }

  // ==================== PUBLIC API ====================

  /** Conteggio agenti attivi */
  get activeCount(): number {
    return this.running.size;
  }

  /** Info agenti attivi */
  get activeAgents(): Array<{ agentId: string; taskId: string; project: string; role: string }> {
    return [...this.running.values()].map(a => ({
      agentId: a.agentId,
      taskId: a.taskId,
      project: a.project,
      role: a.role,
    }));
  }

  /** Stato completo (per dashboard) */
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

  /** Health */
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
