/**
 * Agent Worker — Poll task_queue, spawn claude -p with enriched context
 *
 * Loop:
 *   poll task_queue ogni 2s
 *   → task pending + deps ok
 *   → buildContext(task, project) → system prompt file
 *   → spawn claude -p --system-prompt <file> <task>
 *   → stdout → SSE broadcast (streaming live)
 *   → on close → completeTask + save chat_log + agentDone
 *
 * Max 2 processi claude in parallelo (rate limit protection).
 */

import { spawn, ChildProcess } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';
import { unlinkSync } from 'fs';
import { randomUUID } from 'crypto';
import {
  surqlQuery,
  assignTask,
  completeTask,
  upsertAgentState,
} from '../pti/surreal-bridge.js';
import { buildContext, detectProject } from './context-builder.js';
import type { AgentRole } from './context-builder.js';

// ==================== TIPI ====================

export interface WorkerConfig {
  maxParallel?: number;       // default 2
  pollIntervalMs?: number;    // default 2000
  defaultProject?: string;    // default 'alessio-os'
  onLog?: (text: string, cls: string) => void;      // SSE broadcast
  onResponse?: (text: string, taskId: string) => void;  // response bubble
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

// ==================== WORKER ====================

export class AgentWorker {
  private maxParallel: number;
  private pollInterval: number;
  private defaultProject: string;
  private running: Map<string, RunningAgent> = new Map();
  private timer: ReturnType<typeof setInterval> | null = null;
  private log: (text: string, cls: string) => void;
  private onResponse: (text: string, taskId: string) => void;

  constructor(config: WorkerConfig = {}) {
    this.maxParallel = config.maxParallel ?? 2;
    this.pollInterval = config.pollIntervalMs ?? 2000;
    this.defaultProject = config.defaultProject ?? 'alessio-os';
    this.log = config.onLog ?? ((t, c) => console.log(`[worker:${c}] ${t}`));
    this.onResponse = config.onResponse ?? (() => {});
  }

  /** Start polling loop */
  start(): void {
    if (this.timer) return;
    this.log('[worker] Avviato — polling task_queue', 'event');
    this.timer = setInterval(() => this.poll().catch(err => {
      this.log(`[worker] Poll error: ${err}`, 'error');
    }), this.pollInterval);
    // Immediate first poll
    this.poll().catch(() => {});
  }

  /** Stop polling */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.log('[worker] Fermato', 'event');
  }

  /** How many agents running */
  get activeCount(): number {
    return this.running.size;
  }

  /** Get running agents info */
  get activeAgents(): Array<{ agentId: string; taskId: string; project: string; role: string }> {
    return [...this.running.values()].map(a => ({
      agentId: a.agentId,
      taskId: a.taskId,
      project: a.project,
      role: a.role,
    }));
  }

  // --- Direct dispatch (bypasses queue, used by dashboard handleCommand) ---
  async dispatchDirect(text: string, project?: string): Promise<{ agentId: string; taskId: string }> {
    const proj = project ?? this.defaultProject;

    // Create task in SurrealDB
    const taskRes = await surqlQuery(`
      CREATE task_queue SET
        task = $task,
        project = $project,
        priority = 10,
        status = 'pending',
        created_at = time::now()
    `, { task: text, project: proj });
    const taskId = (taskRes[0]?.result as Array<{ id: string }>)?.[0]?.id ?? `task-${randomUUID().slice(0, 8)}`;

    // Save user message
    await surqlQuery(`
      CREATE chat_log SET
        session_id = 'dashboard-live',
        role = 'user',
        content = $content,
        project = $project,
        created_at = time::now()
    `, { content: text, project: proj });

    // Detect role from content
    const role = detectRole(text);

    // Spawn immediately (even if at max capacity — direct commands are priority)
    await this.spawnAgent(taskId, text, proj, role);

    const agentId = [...this.running.entries()].find(([, a]) => a.taskId === taskId)?.[0] ?? '';
    return { agentId, taskId };
  }

  // ==================== INTERNAL ====================

