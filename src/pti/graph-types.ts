/**
 * PTI Graph Types — Membrane pure
 *
 * Tipi esportati dal runtime PTI v4.1.
 * 0 dipendenze: atomo superficie pura.
 */

// ==================== TIPI DELTA ====================

export type DeltaValore = { tipo: 'valore'; prima: unknown; dopo: unknown };
export type DeltaLista = {
  tipo: 'lista';
  aggiunti: unknown[];
  rimossi: unknown[];
};
export type DeltaMappa = {
  tipo: 'mappa';
  set: Record<string, unknown>;
  unset: string[];
};
export type Delta = DeltaValore | DeltaLista | DeltaMappa;

// ==================== DELTA LOG ====================

export interface DeltaLogEntry {
  timestamp: number;
  nodoId: string;
  delta: Delta;
  causa: string;
}

// ==================== NODO ====================

export type NodoTipo = 'fatto' | 'derivato' | 'azione' | 'assert';

export interface Nodo {
  id: string;
  tipo: NodoTipo;
  valore: unknown;
  livello: number;
  sorgenti: string[];
  salti: string[];
  regola?: (sorgenti: Map<string, unknown>, delta: Delta) => unknown;
  effetto?: (sorgenti: Map<string, unknown>, delta: Delta) => void | Promise<void>;
  predicato?: (sorgenti: Map<string, unknown>) => boolean;
  messaggioAssert?: string;
  bloccante?: boolean;
  ultimoDelta?: Delta;
  accessCount: number;
}

// ==================== ASSERT VIOLATION ====================

export interface AssertViolation {
  assertId: string;
  messaggio: string;
  sorgenti: Map<string, unknown>;
  timestamp: number;
  bloccato: boolean;
}

// ==================== SNAPSHOT TYPES ====================

export interface NodoSnap {
  id: string;
  tipo: NodoTipo;
  valore: unknown;
  livello: number;
  sorgenti: string[];
  salti: string[];
  bloccante?: boolean;
  messaggioAssert?: string;
  accessCount: number;
}

export interface GrafoSnapshot {
  nodi: NodoSnap[];
  log: DeltaLogEntry[];
  violations: Array<Record<string, unknown>>;
  timestamp: number;
}
