import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  GrafoPTI,
  computaDelta,
  isDeltaValore,
  isDeltaLista,
  isDeltaMappa,
} from '../src/pti/graph.js';
import type { Delta, AssertViolation } from '../src/pti/graph.js';
import { diffStrutturale, formatDiff } from '../src/pti/diff.js';
import { parsePti, formatPti, estraiTopologia } from '../src/pti/parser.js';

// ==================== computaDelta ====================

describe('computaDelta', () => {
  it('scalare → DeltaValore', () => {
    const d = computaDelta(1, 2);
    assert.ok(isDeltaValore(d));
    assert.equal(d.prima, 1);
    assert.equal(d.dopo, 2);
  });

  it('stringa → DeltaValore', () => {
    const d = computaDelta('a', 'b');
    assert.ok(isDeltaValore(d));
  });

  it('null → valore → DeltaValore', () => {
    const d = computaDelta(null, 42);
    assert.ok(isDeltaValore(d));
  });

  it('array con aggiunti/rimossi → DeltaLista', () => {
    const d = computaDelta([1, 2, 3], [2, 3, 4]);
    assert.ok(isDeltaLista(d));
    assert.deepEqual(d.aggiunti, [4]);
    assert.deepEqual(d.rimossi, [1]);
  });

  it('array identico → DeltaValore (no structural change)', () => {
    const d = computaDelta([1, 2], [1, 2]);
    assert.ok(isDeltaValore(d));
  });

  it('array con oggetti → DeltaLista', () => {
    const d = computaDelta(
      [{ id: 1 }, { id: 2 }],
      [{ id: 2 }, { id: 3 }],
    );
    assert.ok(isDeltaLista(d));
    assert.equal(d.aggiunti.length, 1);
    assert.equal(d.rimossi.length, 1);
  });

  it('oggetto con set/unset → DeltaMappa', () => {
    const d = computaDelta({ a: 1, b: 2 }, { a: 1, c: 3 });
    assert.ok(isDeltaMappa(d));
    assert.deepEqual(d.set, { c: 3 });
    assert.deepEqual(d.unset, ['b']);
  });

  it('oggetto con solo modifica → DeltaMappa', () => {
    const d = computaDelta({ a: 1 }, { a: 2 });
    assert.ok(isDeltaMappa(d));
    assert.deepEqual(d.set, { a: 2 });
    assert.deepEqual(d.unset, []);
  });

  it('oggetto identico → DeltaValore', () => {
    const d = computaDelta({ a: 1 }, { a: 1 });
    assert.ok(isDeltaValore(d));
  });
});

// ==================== FATTI ====================

describe('fatto', () => {
  let g: GrafoPTI;
  beforeEach(() => { g = new GrafoPTI(); });

  it('crea nodo e leggi ritorna valore', () => {
    g.fatto('x', 10);
    assert.equal(g.leggi('x'), 10);
  });

  it('aggiorna valore esistente', () => {
    g.fatto('x', 1);
    g.fatto('x', 2);
    assert.equal(g.leggi('x'), 2);
  });

  it('no-op se valore identico', () => {
    g.fatto('x', 1);
    const log0 = g.deltaLog.length;
    g.fatto('x', 1);
    assert.equal(g.deltaLog.length, log0); // nessun nuovo log
  });

  it('ritorna true se accettato', () => {
    assert.equal(g.fatto('x', 1), true);
  });

  it('registra nel deltaLog', () => {
    g.fatto('x', 1);
    assert.equal(g.deltaLog.length, 1);
    assert.equal(g.deltaLog[0].nodoId, 'x');
    assert.equal(g.deltaLog[0].causa, 'x');
  });
});

// ==================== DERIVATI ====================

