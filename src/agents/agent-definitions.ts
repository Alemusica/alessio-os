/**
 * Agent Definitions — Persistent Project-Scoped Agents
 *
 * Ogni progetto ha i suoi agenti definiti con identità, ruolo, paradigma.
 * Non effimeri — persistono in SurrealDB.
 *
 * Fatto:     agent_definition.{id}.role = 'coder'
 * Derivato:  agent_definitions.count(project) := COUNT(definitions WHERE project)
 * Salto:     agent_definition.created → [agents-strip, agents-view]
 */

import { surqlQuery } from '../pti/surreal-bridge.js';
import { randomUUID } from 'crypto';

// ==================== TIPI ====================

export interface AgentDefinition {
  agent_def_id: string;
  project: string;
  name: string;
  role: string;                  // coder|tester|reviewer|researcher|auditor|custom
  custom_identity?: string;      // override di AGENT_IDENTITIES[role]
  paradigm_id?: string;          // null = inherit project paradigm
  mcp_config?: Record<string, unknown>;  // custom MCP servers (null = isolated)
  tags: string[];
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

// ==================== CRUD ====================

export async function listAgentDefinitions(project: string): Promise<AgentDefinition[]> {
  const res = await surqlQuery(`
    SELECT * FROM agent_definition
    WHERE project = $project
    ORDER BY created_at ASC
  `, { project });
  const result = res[0]?.result;
  return Array.isArray(result) ? result as AgentDefinition[] : [];
}

export async function getAgentDefinition(id: string): Promise<AgentDefinition | null> {
  const res = await surqlQuery(
    `SELECT * FROM agent_definition WHERE agent_def_id = $id`,
    { id }
  );
  const result = res[0]?.result as AgentDefinition[];
  return result?.[0] ?? null;
}

export async function createAgentDefinition(def: Omit<AgentDefinition, 'agent_def_id' | 'created_at' | 'updated_at'>): Promise<string> {
  const id = `adef-${randomUUID().slice(0, 8)}`;
  await surqlQuery(`
    CREATE agent_definition SET
      agent_def_id = $agent_def_id,
      project = $project,
      name = $name,
      role = $role,
      custom_identity = $custom_identity,
      paradigm_id = $paradigm_id,
      mcp_config = $mcp_config,
      tags = $tags,
      is_active = $is_active,
      created_at = time::now(),
      updated_at = time::now()
  `, {
    agent_def_id: id,
    project: def.project,
    name: def.name,
    role: def.role,
    custom_identity: def.custom_identity ?? null,
    paradigm_id: def.paradigm_id ?? null,
    mcp_config: def.mcp_config ?? null,
    tags: def.tags ?? [],
    is_active: def.is_active ?? true,
  } as Record<string, unknown>);
  return id;
}

export async function updateAgentDefinition(id: string, partial: Partial<AgentDefinition>): Promise<void> {
  const sets: string[] = ['updated_at = time::now()'];
  const vars: Record<string, unknown> = { id };

  if (partial.name !== undefined) { sets.push('name = $name'); vars.name = partial.name; }
  if (partial.role !== undefined) { sets.push('role = $role'); vars.role = partial.role; }
  if (partial.custom_identity !== undefined) { sets.push('custom_identity = $custom_identity'); vars.custom_identity = partial.custom_identity; }
  if (partial.paradigm_id !== undefined) { sets.push('paradigm_id = $paradigm_id'); vars.paradigm_id = partial.paradigm_id; }
  if (partial.mcp_config !== undefined) { sets.push('mcp_config = $mcp_config'); vars.mcp_config = partial.mcp_config; }
  if (partial.tags !== undefined) { sets.push('tags = $tags'); vars.tags = partial.tags; }
  if (partial.is_active !== undefined) { sets.push('is_active = $is_active'); vars.is_active = partial.is_active; }

  await surqlQuery(
    `UPDATE agent_definition SET ${sets.join(', ')} WHERE agent_def_id = $id`,
    vars
  );
}

export async function deleteAgentDefinition(id: string): Promise<void> {
  await surqlQuery(`DELETE FROM agent_definition WHERE agent_def_id = $id`, { id });
}
