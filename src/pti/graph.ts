/**
 * PTI Core Runtime v4.1
 *
 * Organello: GrafoPTI — motore di propagazione incrementale.
 * Tipi e funzioni pure estratti in graph-types.ts e graph-compute.ts.
 *
 * FATTI → DERIVATI → ASSERT → AZIONI (ordine propagazione per livello)
 */

// Re-export types and compute for backward compatibility
export type { DeltaValore, DeltaLista, DeltaMappa, Delta, DeltaLogEntry, NodoTipo, Nodo, AssertViolation, NodoSnap, GrafoSnapshot } from './graph-types.js';
export { isDeltaValore, isDeltaLista, isDeltaMappa, computaDelta, patternToRegex } from './graph-compute.js';

import type { Delta, DeltaLogEntry, Nodo, NodoTipo, AssertViolation, NodoSnap, GrafoSnapshot } from './graph-types.js';
import { computaDelta, patternToRegex } from './graph-compute.js';

// ==================== ORDINE PROPAGAZIONE ====================

const TIPO_ORDINE: Record<NodoTipo, number> = {
  fatto: 0,
  derivato: 1,
  assert: 2,
  azione: 3,
};

// ==================== GRAFO PTI v4.1 ====================

export class GrafoPTI {
  private nodi: Map<string, Nodo> = new Map();
  private dipendenti: Map<string, Set<string>> = new Map();
  private listeners: Map<string, Array<(nodo: Nodo, delta: Delta) => void>> = new Map();
  private propagando = false;
  private simulando = false;          // skip side effects durante simula()
  private codaDifferita: Array<{ id: string; valore: unknown }> = [];
  private violations: AssertViolation[] = [];
  readonly deltaLog: DeltaLogEntry[] = [];
  private onViolation?: (v: AssertViolation) => void;
  private onPropagationCb?: (entries: DeltaLogEntry[]) => void;
  private causaCorrente = '';
  private maxLogSize: number;

  constructor(opts?: {
    onViolation?: (v: AssertViolation) => void;
    maxLogSize?: number;
  }) {
    this.onViolation = opts?.onViolation;
    this.maxLogSize = opts?.maxLogSize ?? 10_000;
  }

  // --- FATTO: soggetto.attributo = valore ---
  // Ritorna true se accettato, false se bloccato da assert
  fatto(id: string, valore: unknown): boolean {
    if (this.propagando) {
      this.codaDifferita.push({ id, valore });
      return true;
    }

    if (this.nodi.has(id)) {
      const nodo = this.nodi.get(id)!;
      if (nodo.valore === valore) return true;

      const delta = computaDelta(nodo.valore, valore);
      const snap = this.snapshot();
      nodo.valore = valore;
      nodo.ultimoDelta = delta;
      nodo.accessCount++;

      this.causaCorrente = id;
      const bloccato = this.propaga(id, delta);

      if (bloccato) {
        this.rollback(snap);
        return false;
      }

      this.registraLog(id, delta, id);
      return true;
    }

    // Nuovo fatto
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

    const delta: Delta = { tipo: 'valore', prima: undefined, dopo: valore };
    nodo.ultimoDelta = delta;
    this.causaCorrente = id;
    this.propaga(id, delta);
    this.registraLog(id, delta, id);
    return true;
  }

  // --- DERIVATO: soggetto := regola(sorgenti) ---
  derivato(
    id: string,
    sorgenti: string[],
    regola: (s: Map<string, unknown>, delta: Delta) => unknown,
  ): void {
    if (this.hasCycle(id, sorgenti)) {
      throw new Error(`[PTI] Dipendenza circolare: ${id} → ${sorgenti.join(', ')} → ... → ${id}`);
    }

    let maxLivello = 0;
    for (const sId of sorgenti) {
      const s = this.nodi.get(sId);
      if (s && s.livello >= maxLivello) maxLivello = s.livello + 1;
    }

    const valoriSorgenti = this.raccogliSorgenti(sorgenti);
    const initDelta: Delta = { tipo: 'valore', prima: undefined, dopo: undefined };
    const valoreIniziale = regola(valoriSorgenti, initDelta);

    const nodo: Nodo = {
      id,
      tipo: 'derivato',
      valore: valoreIniziale,
      livello: maxLivello,
      sorgenti,
      salti: [],
      regola,
      accessCount: 0,
    };

    this.nodi.set(id, nodo);
    this.dipendenti.set(id, new Set());
    this.registraDipendenze(id, sorgenti);
  }

