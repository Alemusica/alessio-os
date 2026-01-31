/**
 * PTI Core Runtime v4 — Grafo Reattivo Completo
 *
 * FATTI:     nodi base, valore assegnato con =
 * DERIVATI:  nodi materializzati, regola con :=
 * AZIONI:    nodi side-effect, eseguiti quando sorgenti cambiano
 * SALTI:     connessioni dichiarate con → (cross-gerarchia)
 * ASSERT:    vincoli invarianti, controllati durante propagazione
 * DELTA:     propagazione incrementale, mai ricalcolo totale
 *
 * Il grafo è il control flow. Niente polling, niente imperativi.
 * fatto() → propaga derivati → trigger azioni → nuovi fatti → ...
 */

// ==================== TIPI DELTA ====================

export type DeltaValore = { prima: unknown; dopo: unknown };
export type DeltaLista = {
  aggiunti?: unknown[];
  rimossi?: unknown[];
  modifiche?: Array<{ idx: number; prima: unknown; dopo: unknown }>;
};
export type DeltaMappa = { set?: Record<string, unknown>; unset?: string[] };
export type Delta = DeltaValore | DeltaLista | DeltaMappa;

// ==================== NODO ====================

export type NodoTipo = 'fatto' | 'derivato' | 'azione' | 'assert';

export interface Nodo {
  id: string;
  tipo: NodoTipo;
  valore: unknown;
  livello: number;                    // ordine topologico
  sorgenti: string[];                 // nodi da cui dipendo
  salti: string[];                    // → [destinazioni]
  regola?: (sorgenti: Map<string, unknown>, delta: Delta) => unknown;
  effetto?: (sorgenti: Map<string, unknown>, delta: Delta) => void | Promise<void>;
  predicato?: (sorgenti: Map<string, unknown>) => boolean;
  messaggioAssert?: string;
  ultimoDelta?: Delta;
  accessCount: number;                // per biocache
}

// ==================== ASSERT VIOLATION ====================

export interface AssertViolation {
  assertId: string;
  messaggio: string;
  sorgenti: Map<string, unknown>;
  timestamp: number;
}

// ==================== GRAFO PTI v4 ====================

export class GrafoPTI {
  private nodi: Map<string, Nodo> = new Map();
  private dipendenti: Map<string, Set<string>> = new Map();  // inverso di sorgenti
  private listeners: Map<string, Array<(nodo: Nodo, delta: Delta) => void>> = new Map();
  private propagando = false;   // guard reentrant propagation
  private codaDifferita: Array<{ id: string; valore: unknown }> = [];
  private violations: AssertViolation[] = [];
  private onViolation?: (v: AssertViolation) => void;

  constructor(opts?: { onViolation?: (v: AssertViolation) => void }) {
    this.onViolation = opts?.onViolation;
  }

