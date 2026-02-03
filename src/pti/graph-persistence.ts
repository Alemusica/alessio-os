/**
 * PTI Graph Persistence — Bridge GrafoPTI ↔ SurrealDB
 *
 * Sync topologia, log delta, snapshot per time-travel.
 * Usa stesse utility di surreal-bridge.ts.
 */

import { surqlQuery, esc } from './surreal-bridge.js';
import type { GrafoPTI, DeltaLogEntry } from './graph.js';

// --- Sync topologia: nodi + edges ---

export async function syncTopology(grafo: GrafoPTI, graphId: string): Promise<{ nodi: number; edges: number }> {
  const stato = grafo.stato();
  let edgeCount = 0;

  // Batch: UPSERT tutti i nodi
  const nodiQueries = stato.map(n => `
    UPSERT pti_node SET
      node_id = '${escId(n.id)}',
      tipo = '${n.tipo}',
      valore = ${escJson(n.valore)},
      livello = ${n.livello},
      sorgenti = [${n.sorgenti.map(s => `'${escId(s)}'`).join(', ')}],
      salti = [${n.salti.map(s => `'${escId(s)}'`).join(', ')}],
      graph_id = '${escId(graphId)}',
      updated_at = time::now()
    WHERE node_id = '${escId(n.id)}' AND graph_id = '${escId(graphId)}';
  `).join('\n');

  // Edges: dipendenze + salti
  const edgeQueries: string[] = [];
  for (const n of stato) {
    for (const s of n.sorgenti) {
      edgeQueries.push(`
        UPSERT pti_edge SET
          from_node = '${escId(s)}',
          to_node = '${escId(n.id)}',
          tipo = 'dipendenza',
          graph_id = '${escId(graphId)}'
        WHERE from_node = '${escId(s)}' AND to_node = '${escId(n.id)}' AND graph_id = '${escId(graphId)}';
      `);
      edgeCount++;
    }
    for (const s of n.salti) {
      edgeQueries.push(`
        UPSERT pti_edge SET
          from_node = '${escId(n.id)}',
          to_node = '${escId(s)}',
          tipo = 'salto',
          graph_id = '${escId(graphId)}'
        WHERE from_node = '${escId(n.id)}' AND to_node = '${escId(s)}' AND graph_id = '${escId(graphId)}';
      `);
      edgeCount++;
    }
  }

  await surqlQuery(nodiQueries + '\n' + edgeQueries.join('\n'));
  return { nodi: stato.length, edges: edgeCount };
}

// --- Attach delta logger ---

export function attachDeltaLogger(
  grafo: GrafoPTI,
  graphId: string,
  onDelta?: (entries: DeltaLogEntry[]) => void,
): void {
  let buffer: DeltaLogEntry[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const flush = async () => {
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];

    const queries = batch.map(e => `
      CREATE pti_delta_log SET
        nodo_id = '${escId(e.nodoId)}',
        delta = ${escJson(e.delta)},
        causa = '${escId(e.causa)}',
        graph_id = '${escId(graphId)}',
        created_at = time::now();
    `).join('\n');

    try {
      await surqlQuery(queries);
    } catch (err) {
      console.error(`[pti-persist] delta flush error:`, err);
    }
  };

  grafo.onPropagazione((entries) => {
    buffer.push(...entries);
    onDelta?.(entries);

    // Batch: flush every 500ms
    if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        flush();
      }, 500);
    }
  });
}

// --- Snapshot ---

export async function saveSnapshot(grafo: GrafoPTI, graphId: string, label?: string): Promise<void> {
  const snapshot = grafo.serialize();
  await surqlQuery(`
    CREATE pti_snapshot SET
      graph_id = '${escId(graphId)}',
      snapshot = ${escJson(snapshot)},
      label = ${label ? `'${escId(label)}'` : 'NONE'},
      created_at = time::now();
  `);
}

// --- List snapshots ---

export async function getSnapshots(graphId: string, limit = 10): Promise<Array<{ id: string; label: string | null; created_at: string; snapshot: unknown }>> {
  const res = await surqlQuery(`
    SELECT id, label, created_at, snapshot
    FROM pti_snapshot
    WHERE graph_id = '${escId(graphId)}'
    ORDER BY created_at DESC
    LIMIT ${limit}
  `);
  const result = res[0]?.result;
  return Array.isArray(result) ? result as Array<{ id: string; label: string | null; created_at: string; snapshot: unknown }> : [];
}

// --- Query topology from DB ---

export async function getTopologyFromDB(graphId: string): Promise<{
  nodi: unknown[];
  edges: unknown[];
  delta_count: number;
}> {
  const res = await surqlQuery(`fn::pti_topology('${escId(graphId)}')`);
  const result = res[0]?.result as { nodi?: unknown[]; edges?: unknown[]; delta_count?: number } | undefined;
  return {
    nodi: result?.nodi ?? [],
    edges: result?.edges ?? [],
    delta_count: result?.delta_count ?? 0,
  };
}

// --- Query delta history ---

export async function getDeltaHistory(graphId: string, limit = 50): Promise<unknown[]> {
  const res = await surqlQuery(`
    SELECT * FROM pti_delta_log
    WHERE graph_id = '${escId(graphId)}'
    ORDER BY created_at DESC
    LIMIT ${limit};
  `);
  const result = res[0]?.result;
  return Array.isArray(result) ? result : [];
}

// escId and escJson replaced by shared esc() from surreal-bridge
const escId = (s: string) => String(s).replace(/'/g, "\\'");
const escJson = esc;