  // --- AZIONE: effetto collaterale quando sorgenti cambiano ---
  azione(
    id: string,
    sorgenti: string[],
    effetto: (s: Map<string, unknown>, delta: Delta) => void | Promise<void>,
  ): void {
    let maxLivello = 0;
    for (const sId of sorgenti) {
      const s = this.nodi.get(sId);
      if (s && s.livello >= maxLivello) maxLivello = s.livello + 1;
    }

    const nodo: Nodo = {
      id,
      tipo: 'azione',
      valore: 0,
      livello: maxLivello,
      sorgenti,
      salti: [],
      effetto,
      accessCount: 0,
    };

    this.nodi.set(id, nodo);
    this.dipendenti.set(id, new Set());
    this.registraDipendenze(id, sorgenti);
  }

  // --- ASSERT: vincolo invariante ---
  assert(
    id: string,
    sorgenti: string[],
    predicato: (s: Map<string, unknown>) => boolean,
    messaggio: string,
    bloccante = false,
  ): void {
    let maxLivello = 0;
    for (const sId of sorgenti) {
      const s = this.nodi.get(sId);
      if (s && s.livello >= maxLivello) maxLivello = s.livello + 1;
    }

    const nodo: Nodo = {
      id,
      tipo: 'assert',
      valore: true,
      livello: maxLivello,
      sorgenti,
      salti: [],
      predicato,
      messaggioAssert: messaggio,
      bloccante,
      accessCount: 0,
    };

    this.nodi.set(id, nodo);
    this.dipendenti.set(id, new Set());
    this.registraDipendenze(id, sorgenti);

    const valori = this.raccogliSorgenti(sorgenti);
    nodo.valore = predicato(valori);
  }

  // --- SALTO: soggetto → [destinazioni] ---
  salto(sorgente: string, destinazioni: string[]): void {
    const nodo = this.nodi.get(sorgente);
    if (!nodo) {
      console.warn(`[PTI] salto: sorgente '${sorgente}' non esiste`);
      return;
    }
    for (const d of destinazioni) {
      if (!this.nodi.has(d)) {
        console.warn(`[PTI] salto: destinazione '${d}' non esiste`);
      }
    }
    nodo.salti = [...new Set([...nodo.salti, ...destinazioni])];
  }

  // --- LEGGI: O(1) lookup ---
  leggi(id: string): unknown {
    const nodo = this.nodi.get(id);
    if (!nodo) return undefined;
    nodo.accessCount++;
    return nodo.valore;
  }

  // --- NODO: accesso diretto ---
  nodo(id: string): Nodo | undefined {
    return this.nodi.get(id);
  }

  // --- Violazioni ---
  getViolations(): AssertViolation[] {
    return [...this.violations];
  }

  clearViolations(): void {
    this.violations = [];
  }

  // ==================== PROPAGAZIONE ====================

