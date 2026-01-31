/**
 * PTI Core Runtime — Grafo + Delta Propagation
 *
 * FATTI:     nodi base, valore assegnato con =
 * DERIVATI:  nodi materializzati, regola con :=
 * SALTI:     connessioni dichiarate con →
 * DELTA:     propagazione incrementale, mai ricalcolo totale
 */

// ==================== TIPI DELTA ====================

export type DeltaValore = { prima: unknown; dopo: unknown };
export type DeltaLista = {
  aggiungi?: unknown[];
  rimuovi?: unknown[];
  modifica?: Array<{ idx: number; prima: unknown; dopo: unknown }>;
};
export type DeltaMappa = { set?: Record<string, unknown>; unset?: string[] };
export type Delta = DeltaValore | DeltaLista | DeltaMappa;

// ==================== NODO ====================

export type NodoTipo = 'fatto' | 'derivato' | 'azione';

export interface Nodo {
  id: string;
  tipo: NodoTipo;
  valore: unknown;
  livello: number;                    // ordine topologico
  sorgenti: string[];                 // nodi da cui dipendo
  salti: string[];                    // → [destinazioni]
  regola?: (sorgenti: Map<string, unknown>, delta: Delta) => unknown;
  ultimoDelta?: Delta;
  accessCount: number;                // per biocache
}

// ==================== GRAFO PTI ====================

export class GrafoPTI {
  private nodi: Map<string, Nodo> = new Map();
  private dipendenti: Map<string, Set<string>> = new Map();  // inverso di sorgenti
  private listeners: Map<string, Array<(nodo: Nodo, delta: Delta) => void>> = new Map();

  // --- FATTO: soggetto.attributo = valore ---
  fatto(id: string, valore: unknown): void {
    if (this.nodi.has(id)) {
      const nodo = this.nodi.get(id)!;
      const delta: DeltaValore = { prima: nodo.valore, dopo: valore };
      nodo.valore = valore;
      nodo.ultimoDelta = delta;
      nodo.accessCount++;
      this.propaga(id, delta);
      return;
    }

    const nodo: Nodo = {
      id,
      tipo: 'fatto',
      valore,
      livello: 0,
      sorgenti: [],
      salti: [],
      accessCount: 0,
    };
    this.nodi.set(id, nodo);
    this.dipendenti.set(id, new Set());
  }

  // --- DERIVATO: soggetto := regola → [salti] ---
  derivato(
    id: string,
    sorgenti: string[],
    regola: (s: Map<string, unknown>, delta: Delta) => unknown,
    salti: string[] = [],
  ): void {
    // Calcola livello: max(sorgenti.livello) + 1
    let maxLivello = 0;
    for (const sId of sorgenti) {
      const s = this.nodi.get(sId);
      if (s && s.livello >= maxLivello) maxLivello = s.livello + 1;
    }

    // Materializza valore iniziale
    const valoriSorgenti = new Map<string, unknown>();
    for (const sId of sorgenti) {
      const s = this.nodi.get(sId);
      if (s) valoriSorgenti.set(sId, s.valore);
    }

    const valoreIniziale = regola(valoriSorgenti, { prima: undefined, dopo: undefined });

    const nodo: Nodo = {
      id,
      tipo: 'derivato',
      valore: valoreIniziale,
      livello: maxLivello,
      sorgenti,
      salti,
      regola,
      accessCount: 0,
    };

    this.nodi.set(id, nodo);
    this.dipendenti.set(id, new Set());

    // Registra dipendenza inversa
    for (const sId of sorgenti) {
      if (!this.dipendenti.has(sId)) this.dipendenti.set(sId, new Set());
      this.dipendenti.get(sId)!.add(id);
    }
  }

  // --- SALTO: soggetto.attributo → [destinazioni] ---
  salto(sorgente: string, destinazioni: string[]): void {
    const nodo = this.nodi.get(sorgente);
    if (nodo) {
      nodo.salti = [...new Set([...nodo.salti, ...destinazioni])];
    }
  }

  // --- LEGGI: O(1) lookup ---
  leggi(id: string): unknown {
    const nodo = this.nodi.get(id);
    if (!nodo) return undefined;
    nodo.accessCount++;
    return nodo.valore;
  }

