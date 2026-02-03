/**
 * PTIG Generator — Censimento PTI-nativo del codice
 *
 * Analizza file TypeScript con regex e classifica ogni elemento
 * secondo la gerarchia biologica PTI:
 *   DNA = { livello, tipo, membrana, specializzazione }
 *
 * Livelli (dalla profondità dipendenze):
 *   organo(0) → tessuto(1) → cellula(2) → molecola(3) → atomo(4)
 *
 * Tipi (dalla sintassi):
 *   fatto | derivato | azione | organello | membrana | fatto-tipo
 *
 * Membrane (dal pattern):
 *   interno | superficie | transmembrana
 *
 * Specializzazioni:
 *   recettore | enzima | marker | canale
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, relative } from 'path';
import { collectTsFiles } from './registry.js';

// ==================== TIPI ====================

export interface PtigFile {
  version: '1.0';
  project: string;
  generatedAt: string;
  rootDir: string;
  nodi: PtigNodo[];
  connessioni: PtigConnessione[];
  metriche: PtigMetriche;
}

export interface PtigNodo {
  id: string;
  dna: {
    livello: number;
    livelloNome: string;
    tipo: 'fatto' | 'derivato' | 'azione' | 'organello' | 'membrana' | 'fatto-tipo';
    membrana: 'interno' | 'superficie' | 'transmembrana';
    specializzazione?: 'recettore' | 'canale' | 'marker' | 'enzima';
  };
  file: string;
  rigaInizio: number;
  rigaFine: number;
  righe: number;
  valore?: PtigValore;
}

export interface PtigValore {
  params?: Array<{ nome: string; tipo?: string }>;
  ritorno?: string;
  async?: boolean;
  complessita?: number;
  estende?: string;
  implementa?: string[];
  metodi?: string[];
  proprieta?: Array<{ nome: string; tipo?: string; membrana: string }>;
  estendeInterfacce?: string[];
  campi?: Array<{ nome: string; tipo?: string; opzionale: boolean }>;
  definizione?: string;
  imports?: string[];
  exports?: string[];
}

export interface PtigConnessione {
  da: string;
  a: string;
  tipo: 'import' | 'chiama' | 'estende' | 'implementa' | 'salto' | 'dipendenza';
  dettaglio?: string;
}

export interface PtigMetriche {
  rho: number;
  cr: number;
  kappa: number;
  q: number;
  totale_nodi: number;
  per_livello: Record<string, number>;
  per_tipo: Record<string, number>;
  per_membrana: Record<string, number>;
}

// ==================== LIVELLO DA DIPENDENZE ====================

const LIVELLO_MAP: Record<string, { livello: number; nome: string }> = {
  atomo:    { livello: 4, nome: 'atomo' },
  molecola: { livello: 3, nome: 'molecola' },
  cellula:  { livello: 2, nome: 'cellula' },
  tessuto:  { livello: 1, nome: 'tessuto' },
  organo:   { livello: 0, nome: 'organo' },
};

function classifyLevel(depCount: number): { livello: number; nome: string } {
  if (depCount === 0) return LIVELLO_MAP.atomo;
  if (depCount <= 2) return LIVELLO_MAP.molecola;
  if (depCount <= 4) return LIVELLO_MAP.cellula;
  if (depCount <= 6) return LIVELLO_MAP.tessuto;
  return LIVELLO_MAP.organo;
}

// ==================== MEMBRANA ====================

function classifyMembrane(exported: boolean, name: string): 'interno' | 'superficie' | 'transmembrana' {
  if (!exported) return 'interno';
  if (name.startsWith('_')) return 'interno';
  // Functions and class methods are transmembrana (they cross boundaries)
  // Constants and types are superficie (they expose data, not behavior)
  return 'transmembrana';
}

function classifyMembraneFatto(exported: boolean, name: string): 'interno' | 'superficie' | 'transmembrana' {
  if (!exported) return 'interno';
  if (name.startsWith('_')) return 'interno';
  return 'superficie';
}

// ==================== SPECIALIZZAZIONE ====================

function classifySpecialization(
  tipo: string,
  membrana: string,
  hasParams: boolean,
  callCount: number,
  name: string,
): 'recettore' | 'enzima' | 'marker' | 'canale' | undefined {
  if (tipo !== 'azione') return undefined;

  // Recettore: export function with params that propagates (calls others)
  if (membrana === 'transmembrana' && hasParams && callCount > 0) return 'recettore';

  // Enzima: internal function that transforms
  if (membrana === 'interno') return 'enzima';

  // Canale: getter/setter pattern
  if (name.startsWith('get') || name.startsWith('set')) return 'canale';

  // Marker: export function that primarily computes and returns (few calls)
  if (membrana === 'transmembrana' && callCount === 0) return 'marker';

  return undefined;
}

// ==================== COMPLESSITA CICLOMATICA ====================

function computeComplexity(body: string): number {
  let cx = 1; // base
  const patterns = [
    /\bif\s*\(/g,
    /\belse\s+if\s*\(/g,
    /\bfor\s*\(/g,
    /\bwhile\s*\(/g,
    /\bswitch\s*\(/g,
    /\bcase\s+/g,
    /\bcatch\s*\(/g,
    /\?\s*[^:]/g,    // ternary
    /&&/g,
    /\|\|/g,
    /\?\?/g,
  ];
  for (const pat of patterns) {
    const matches = body.match(pat);
    if (matches) cx += matches.length;
  }
  return cx;
}

// ==================== ESTRAI CHIAMATE ====================

function extractCalls(body: string): string[] {
  const calls: string[] = [];
  const callRe = /\b([a-zA-Z_]\w*)\s*\(/g;
  const keywords = new Set([
    'if', 'for', 'while', 'switch', 'catch', 'function', 'return',
    'new', 'typeof', 'instanceof', 'await', 'throw', 'class',
  ]);
  let m;
  while ((m = callRe.exec(body)) !== null) {
    if (!keywords.has(m[1]) && !calls.includes(m[1])) {
      calls.push(m[1]);
    }
  }
  return calls;
}

// ==================== ESTRAI PARAMETRI ====================

function extractParams(paramsStr: string): Array<{ nome: string; tipo?: string }> {
  if (!paramsStr.trim()) return [];
  const params: Array<{ nome: string; tipo?: string }> = [];
  // Handle nested generics by counting angle brackets
  let depth = 0;
  let current = '';
  for (const ch of paramsStr) {
    if (ch === '<' || ch === '(') depth++;
    else if (ch === '>' || ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      params.push(parseParam(current.trim()));
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) params.push(parseParam(current.trim()));
  return params;
}

function parseParam(raw: string): { nome: string; tipo?: string } {
  // Remove default values
  const noDefault = raw.replace(/\s*=\s*.*$/, '');
  const colonIdx = noDefault.indexOf(':');
  if (colonIdx === -1) return { nome: noDefault.replace(/\?$/, '') };
  const nome = noDefault.slice(0, colonIdx).trim().replace(/\?$/, '');
  const tipo = noDefault.slice(colonIdx + 1).trim();
  return { nome, tipo: tipo || undefined };
}

// ==================== TROVA FINE BLOCCO ====================

function findBlockEnd(content: string, startIdx: number): number {
  let depth = 0;
  let foundOpen = false;
  for (let i = startIdx; i < content.length; i++) {
    if (content[i] === '{') { depth++; foundOpen = true; }
    else if (content[i] === '}') {
      depth--;
      if (foundOpen && depth === 0) return i;
    }
  }
  return content.length;
}

function lineAt(content: string, charIdx: number): number {
  let line = 1;
  for (let i = 0; i < charIdx && i < content.length; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}

// ==================== ESTRAZIONE GENERICA (Template Method) ====================

interface ElementConfig {
  regex: RegExp;
  tipo: PtigNodo['dna']['tipo'];
  isFatto: boolean; // classifyMembraneFatto vs classifyMembrane
  build(m: RegExpExecArray, content: string): {
    exported: boolean;
    name: string;
    startLine: number;
    endLine: number;
    body?: string;
    valore: PtigValore;
  } | null;
}

function extractElements(content: string, fileId: string, configs: ElementConfig[]): PtigNodo[] {
  const nodi: PtigNodo[] = [];
  const seen = new Set<string>();

  for (const cfg of configs) {
    cfg.regex.lastIndex = 0;
    let m;
    while ((m = cfg.regex.exec(content)) !== null) {
      const r = cfg.build(m, content);
      if (!r) continue;
      const id = `${fileId}.${r.name}`;
      if (seen.has(id)) continue;
      seen.add(id);

      const membrana = cfg.isFatto
        ? classifyMembraneFatto(r.exported, r.name)
        : classifyMembrane(r.exported, r.name);
      const calls = r.body ? extractCalls(r.body) : [];
      const spec = cfg.tipo === 'azione'
        ? classifySpecialization('azione', membrana, (r.valore.params?.length ?? 0) > 0, calls.length, r.name)
        : undefined;

      nodi.push({
        id,
        dna: { livello: 5, livelloNome: 'elemento', tipo: cfg.tipo, membrana, specializzazione: spec },
        file: '',
        rigaInizio: r.startLine,
        rigaFine: r.endLine,
        righe: r.endLine - r.startLine + 1,
        valore: { ...r.valore, complessita: r.body ? computeComplexity(r.body) : undefined },
      });
    }
  }

  return nodi;
}

// 5 config → 1 engine. Ogni config è pura data, nessuna logica duplicata.
const ELEMENT_CONFIGS: ElementConfig[] = [
  // Regular functions
  {
    regex: /^(export\s+)?(async\s+)?function\s+(\w+)\s*\(([^)]*)\)\s*(?::\s*([^{]+))?\s*\{/gm,
    tipo: 'azione', isFatto: false,
    build(m, content) {
      const blockEnd = findBlockEnd(content, m.index);
      return {
        exported: !!m[1], name: m[3],
        startLine: lineAt(content, m.index), endLine: lineAt(content, blockEnd),
        body: content.slice(m.index, blockEnd),
        valore: { params: extractParams(m[4]), ritorno: m[5]?.trim(), async: !!m[2] || undefined },
      };
    },
  },
  // Arrow functions
  {
    regex: /^(export\s+)?(?:const|let)\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(async\s+)?\(([^)]*)\)\s*(?::\s*([^=>{]+))?\s*=>/gm,
    tipo: 'azione', isFatto: false,
    build(m, content) {
      const afterArrow = content.indexOf('=>', m.index);
      if (afterArrow === -1) return null;
      const nextChar = content.slice(afterArrow + 2).trimStart()[0];
      let endIdx: number;
      if (nextChar === '{') {
        endIdx = findBlockEnd(content, content.indexOf('{', afterArrow));
      } else {
        const lineEnd = content.indexOf('\n', afterArrow);
        endIdx = lineEnd > 0 ? lineEnd : content.length;
      }
      return {
        exported: !!m[1], name: m[2],
        startLine: lineAt(content, m.index), endLine: lineAt(content, endIdx),
        body: content.slice(m.index, endIdx),
        valore: { params: extractParams(m[4]), ritorno: m[5]?.trim(), async: !!m[3] || undefined },
      };
    },
  },
  // Interfaces
  {
    regex: /^(export\s+)?interface\s+(\w+)(?:\s+extends\s+([\w,\s]+))?\s*\{/gm,
    tipo: 'membrana', isFatto: true,
    build(m, content) {
      const blockEnd = findBlockEnd(content, m.index);
      const body = content.slice(m.index, blockEnd + 1);
      const campi: Array<{ nome: string; tipo?: string; opzionale: boolean }> = [];
      const fieldRe = /^\s+(\w+)(\?)?:\s*([^;]+)/gm;
      let fm;
      while ((fm = fieldRe.exec(body)) !== null) {
        campi.push({ nome: fm[1], tipo: fm[3]?.trim(), opzionale: !!fm[2] });
      }
      return {
        exported: !!m[1], name: m[2],
        startLine: lineAt(content, m.index), endLine: lineAt(content, blockEnd),
        valore: { estendeInterfacce: m[3] ? m[3].split(',').map((s: string) => s.trim()) : undefined, campi },
      };
    },
  },
  // Type aliases
  {
    regex: /^(export\s+)?type\s+(\w+)(?:<[^>]*>)?\s*=\s*(.+)/gm,
    tipo: 'fatto-tipo', isFatto: true,
    build(m, content) {
      const sl = lineAt(content, m.index);
      return { exported: !!m[1], name: m[2], startLine: sl, endLine: sl, valore: { definizione: m[3].replace(/;$/, '').trim() } };
    },
  },
  // Constants (non-function)
  {
    regex: /^(export\s+)?const\s+(\w+)\s*(?::\s*([^=]+))?\s*=\s*(?!(?:async\s+)?\()/gm,
    tipo: 'fatto', isFatto: true,
    build(m, content) {
      const lineEnd = content.indexOf('\n', m.index);
      const lineContent = content.slice(m.index, lineEnd > 0 ? lineEnd : undefined);
      if (lineContent.includes('=>') || lineContent.includes('function')) return null;
      const sl = lineAt(content, m.index);
      return { exported: !!m[1], name: m[2], startLine: sl, endLine: sl, valore: { definizione: m[3]?.trim() } };
    },
  },
];

// ==================== ESTRAI CLASSI (nidificato: metodi + proprietà) ====================

function extractClassElements(content: string, fileId: string): PtigNodo[] {
  const nodi: PtigNodo[] = [];
  const classRe = /^(export\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?\s*\{/gm;
  let m;
  while ((m = classRe.exec(content)) !== null) {
    const exported = !!m[1], name = m[2];
    const estende = m[3] || undefined;
    const implementa = m[4] ? m[4].split(',').map(s => s.trim()) : undefined;
    const startLine = lineAt(content, m.index);
    const blockEnd = findBlockEnd(content, m.index);
    const endLine = lineAt(content, blockEnd);
    const classBody = content.slice(m.index, blockEnd + 1);
    const membrana = classifyMembrane(exported, name);
    const metodi: string[] = [];
    const proprieta: Array<{ nome: string; tipo?: string; membrana: string }> = [];

    // Methods
    const methodRe = /^\s*(public|private|protected)?\s*(async\s+)?(\w+)\s*\(([^)]*)\)\s*(?::\s*([^{]+))?\s*\{/gm;
    let mm;
    while ((mm = methodRe.exec(classBody)) !== null) {
      const vis = (mm[1] || 'public') as string;
      const methodName = mm[3];
      if (methodName === 'constructor') continue;
      const methodStart = lineAt(content, m.index) + lineAt(classBody, mm.index) - 1;
      const methodBlockEnd = findBlockEnd(classBody, mm.index);
      const methodEnd = lineAt(content, m.index) + lineAt(classBody, methodBlockEnd) - 1;
      const methodBody = classBody.slice(mm.index, methodBlockEnd);
      const params = extractParams(mm[4]);
      const methodCalls = extractCalls(methodBody);
      const methodMembrana = vis === 'private' || methodName.startsWith('_') ? 'interno' : 'transmembrana';
      const methodId = `${fileId}.${name}.${methodName}`;
      metodi.push(methodId);
      nodi.push({
        id: methodId,
        dna: {
          livello: 6, livelloNome: 'sub-elemento', tipo: 'azione', membrana: methodMembrana,
          specializzazione: classifySpecialization('azione', methodMembrana, params.length > 0, methodCalls.length, methodName),
        },
        file: '', rigaInizio: methodStart, rigaFine: methodEnd, righe: methodEnd - methodStart + 1,
        valore: { params, ritorno: mm[5]?.trim(), async: !!mm[2] || undefined, complessita: computeComplexity(methodBody) },
      });
    }

    // Properties
    const propRe = /^\s*(public|private|protected)?\s*(readonly\s+)?(\w+)\s*[?!]?\s*:\s*([^;=]+)/gm;
    let pm;
    while ((pm = propRe.exec(classBody)) !== null) {
      const propName = pm[3];
      if (['constructor', 'async', 'static', 'get', 'set', 'return'].includes(propName)) continue;
      proprieta.push({
        nome: propName, tipo: pm[4]?.trim(),
        membrana: (pm[1] || 'public') === 'private' || propName.startsWith('_') ? 'interno' : 'superficie',
      });
    }

    nodi.push({
      id: `${fileId}.${name}`,
      dna: { livello: 5, livelloNome: 'elemento', tipo: 'organello', membrana },
      file: '', rigaInizio: startLine, rigaFine: endLine, righe: endLine - startLine + 1,
      valore: { estende, implementa, metodi, proprieta },
    });
  }
  return nodi;
}

// ==================== ESTRAI IMPORT ====================

function extractImports(content: string): Array<{ path: string; names: string[] }> {
  const imports: Array<{ path: string; names: string[] }> = [];
  const importRe = /import\s+(?:\{([^}]+)\}|\*\s+as\s+(\w+)|(\w+))\s+from\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = importRe.exec(content)) !== null) {
    const names = m[1]
      ? m[1].split(',').map(s => s.trim().split(/\s+as\s+/).pop()!).filter(Boolean)
      : m[2] ? [m[2]] : m[3] ? [m[3]] : [];
    imports.push({ path: m[4], names });
  }
  return imports;
}

// ==================== ANALIZZA MODULO SINGOLO ====================

export function analizzaModulo(rootDir: string, relPath: string): PtigNodo[] {
  const content = readFileSync(join(rootDir, relPath), 'utf-8');
  const totalLines = content.split('\n').length;
  const fileId = relPath.replace(/[\\/]/g, '.').replace(/\.ts$/, '');

  // Extract imports for level classification
  const imports = extractImports(content);
  const relImports = imports.filter(i => i.path.startsWith('.'));
  const level = classifyLevel(relImports.length);

  // Extract all exports
  const exportNames: string[] = [];
  const exportRe = /export\s+(?:async\s+)?(?:function|class|const|let|type|interface|enum)\s+(\w+)/g;
  let em;
  while ((em = exportRe.exec(content)) !== null) {
    exportNames.push(em[1]);
  }

  // File-level node
  const fileNode: PtigNodo = {
    id: fileId,
    dna: {
      livello: level.livello,
      livelloNome: level.nome,
      tipo: 'fatto', // file is a structural fact
      membrana: exportNames.length > 0 ? 'superficie' : 'interno',
    },
    file: relPath,
    rigaInizio: 1,
    rigaFine: totalLines,
    righe: totalLines,
    valore: {
      imports: relImports.map(i => i.path.replace(/\.js$/, '')),
      exports: exportNames,
    },
  };

  // Extract internal elements: 1 engine + config, classi separate (nidificazione)
  const elements = extractElements(content, fileId, ELEMENT_CONFIGS);
  const classes = extractClassElements(content, fileId);

  // Set file path on all internal nodes
  const internals = [...elements, ...classes];
  for (const n of internals) {
    n.file = relPath;
  }

  return [fileNode, ...internals];
}

// ==================== CONNESSIONI ====================

function buildConnections(nodi: PtigNodo[], rootDir: string): PtigConnessione[] {
  const connessioni: PtigConnessione[] = [];
  const fileNodes = nodi.filter(n => n.valore?.imports);

  // Map file paths to file IDs
  const pathToId = new Map<string, string>();
  for (const n of fileNodes) {
    const relNoExt = n.file.replace(/\.ts$/, '');
    pathToId.set(relNoExt, n.id);
    // Also map without src/ prefix
    if (relNoExt.startsWith('src/')) {
      pathToId.set(relNoExt.slice(4), n.id);
    }
  }

  for (const node of fileNodes) {
    if (!node.valore?.imports) continue;
    const srcDir = node.file.includes('/') ? node.file.slice(0, node.file.lastIndexOf('/')) : '';

    for (const imp of node.valore.imports) {
      // Resolve relative import
      const resolved = imp.startsWith('./')
        ? join(srcDir, imp).replace(/\\/g, '/')
        : imp.startsWith('../')
          ? join(srcDir, imp).replace(/\\/g, '/')
          : imp;

      const normalised = resolved.replace(/^\.\//, '');
      const targetId = pathToId.get(normalised) ?? pathToId.get(`src/${normalised}`);

      if (targetId) {
        connessioni.push({
          da: node.id,
          a: targetId,
          tipo: 'dipendenza',
        });
      }
    }
  }

  // Class extends connections
  for (const n of nodi) {
    if (n.dna.tipo === 'organello' && n.valore?.estende) {
      const target = nodi.find(t => t.id.endsWith(`.${n.valore!.estende}`));
      if (target) {
        connessioni.push({ da: n.id, a: target.id, tipo: 'estende' });
      }
    }
    if (n.dna.tipo === 'organello' && n.valore?.implementa) {
      for (const impl of n.valore.implementa) {
        const target = nodi.find(t => t.id.endsWith(`.${impl}`));
        if (target) {
          connessioni.push({ da: n.id, a: target.id, tipo: 'implementa' });
        }
      }
    }
  }

  return connessioni;
}

// ==================== METRICHE PTI ====================

function computeMetrics(nodi: PtigNodo[], connessioni: PtigConnessione[]): PtigMetriche {
  const per_livello: Record<string, number> = {};
  const per_tipo: Record<string, number> = {};
  const per_membrana: Record<string, number> = {};

  for (const n of nodi) {
    per_livello[n.dna.livelloNome] = (per_livello[n.dna.livelloNome] ?? 0) + 1;
    per_tipo[n.dna.tipo] = (per_tipo[n.dna.tipo] ?? 0) + 1;
    per_membrana[n.dna.membrana] = (per_membrana[n.dna.membrana] ?? 0) + 1;
  }

  // ρ (rho) — redundancy: approximate by checking function signature similarity
  const azioni = nodi.filter(n => n.dna.tipo === 'azione' && n.valore?.params);
  let duplicatePatterns = 0;
  const signatures = new Set<string>();
  for (const a of azioni) {
    const sig = (a.valore?.params ?? []).map(p => p.tipo ?? '?').join(',') + '→' + (a.valore?.ritorno ?? '?');
    if (signatures.has(sig)) duplicatePatterns++;
    signatures.add(sig);
  }
  const rho = azioni.length > 0 ? duplicatePatterns / azioni.length : 0;

  // CR — compression ratio: nodes with connections / total nodes
  const nodesWithConnections = new Set([
    ...connessioni.map(c => c.da),
    ...connessioni.map(c => c.a),
  ]).size;
  const cr = nodi.length > 0 ? nodesWithConnections / nodi.length : 0;

  // κ (kappa) — channelization: used imports / declared imports
  const fileNodes = nodi.filter(n => n.valore?.imports);
  let declaredImports = 0;
  let usedImports = 0;
  for (const fn of fileNodes) {
    const importCount = fn.valore?.imports?.length ?? 0;
    declaredImports += importCount;
    const actualDeps = connessioni.filter(c => c.da === fn.id && c.tipo === 'dipendenza').length;
    usedImports += actualDeps;
  }
  const kappa = declaredImports > 0 ? usedImports / declaredImports : 1;

  // Q = CR * (1 - ρ) * κ
  const q = cr * (1 - rho) * kappa;

  return {
    rho: Math.round(rho * 1000) / 1000,
    cr: Math.round(cr * 1000) / 1000,
    kappa: Math.round(kappa * 1000) / 1000,
    q: Math.round(q * 1000) / 1000,
    totale_nodi: nodi.length,
    per_livello,
    per_tipo,
    per_membrana,
  };
}

// ==================== GENERA .PTIG ====================

export function generaPtig(project: string, rootDir: string): PtigFile {
  const files = collectTsFiles(join(rootDir, 'src'), rootDir);
  const allNodi: PtigNodo[] = [];

  for (const relPath of files) {
    try {
      const moduleNodi = analizzaModulo(rootDir, relPath);
      allNodi.push(...moduleNodi);
    } catch {
      // Skip unreadable files
    }
  }

  const connessioni = buildConnections(allNodi, rootDir);
  const metriche = computeMetrics(allNodi, connessioni);

  return {
    version: '1.0',
    project,
    generatedAt: new Date().toISOString(),
    rootDir,
    nodi: allNodi,
    connessioni,
    metriche,
  };
}

// ==================== SALVA ====================

export function salvaPtig(project: string, rootDir: string): string {
  const ptig = generaPtig(project, rootDir);
  const outputPath = join(rootDir, `${project}.ptig.json`);
  writeFileSync(outputPath, JSON.stringify(ptig, null, 2), 'utf-8');
  return outputPath;
}

// ==================== CLI ====================

if (process.argv[1]?.includes('ptig-generator')) {
  const project = process.argv[2] ?? 'alessio-os';
  const rootDir = process.argv[3] ?? process.cwd();
  console.log(`[ptig] Generando .ptig per "${project}" (root: ${rootDir})...`);
  const path = salvaPtig(project, rootDir);
  console.log(`[ptig] Salvato: ${path}`);
}