describe('derivato', () => {
  let g: GrafoPTI;
  beforeEach(() => { g = new GrafoPTI(); });

  it('materializza valore iniziale', () => {
    g.fatto('a', 5);
    g.derivato('doppio', ['a'], (s) => (s.get('a') as number) * 2);
    assert.equal(g.leggi('doppio'), 10);
  });

  it('ricalcola quando sorgente cambia', () => {
    g.fatto('a', 5);
    g.derivato('doppio', ['a'], (s) => (s.get('a') as number) * 2);
    g.fatto('a', 7);
    assert.equal(g.leggi('doppio'), 14);
  });

  it('catena di derivati', () => {
    g.fatto('a', 2);
    g.derivato('b', ['a'], (s) => (s.get('a') as number) + 1);
    g.derivato('c', ['b'], (s) => (s.get('b') as number) * 10);
    assert.equal(g.leggi('c'), 30);

    g.fatto('a', 5);
    assert.equal(g.leggi('b'), 6);
    assert.equal(g.leggi('c'), 60);
  });

  it('non propaga se valore non cambia', () => {
    g.fatto('a', 5);
    let count = 0;
    g.derivato('clamp', ['a'], (s) => Math.min(s.get('a') as number, 10));
    g.azione('counter', ['clamp'], () => { count++; });

    g.fatto('a', 3);  // clamp: 5 → 3, azione fire
    assert.equal(count, 1);
    g.fatto('a', 3);  // stesso valore → no propagation
    assert.equal(count, 1);
  });

  it('rileva ciclo', () => {
    g.fatto('a', 1);
    g.derivato('b', ['a'], (s) => s.get('a'));
    assert.throws(() => {
      g.derivato('a', ['b'], (s) => s.get('b'));
    }, /circolare/i);
  });
});

// ==================== AZIONI ====================

describe('azione', () => {
  let g: GrafoPTI;
  beforeEach(() => { g = new GrafoPTI(); });

  it('esegue quando sorgente cambia', () => {
    g.fatto('x', 0);
    const log: number[] = [];
    g.azione('act', ['x'], (s) => { log.push(s.get('x') as number); });

    g.fatto('x', 1);
    g.fatto('x', 2);
    assert.deepEqual(log, [1, 2]);
  });

  it('contatore esecuzioni', () => {
    g.fatto('x', 0);
    g.azione('act', ['x'], () => {});
    g.fatto('x', 1);
    g.fatto('x', 2);
    assert.equal(g.nodo('act')?.valore, 2);
  });

  it('fatto dentro azione → coda differita', () => {
    g.fatto('trigger', 0);
    g.fatto('result', '');
    g.azione('act', ['trigger'], (s) => {
      g.fatto('result', `triggered:${s.get('trigger')}`);
    });
    g.fatto('trigger', 1);
    assert.equal(g.leggi('result'), 'triggered:1');
  });
});

// ==================== ASSERT ====================

describe('assert', () => {
  let g: GrafoPTI;
  let violations: AssertViolation[];

  beforeEach(() => {
    violations = [];
    g = new GrafoPTI({ onViolation: (v) => violations.push(v) });
  });

  it('non-bloccante: segnala ma accetta', () => {
    g.fatto('n', 0);
    g.assert('check', ['n'], (s) => (s.get('n') as number) >= 0, 'n >= 0');

    g.fatto('n', -1);
    assert.equal(g.leggi('n'), -1); // accettato
    assert.equal(violations.length, 1);
    assert.equal(violations[0].bloccato, false);
  });

  it('bloccante: rifiuta e rollback', () => {
    g.fatto('n', 5);
    g.assert('check', ['n'], (s) => (s.get('n') as number) >= 0, 'n >= 0', true);

    const ok = g.fatto('n', -1);
    assert.equal(ok, false);
    assert.equal(g.leggi('n'), 5); // rollback
    assert.equal(violations.length, 1);
    assert.equal(violations[0].bloccato, true);
  });

  it('bloccante: accetta se predicato ok', () => {
    g.fatto('n', 5);
    g.assert('check', ['n'], (s) => (s.get('n') as number) >= 0, 'n >= 0', true);

    const ok = g.fatto('n', 10);
    assert.equal(ok, true);
    assert.equal(g.leggi('n'), 10);
    assert.equal(violations.length, 0);
  });

  it('bloccante: rollback anche derivati', () => {
    g.fatto('n', 5);
    g.derivato('doppio', ['n'], (s) => (s.get('n') as number) * 2);
    g.assert('check', ['n'], (s) => (s.get('n') as number) >= 0, 'n >= 0', true);

    g.fatto('n', -1);
    assert.equal(g.leggi('n'), 5);
    assert.equal(g.leggi('doppio'), 10); // rollback anche derivato
  });
});

// ==================== SALTI ====================