  // --- PROPAGA: delta cascata in ordine topologico ---
  private propaga(sorgenteId: string, delta: Delta): void {
    const coda: Array<{ id: string; delta: Delta }> = [];

    // Raccogli dipendenti diretti
    const diretti = this.dipendenti.get(sorgenteId);
    if (diretti) {
      for (const dId of diretti) {
        coda.push({ id: dId, delta });
      }
    }

    // Ordina per livello topologico (garanzia PTI)
    coda.sort((a, b) => {
      const na = this.nodi.get(a.id);
      const nb = this.nodi.get(b.id);
      return (na?.livello ?? 0) - (nb?.livello ?? 0);
    });

    // Propaga in ordine
    const visitati = new Set<string>();
    for (const item of coda) {
      if (visitati.has(item.id)) continue;
      visitati.add(item.id);

      const nodo = this.nodi.get(item.id);
      if (!nodo || !nodo.regola) continue;

      // Raccogli valori sorgenti attuali
      const valoriSorgenti = new Map<string, unknown>();
      for (const sId of nodo.sorgenti) {
        const s = this.nodi.get(sId);
        if (s) valoriSorgenti.set(sId, s.valore);
      }

      // Calcola nuovo valore via regola + delta
      const prima = nodo.valore;
      const dopo = nodo.regola(valoriSorgenti, item.delta);

      if (prima !== dopo) {
        const nuovoDelta: DeltaValore = { prima, dopo };
        nodo.valore = dopo;
        nodo.ultimoDelta = nuovoDelta;
        nodo.accessCount++;

        // Notifica listeners
        this.emettiEvento(item.id, nodo, nuovoDelta);

        // Propaga ricorsivamente ai dipendenti di questo nodo
        const subDiretti = this.dipendenti.get(item.id);
        if (subDiretti) {
          for (const subId of subDiretti) {
            if (!visitati.has(subId)) {
              coda.push({ id: subId, delta: nuovoDelta });
            }
          }
          // Riordina
          coda.sort((a, b) => {
            const na = this.nodi.get(a.id);
            const nb = this.nodi.get(b.id);
            return (na?.livello ?? 0) - (nb?.livello ?? 0);
          });
        }
      }
    }

    // SALTI: dopo propagazione gerarchica
    const nodoSorgente = this.nodi.get(sorgenteId);
    if (nodoSorgente?.salti.length) {
      for (const saltoId of nodoSorgente.salti) {
        this.emettiEvento(saltoId, nodoSorgente, delta);
      }
    }
  }

  // --- LISTENER: osserva cambiamenti ---
  onDelta(id: string, cb: (nodo: Nodo, delta: Delta) => void): void {
    if (!this.listeners.has(id)) this.listeners.set(id, []);
    this.listeners.get(id)!.push(cb);
  }

  private emettiEvento(id: string, nodo: Nodo, delta: Delta): void {
    const cbs = this.listeners.get(id);
    if (cbs) {
      for (const cb of cbs) cb(nodo, delta);
    }
  }

  // --- TRACE: debug PTI ---
  trace(id: string): {
    nodo: Nodo | undefined;
    sorgenti: Array<{ id: string; valore: unknown }>;
    dipendenti: string[];
    salti: string[];
  } {
    const nodo = this.nodi.get(id);
    if (!nodo) return { nodo: undefined, sorgenti: [], dipendenti: [], salti: [] };

    return {
      nodo,
      sorgenti: nodo.sorgenti.map((sId) => ({
        id: sId,
        valore: this.nodi.get(sId)?.valore,
      })),
      dipendenti: [...(this.dipendenti.get(id) ?? [])],
      salti: nodo.salti,
    };
  }

  // --- GRAFO COMPLETO: per dashboard ---
  stato(): Array<{ id: string; tipo: NodoTipo; valore: unknown; livello: number }> {
    return [...this.nodi.values()].map((n) => ({
      id: n.id,
      tipo: n.tipo,
      valore: n.valore,
      livello: n.livello,
    }));
  }
}
