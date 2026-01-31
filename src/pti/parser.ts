/**
 * PTI Parser v1 — Minimale
 *
 * Parsa file .pti nella struttura topologica.
 * Non valuta espressioni — estrae identità, connessioni, struttura.
 *
 * Grammatica supportata:
 *   soggetto.attributo = valore                  → Fatto
 *   soggetto := espressione                      → Derivato
 *       assert: condizione                       → Assert inline
 *   soggetto → [dest1, dest2]                    → Salto
 *   soggetto.verbo(p1, p2):                      → Azione
 *       corpo indentato                          → Body
 *       → [salti]                                → Salti azione
 *       < ritorno                                → Return
 *   # commento                                   → Ignorato
 */

// ==================== AST ====================

export interface PtiFatto {
  tipo: 'fatto';
  id: string;           // soggetto.attributo
  valore: string;       // raw expression
  linea: number;
}

export interface PtiDerivato {
  tipo: 'derivato';
  id: string;           // soggetto
  espressione: string;  // raw expression dopo :=
  salti: string[];      // → [dest] inline se presente
  assert: string[];     // assert: inline
  linea: number;
}

export interface PtiSalto {
  tipo: 'salto';
  sorgente: string;
  destinazioni: string[];
  linea: number;
}

export interface PtiAzione {
  tipo: 'azione';
  id: string;           // soggetto.verbo
  params: string[];
  corpo: string[];      // raw lines
  salti: string[];      // → [dest]
  ritorno: string;      // < espressione
  linea: number;
}

export type PtiNodo = PtiFatto | PtiDerivato | PtiSalto | PtiAzione;

export interface PtiAst {
  nodi: PtiNodo[];
  fatti: PtiFatto[];
  derivati: PtiDerivato[];
  salti: PtiSalto[];
  azioni: PtiAzione[];
  errori: Array<{ linea: number; messaggio: string }>;
}

// ==================== PARSER ====================

export function parsePti(source: string): PtiAst {
  const lines = source.split('\n');
  const ast: PtiAst = {
    nodi: [], fatti: [], derivati: [], salti: [], azioni: [],
    errori: [],
  };

  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();
    const lineNum = i + 1;

    // Skip blank lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      i++;
      continue;
    }

    // Azione: soggetto.verbo(params):
    const azioneMatch = trimmed.match(/^([\w.*]+)\((.*?)\)\s*:$/);
    if (azioneMatch) {
      const azione = parseAzione(azioneMatch[1], azioneMatch[2], lineNum, lines, i);
      ast.azioni.push(azione.nodo);
      ast.nodi.push(azione.nodo);
      i = azione.nextLine;
      continue;
    }

    // Derivato: soggetto := espressione [→ [salti]]
    const derivatoMatch = trimmed.match(/^([\w.*]+)\s*:=\s*(.+)$/);
    if (derivatoMatch) {
      const derivato = parseDerivato(derivatoMatch[1], derivatoMatch[2], lineNum, lines, i);
      ast.derivati.push(derivato.nodo);
      ast.nodi.push(derivato.nodo);
      i = derivato.nextLine;
      continue;
    }

    // Salto: soggetto → [dest1, dest2]
    const saltoMatch = trimmed.match(/^([\w.*]+)\s*[→\->]+\s*\[(.+)\]$/);
    if (saltoMatch) {
      const destinazioni = saltoMatch[2].split(',').map(s => s.trim()).filter(Boolean);
      const salto: PtiSalto = {
        tipo: 'salto',
        sorgente: saltoMatch[1],
        destinazioni,
        linea: lineNum,
      };
      ast.salti.push(salto);
      ast.nodi.push(salto);
      i++;
      continue;
    }

    // Fatto: soggetto.attributo = valore
    const fattoMatch = trimmed.match(/^([\w.*]+)\s*=\s*(.+)$/);
    if (fattoMatch) {
      const fatto: PtiFatto = {
        tipo: 'fatto',
        id: fattoMatch[1],
        valore: fattoMatch[2].trim(),
        linea: lineNum,
      };
      ast.fatti.push(fatto);
      ast.nodi.push(fatto);
      i++;
      continue;
    }

    // Linea non riconosciuta
    ast.errori.push({ linea: lineNum, messaggio: `Sintassi non riconosciuta: ${trimmed}` });
    i++;
  }

  return ast;
}

// ==================== SUB-PARSERS ====================

function parseDerivato(
  id: string,
  expr: string,
  lineNum: number,
  lines: string[],
  lineIdx: number,
): { nodo: PtiDerivato; nextLine: number } {
  // Check for inline salti: espressione → [dest1, dest2]
  let espressione = expr;
  let salti: string[] = [];

  const saltoMatch = expr.match(/^(.+?)\s*[→\->]+\s*\[(.+)\]$/);
  if (saltoMatch) {
    espressione = saltoMatch[1].trim();
    salti = saltoMatch[2].split(',').map(s => s.trim()).filter(Boolean);
  }

  // Parse indented assert: lines
  const asserts: string[] = [];
  let nextLine = lineIdx + 1;
  while (nextLine < lines.length) {
    const next = lines[nextLine];
    if (!next.match(/^\s+/)) break; // non indentato → fine blocco
    const nextTrimmed = next.trim();
    if (!nextTrimmed || nextTrimmed.startsWith('#')) {
      nextLine++;
      continue;
    }
    const assertMatch = nextTrimmed.match(/^assert:\s*(.+)$/);
    if (assertMatch) {
      asserts.push(assertMatch[1].trim());
      nextLine++;
    } else {
      break; // indentato ma non assert → fine blocco
    }
  }

  return {
    nodo: {
      tipo: 'derivato', id, espressione, salti, assert: asserts, linea: lineNum,
    },
    nextLine,
  };
}