  // --- FATTO: soggetto.attributo = valore ---
  fatto(id: string, valore: unknown): void {
    // Se stiamo propagando, accoda (evita ricorsione)
    if (this.propagando) {
      this.codaDifferita.push({ id, valore });
      return;
    }

    if (this.nodi.has(id)) {
      const nodo = this.nodi.get(id)!;
      if (nodo.valore === valore) return;  // no-op se uguale
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

    // Propaga anche la prima volta (per triggerer derivati/azioni gia' registrati)
    const delta: DeltaValore = { prima: undefined, dopo: valore };
    nodo.ultimoDelta = delta;
    this.propaga(id, delta);
  }

  // --- DERIVATO: soggetto := regola(sorgenti) ---
  derivato(
    id: string,
    sorgenti: string[],
    regola: (s: Map<string, unknown>, delta: Delta) => unknown,
  ): void {
    // Cycle detection: verifica che nessuna sorgente dipenda (direttamente o transitivamente) da id
    if (this.hasCycle(id, sorgenti)) {
      throw new Error(`[PTI] Dipendenza circolare: ${id} → ${sorgenti.join(', ')} → ... → ${id}`);
    }

    let maxLivello = 0;
    for (const sId of sorgenti) {
      const s = this.nodi.get(sId);
      if (s && s.livello >= maxLivello) maxLivello = s.livello + 1;
    }

    // Materializza valore iniziale
    const valoriSorgenti = this.raccogliSorgenti(sorgenti);
    const valoreIniziale = regola(valoriSorgenti, { prima: undefined, dopo: undefined });

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
  // Azioni sono fire-and-forget: async ok, risultati → nuovi fatto()
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
      valore: 0,             // contatore esecuzioni
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
  ): void {
    let maxLivello = 0;
    for (const sId of sorgenti) {
      const s = this.nodi.get(sId);
      if (s && s.livello >= maxLivello) maxLivello = s.livello + 1;
    }

    const nodo: Nodo = {
      id,
      tipo: 'assert',
      valore: true,           // ultimo risultato check
      livello: maxLivello,
      sorgenti,
      salti: [],
      predicato,
      messaggioAssert: messaggio,
      accessCount: 0,
    };

    this.nodi.set(id, nodo);
    this.dipendenti.set(id, new Set());
    this.registraDipendenze(id, sorgenti);

    // Check iniziale
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

  // --- NODO: accesso diretto al nodo ---
  nodo(id: string): Nodo | undefined {
    return this.nodi.get(id);
  }

  // --- Violazioni assert ---
  getViolations(): AssertViolation[] {
    return [...this.violations];
  }

  clearViolations(): void {
    this.violations = [];
  }

  // ==================== PROPAGAZIONE ====================

  private propaga(sorgenteId: string, delta: Delta): void {
    this.propagando = true;

    try {
      const coda: Array<{ id: string; delta: Delta }> = [];

      // Raccogli dipendenti diretti
      const diretti = this.dipendenti.get(sorgenteId);
      if (diretti) {
        for (const dId of diretti) {
          coda.push({ id: dId, delta });
        }
      }

      // Ordina per livello topologico
      coda.sort((a, b) => {
        const na = this.nodi.get(a.id);
        const nb = this.nodi.get(b.id);
        return (na?.livello ?? 0) - (nb?.livello ?? 0);
      });

      // Propaga in ordine topologico
      const visitati = new Set<string>();
      for (let i = 0; i < coda.length; i++) {
        const item = coda[i];
        if (visitati.has(item.id)) continue;
        visitati.add(item.id);

        const nodo = this.nodi.get(item.id);
        if (!nodo) continue;

        // Dispatch per tipo
        switch (nodo.tipo) {
          case 'derivato':
            this.propagaDerivato(nodo, item.delta, coda, visitati);
            break;
          case 'azione':
            this.eseguiAzione(nodo, item.delta);
            break;
          case 'assert':
            this.verificaAssert(nodo);
            break;
        }
      }

      // SALTI: dopo propagazione gerarchica, i salti cross-gerarchia
      // propagano il delta ai nodi destinazione (triggerer i loro dipendenti)
      const nodoSorgente = this.nodi.get(sorgenteId);
      if (nodoSorgente?.salti.length) {
        for (const saltoId of nodoSorgente.salti) {
          // Se il salto punta a un nodo esistente, propaga ai suoi dipendenti
          const saltoDest = this.nodi.get(saltoId);
          if (saltoDest) {
            const saltoDiretti = this.dipendenti.get(saltoId);
            if (saltoDiretti) {
              for (const dId of saltoDiretti) {
                if (!visitati.has(dId)) {
                  const depNodo = this.nodi.get(dId);
                  if (depNodo) {
                    switch (depNodo.tipo) {
                      case 'derivato':
                        this.propagaDerivato(depNodo, delta, coda, visitati);
                        break;
                      case 'azione':
                        this.eseguiAzione(depNodo, delta);
                        break;
                      case 'assert':
                        this.verificaAssert(depNodo);
                        break;
                    }
                  }
                }
              }
            }
          }
          // Emetti evento per listeners esterni
          this.emettiEvento(saltoId, nodoSorgente, delta);
        }
      }
    } finally {
      this.propagando = false;
    }

    // Processa coda differita (fatto() chiamati durante propagazione)
    this.processaCodaDifferita();
  }

  private propagaDerivato(
    nodo: Nodo,
    delta: Delta,
    coda: Array<{ id: string; delta: Delta }>,
    visitati: Set<string>,
  ): void {
    if (!nodo.regola) return;

    const valoriSorgenti = this.raccogliSorgenti(nodo.sorgenti);
    const prima = nodo.valore;
    const dopo = nodo.regola(valoriSorgenti, delta);

    if (prima !== dopo) {
      const nuovoDelta: DeltaValore = { prima, dopo };
      nodo.valore = dopo;
      nodo.ultimoDelta = nuovoDelta;
      nodo.accessCount++;

      // Notifica listeners
      this.emettiEvento(nodo.id, nodo, nuovoDelta);

      // Propaga ai dipendenti
      const subDiretti = this.dipendenti.get(nodo.id);
      if (subDiretti) {
        for (const subId of subDiretti) {
          if (!visitati.has(subId)) {
            coda.push({ id: subId, delta: nuovoDelta });
          }
        }
        // Re-sort per livello
        coda.sort((a, b) => {
          const na = this.nodi.get(a.id);
          const nb = this.nodi.get(b.id);
          return (na?.livello ?? 0) - (nb?.livello ?? 0);
        });
      }

      // Salti del derivato
      if (nodo.salti.length) {
        for (const saltoId of nodo.salti) {
          this.emettiEvento(saltoId, nodo, nuovoDelta);
          // Trigger dipendenti del salto destination
          const saltoDiretti = this.dipendenti.get(saltoId);
          if (saltoDiretti) {
            for (const dId of saltoDiretti) {
              if (!visitati.has(dId)) {
                coda.push({ id: dId, delta: nuovoDelta });
              }
            }
          }
        }
      }
    }
  }

  private eseguiAzione(nodo: Nodo, delta: Delta): void {
    if (!nodo.effetto) return;

    const valoriSorgenti = this.raccogliSorgenti(nodo.sorgenti);
    nodo.valore = (nodo.valore as number) + 1;
    nodo.accessCount++;

    // Fire-and-forget: async effects schedule their work,
    // completamento → nuovi fatto() che ri-propagano
    try {
      const result = nodo.effetto(valoriSorgenti, delta);
      if (result instanceof Promise) {
        result.catch((err) => {
          this.emettiEvento(`${nodo.id}:error`, nodo, {
            prima: null,
            dopo: err instanceof Error ? err.message : String(err),
          } as DeltaValore);
        });
      }
    } catch (err) {
      this.emettiEvento(`${nodo.id}:error`, nodo, {
        prima: null,
        dopo: err instanceof Error ? (err as Error).message : String(err),
      } as DeltaValore);
    }
  }

  private verificaAssert(nodo: Nodo): void {
    if (!nodo.predicato) return;

    const valoriSorgenti = this.raccogliSorgenti(nodo.sorgenti);
    const ok = nodo.predicato(valoriSorgenti);
    const prima = nodo.valore;
    nodo.valore = ok;

    if (!ok && prima !== ok) {
      const violation: AssertViolation = {
        assertId: nodo.id,
        messaggio: nodo.messaggioAssert ?? `Assert failed: ${nodo.id}`,
        sorgenti: valoriSorgenti,
        timestamp: Date.now(),
      };
      this.violations.push(violation);
      if (this.onViolation) this.onViolation(violation);
      this.emettiEvento(nodo.id, nodo, { prima, dopo: ok } as DeltaValore);
    }
  }

  // --- Processa fatto() accodati durante propagazione ---
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
        if (seen.has(key)) continue; // ciclo rilevato — skip
        seen.add(key);
        this.fatto(id, valore);
      }
    }