  /**
   * Propaga delta dal nodo sorgente a tutti i dipendenti + salti.
   * Ritorna true se un assert bloccante ha fermato la propagazione.
   */
  private propaga(sorgenteId: string, delta: Delta): boolean {
    this.propagando = true;
    let bloccato = false;
    const logSizeBefore = this.deltaLog.length;

    try {
      const coda: Array<{ id: string; delta: Delta }> = [];

      // Raccogli dipendenti diretti + dipendenti dei salti (unificato)
      this.raccogliTuttiDipendenti(sorgenteId, delta, coda);
      this.ordinaCoda(coda);

      const visitati = new Set<string>();
      for (let i = 0; i < coda.length; i++) {
        const item = coda[i];
        if (visitati.has(item.id)) continue;
        visitati.add(item.id);

        if (bloccato) break;

        const nodo = this.nodi.get(item.id);
        if (!nodo) continue;

        switch (nodo.tipo) {
          case 'derivato':
            this.propagaDerivato(nodo, item.delta, coda, visitati);
            break;
          case 'assert':
            bloccato = this.verificaAssert(nodo);
            break;
          case 'azione':
            if (!this.simulando) {
              this.eseguiAzione(nodo, item.delta);
            }
            break;
        }
      }
    } finally {
      this.propagando = false;
    }

    if (!bloccato) {
      this.processaCodaDifferita();
      if (this.onPropagationCb && this.deltaLog.length > logSizeBefore) {
        this.onPropagationCb(this.deltaLog.slice(logSizeBefore));
      }
    } else {
      this.codaDifferita = [];
    }

    return bloccato;
  }

  /**
   * Raccogli dipendenti diretti + dipendenti raggiungibili via salti.
   */
  private raccogliTuttiDipendenti(
    nodoId: string,
    delta: Delta,
    coda: Array<{ id: string; delta: Delta }>,
  ): void {
    const diretti = this.dipendenti.get(nodoId);
    if (diretti) {
      for (const dId of diretti) {
        coda.push({ id: dId, delta });
      }
    }

    const nodo = this.nodi.get(nodoId);
    if (nodo?.salti.length) {
      for (const saltoId of nodo.salti) {
        this.emettiEvento(saltoId, nodo, delta);
        const saltoDip = this.dipendenti.get(saltoId);
        if (saltoDip) {
          for (const dId of saltoDip) {
            coda.push({ id: dId, delta });
          }
        }
      }
    }
  }

  /** Ordina coda: livello ASC, poi derivato < assert < azione */
  private ordinaCoda(coda: Array<{ id: string; delta: Delta }>): void {
    coda.sort((a, b) => {
      const na = this.nodi.get(a.id);
      const nb = this.nodi.get(b.id);
      const livDiff = (na?.livello ?? 0) - (nb?.livello ?? 0);
      if (livDiff !== 0) return livDiff;
      return (TIPO_ORDINE[na?.tipo ?? 'fatto'] ?? 0) - (TIPO_ORDINE[nb?.tipo ?? 'fatto'] ?? 0);
    });
  }

  private propagaDerivato(
    nodo: Nodo,
    delta: Delta,
    coda: Array<{ id: string; delta: Delta }>,
    _visitati: Set<string>,
  ): void {
    if (!nodo.regola) return;

    const valoriSorgenti = this.raccogliSorgenti(nodo.sorgenti);
    const prima = nodo.valore;
    const dopo = nodo.regola(valoriSorgenti, delta);

    if (prima !== dopo) {
      const nuovoDelta = computaDelta(prima, dopo);
      nodo.valore = dopo;
      nodo.ultimoDelta = nuovoDelta;
      nodo.accessCount++;

      this.emettiEvento(nodo.id, nodo, nuovoDelta);
      this.registraLog(nodo.id, nuovoDelta, this.causaCorrente);

      const primaLen = coda.length;
      this.raccogliTuttiDipendenti(nodo.id, nuovoDelta, coda);

      if (coda.length > primaLen) {
        this.ordinaCoda(coda);
      }
    }
  }

