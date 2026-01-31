/**
 * ALESSIO-OS Orchestratore — PTI Multi-Agent
 *
 * In PTI:
 *   input.* → [router]
 *   router := analizza(input, ctx, experience) → [agent.spawn]
 *   agent.*.findings → [shared_memory, dashboard, dependent_agents]
 *   agent.*.status → [task_queue, orchestrator]
 *
 * v0.2: Integrato con AgentWorker per spawn reale via claude CLI
 */

import { GrafoPTI } from '../pti/graph.js';
import {
  surqlQuery,
  upsertAgentState,
  createTask,
  assignTask,
  completeTask,
  getReadyTasks,
  getIdleAgents,
  saveSessionContext,
  getSessionState,
  surrealHealthCheck,
} from '../pti/surreal-bridge.js';
import { AgentWorker } from './worker.js';
import type { AgentRole } from './context-builder.js';
import { randomUUID } from 'crypto';

// ==================== TIPI ====================

export interface AgentConfig {
  id: string;
  role: AgentRole;
  prompt: string;
  tools?: string[];
  maxTurns?: number;
}

export interface TaskInput {
  type: 'text' | 'voice' | 'image' | 'file';
  content: string;
  project: string;
  metadata?: Record<string, unknown>;
}

export interface OrchestratorConfig {
  project: string;
  sessionId?: string;
  maxParallelAgents?: number;
  onLog?: (text: string, cls: string) => void;
  onResponse?: (text: string, taskId: string) => void;
}

// ==================== ROUTING PATTERNS ====================
// Derivati dall'analisi di 7000+ messaggi

interface RouteMatch {
  roles: AgentRole[];
  priority: number;
}

const ROUTE_PATTERNS: Array<{ test: (s: string) => boolean; match: RouteMatch }> = [
  // Screenshot/image → coder + reviewer (alta priorità)
  {
    test: s => s.includes('[image]') || s.includes('[screenshot]') || s.includes('screenshot'),
    match: { roles: ['coder', 'reviewer'], priority: 9 },
  },
  // Fix urgente → solo coder, max priorità
  {
    test: s => /\b(fix|fixa|bug|errore|ancora|broken|rotto|non funziona|crash)\b/.test(s),
    match: { roles: ['coder'], priority: 10 },
  },
  // Audit/review → reviewer + tester
  {
    test: s => /\b(audit|controlla|red.?team|verifica sicurezza|security|vulnerability)\b/.test(s),
    match: { roles: ['reviewer', 'tester'], priority: 7 },
  },
  // Ricerca → researcher
  {
    test: s => /\b(ricerca|cerca online|research|brainstorm|analizza|esplora|paper)\b/.test(s),
    match: { roles: ['researcher'], priority: 6 },
  },
  // Parallelo esplicito → coder × 2 + reviewer
  {
    test: s => /\b(parallelo|paralleli|tutti|fixa tutto|fai tutto)\b/.test(s),
    match: { roles: ['coder', 'coder', 'reviewer'], priority: 8 },
  },
  // Deploy/git → coder con contesto git
  {
    test: s => /\b(deploy|push|commit|release|pubblica)\b/.test(s),
    match: { roles: ['coder'], priority: 9 },
  },
  // Piano/progetta → researcher poi coder (sequenziale)
  {
    test: s => /\b(piano|pianifica|progetta|architettura|design)\b/.test(s),
    match: { roles: ['researcher'], priority: 7 },
  },
  // Test → tester
  {
    test: s => /\b(test|testa|coverage|spec)\b/.test(s),
    match: { roles: ['tester'], priority: 7 },
  },
];

// ==================== ORCHESTRATORE ====================

export class Orchestrator {
  private grafo: GrafoPTI;
  private sessionId: string;
  private project: string;
  private maxParallel: number;
  private worker: AgentWorker;

  constructor(config: OrchestratorConfig) {
    this.grafo = new GrafoPTI();
    this.sessionId = config.sessionId ?? randomUUID();
    this.project = config.project;
    this.maxParallel = config.maxParallelAgents ?? 2;

    // Create worker with callbacks
    this.worker = new AgentWorker({
      maxParallel: this.maxParallel,
      defaultProject: this.project,
      onLog: config.onLog,
      onResponse: config.onResponse,
    });

    this.initGrafo();
  }

  /** Start the worker polling loop */
  start(): void {
    this.worker.start();
  }

  /** Stop the worker */
  stop(): void {
    this.worker.stop();
  }

  /** Get the worker instance (for direct dispatch from dashboard) */
  getWorker(): AgentWorker {
    return this.worker;
  }