    if (iterations >= MAX_ITERATIONS) {
      console.error(`[PTI] processaCodaDifferita: max ${MAX_ITERATIONS} iterazioni — possibile ciclo`);
      this.codaDifferita = []; // drain per non bloccare
    }
  }

  // ==================== UTILITY ====================

  /** DFS cycle detection: verifica se aggiungere id con queste sorgenti crea un ciclo */
  private hasCycle(newId: string, newSorgenti: string[]): boolean {
    // Se newId è tra le sorgenti → self-loop
    if (newSorgenti.includes(newId)) return true;

    // DFS: da newId, segui i dipendenti (nodi che dipendono da newId).
    // Se raggiungiamo una delle newSorgenti → ciclo
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
  stato(): Array<{ id: string; tipo: NodoTipo; valore: unknown; livello: number; salti: string[] }> {
    return [...this.nodi.values()].map((n) => ({
      id: n.id,
      tipo: n.tipo,
      valore: n.valore,
      livello: n.livello,
      salti: n.salti,
    }));
  }

  // --- STATS: per debug ---
  stats(): { nodi: number; fatti: number; derivati: number; azioni: number; assert: number; violations: number } {
    let fatti = 0, derivati = 0, azioni = 0, asserts = 0;
    for (const n of this.nodi.values()) {
      switch (n.tipo) {
        case 'fatto': fatti++; break;
        case 'derivato': derivati++; break;
        case 'azione': azioni++; break;
        case 'assert': asserts++; break;
      }
    }
    return { nodi: this.nodi.size, fatti, derivati, azioni, assert: asserts, violations: this.violations.length };
  }
}