describe('salto', () => {
  let g: GrafoPTI;
  beforeEach(() => { g = new GrafoPTI(); });

  it('propaga cross-gerarchia', () => {
    g.fatto('a.stato', 'libero');
    g.fatto('b.valore', 0);
    g.derivato('b.calc', ['b.valore'], (s) => (s.get('b.valore') as number) + 1);

    // salto: quando a.stato cambia, trigger i dipendenti di b.valore
    g.salto('a.stato', ['b.valore']);

    const log: unknown[] = [];
    g.onDelta('b.valore', (_n, d) => log.push(d));

    g.fatto('a.stato', 'occupato');
    // b.calc dovrebbe essere ricalcolato (salto ha triggerato i suoi dipendenti)
    assert.ok(log.length > 0);
  });

  it('integrato nel topological sort', () => {
    const order: string[] = [];

    g.fatto('src', 0);
    g.fatto('mid', 0);
    // d1 e a1 dipendono entrambi da mid, triggerati via salto da src
    g.derivato('d1', ['mid'], (s) => {
      order.push('d1');
      return (s.get('mid') as number) + 1;
    });
    g.azione('a1', ['mid'], () => { order.push('a1'); });

    g.salto('src', ['mid']);

    order.length = 0;
    g.fatto('src', 1);
    // Entrambi triggerati dal salto; derivato (TIPO_ORDINE=1) prima di azione (3)
    const d1Idx = order.indexOf('d1');
    const a1Idx = order.indexOf('a1');
    assert.ok(d1Idx >= 0, 'derivato deve essere triggerato');
    assert.ok(a1Idx >= 0, 'azione deve essere triggerata');
    assert.ok(d1Idx < a1Idx, `derivato (${d1Idx}) deve precedere azione (${a1Idx})`);
  });
});

// ==================== DELTA STRUTTURALI ====================

describe('delta strutturali in propagazione', () => {
  let g: GrafoPTI;
  beforeEach(() => { g = new GrafoPTI(); });

  it('fatto con array produce DeltaLista', () => {
    g.fatto('lista', [1, 2, 3]);
    g.fatto('lista', [2, 3, 4]);

    const entry = g.causa('lista');
    assert.ok(entry);
    assert.ok(isDeltaLista(entry.delta));
    assert.deepEqual(entry.delta.aggiunti, [4]);
    assert.deepEqual(entry.delta.rimossi, [1]);
  });

  it('fatto con oggetto produce DeltaMappa', () => {
    g.fatto('obj', { a: 1, b: 2 });
    g.fatto('obj', { a: 1, c: 3 });

    const entry = g.causa('obj');
    assert.ok(entry);
    assert.ok(isDeltaMappa(entry.delta));
    assert.deepEqual(entry.delta.set, { c: 3 });
    assert.deepEqual(entry.delta.unset, ['b']);
  });

  it('derivato riceve delta strutturale', () => {
    g.fatto('items', [1, 2, 3]);
    let ricevuto: Delta | undefined;
    g.derivato('count', ['items'], (s, delta) => {
      ricevuto = delta;
      return (s.get('items') as unknown[]).length;
    });

    g.fatto('items', [1, 2, 3, 4]);
    assert.ok(ricevuto);
    assert.ok(isDeltaLista(ricevuto));
  });
});

// ==================== CAUSAL TRACING ====================

