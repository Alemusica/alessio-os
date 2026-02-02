/**
 * Paradigm Registry — Dischetti Swappabili
 *
 * Ogni paradigma è un "dischetto" che definisce come gli agenti pensano.
 * PTI v4.1 è il default. Nuovi paradigmi possono essere creati e assegnati
 * per-progetto o per-agente.
 *
 * Fatto:     paradigm.{id}.compact = testo
 * Derivato:  paradigm.active(project) := assignment → fallback PTI
 * Salto:     paradigm.changed → [context-builder, agents-strip]
 */

import { surqlQuery } from './surreal-bridge.js';
import { PTI_MANIFESTO, PTI_MANIFESTO_COMPACT, PTI_VERSION } from './manifesto.js';

// ==================== TIPI ====================

export interface Paradigm {
  paradigm_id: string;
  name: string;
  version: string;
  description: string;
  compact: string;       // versione compatta per context window agenti
  full_text: string;     // manifesto completo
  tags: string[];
  created_at?: string;
}

export interface ParadigmAssignment {
  target_type: 'project' | 'agent';
  target_id: string;
  paradigm_id: string;
  assigned_at?: string;
}

// ==================== DEFAULT PTI ====================

const DEFAULT_PARADIGM_ID = 'pti-v4.1';

const DEFAULT_PARADIGM: Paradigm = {
  paradigm_id: DEFAULT_PARADIGM_ID,
  name: 'PTI — Paradigma Tissutale Interconnesso',
  version: PTI_VERSION,
  description: 'Programmazione dichiarativa-reattiva con delta propagation per collaborazione umano-LLM',
  compact: PTI_MANIFESTO_COMPACT,
  full_text: PTI_MANIFESTO,
  tags: ['reactive', 'graph', 'declarative', 'delta-propagation', 'llm-native'],
};

// ==================== SEED ====================

/** Al boot: inserisce PTI v4.1 se non esiste già */
export async function seedDefaultParadigm(): Promise<void> {
  try {
    const res = await surqlQuery(
      `SELECT paradigm_id FROM paradigm WHERE paradigm_id = $id`,
      { id: DEFAULT_PARADIGM_ID }
    );
    const existing = res[0]?.result;
    if (Array.isArray(existing) && existing.length > 0) return;

    await surqlQuery(`
      CREATE paradigm SET
        paradigm_id = $paradigm_id,
        name = $name,
        version = $version,
        description = $description,
        compact = $compact,
        full_text = $full_text,
        tags = $tags,
        created_at = time::now()
    `, {
      paradigm_id: DEFAULT_PARADIGM.paradigm_id,
      name: DEFAULT_PARADIGM.name,
      version: DEFAULT_PARADIGM.version,
      description: DEFAULT_PARADIGM.description,
      compact: DEFAULT_PARADIGM.compact,
      full_text: DEFAULT_PARADIGM.full_text,
      tags: DEFAULT_PARADIGM.tags,
    } as Record<string, unknown>);
  } catch {
    // SurrealDB non raggiungibile — usa in-memory default
  }
}

// ==================== CRUD ====================

export async function listParadigms(): Promise<Paradigm[]> {
  try {
    const res = await surqlQuery(`SELECT * FROM paradigm ORDER BY created_at ASC`);
    const result = res[0]?.result;
    return Array.isArray(result) ? result as Paradigm[] : [DEFAULT_PARADIGM];
  } catch {
    return [DEFAULT_PARADIGM];
  }
}

export async function getParadigm(id: string): Promise<Paradigm | null> {
  if (id === DEFAULT_PARADIGM_ID) {
    // Fast path — always available even without DB
    try {
      const res = await surqlQuery(
        `SELECT * FROM paradigm WHERE paradigm_id = $id`,
        { id }
      );
      const result = res[0]?.result as Paradigm[];
      return result?.[0] ?? DEFAULT_PARADIGM;
    } catch {
      return DEFAULT_PARADIGM;
    }
  }
  const res = await surqlQuery(
    `SELECT * FROM paradigm WHERE paradigm_id = $id`,
    { id }
  );
  const result = res[0]?.result as Paradigm[];
  return result?.[0] ?? null;
}

export async function createParadigm(p: Omit<Paradigm, 'created_at'>): Promise<string> {
  await surqlQuery(`
    CREATE paradigm SET
      paradigm_id = $paradigm_id,
      name = $name,
      version = $version,
      description = $description,
      compact = $compact,
      full_text = $full_text,
      tags = $tags,
      created_at = time::now()
  `, {
    paradigm_id: p.paradigm_id,
    name: p.name,
    version: p.version,
    description: p.description,
    compact: p.compact,
    full_text: p.full_text,
    tags: p.tags,
  } as Record<string, unknown>);
  return p.paradigm_id;
}

export async function deleteParadigm(id: string): Promise<void> {
  if (id === DEFAULT_PARADIGM_ID) {
    throw new Error('Cannot delete default PTI paradigm');
  }
  await surqlQuery(`DELETE FROM paradigm WHERE paradigm_id = $id`, { id });
  // Clean up assignments pointing to this paradigm
  await surqlQuery(`DELETE FROM paradigm_assignment WHERE paradigm_id = $id`, { id });
}

// ==================== ASSIGNMENT ====================

export async function assignParadigm(assignment: ParadigmAssignment): Promise<void> {
  await surqlQuery(`
    UPSERT paradigm_assignment SET
      target_type = $target_type,
      target_id = $target_id,
      paradigm_id = $paradigm_id,
      assigned_at = time::now()
    WHERE target_type = $target_type AND target_id = $target_id
  `, {
    target_type: assignment.target_type,
    target_id: assignment.target_id,
    paradigm_id: assignment.paradigm_id,
  } as Record<string, unknown>);
}

export async function getAssignment(targetType: string, targetId: string): Promise<ParadigmAssignment | null> {
  const res = await surqlQuery(`
    SELECT * FROM paradigm_assignment
    WHERE target_type = $target_type AND target_id = $target_id
  `, { target_type: targetType, target_id: targetId });
  const result = res[0]?.result as ParadigmAssignment[];
  return result?.[0] ?? null;
}

export async function removeAssignment(targetType: string, targetId: string): Promise<void> {
  await surqlQuery(`
    DELETE FROM paradigm_assignment
    WHERE target_type = $target_type AND target_id = $target_id
  `, { target_type: targetType, target_id: targetId });
}

// ==================== RISOLUZIONE (derivato) ====================

/**
 * Risolvi paradigma per un contesto agente.
 * Cascata: agent-level → project-level → default PTI
 *
 * derivato: paradigm.active := agent.paradigm ?? project.paradigm ?? pti-v4.1
 */
export async function resolveParadigm(project: string, agentDefId?: string): Promise<Paradigm> {
  try {
    // 1. Agent-level override
    if (agentDefId) {
      const agentAssignment = await getAssignment('agent', agentDefId);
      if (agentAssignment) {
        const p = await getParadigm(agentAssignment.paradigm_id);
        if (p) return p;
      }
    }

    // 2. Project-level override
    const projectAssignment = await getAssignment('project', project);
    if (projectAssignment) {
      const p = await getParadigm(projectAssignment.paradigm_id);
      if (p) return p;
    }
  } catch {
    // DB non disponibile — fallback
  }

  // 3. Default PTI
  return DEFAULT_PARADIGM;
}
