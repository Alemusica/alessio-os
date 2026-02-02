/**
 * Action Logger — Structured Action History
 *
 * Log strutturato di tutte le azioni sistema per ogni progetto.
 * Gli agenti ricevono le azioni recenti nel contesto.
 *
 * Fatto:     action.last = { type, title, project }
 * Derivato:  actions.count(project) := COUNT(action_log WHERE project)
 * Salto:     action.new → [timeline-view, context-builder, SSE]
 */

import { surqlQuery } from '../pti/surreal-bridge.js';
import { randomUUID } from 'crypto';

// ==================== TIPI ====================

export type ActionType =
  | 'task_created'
  | 'agent_spawned'
  | 'agent_completed'
  | 'branch_created'
  | 'pr_created'
  | 'paradigm_changed'
  | 'agent_defined'
  | 'agent_updated'
  | 'agent_removed'
  | 'command_sent'
  | 'error';

export interface ActionLogEntry {
  action_id: string;
  project: string;
  session_id?: string;
  agent_id?: string;
  agent_def_id?: string;
  action_type: ActionType;
  title: string;
  details?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
}

// ==================== SSE CALLBACK ====================

let onActionCb: ((entry: ActionLogEntry) => void) | undefined;

/** Register callback for real-time SSE broadcast */
export function onAction(cb: (entry: ActionLogEntry) => void): void {
  onActionCb = cb;
}

// ==================== LOG ====================

export async function logAction(entry: Omit<ActionLogEntry, 'action_id'>): Promise<string> {
  const id = `act-${randomUUID().slice(0, 8)}`;
  const full: ActionLogEntry = { action_id: id, ...entry };

  try {
    await surqlQuery(`
      CREATE action_log SET
        action_id = $action_id,
        project = $project,
        session_id = $session_id,
        agent_id = $agent_id,
        agent_def_id = $agent_def_id,
        action_type = $action_type,
        title = $title,
        details = $details,
        metadata = $metadata,
        created_at = time::now()
    `, {
      action_id: id,
      project: entry.project,
      session_id: entry.session_id ?? null,
      agent_id: entry.agent_id ?? null,
      agent_def_id: entry.agent_def_id ?? null,
      action_type: entry.action_type,
      title: entry.title,
      details: entry.details ?? null,
      metadata: entry.metadata ?? null,
    } as Record<string, unknown>);
  } catch {
    // DB down — log to console as fallback
    console.warn(`[action-logger] DB write failed: ${entry.action_type} — ${entry.title}`);
  }

  // Broadcast via SSE callback
  if (onActionCb) onActionCb(full);

  return id;
}

// ==================== QUERY ====================

export async function getActionHistory(project: string, opts?: {
  limit?: number;
  offset?: number;
  type?: string;
}): Promise<ActionLogEntry[]> {
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;
  const typeFilter = opts?.type ? `AND action_type = '${opts.type}'` : '';

  const res = await surqlQuery(`
    SELECT * FROM action_log
    WHERE project = $project ${typeFilter}
    ORDER BY created_at DESC
    LIMIT ${limit}
    START ${offset}
  `, { project });
  const result = res[0]?.result;
  return Array.isArray(result) ? result as ActionLogEntry[] : [];
}

export async function getRecentActions(project: string, limit = 15): Promise<ActionLogEntry[]> {
  const res = await surqlQuery(`
    SELECT action_type, title, details, agent_id, created_at FROM action_log
    WHERE project = $project
    ORDER BY created_at DESC
    LIMIT ${limit}
  `, { project });
  const result = res[0]?.result;
  return Array.isArray(result) ? (result as ActionLogEntry[]).reverse() : [];
}