  private eseguiAzione(nodo: Nodo, delta: Delta): void {
    if (!nodo.effetto) return;

    const valoriSorgenti = this.raccogliSorgenti(nodo.sorgenti);
    nodo.valore = (nodo.valore as number) + 1;
    nodo.accessCount++;

    try {
      const result = nodo.effetto(valoriSorgenti, delta);
      if (result instanceof Promise) {
        result.catch((err) => {
          this.emettiEvento(`${nodo.id}:error`, nodo, {
            tipo: 'valore',
            prima: null,
            dopo: err instanceof Error ? err.message : String(err),
          });
        });
      }
    } catch (err) {
      this.emettiEvento(`${nodo.id}:error`, nodo, {
        tipo: 'valore',
        prima: null,
        dopo: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Verifica un assert. Ritorna true se BLOCCANTE e fallito.
   */
  private verificaAssert(nodo: Nodo): boolean {
    if (!nodo.predicato) return false;

    const valoriSorgenti = this.raccogliSorgenti(nodo.sorgenti);
    const ok = nodo.predicato(valoriSorgenti);
    const prima = nodo.valore;
    nodo.valore = ok;

    if (!ok) {
      const violation: AssertViolation = {
        assertId: nodo.id,
        messaggio: nodo.messaggioAssert ?? `Assert failed: ${nodo.id}`,
        sorgenti: valoriSorgenti,
        timestamp: Date.now(),
        bloccato: nodo.bloccante ?? false,
      };
      this.violations.push(violation);
      if (this.onViolation) this.onViolation(violation);
      if (prima !== ok) {
        this.emettiEvento(nodo.id, nodo, { tipo: 'valore', prima, dopo: ok });
      }
      return nodo.bloccante ?? false;
    }

    return false;
  }

  private processaCodaDifferita(): void {
    const MAX_ITERATIONS = 100;
    const seen = new Set<string>();
    let iterations = 0;

    while (this.codaDifferita.length > 0 && iterations < MAX_ITERATIONS) {
      iterations++;
      const batch = [...this.codaDifferita];
      this.codaDifferita = [];
      for (const { id, valore } of batch) {
        const key = `${id}:${JSON.stringify(valore)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        this.fatto(id, valore);
      }
    }

    if (iterations >= MAX_ITERATIONS) {
      console.error(`[PTI] processaCodaDifferita: max ${MAX_ITERATIONS} iterazioni — possibile ciclo`);
      this.codaDifferita = [];
    }
  }

  // ==================== CAUSAL TRACING ====================

  /**
   * ? causa(id) — Cosa ha causato il valore corrente di questo nodo?
   * Ritorna l'ultimo delta log entry che ha modificato il nodo.
   */
  causa(id: string): DeltaLogEntry | undefined {
    for (let i = this.deltaLog.length - 1; i >= 0; i--) {
      if (this.deltaLog[i].nodoId === id) return this.deltaLog[i];
    }
    return undefined;
  }

  /**
   * ? catena(id) — Catena causale completa: dal nodo risali alle sorgenti.
   * Ritorna [nodo ← sorgente ← ... ← fatto_originale].
   */
  catena(id: string): Array<{ id: string; valore: unknown; delta?: Delta }> {
    const chain: Array<{ id: string; valore: unknown; delta?: Delta }> = [];
    const visited = new Set<string>();

    const walk = (nodoId: string) => {
      if (visited.has(nodoId)) return;
      visited.add(nodoId);

      const nodo = this.nodi.get(nodoId);
      if (!nodo) return;

      chain.push({ id: nodoId, valore: nodo.valore, delta: nodo.ultimoDelta });

      for (const sId of nodo.sorgenti) {
        walk(sId);
      }
    };

    walk(id);
    return chain;
  }

  /**
   * ? simula(id, valore) — Simula una modifica senza applicarla.
   * Ritorna i nodi affetti e i delta previsti.
   */
  simula(id: string, valore: unknown): {
    affetti: string[];
    delta: Map<string, { prima: unknown; dopo: unknown }>;
    assertFalliti: string[];
  } {
    const snap = this.snapshot();
    const violazionePrima = this.violations.length;

    this.simulando = true;
    try {
      const nodo = this.nodi.get(id);
      if (!nodo) return { affetti: [], delta: new Map(), assertFalliti: [] };

      const delta = computaDelta(nodo.valore, valore);
      nodo.valore = valore;
      nodo.ultimoDelta = delta;
      this.causaCorrente = id;
      this.propaga(id, delta);
    } finally {
      this.simulando = false;
    }

    const affetti: string[] = [];
    const deltaMap = new Map<string, { prima: unknown; dopo: unknown }>();
    for (const [nId, val] of snap) {
      const nodo = this.nodi.get(nId);
      if (nodo && nodo.valore !== val) {
        affetti.push(nId);
        deltaMap.set(nId, { prima: val, dopo: nodo.valore });
      }
    }

    const assertFalliti = this.violations
      .slice(violazionePrima)
      .map(v => v.assertId);

    // Rollback
    this.rollback(snap);
    this.violations.splice(violazionePrima);
    this.codaDifferita = [];

    return { affetti, delta: deltaMap, assertFalliti };
  }

  // ==================== SNAPSHOT / ROLLBACK ====================

  private snapshot(): Map<string, unknown> {
    const snap = new Map<string, unknown>();
    for (const [id, nodo] of this.nodi) {
      snap.set(id, nodo.valore);
    }
    return snap;
  }

  private rollback(snap: Map<string, unknown>): void {
    for (const [id, val] of snap) {
      const nodo = this.nodi.get(id);
      if (nodo) nodo.valore = val;
    }
  }

  // ==================== UTILITY ====================

  private hasCycle(newId: string, newSorgenti: string[]): boolean {
    if (newSorgenti.includes(newId)) return true;

    const target = new Set(newSorgenti);
    const visited = new Set<string>();

    const dfs = (nodeId: string): boolean => {
      if (target.has(nodeId)) return true;
      if (visited.has(nodeId)) return false;
      visited.add(nodeId);

      const deps = this.dipendenti.get(nodeId);
      if (deps) {
        for (const depId of deps) {
          if (dfs(depId)) return true;
        }
      }
      return false;
    };

    return dfs(newId);
  }

  private raccogliSorgenti(sorgenti: string[]): Map<string, unknown> {
    const m = new Map<string, unknown>();
    for (const sId of sorgenti) {
      const s = this.nodi.get(sId);
      if (s) m.set(sId, s.valore);
    }
    return m;
  }

  private registraDipendenze(id: string, sorgenti: string[]): void {
    for (const sId of sorgenti) {
      if (!this.dipendenti.has(sId)) this.dipendenti.set(sId, new Set());
      this.dipendenti.get(sId)!.add(id);
    }
  }

  private registraLog(nodoId: string, delta: Delta, causa: string): void {
    if (this.simulando) return;

    this.deltaLog.push({ timestamp: Date.now(), nodoId, delta, causa });

    if (this.deltaLog.length > this.maxLogSize) {
      this.deltaLog.splice(0, this.deltaLog.length - this.maxLogSize);
    }
  }

  // --- PROPAGATION CALLBACK ---
  onPropagazione(cb: (entries: DeltaLogEntry[]) => void): void {
    this.onPropagationCb = cb;
  }

  // --- LISTENER ---
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

  // --- TRACE ---
  trace(id: string): {
    nodo: Nodo | undefined;
    sorgenti: Array<{ id: string; valore: unknown }>;
    dipendenti: string[];
    salti: string[];
    ultimoCausa: DeltaLogEntry | undefined;
  } {
    const nodo = this.nodi.get(id);
    if (!nodo) return { nodo: undefined, sorgenti: [], dipendenti: [], salti: [], ultimoCausa: undefined };

    return {
      nodo,
      sorgenti: nodo.sorgenti.map((sId) => ({
        id: sId,
        valore: this.nodi.get(sId)?.valore,
      })),
      dipendenti: [...(this.dipendenti.get(id) ?? [])],
      salti: nodo.salti,
      ultimoCausa: this.causa(id),
    };
  }

  // ==================== WILDCARD QUERY ====================

  /**
   * query('tavolo.*')        → [tavolo.1, tavolo.2, ...]
   * query('tavolo.*.stato')  → [tavolo.1.stato, tavolo.2.stato, ...]
   * query('*.running')       → [agents.running, ...]
   *
   * Supporta * come segmento wildcard (non ricorsivo).
   */
  query(pattern: string): Nodo[] {
    const regex = patternToRegex(pattern);
    const risultato: Nodo[] = [];
    for (const nodo of this.nodi.values()) {
      if (regex.test(nodo.id)) risultato.push(nodo);
    }
    return risultato;
  }

  /** Versione che ritorna solo gli ID */
  queryIds(pattern: string): string[] {
    return this.query(pattern).map(n => n.id);
  }

  // ==================== SERIALIZE / HYDRATE ====================

  /**
   * Serializza lo stato completo del grafo.
   * Esclude regole/effetti/predicati (funzioni → non serializzabili).
   * Per hydrate serve ri-registrare le funzioni.
   */
  serialize(): GrafoSnapshot {
    const nodi: NodoSnap[] = [];
    for (const n of this.nodi.values()) {
      nodi.push({
        id: n.id,
        tipo: n.tipo,
        valore: n.valore,
        livello: n.livello,
        sorgenti: n.sorgenti,
        salti: n.salti,
        bloccante: n.bloccante,
        messaggioAssert: n.messaggioAssert,
        accessCount: n.accessCount,
      });
    }
    return {
      nodi,
      log: [...this.deltaLog],
      violations: this.violations.map(v => ({
        ...v,
        sorgenti: Object.fromEntries(v.sorgenti),
      })),
      timestamp: Date.now(),
    };
  }

  /**
   * Ripristina i fatti da uno snapshot.
   * Derivati/azioni/assert devono essere ri-registrati dal codice
   * (le funzioni non sono serializzabili).
   * Hydrate setta solo i valori dei fatti già registrati.
   */
  hydrate(snapshot: GrafoSnapshot): { ripristinati: number; mancanti: string[] } {
    let ripristinati = 0;
    const mancanti: string[] = [];

    for (const snap of snapshot.nodi) {
      if (snap.tipo === 'fatto') {
        if (this.nodi.has(snap.id)) {
          const nodo = this.nodi.get(snap.id)!;
          nodo.valore = snap.valore;
          nodo.accessCount = snap.accessCount;
          ripristinati++;
        } else {
          // Fatto non ancora registrato → crealo
          this.fatto(snap.id, snap.valore);
          ripristinati++;
        }
      } else {
        // Derivato/azione/assert: verifica che esista (registrato dal codice)
        if (!this.nodi.has(snap.id)) {
          mancanti.push(snap.id);
        } else {
          // Ripristina valore materializzato
          const nodo = this.nodi.get(snap.id)!;
          nodo.valore = snap.valore;
          nodo.accessCount = snap.accessCount;
          ripristinati++;
        }
      }
    }

    // Ripristina salti
    for (const snap of snapshot.nodi) {
      if (snap.salti.length > 0 && this.nodi.has(snap.id)) {
        this.nodi.get(snap.id)!.salti = [...snap.salti];
      }
    }

    return { ripristinati, mancanti };
  }

  // --- GRAFO COMPLETO: per dashboard ---
  stato(): Array<{ id: string; tipo: NodoTipo; valore: unknown; livello: number; sorgenti: string[]; salti: string[] }> {
    return [...this.nodi.values()].map((n) => ({
      id: n.id,
      tipo: n.tipo,
      valore: n.valore,
      livello: n.livello,
      sorgenti: n.sorgenti,
      salti: n.salti,
    }));
  }

  // --- STATS ---
  stats(): {
    nodi: number; fatti: number; derivati: number; azioni: number; assert: number;
    violations: number; logSize: number;
  } {
    let fatti = 0, derivati = 0, azioni = 0, asserts = 0;
    for (const n of this.nodi.values()) {
      switch (n.tipo) {
        case 'fatto': fatti++; break;
        case 'derivato': derivati++; break;
        case 'azione': azioni++; break;
        case 'assert': asserts++; break;
      }
    }
    return {
      nodi: this.nodi.size, fatti, derivati, azioni,
      assert: asserts, violations: this.violations.length,
      logSize: this.deltaLog.length,
    };
  }
}

// patternToRegex and snapshot types now in graph-compute.ts and graph-types.ts
