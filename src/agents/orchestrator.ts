/**
 * ALESSIO-OS Orchestratore — PTI Multi-Agent
 *
 * In PTI:
 *   input.* → [router]
 *   router := analizza(input, ctx, experience) → [agent.spawn]
 *   agent.*.findings → [shared_memory, dashboard, dependent_agents]
 *   agent.*.status → [task_queue, orchestrator]
 *
 * Auth: Claude Max sessionKey (Agent SDK)
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
import { randomUUID } from 'crypto';

// ==================== TIPI ====================

export interface AgentConfig {
  id: string;
  role: 'coder' | 'tester' | 'reviewer' | 'researcher' | 'auditor';
  prompt: string;
  tools?: string[];         // MCP tools abilitati
  maxTurns?: number;
}

export interface TaskInput {
  type: 'text' | 'voice' | 'image' | 'file';
  content: string;          // testo, path file, o testo OCR
  project: string;
  metadata?: Record<string, unknown>;
}

export interface OrchestratorConfig {
  project: string;
  sessionId?: string;
  maxParallelAgents?: number;
}

// ==================== ORCHESTRATORE ====================

export class Orchestrator {
  private grafo: GrafoPTI;
  private sessionId: string;
  private project: string;
  private maxParallel: number;
  private agentProcesses: Map<string, { role: string; status: string }> = new Map();

  constructor(config: OrchestratorConfig) {
    this.grafo = new GrafoPTI();
    this.sessionId = config.sessionId ?? randomUUID();
    this.project = config.project;
    this.maxParallel = config.maxParallelAgents ?? 5;

    this.initGrafo();
  }

  // --- Inizializza grafo PTI ---
  private initGrafo(): void {
    // Fatti base
    this.grafo.fatto('session.id', this.sessionId);
    this.grafo.fatto('session.project', this.project);
    this.grafo.fatto('agents.count', 0);
    this.grafo.fatto('tasks.pending', 0);
    this.grafo.fatto('tasks.running', 0);
    this.grafo.fatto('tasks.done', 0);

    // Derivato: capacità disponibile
    this.grafo.derivato(
      'agents.capacity',
      ['agents.count'],
      (s) => this.maxParallel - (s.get('agents.count') as number ?? 0),
    );

    // Derivato: può accettare task?
    this.grafo.derivato(
      'can.accept',
      ['agents.capacity', 'tasks.pending'],
      (s) => (s.get('agents.capacity') as number) > 0 && (s.get('tasks.pending') as number) > 0,
    );

    // Salti
    this.grafo.salto('agents.count', ['can.accept']);
    this.grafo.salto('tasks.pending', ['can.accept']);

    // Listener: quando can.accept diventa true, dispatcha
    this.grafo.onDelta('can.accept', (_nodo, delta) => {
      if ('dopo' in delta && delta.dopo === true) {
        this.dispatchNext().catch(console.error);
      }
    });
  }

  // --- Ricevi input (testo, voce, immagine) ---
  async handleInput(input: TaskInput): Promise<string[]> {
    // 1. Cerca contesto in SurrealDB
    const ctx = await this.loadContext();

    // 2. Cerca esperienze simili
    const experiences = await this.findSimilarExperiences(input.content);

    // 3. Decomponi in task (via lead agent o euristica)
    const tasks = await this.decompose(input, ctx, experiences);

    // 4. Inserisci task nel grafo e in SurrealDB
    const taskIds: string[] = [];
    for (const task of tasks) {
      const taskId = await createTask({
        task: task.description,
        project: this.project,
        priority: task.priority,
      });
      taskIds.push(taskId);

      // Aggiorna fatto PTI
      this.grafo.fatto('tasks.pending', (this.grafo.leggi('tasks.pending') as number) + 1);
    }

    // 5. Salva contesto sessione
    await saveSessionContext({
      session_id: this.sessionId,
      project: this.project,
      decisions: [`Decomposto input in ${tasks.length} task`],
      agent_roles: tasks.map(t => t.role),
    });

    return taskIds;
  }

  // --- Decomponi input in task paralleli ---
  private async decompose(
    input: TaskInput,
    _ctx: unknown,
    _experiences: unknown[],
  ): Promise<Array<{ description: string; role: string; priority: number }>> {
    // Euristica base: analisi del contenuto
    // In produzione qui va il lead agent Claude
    const tasks: Array<{ description: string; role: string; priority: number }> = [];

    const content = input.content.toLowerCase();

    // Pattern matching sui tuoi comandi tipici
    if (content.includes('paralleli') || content.includes('in parallelo')) {
      // Richiesta esplicita di parallelismo
      tasks.push(
        { description: `Analisi principale: ${input.content}`, role: 'coder', priority: 8 },
        { description: `Audit parallelo: ${input.content}`, role: 'auditor', priority: 7 },
      );
    } else if (content.includes('audit') || content.includes('controlla') || content.includes('verifica')) {
      tasks.push(
        { description: `Audit: ${input.content}`, role: 'auditor', priority: 9 },
        { description: `Test copertura: ${input.content}`, role: 'tester', priority: 7 },
      );
    } else if (content.includes('fix') || content.includes('bug') || content.includes('errore')) {
      tasks.push(
        { description: `Fix: ${input.content}`, role: 'coder', priority: 9 },
        { description: `Verifica fix: ${input.content}`, role: 'tester', priority: 6 },
      );
    } else if (content.includes('ricerca') || content.includes('cerca') || content.includes('research')) {
      tasks.push(
        { description: `Ricerca: ${input.content}`, role: 'researcher', priority: 8 },
      );
    } else {
      // Default: singolo task
      tasks.push(
        { description: input.content, role: 'coder', priority: 5 },
      );
    }

    return tasks;
  }

  // --- Dispatch: assegna task pronti ad agenti liberi ---
  private async dispatchNext(): Promise<void> {
    const readyTasks = await getReadyTasks(this.project);
    const idleAgents = await getIdleAgents(this.project);

    for (const task of readyTasks as Array<{ id: string; task: string }>) {
      if (this.agentProcesses.size >= this.maxParallel) break;

      // Spawn nuovo agente o riusa idle
      const agentId = `agent-${randomUUID().slice(0, 8)}`;
      await assignTask(task.id, agentId);
      await upsertAgentState(agentId, {
        session_id: this.sessionId,
        project: this.project,
        role: 'coder',
        status: 'working',
        current_task: task.task,
      });

      this.agentProcesses.set(agentId, { role: 'coder', status: 'working' });
      this.grafo.fatto('agents.count', this.agentProcesses.size);
      this.grafo.fatto('tasks.running', (this.grafo.leggi('tasks.running') as number) + 1);
      this.grafo.fatto('tasks.pending', Math.max(0, (this.grafo.leggi('tasks.pending') as number) - 1));

      // Qui in produzione: spawn Claude Agent SDK subagent
      console.log(`[PTI] Spawned ${agentId} → ${task.task}`);
    }
  }

  // --- Agent completa il lavoro ---
  async agentDone(agentId: string, taskId: string, result: string, findings: unknown[]): Promise<void> {
    // Aggiorna SurrealDB
    await completeTask(taskId, result, { findings });
    await upsertAgentState(agentId, {
      session_id: this.sessionId,
      project: this.project,
      role: this.agentProcesses.get(agentId)?.role ?? 'coder',
      status: 'done',
      findings,
    });

    // Aggiorna grafo PTI — delta propaga
    this.agentProcesses.delete(agentId);
    this.grafo.fatto('agents.count', this.agentProcesses.size);
    this.grafo.fatto('tasks.running', Math.max(0, (this.grafo.leggi('tasks.running') as number) - 1));
    this.grafo.fatto('tasks.done', (this.grafo.leggi('tasks.done') as number) + 1);

    // I findings saltano → shared_memory (tutti gli agenti li vedono)
    this.grafo.fatto(`findings.${agentId}`, findings);
    this.grafo.salto(`findings.${agentId}`, ['shared_memory', 'dashboard']);

    console.log(`[PTI] Agent ${agentId} done → ${findings.length} findings`);
  }

  // --- Carica contesto da SurrealDB ---
  private async loadContext(): Promise<unknown> {
    return getSessionState(this.sessionId);
  }

  // --- Cerca esperienze simili in SurrealDB ---
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
    agents: Map<string, { role: string; status: string }>;
  } {
    return {
      session: this.sessionId,
      project: this.project,
      grafo: this.grafo.stato(),
      agents: this.agentProcesses,
    };
  }

  // --- Health ---
  async health(): Promise<{ surreal: boolean; agents: number; tasks: unknown }> {
    const surrealOk = await surrealHealthCheck();
    return {
      surreal: surrealOk,
      agents: this.agentProcesses.size,
      tasks: {
        pending: this.grafo.leggi('tasks.pending'),
        running: this.grafo.leggi('tasks.running'),
        done: this.grafo.leggi('tasks.done'),
      },
    };
  }
}
