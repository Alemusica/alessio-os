/**
 * PTI Diff Strutturale v1
 *
 * Il diff strutturale mostra cosa è cambiato nel GRAFO, non nel testo.
 * Semantica visibile immediatamente:
 *   ~ nodo.x: regola invariata
 *   + nodo.y: nuovo derivato
 *   - nodo.z: rimosso
 *   → +connessione: nuova propagazione
 *
 * Lavora su snapshot del grafo (output di GrafoPTI.stato()).
 */

import type { NodoTipo } from './graph.js';

// ==================== TIPI ====================

export interface NodoSnapshot {
  id: string;
  tipo: NodoTipo;
  valore: unknown;
  livello: number;
  salti: string[];
}

export interface DiffNodo {
  id: string;
  tipo: NodoTipo;
  cambiamento: 'aggiunto' | 'rimosso' | 'modificato' | 'invariato';
  prima?: unknown;
  dopo?: unknown;
  saltiAggiunti: string[];
  saltiRimossi: string[];
}

export interface DiffConnessione {
  da: string;
  a: string;
  tipo: 'aggiunto' | 'rimosso';
}

export interface DiffStrutturale {
  nodi: DiffNodo[];
  connessioni: DiffConnessione[];
  sommario: {
    aggiunti: number;
    rimossi: number;
    modificati: number;
    invariati: number;
    connessioniAggiunte: number;
    connessioniRimosse: number;
  };
}

// ==================== DIFF ====================

export function diffStrutturale(
  prima: NodoSnapshot[],
  dopo: NodoSnapshot[],
): DiffStrutturale {
  const mapPrima = new Map(prima.map(n => [n.id, n]));
  const mapDopo = new Map(dopo.map(n => [n.id, n]));

  const nodi: DiffNodo[] = [];
  const connessioni: DiffConnessione[] = [];
  let aggiunti = 0, rimossi = 0, modificati = 0, invariati = 0;

  // Nodi rimossi o modificati
  for (const [id, nP] of mapPrima) {
    const nD = mapDopo.get(id);
    if (!nD) {
      nodi.push({
        id, tipo: nP.tipo,
        cambiamento: 'rimosso',
        prima: nP.valore,
        saltiAggiunti: [],
        saltiRimossi: nP.salti,
      });
      for (const s of nP.salti) {
        connessioni.push({ da: id, a: s, tipo: 'rimosso' });
      }
      rimossi++;
      continue;
    }

    // Confronta
    const saltiPrima = new Set(nP.salti);
    const saltiDopo = new Set(nD.salti);
    const saltiAggiunti = nD.salti.filter(s => !saltiPrima.has(s));
    const saltiRimossi = nP.salti.filter(s => !saltiDopo.has(s));

    const valoreUguale = nP.valore === nD.valore ||
      JSON.stringify(nP.valore) === JSON.stringify(nD.valore);
    const saltiUguali = saltiAggiunti.length === 0 && saltiRimossi.length === 0;

    if (valoreUguale && saltiUguali) {
      nodi.push({
        id, tipo: nD.tipo,
        cambiamento: 'invariato',
        saltiAggiunti: [], saltiRimossi: [],
      });
      invariati++;
    } else {
      nodi.push({
        id, tipo: nD.tipo,
        cambiamento: 'modificato',
        prima: nP.valore,
        dopo: nD.valore,
        saltiAggiunti, saltiRimossi,
      });
      for (const s of saltiAggiunti) connessioni.push({ da: id, a: s, tipo: 'aggiunto' });
      for (const s of saltiRimossi) connessioni.push({ da: id, a: s, tipo: 'rimosso' });
      modificati++;
    }
  }

  // Nodi aggiunti
  for (const [id, nD] of mapDopo) {
    if (!mapPrima.has(id)) {
      nodi.push({
        id, tipo: nD.tipo,
        cambiamento: 'aggiunto',
        dopo: nD.valore,
        saltiAggiunti: nD.salti,
        saltiRimossi: [],
      });
      for (const s of nD.salti) {
        connessioni.push({ da: id, a: s, tipo: 'aggiunto' });
      }
      aggiunti++;
    }
  }

  return {
    nodi,
    connessioni,
    sommario: {
      aggiunti, rimossi, modificati, invariati,
      connessioniAggiunte: connessioni.filter(c => c.tipo === 'aggiunto').length,
      connessioniRimosse: connessioni.filter(c => c.tipo === 'rimosso').length,
    },
  };
}

// ==================== FORMAT ====================

/**
 * Formatta il diff in modo leggibile (stile manifesto PTI).
 *
 *   + config.tempo_max = 120
 *   ~ tavoli.occupati: invariato
 *   - vecchio.nodo: rimosso
 *   → +dashboard ← tavoli.scaduti
 */
export function formatDiff(diff: DiffStrutturale): string {
  const lines: string[] = [];

  // Ordina: rimossi, modificati, aggiunti, invariati
  const ordine = { rimosso: 0, modificato: 1, aggiunto: 2, invariato: 3 };
  const sorted = [...diff.nodi].sort((a, b) =>
    ordine[a.cambiamento] - ordine[b.cambiamento],
  );

  for (const n of sorted) {
    switch (n.cambiamento) {
      case 'aggiunto':
        lines.push(`  + ${n.id} (${n.tipo}) = ${fmt(n.dopo)}`);
        break;
      case 'rimosso':
        lines.push(`  - ${n.id} (${n.tipo})`);
        break;
      case 'modificato':
        lines.push(`  ~ ${n.id}: ${fmt(n.prima)} → ${fmt(n.dopo)}`);
        break;
      case 'invariato':
        lines.push(`    ${n.id}: invariato`);
        break;
    }
  }

  if (diff.connessioni.length > 0) {
    lines.push('');
    for (const c of diff.connessioni) {
      const sym = c.tipo === 'aggiunto' ? '+' : '-';
      lines.push(`  ${sym}→ ${c.da} → ${c.a}`);
    }
  }

  lines.push('');
  const s = diff.sommario;
  lines.push(`  ${s.aggiunti} aggiunti, ${s.rimossi} rimossi, ${s.modificati} modificati, ${s.invariati} invariati`);
  if (s.connessioniAggiunte || s.connessioniRimosse) {
    lines.push(`  ${s.connessioniAggiunte} connessioni +, ${s.connessioniRimosse} connessioni -`);
  }

  return lines.join('\n');
}

function fmt(v: unknown): string {
  if (v === undefined) return '∅';
  if (v === null) return 'null';
  if (typeof v === 'string') return `"${v}"`;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try { return JSON.stringify(v); } catch { return String(v); }
}