describe('causal tracing', () => {
  let g: GrafoPTI;
  beforeEach(() => { g = new GrafoPTI(); });

  it('causa() ritorna ultimo delta per nodo', () => {
    g.fatto('x', 1);
    g.fatto('x', 2);
    g.fatto('x', 3);
    const c = g.causa('x');
    assert.ok(c);
    assert.ok(isDeltaValore(c.delta));
    assert.equal(c.delta.dopo, 3);
  });

  it('causa() undefined per nodo inesistente', () => {
    assert.equal(g.causa('nope'), undefined);
  });

  it('catena() risale alle sorgenti', () => {
    g.fatto('a', 1);
    g.fatto('b', 2);
    g.derivato('c', ['a', 'b'], (s) =>
      (s.get('a') as number) + (s.get('b') as number),
    );
    g.derivato('d', ['c'], (s) => (s.get('c') as number) * 10);

    const chain = g.catena('d');
    const ids = chain.map(n => n.id);
    assert.ok(ids.includes('d'));
    assert.ok(ids.includes('c'));
    assert.ok(ids.includes('a'));
    assert.ok(ids.includes('b'));
    assert.equal(ids[0], 'd'); // parte dal nodo richiesto
  });

  it('simula() ritorna affetti senza modificare stato', () => {
    g.fatto('x', 5);
    g.derivato('doppio', ['x'], (s) => (s.get('x') as number) * 2);
    g.derivato('triplo', ['x'], (s) => (s.get('x') as number) * 3);

    const result = g.simula('x', 10);

    assert.ok(result.affetti.includes('doppio'));
    assert.ok(result.affetti.includes('triplo'));
    assert.deepEqual(result.delta.get('doppio'), { prima: 10, dopo: 20 });
    assert.deepEqual(result.delta.get('triplo'), { prima: 15, dopo: 30 });

    // Stato originale intatto
    assert.equal(g.leggi('x'), 5);
    assert.equal(g.leggi('doppio'), 10);
    assert.equal(g.leggi('triplo'), 15);
  });

  it('simula() rileva assert falliti', () => {
    g.fatto('n', 5);
    g.derivato('d', ['n'], (s) => s.get('n'));
    g.assert('check', ['n'], (s) => (s.get('n') as number) >= 0, 'n >= 0');

    const result = g.simula('n', -1);
    assert.ok(result.assertFalliti.includes('check'));

    // Stato intatto
    assert.equal(g.leggi('n'), 5);
  });

  it('simula() non esegue azioni', () => {
    g.fatto('x', 0);
    let fired = false;
    g.azione('act', ['x'], () => { fired = true; });

    g.simula('x', 99);
    assert.equal(fired, false);
  });
});

// ==================== TRACE ====================

describe('trace', () => {
  let g: GrafoPTI;
  beforeEach(() => { g = new GrafoPTI(); });

  it('ritorna info completa', () => {
    g.fatto('a', 1);
    g.derivato('b', ['a'], (s) => s.get('a'));
    g.fatto('a', 2);

    const t = g.trace('b');
    assert.ok(t.nodo);
    assert.equal(t.nodo.tipo, 'derivato');
    assert.equal(t.sorgenti.length, 1);
    assert.equal(t.sorgenti[0].id, 'a');
    assert.ok(t.ultimoCausa); // ha un log entry
  });

  it('undefined per nodo inesistente', () => {
    const t = g.trace('nope');
    assert.equal(t.nodo, undefined);
  });
});

// ==================== STATS ====================

describe('stats', () => {
  it('conta per tipo', () => {
    const g = new GrafoPTI();
    g.fatto('a', 1);
    g.fatto('b', 2);
    g.derivato('c', ['a'], (s) => s.get('a'));
    g.azione('act', ['b'], () => {});
    g.assert('check', ['a'], () => true, 'ok');

    const s = g.stats();
    assert.equal(s.fatti, 2);
    assert.equal(s.derivati, 1);
    assert.equal(s.azioni, 1);
    assert.equal(s.assert, 1);
    assert.equal(s.nodi, 5);
    assert.ok(s.logSize >= 0);
  });
});

// ==================== CODA DIFFERITA ====================

describe('coda differita', () => {
  it('feedback loop: azione scrive fatto → propaga', () => {
    const g = new GrafoPTI();
    g.fatto('counter', 0);
    g.fatto('doubled', 0);
    g.azione('auto', ['counter'], (s) => {
      const v = s.get('counter') as number;
      if (v > 0) g.fatto('doubled', v * 2);
    });

    g.fatto('counter', 3);
    assert.equal(g.leggi('doubled'), 6);
  });
});

// ==================== ORDINE PROPAGAZIONE ====================

describe('ordine propagazione', () => {
  it('derivato prima di assert prima di azione (stesso livello)', () => {
    const g = new GrafoPTI();
    const order: string[] = [];

    g.fatto('x', 0);
    g.derivato('d', ['x'], (s) => { order.push('derivato'); return s.get('x'); });
    g.assert('a', ['x'], () => { order.push('assert'); return true; }, 'ok');
    g.azione('act', ['x'], () => { order.push('azione'); });

    order.length = 0;
    g.fatto('x', 1);

    assert.equal(order[0], 'derivato');
    assert.equal(order[1], 'assert');
    assert.equal(order[2], 'azione');
  });
});

// ==================== WILDCARD QUERY ====================

