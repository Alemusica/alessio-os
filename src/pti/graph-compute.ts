/**
 * PTI Graph Compute — Enzimi puri
 *
 * Funzioni di calcolo senza stato: computaDelta, type guards, pattern matching.
 * 0 dipendenze: atomo.
 */

import type { Delta, DeltaValore, DeltaLista, DeltaMappa } from './graph-types.js';

// ==================== TYPE GUARDS ====================

export function isDeltaValore(d: Delta): d is DeltaValore { return d.tipo === 'valore'; }
export function isDeltaLista(d: Delta): d is DeltaLista { return d.tipo === 'lista'; }
export function isDeltaMappa(d: Delta): d is DeltaMappa { return d.tipo === 'mappa'; }

// ==================== COMPUTE DELTA ====================

export function computaDelta(prima: unknown, dopo: unknown): Delta {
  // Array → DeltaLista
  if (Array.isArray(prima) && Array.isArray(dopo)) {
    const primaSet = new Set(prima.map(x => JSON.stringify(x)));
    const dopoSet = new Set(dopo.map(x => JSON.stringify(x)));
    const aggiunti = dopo.filter(x => !primaSet.has(JSON.stringify(x)));
    const rimossi = prima.filter(x => !dopoSet.has(JSON.stringify(x)));
    if (aggiunti.length > 0 || rimossi.length > 0) {
      return { tipo: 'lista', aggiunti, rimossi };
    }
    return { tipo: 'valore', prima, dopo };
  }

  // Plain object → DeltaMappa
  if (
    prima !== null && dopo !== null &&
    typeof prima === 'object' && typeof dopo === 'object' &&
    !Array.isArray(prima) && !Array.isArray(dopo)
  ) {
    const p = prima as Record<string, unknown>;
    const d = dopo as Record<string, unknown>;
    const set: Record<string, unknown> = {};
    const unset: string[] = [];
    for (const key of Object.keys(d)) {
      if (p[key] !== d[key]) set[key] = d[key];
    }
    for (const key of Object.keys(p)) {
      if (!(key in d)) unset.push(key);
    }
    if (Object.keys(set).length > 0 || unset.length > 0) {
      return { tipo: 'mappa', set, unset };
    }
    return { tipo: 'valore', prima, dopo };
  }

  // Scalar → DeltaValore
  return { tipo: 'valore', prima, dopo };
}

// ==================== WILDCARD HELPERS ====================

/**
 * Converte pattern PTI in regex.
 * 'tavolo.*'       → /^tavolo\.[^.]+$/
 * 'tavolo.*.stato' → /^tavolo\.[^.]+\.stato$/
 * '*.running'      → /^[^.]+\.running$/
 */
export function patternToRegex(pattern: string): RegExp {
  const escaped = pattern
    .split('.')
    .map(seg => seg === '*' ? '[^.]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\.');
  return new RegExp(`^${escaped}$`);
}