  // --- Inizializza grafo PTI ---
  private initGrafo(): void {
    this.grafo.fatto('session.id', this.sessionId);
    this.grafo.fatto('session.project', this.project);
    this.grafo.fatto('agents.count', 0);
    this.grafo.fatto('tasks.pending', 0);
    this.grafo.fatto('tasks.running', 0);
    this.grafo.fatto('tasks.done', 0);

    this.grafo.derivato(
      'agents.capacity',
      ['agents.count'],
      (s) => this.maxParallel - (s.get('agents.count') as number ?? 0),
    );

    this.grafo.derivato(
      'can.accept',
      ['agents.capacity', 'tasks.pending'],
      (s) => (s.get('agents.capacity') as number) > 0 && (s.get('tasks.pending') as number) > 0,
    );

    this.grafo.salto('agents.count', ['can.accept']);
    this.grafo.salto('tasks.pending', ['can.accept']);
  }

  // --- Route input through pattern matching ---
  route(content: string): RouteMatch {
    const lower = content.toLowerCase();
    for (const pattern of ROUTE_PATTERNS) {
      if (pattern.test(lower)) return pattern.match;
    }
    // Default: single coder
    return { roles: ['coder'], priority: 5 };
  }

  // --- Ricevi input (testo, voce, immagine) ---
  async handleInput(input: TaskInput): Promise<string[]> {
    const ctx = await this.loadContext();
    const experiences = await this.findSimilarExperiences(input.content);

    // Route to determine agents
    const routeMatch = this.route(input.content);
    const tasks = routeMatch.roles.map((role, i) => ({
      description: routeMatch.roles.length > 1
        ? `[${role}] ${input.content}`
        : input.content,
      role,
      priority: routeMatch.priority - i, // first agent gets highest priority
    }));

    // Create tasks in SurrealDB
    const taskIds: string[] = [];
    for (const task of tasks) {
      const taskId = await createTask({
        task: task.description,
        project: input.project || this.project,
        priority: task.priority,
      });
      taskIds.push(taskId);
      this.grafo.fatto('tasks.pending', (this.grafo.leggi('tasks.pending') as number) + 1);
    }

    // Save session context
    await saveSessionContext({
      session_id: this.sessionId,
      project: input.project || this.project,
      decisions: [`Routed: ${routeMatch.roles.join(', ')} — priority ${routeMatch.priority}`],
      agent_roles: routeMatch.roles,
    });

    return taskIds;
  }

  // --- Agent completa il lavoro ---
  async agentDone(agentId: string, taskId: string, result: string, findings: unknown[]): Promise<void> {
    await completeTask(taskId, result, { findings });

    this.grafo.fatto('tasks.running', Math.max(0, (this.grafo.leggi('tasks.running') as number) - 1));
    this.grafo.fatto('tasks.done', (this.grafo.leggi('tasks.done') as number) + 1);

    this.grafo.fatto(`findings.${agentId}`, findings);
    this.grafo.salto(`findings.${agentId}`, ['shared_memory', 'dashboard']);
  }

  // --- Carica contesto da SurrealDB ---
  private async loadContext(): Promise<unknown> {
    return getSessionState(this.sessionId);
  }

  // --- Cerca esperienze simili ---
  private async findSimilarExperiences(query: string): Promise<unknown[]> {
    try {
      const res = await surqlQuery(`
        SELECT problem_type, problem_description, outcome, solution_steps
        FROM experience
        WHERE outcome = 'success'
        AND problem_description CONTAINS $query
        ORDER BY reuse_count DESC
        LIMIT 5
      `, { query: query.slice(0, 100) });
      return res[0]?.result as unknown[] ?? [];
    } catch {
      return [];
    }
  }

  // --- Stato completo (per dashboard) ---
  stato(): {
    session: string;
    project: string;
    grafo: ReturnType<GrafoPTI['stato']>;
    workerActive: number;
    workerAgents: Array<{ agentId: string; taskId: string; project: string; role: string }>;
  } {
    return {
      session: this.sessionId,
      project: this.project,
      grafo: this.grafo.stato(),
      workerActive: this.worker.activeCount,
      workerAgents: this.worker.activeAgents,
    };
  }

  // --- Health ---
  async health(): Promise<{ surreal: boolean; agents: number; tasks: unknown }> {
    const surrealOk = await surrealHealthCheck();
    return {
      surreal: surrealOk,
      agents: this.worker.activeCount,
      tasks: {
        pending: this.grafo.leggi('tasks.pending'),
        running: this.grafo.leggi('tasks.running'),
        done: this.grafo.leggi('tasks.done'),
      },
    };
  }
}