describe('wildcard query', () => {
  let g: GrafoPTI;
  beforeEach(() => { g = new GrafoPTI(); });

  it('tavolo.* matcha tavolo.1, tavolo.2', () => {
    g.fatto('tavolo.1', { posti: 4 });
    g.fatto('tavolo.2', { posti: 6 });
    g.fatto('tavolo.3', { posti: 2 });
    g.fatto('config.max', 10);

    const result = g.queryIds('tavolo.*');
    assert.equal(result.length, 3);
    assert.ok(result.includes('tavolo.1'));
    assert.ok(result.includes('tavolo.2'));
    assert.ok(result.includes('tavolo.3'));
    assert.ok(!result.includes('config.max'));
  });

  it('tavolo.*.stato matcha solo i sotto-attributi', () => {
    g.fatto('tavolo.1.stato', 'libero');
    g.fatto('tavolo.2.stato', 'occupato');
    g.fatto('tavolo.1.posti', 4);

    const result = g.queryIds('tavolo.*.stato');
    assert.equal(result.length, 2);
    assert.ok(result.includes('tavolo.1.stato'));
    assert.ok(result.includes('tavolo.2.stato'));
  });

  it('*.running matcha agents.running', () => {
    g.fatto('agents.running', 2);
    g.fatto('agents.max', 5);
    g.fatto('queue.version', 1);

    const result = g.queryIds('*.running');
    assert.deepEqual(result, ['agents.running']);
  });

  it('query() ritorna Nodo[] con valori', () => {
    g.fatto('t.1', 'a');
    g.fatto('t.2', 'b');
    const nodi = g.query('t.*');
    assert.equal(nodi.length, 2);
    assert.ok(nodi[0].valore === 'a' || nodi[0].valore === 'b');
  });
});

// ==================== SERIALIZE / HYDRATE ====================

describe('serialize / hydrate', () => {
  it('serialize cattura stato completo', () => {
    const g = new GrafoPTI();
    g.fatto('a', 1);
    g.fatto('b', 2);
    g.derivato('c', ['a', 'b'], (s) =>
      (s.get('a') as number) + (s.get('b') as number),
    );
    g.salto('a', ['b']);
    g.fatto('a', 10);

    const snap = g.serialize();
    assert.equal(snap.nodi.length, 3);
    assert.ok(snap.log.length > 0);
    assert.ok(snap.timestamp > 0);

    const nodoA = snap.nodi.find(n => n.id === 'a');
    assert.equal(nodoA?.valore, 10);
    assert.deepEqual(nodoA?.salti, ['b']);
  });

  it('hydrate ripristina fatti', () => {
    const g1 = new GrafoPTI();
    g1.fatto('x', 100);
    g1.fatto('y', 200);
    g1.derivato('sum', ['x', 'y'], (s) =>
      (s.get('x') as number) + (s.get('y') as number),
    );
    const snap = g1.serialize();

    // Nuovo grafo con stessa struttura
    const g2 = new GrafoPTI();
    g2.fatto('x', 0);
    g2.fatto('y', 0);
    g2.derivato('sum', ['x', 'y'], (s) =>
      (s.get('x') as number) + (s.get('y') as number),
    );

    const result = g2.hydrate(snap);
    assert.equal(result.ripristinati, 3);
    assert.equal(result.mancanti.length, 0);
    assert.equal(g2.leggi('x'), 100);
    assert.equal(g2.leggi('y'), 200);
    assert.equal(g2.leggi('sum'), 300); // valore materializzato ripristinato
  });

  it('hydrate segnala nodi mancanti', () => {
    const g1 = new GrafoPTI();
    g1.fatto('x', 1);
    g1.derivato('d', ['x'], (s) => s.get('x'));
    const snap = g1.serialize();

    const g2 = new GrafoPTI();
    g2.fatto('x', 0);
    // d non registrato

    const result = g2.hydrate(snap);
    assert.ok(result.mancanti.includes('d'));
  });
});

// ==================== DIFF STRUTTURALE ====================