  private async poll(): Promise<void> {
    if (this.running.size >= this.maxParallel) return;

    // Get pending tasks
    const res = await surqlQuery(`
      SELECT * FROM task_queue
      WHERE status = 'pending'
      ORDER BY priority DESC
      LIMIT $limit
    `, { limit: this.maxParallel - this.running.size });

    const tasks = res[0]?.result;
    if (!Array.isArray(tasks) || tasks.length === 0) return;

    for (const task of tasks as Array<{ id: string; task: string; project: string }>) {
      if (this.running.size >= this.maxParallel) break;

      const role = detectRole(task.task);
      await this.spawnAgent(task.id, task.task, task.project, role);
    }
  }

  private async spawnAgent(taskId: string, task: string, project: string, role: AgentRole): Promise<void> {
    const agentId = `agent-${randomUUID().slice(0, 8)}`;

    // Mark task as running
    await assignTask(taskId, agentId);

    // Update agent state
    await upsertAgentState(agentId, {
      session_id: 'dashboard-live',
      project,
      role,
      status: 'working',
      current_task: task,
    });

    this.log(`[${agentId}] ${role} → "${task.slice(0, 80)}"`, 'agent-name');

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

    // Resolve project working directory
    const cwd = resolveProjectCwd(project);

    // Spawn claude — --system-prompt takes a string, not a file path
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
      agentId,
      taskId,
      project,
      role,
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

    // Handle spawn errors (e.g. binary not found)
    child.on('error', (err) => {
      this.log(`[${agentId}] spawn error: ${err.message}`, 'error');
      this.running.delete(agentId);
      completeTask(taskId, `ERROR: ${err.message}`).catch(() => {});
      if (agent.promptFile) {
        try { unlinkSync(agent.promptFile); } catch { /* ok */ }
      }
    });

    // On close → complete task, save response, cleanup
    child.on('close', async (code) => {
      this.log(`[${agentId}] exit: ${code}`, 'event');
      this.running.delete(agentId);

      const result = agent.output.trim();

      // Complete task in SurrealDB
      try {
        await completeTask(taskId, result);
      } catch { /* ok */ }

      // Update agent state → done
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

      // Save assistant response to chat_log
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

        // Emit response event for chat bubble
        this.onResponse(result, taskId);
      }

      // Cleanup temp prompt file
      if (agent.promptFile) {
        try { unlinkSync(agent.promptFile); } catch { /* ok */ }
      }
    });
  }
}

// ==================== HELPERS ====================

/** Detect agent role from task content */
function detectRole(task: string): AgentRole {
  const t = task.toLowerCase();

  if (t.includes('audit') || t.includes('controlla') || t.includes('red team') || t.includes('verifica sicurezza')) {
    return 'reviewer';
  }
  if (t.includes('test') || t.includes('verifica') || t.includes('coverage')) {
    return 'tester';
  }
  if (t.includes('ricerca') || t.includes('cerca online') || t.includes('research') || t.includes('brainstorm') || t.includes('analizza')) {
    return 'researcher';
  }
  if (t.includes('audit completo') || t.includes('security audit') || t.includes('vulnerability')) {
    return 'auditor';
  }
  return 'coder';
}

/** Resolve working directory for a project */
function resolveProjectCwd(project: string): string {
  const home = homedir();

  // Known project paths
  const paths: Record<string, string> = {
    'alessio-os':              join(home, 'alessio-os'),
    'trovatore':               join(home, 'trovatore'),
    'social-cli-mcp':          join(home, 'social-cli-mcp'),
    'ui-canvas-mcp':           join(home, 'ui-canvas-mcp'),
    'gestionale-nautica-main': join(home, 'gestionale-nautica-main'),
    'ricchexxa-main':          join(home, 'ricchexxa-main'),
    'dag-consulting-2-0':      join(home, 'Documents/Web/Dag Consulting 2.0'),
    'nico':                    join(home, 'nico'),
    'looperpedal':             join(home, 'looperpedal'),
    'abletonscripts':          join(home, 'abletonscripts'),
    'innesti-revamp-draft':    join(home, 'innesti-revamp-draft'),
    'phonon-ui':               join(home, 'phonon-ui'),
    'xyl-excel':               join(home, 'xyl-excel'),
  };

  return paths[project] ?? join(home, project);
}