function parseAzione(
  id: string,
  paramsRaw: string,
  lineNum: number,
  lines: string[],
  lineIdx: number,
): { nodo: PtiAzione; nextLine: number } {
  const params = paramsRaw.split(',').map(s => s.trim()).filter(Boolean);
  const corpo: string[] = [];
  const salti: string[] = [];
  let ritorno = '';

  let nextLine = lineIdx + 1;
  while (nextLine < lines.length) {
    const next = lines[nextLine];
    if (!next.match(/^\s+/)) break; // non indentato → fine blocco
    const nextTrimmed = next.trim();
    if (!nextTrimmed || nextTrimmed.startsWith('#')) {
      nextLine++;
      continue;
    }

    // Salti inline: → [dest1, dest2]
    const saltoMatch = nextTrimmed.match(/^[→\->]+\s*\[(.+)\]$/);
    if (saltoMatch) {
      salti.push(...saltoMatch[1].split(',').map(s => s.trim()).filter(Boolean));
      nextLine++;
      continue;
    }

    // Return: < espressione
    const returnMatch = nextTrimmed.match(/^<\s*(.+)$/);
    if (returnMatch) {
      ritorno = returnMatch[1].trim();
      nextLine++;
      continue;
    }

    corpo.push(nextTrimmed);
    nextLine++;
  }

  return {
    nodo: {
      tipo: 'azione', id, params, corpo, salti, ritorno, linea: lineNum,
    },
    nextLine,
  };
}

// ==================== FORMATTER ====================

/**
 * Serializza un AST PTI back in formato .pti
 */
export function formatPti(ast: PtiAst): string {
  const lines: string[] = [];

  if (ast.fatti.length > 0) {
    lines.push('# Fatti');
    for (const f of ast.fatti) {
      lines.push(`${f.id} = ${f.valore}`);
    }
    lines.push('');
  }

  if (ast.derivati.length > 0) {
    lines.push('# Derivati');
    for (const d of ast.derivati) {
      let line = `${d.id} := ${d.espressione}`;
      if (d.salti.length > 0) {
        line += ` → [${d.salti.join(', ')}]`;
      }
      lines.push(line);
      for (const a of d.assert) {
        lines.push(`    assert: ${a}`);
      }
    }
    lines.push('');
  }

  if (ast.salti.length > 0) {
    lines.push('# Salti');
    for (const s of ast.salti) {
      lines.push(`${s.sorgente} → [${s.destinazioni.join(', ')}]`);
    }
    lines.push('');
  }

  if (ast.azioni.length > 0) {
    lines.push('# Azioni');
    for (const a of ast.azioni) {
      lines.push(`${a.id}(${a.params.join(', ')}):`);
      for (const c of a.corpo) {
        lines.push(`    ${c}`);
      }
      if (a.salti.length > 0) {
        lines.push(`    → [${a.salti.join(', ')}]`);
      }
      if (a.ritorno) {
        lines.push(`    < ${a.ritorno}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n').trimEnd() + '\n';
}

// ==================== ESTRAZIONE TOPOLOGIA ====================

/**
 * Estrai la topologia dal AST: nodi e connessioni.
 * Usabile da LLM per capire la struttura senza leggere il codice.
 */
export function estraiTopologia(ast: PtiAst): {
  nodi: Array<{ id: string; tipo: string }>;
  connessioni: Array<{ da: string; a: string; tipo: string }>;
} {
  const nodi: Array<{ id: string; tipo: string }> = [];
  const connessioni: Array<{ da: string; a: string; tipo: string }> = [];

  for (const f of ast.fatti) {
    nodi.push({ id: f.id, tipo: 'fatto' });
  }

  for (const d of ast.derivati) {
    nodi.push({ id: d.id, tipo: 'derivato' });
    // Estrai sorgenti dall'espressione (pattern: id.* | .attr)
    const refs = estraiRiferimenti(d.espressione);
    for (const ref of refs) {
      connessioni.push({ da: ref, a: d.id, tipo: 'dipendenza' });
    }
    for (const s of d.salti) {
      connessioni.push({ da: d.id, a: s, tipo: 'salto' });
    }
  }

  for (const s of ast.salti) {
    for (const dest of s.destinazioni) {
      connessioni.push({ da: s.sorgente, a: dest, tipo: 'salto' });
    }
  }

  for (const a of ast.azioni) {
    nodi.push({ id: a.id, tipo: 'azione' });
    for (const s of a.salti) {
      connessioni.push({ da: a.id, a: s, tipo: 'salto' });
    }
  }

  return { nodi, connessioni };
}

/**
 * Estrai riferimenti a nodi da un'espressione PTI.
 * Pattern: identificatori con punto (tavolo.*, tavoli.liberi, etc.)
 */
function estraiRiferimenti(expr: string): string[] {
  const refs: string[] = [];
  // Match: word.word patterns (possibly with *)
  const matches = expr.matchAll(/\b([\w]+(?:\.[\w*]+)+)\b/g);
  for (const m of matches) {
    refs.push(m[1]);
  }
  return refs;
}