describe('diff strutturale', () => {
  it('rileva nodi aggiunti', () => {
    const prima = [{ id: 'a', tipo: 'fatto' as const, valore: 1, livello: 0, salti: [] }];
    const dopo = [
      { id: 'a', tipo: 'fatto' as const, valore: 1, livello: 0, salti: [] },
      { id: 'b', tipo: 'fatto' as const, valore: 2, livello: 0, salti: [] },
    ];

    const d = diffStrutturale(prima, dopo);
    assert.equal(d.sommario.aggiunti, 1);
    assert.equal(d.sommario.invariati, 1);
    assert.ok(d.nodi.find(n => n.id === 'b' && n.cambiamento === 'aggiunto'));
  });

  it('rileva nodi rimossi', () => {
    const prima = [
      { id: 'a', tipo: 'fatto' as const, valore: 1, livello: 0, salti: [] },
      { id: 'b', tipo: 'fatto' as const, valore: 2, livello: 0, salti: [] },
    ];
    const dopo = [{ id: 'a', tipo: 'fatto' as const, valore: 1, livello: 0, salti: [] }];

    const d = diffStrutturale(prima, dopo);
    assert.equal(d.sommario.rimossi, 1);
    assert.ok(d.nodi.find(n => n.id === 'b' && n.cambiamento === 'rimosso'));
  });

  it('rileva valore modificato', () => {
    const prima = [{ id: 'a', tipo: 'fatto' as const, valore: 1, livello: 0, salti: [] }];
    const dopo = [{ id: 'a', tipo: 'fatto' as const, valore: 99, livello: 0, salti: [] }];

    const d = diffStrutturale(prima, dopo);
    assert.equal(d.sommario.modificati, 1);
    const mod = d.nodi.find(n => n.cambiamento === 'modificato');
    assert.equal(mod?.prima, 1);
    assert.equal(mod?.dopo, 99);
  });

  it('rileva connessioni aggiunte/rimosse', () => {
    const prima = [{ id: 'a', tipo: 'fatto' as const, valore: 1, livello: 0, salti: ['b'] }];
    const dopo = [{ id: 'a', tipo: 'fatto' as const, valore: 1, livello: 0, salti: ['c'] }];

    const d = diffStrutturale(prima, dopo);
    assert.equal(d.sommario.connessioniAggiunte, 1);
    assert.equal(d.sommario.connessioniRimosse, 1);
    assert.ok(d.connessioni.find(c => c.a === 'c' && c.tipo === 'aggiunto'));
    assert.ok(d.connessioni.find(c => c.a === 'b' && c.tipo === 'rimosso'));
  });

  it('formatDiff produce output leggibile', () => {
    const prima = [{ id: 'a', tipo: 'fatto' as const, valore: 1, livello: 0, salti: [] }];
    const dopo = [
      { id: 'a', tipo: 'fatto' as const, valore: 2, livello: 0, salti: [] },
      { id: 'b', tipo: 'derivato' as const, valore: 4, livello: 1, salti: ['a'] },
    ];

    const d = diffStrutturale(prima, dopo);
    const out = formatDiff(d);
    assert.ok(out.includes('~'));  // modificato
    assert.ok(out.includes('+'));  // aggiunto
  });

  it('integrazione con GrafoPTI.stato()', () => {
    const g = new GrafoPTI();
    g.fatto('x', 1);
    g.derivato('d', ['x'], (s) => (s.get('x') as number) * 2);
    const snap1 = g.stato();

    g.fatto('x', 5);
    g.fatto('y', 10);
    const snap2 = g.stato();

    const d = diffStrutturale(snap1, snap2);
    assert.equal(d.sommario.aggiunti, 1);  // y
    assert.equal(d.sommario.modificati, 2); // x cambiato, d ricalcolato
  });
});

// ==================== PARSER PTI ====================

describe('parser PTI', () => {
  it('parsa fatti', () => {
    const ast = parsePti(`
tavolo.1.posti = 4
tavolo.1.stato = null
    `);
    assert.equal(ast.fatti.length, 2);
    assert.equal(ast.fatti[0].id, 'tavolo.1.posti');
    assert.equal(ast.fatti[0].valore, '4');
    assert.equal(ast.fatti[1].valore, 'null');
  });

  it('parsa derivati con assert', () => {
    const ast = parsePti(`
tavoli.liberi := tavolo.* | .stato == null
    assert: # <= tavolo.* | #
    assert: ∩ tavoli.occupati == ∅
    `);
    assert.equal(ast.derivati.length, 1);
    assert.equal(ast.derivati[0].id, 'tavoli.liberi');
    assert.equal(ast.derivati[0].espressione, 'tavolo.* | .stato == null');
    assert.equal(ast.derivati[0].assert.length, 2);
  });

  it('parsa derivati con salti inline', () => {
    const ast = parsePti(`
tavoli.capienza := tavoli.liberi | Σ.posti → [dashboard, report]
    `);
    assert.equal(ast.derivati.length, 1);
    assert.equal(ast.derivati[0].espressione, 'tavoli.liberi | Σ.posti');
    assert.deepEqual(ast.derivati[0].salti, ['dashboard', 'report']);
  });

  it('parsa salti', () => {
    const ast = parsePti(`
tavolo.*.stato → [tavoli.liberi, tavoli.occupati, dashboard]
    `);
    assert.equal(ast.salti.length, 1);
    assert.equal(ast.salti[0].sorgente, 'tavolo.*.stato');
    assert.equal(ast.salti[0].destinazioni.length, 3);
  });

  it('parsa azioni', () => {
    const ast = parsePti(`
ristorante.prenota(cliente, n, ora):
    ? n < 1: < (falso, "persone.minimo")
    candidati = tavoli.liberi | .posti >= n
    t = candidati | ^
    → [email.conferma]
    < (vero, t)
    `);
    assert.equal(ast.azioni.length, 1);
    const a = ast.azioni[0];
    assert.equal(a.id, 'ristorante.prenota');
    assert.deepEqual(a.params, ['cliente', 'n', 'ora']);
    assert.equal(a.corpo.length, 3);
    assert.deepEqual(a.salti, ['email.conferma']);
    assert.equal(a.ritorno, '(vero, t)');
  });

  it('ignora commenti e righe vuote', () => {
    const ast = parsePti(`
# Questo è un commento
tavolo.1 = 4

# Altro commento
tavolo.2 = 6
    `);
    assert.equal(ast.fatti.length, 2);
    assert.equal(ast.errori.length, 0);
  });

  it('esempio completo ristorante.pti', () => {
    const source = `# === ristorante.pti ===

# Fatti
tavolo.*.posti = 4
tavolo.*.stato = null

# Derivati
tavoli.liberi := tavolo.* | .stato == null
    assert: ∩ tavoli.occupati == ∅

tavoli.occupati := tavolo.* | .stato != null
    assert: # + tavoli.liberi | # == tavolo.* | #

tavoli.capienza := tavoli.liberi | Σ.posti
    assert: >= 0

# Salti
tavolo.*.stato → [tavoli.liberi, tavoli.occupati, dashboard]

# Azioni
ristorante.prenota(cliente, n, ora):
    ? n < 1: < (falso, "persone.minimo")
    ? n > 20: < (falso, "persone.massimo")
    candidati = tavoli.liberi | .posti >= n
    ? candidati | # == 0: < (falso, "pieno")
    t = candidati | ^
    t.stato = {cliente, n, ora, creato: now()}
    → [email.conferma]
    < (vero, t)
`;
    const ast = parsePti(source);
    assert.equal(ast.fatti.length, 2);
    assert.equal(ast.derivati.length, 3);
    assert.equal(ast.salti.length, 1);
    assert.equal(ast.azioni.length, 1);
    assert.equal(ast.errori.length, 0);
  });

  it('formatPti roundtrip', () => {
    const source = `tavolo.posti = 4
tavoli.liberi := tavolo.* | .stato == null`;
    const ast = parsePti(source);
    const output = formatPti(ast);
    assert.ok(output.includes('tavolo.posti = 4'));
    assert.ok(output.includes('tavoli.liberi := tavolo.* | .stato == null'));
  });

  it('estraiTopologia estrae nodi e connessioni', () => {
    const ast = parsePti(`
tavolo.*.posti = 4
tavoli.liberi := tavolo.* | .stato == null
tavolo.*.stato → [tavoli.liberi, dashboard]
ristorante.prenota(cliente, n):
    → [email.conferma]
    `);
    const topo = estraiTopologia(ast);
    assert.ok(topo.nodi.length >= 3);
    assert.ok(topo.connessioni.length >= 2);
    // Salto: tavolo.*.stato → tavoli.liberi
    assert.ok(topo.connessioni.find(c => c.da === 'tavolo.*.stato' && c.a === 'tavoli.liberi'));
  });
});
