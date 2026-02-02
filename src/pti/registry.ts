/**
 * PTI Registry — Genera .pti strutturale per ogni progetto
 *
 * Interroga SurrealDB e genera un registry .pti che descrive
 * lo stato corrente del progetto: topic, file modificati,
 * decisioni, branch, sessioni attive.
 *
 * Il registry viene usato dal context-builder per dare
 * agli agenti una mappa strutturale del progetto.
 *
 * PTI topology:
 *   progetto.nome = "alessio-os"               → Fatto
 *   progetto.sessioni := count(chat_log)        → Derivato
 *   topic.X := extract(chat_log)                → Derivato
 *   topic.X → [file.Y, decisione.Z]            → Salti
 */

import { surqlQuery } from './surreal-bridge.js';
import { formatPti, type PtiAst, type PtiFatto, type PtiDerivato, type PtiSalto } from './parser.js';
import { writeFileSync, mkdirSync, readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';

// ==================== TIPI ====================

export interface ProjectRegistry {
  project: string;
  generatedAt: string;
  ast: PtiAst;
  ptiSource: string;
}

interface ChatSummary {
  session_id: string;
  msg_count: number;
  last_msg: string | null;
  git_branch?: string;
}

interface TopicCluster {
  name: string;
  keywords: string[];
  sessions: string[];
  fileRefs: string[];
}

// ==================== QUERY SURREAL ====================

async function getProjectSessions(project: string): Promise<ChatSummary[]> {
  const res = await surqlQuery(`
    SELECT session_id, count() AS msg_count
    FROM chat_log
    WHERE project = $project
    GROUP BY session_id
  `, { project });

  const grouped = Array.isArray(res[0]?.result) ? res[0].result as Array<Record<string, unknown>> : [];

  const enriched: ChatSummary[] = [];
  for (const s of grouped) {
    const dateRes = await surqlQuery(`
      SELECT created_at, git_branch FROM chat_log
      WHERE project = $project AND session_id = $sid
      ORDER BY created_at DESC LIMIT 1
    `, { project, sid: s.session_id });

    const last = (dateRes[0]?.result as Array<Record<string, unknown>>)?.[0];
    enriched.push({
      session_id: s.session_id as string,
      msg_count: s.msg_count as number,
      last_msg: (last?.created_at as string) ?? null,
      git_branch: (last?.git_branch as string) ?? undefined,
    });
  }

  return enriched.sort((a, b) => {
    const ta = a.last_msg ? new Date(a.last_msg).getTime() : 0;
    const tb = b.last_msg ? new Date(b.last_msg).getTime() : 0;
    return tb - ta;
  });
}

async function getProjectTopics(project: string): Promise<TopicCluster[]> {
  // Estrai le ultime 100 chat per analisi topic
  const res = await surqlQuery(`
    SELECT content, session_id, created_at FROM chat_log
    WHERE project = $project AND role = 'user'
    ORDER BY created_at DESC LIMIT 100
  `, { project });

  const messages = Array.isArray(res[0]?.result)
    ? res[0].result as Array<{ content: string; session_id: string }>
    : [];

  // Clustering semplice basato su keyword extraction
  const topicMap = new Map<string, { sessions: Set<string>; count: number; fileRefs: Set<string> }>();

  for (const msg of messages) {
    const keywords = extractTopicKeywords(msg.content);
    const files = extractFileRefs(msg.content);

    for (const kw of keywords) {
      const existing = topicMap.get(kw) ?? { sessions: new Set(), count: 0, fileRefs: new Set() };
      existing.sessions.add(msg.session_id);
      existing.count++;
      for (const f of files) existing.fileRefs.add(f);
      topicMap.set(kw, existing);
    }
  }

  // Top topics per frequenza (almeno 2 menzioni)
  return Array.from(topicMap.entries())
    .filter(([, v]) => v.count >= 2)
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 15)
    .map(([name, v]) => ({
      name,
      keywords: [name],
      sessions: Array.from(v.sessions),
      fileRefs: Array.from(v.fileRefs),
    }));
}

async function getProjectTasks(project: string): Promise<Array<{ task: string; status: string }>> {
  const res = await surqlQuery(`
    SELECT task, status, created_at FROM task_queue
    WHERE project = $project
    ORDER BY created_at DESC LIMIT 20
  `, { project });

  return Array.isArray(res[0]?.result)
    ? res[0].result as Array<{ task: string; status: string }>
    : [];
}

async function getProjectExperiences(project: string): Promise<number> {
  try {
    const res = await surqlQuery(`
      SELECT count() AS total FROM experience
      WHERE tags CONTAINS $project
      GROUP ALL
    `, { project });
    return (res[0]?.result as Array<{ total: number }>)?.[0]?.total ?? 0;
  } catch { return 0; }
}

// ==================== KEYWORD EXTRACTION ====================

const STOP_WORDS = new Set([
  'come', 'cosa', 'dove', 'quando', 'perché', 'questo', 'quello', 'sono',
  'fare', 'fatto', 'della', 'delle', 'degli', 'nella', 'nelle', 'negli',
  'with', 'from', 'that', 'this', 'have', 'been', 'will', 'would', 'could',
  'should', 'about', 'their', 'there', 'which', 'these', 'those', 'than',
  'also', 'just', 'more', 'some', 'very', 'into', 'only', 'other', 'then',
  'puoi', 'fammi', 'voglio', 'posso', 'devi', 'dopo', 'prima', 'ancora',
  'adesso', 'tutto', 'tutti', 'ogni', 'però', 'anche', 'bene', 'basta',
]);

function extractTopicKeywords(text: string): string[] {
  const words = text.toLowerCase()
    .replace(/[^a-z0-9àèéìòù\s-_.]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOP_WORDS.has(w));

  // Dedup e prendi i primi 3 keyword significativi
  return [...new Set(words)].slice(0, 3);
}

function extractFileRefs(text: string): string[] {
  const refs: string[] = [];
  // Match: percorsi file (src/..., test/..., *.ts, *.js, etc.)
  const fileMatches = text.matchAll(/\b((?:src|test|lib|dist|schema)\/[\w/.-]+\.\w+)\b/g);
  for (const m of fileMatches) refs.push(m[1]);
  // Match: nomi file standalone
  const nameMatches = text.matchAll(/\b([\w-]+\.(?:ts|js|tsx|jsx|py|json|surql|pti))\b/g);
  for (const m of nameMatches) refs.push(m[1]);
  return [...new Set(refs)];
}

// ==================== GENERA .PTI ====================

export async function generateRegistry(project: string): Promise<ProjectRegistry> {
  const [sessions, topics, tasks, expCount] = await Promise.all([
    getProjectSessions(project),
    getProjectTopics(project),
    getProjectTasks(project),
    getProjectExperiences(project),
  ]);

  const fatti: PtiFatto[] = [];
  const derivati: PtiDerivato[] = [];
  const salti: PtiSalto[] = [];
  let lineNum = 1;

  // --- Fatti: metadata progetto ---
  fatti.push({ tipo: 'fatto', id: 'progetto.nome', valore: `"${project}"`, linea: lineNum++ });
  fatti.push({ tipo: 'fatto', id: 'progetto.sessioni', valore: String(sessions.length), linea: lineNum++ });
  fatti.push({ tipo: 'fatto', id: 'progetto.esperienze', valore: String(expCount), linea: lineNum++ });
  fatti.push({ tipo: 'fatto', id: 'progetto.generato', valore: `"${new Date().toISOString()}"`, linea: lineNum++ });

  // Branch attivi
  const branches = [...new Set(sessions.map(s => s.git_branch).filter(Boolean))];
  if (branches.length > 0) {
    fatti.push({ tipo: 'fatto', id: 'progetto.branch', valore: `[${branches.map(b => `"${b}"`).join(', ')}]`, linea: lineNum++ });
  }

  // Sessione più recente
  if (sessions.length > 0) {
    const latest = sessions[0];
    fatti.push({ tipo: 'fatto', id: 'sessione.ultima', valore: `"${latest.session_id}"`, linea: lineNum++ });
    fatti.push({ tipo: 'fatto', id: 'sessione.ultima.messaggi', valore: String(latest.msg_count), linea: lineNum++ });
  }

  // --- Derivati: topic cluster ---
  for (const topic of topics) {
    const topicId = `topic.${sanitizeId(topic.name)}`;
    const saltiTopic: string[] = [];

    // Connetti topic → file refs
    for (const f of topic.fileRefs) {
      const fileId = `file.${sanitizeId(f)}`;
      saltiTopic.push(fileId);
      // Registra il file come fatto se ha riferimenti
      if (!fatti.some(fa => fa.id === fileId)) {
        fatti.push({ tipo: 'fatto', id: fileId, valore: `"${f}"`, linea: lineNum++ });
      }
    }

    derivati.push({
      tipo: 'derivato',
      id: topicId,
      espressione: `${topic.sessions.length} sessioni, ${topic.keywords.join('+')}`,
      salti: saltiTopic,
      assert: [],
      linea: lineNum++,
    });
  }

  // --- Derivati: task pendenti ---
  const pendingTasks = tasks.filter(t => t.status === 'pending');
  if (pendingTasks.length > 0) {
    derivati.push({
      tipo: 'derivato',
      id: 'tasks.pending',
      espressione: `${pendingTasks.length} task in coda`,
      salti: [],
      assert: [],
      linea: lineNum++,
    });
  }

  const doneTasks = tasks.filter(t => t.status === 'done');
  if (doneTasks.length > 0) {
    fatti.push({ tipo: 'fatto', id: 'tasks.completati', valore: String(doneTasks.length), linea: lineNum++ });
  }

  // --- Salti: topic → topic (co-occurrence in stessa sessione) ---
  for (let i = 0; i < topics.length; i++) {
    for (let j = i + 1; j < topics.length; j++) {
      const shared = topics[i].sessions.filter(s => topics[j].sessions.includes(s));
      if (shared.length >= 2) {
        salti.push({
          tipo: 'salto',
          sorgente: `topic.${sanitizeId(topics[i].name)}`,
          destinazioni: [`topic.${sanitizeId(topics[j].name)}`],
          linea: lineNum++,
        });
      }
    }
  }

  const ast: PtiAst = {
    nodi: [...fatti, ...derivati, ...salti],
    fatti,
    derivati,
    salti,
    azioni: [],
    errori: [],
  };

  const ptiSource = formatPti(ast);

  return {
    project,
    generatedAt: new Date().toISOString(),
    ast,
    ptiSource,
  };
}

function sanitizeId(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_.-]/g, '_')
    .replace(/__+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
}

// ==================== CODEBASE ANALYSIS ====================

interface ModuleInfo {
  file: string;
  lines: number;
  imports: string[];      // relative import paths
  exports: string[];      // exported names
  level: string;          // atomo|molecola|cellula|tessuto|organo
}

function collectTsFiles(dir: string, rootDir: string): string[] {
  const results: string[] = [];
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (entry.startsWith('.') || entry === 'node_modules' || entry === 'dist') continue;
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        results.push(...collectTsFiles(full, rootDir));
      } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
        results.push(relative(rootDir, full));
      }
    }
  } catch { /* skip unreadable dirs */ }
  return results;
}

function analyzeModule(rootDir: string, relPath: string): ModuleInfo {
  const content = readFileSync(join(rootDir, relPath), 'utf-8');
  const lines = content.split('\n').length;

  // Extract imports (relative only)
  const imports: string[] = [];
  const importRe = /from\s+['"](\.[^'"]+)['"]/g;
  let m;
  while ((m = importRe.exec(content)) !== null) {
    imports.push(m[1].replace(/\.js$/, ''));
  }

  // Extract exports
  const exports: string[] = [];
  const exportRe = /export\s+(?:async\s+)?(?:function|class|const|let|type|interface|enum)\s+(\w+)/g;
  while ((m = exportRe.exec(content)) !== null) {
    exports.push(m[1]);
  }

  // Classify level by dependency count
  const depCount = imports.length;
  let level: string;
  if (depCount === 0) level = 'atomo';
  else if (depCount <= 2) level = 'molecola';
  else if (depCount <= 4) level = 'cellula';
  else if (depCount <= 6) level = 'tessuto';
  else level = 'organo';

  return { file: relPath, lines, imports, exports, level };
}

export function analyzeCodebase(rootDir: string): ModuleInfo[] {
  const files = collectTsFiles(join(rootDir, 'src'), rootDir);
  return files.map(f => analyzeModule(rootDir, f)).sort((a, b) => b.lines - a.lines);
}

// ==================== MANUAL SECTION PRESERVATION ====================

const MANUAL_START = '# === MANUAL START ===';
const MANUAL_END = '# === MANUAL END ===';

function extractManualSection(existingPti: string): string | null {
  const startIdx = existingPti.indexOf(MANUAL_START);
  const endIdx = existingPti.indexOf(MANUAL_END);
  if (startIdx === -1 || endIdx === -1) return null;
  return existingPti.slice(startIdx, endIdx + MANUAL_END.length);
}

// ==================== UNIFIED .PTI GENERATION ====================

export async function generateUnifiedPti(project: string, rootDir: string, existingPtiPath?: string): Promise<string> {
  // 1. DB registry
  const registry = await generateRegistry(project);

  // 2. Codebase analysis
  const modules = analyzeCodebase(rootDir);

  // 3. Build codebase section
  const totalLines = modules.reduce((s, m) => s + m.lines, 0);
  const byLevel = new Map<string, number>();
  for (const m of modules) byLevel.set(m.level, (byLevel.get(m.level) ?? 0) + 1);

  let codeSection = '\n# ==================== CODEBASE ====================\n\n';
  codeSection += `# Moduli: ${modules.length} | Righe totali: ${totalLines}\n`;
  codeSection += `# Livelli: ${Array.from(byLevel.entries()).map(([k, v]) => `${k}(${v})`).join(', ')}\n\n`;

  for (const mod of modules) {
    const id = sanitizeId(mod.file.replace(/\//g, '.').replace(/\.ts$/, ''));
    codeSection += `modulo.${id} = "${mod.file}" # ${mod.lines} righe, ${mod.level}\n`;
    if (mod.exports.length > 0) {
      codeSection += `modulo.${id}.esporta = [${mod.exports.slice(0, 5).map(e => `"${e}"`).join(', ')}]\n`;
    }
  }

  // Dependency graph
  codeSection += '\n# --- Dipendenze (salti) ---\n';
  for (const mod of modules) {
    for (const imp of mod.imports) {
      const targetFile = modules.find(m =>
        m.file.endsWith(imp.replace(/^\.\//, '') + '.ts') ||
        m.file.endsWith(imp + '.ts')
      );
      if (targetFile) {
        const fromId = sanitizeId(mod.file.replace(/\//g, '.').replace(/\.ts$/, ''));
        const toId = sanitizeId(targetFile.file.replace(/\//g, '.').replace(/\.ts$/, ''));
        codeSection += `modulo.${fromId} → modulo.${toId}\n`;
      }
    }
  }

  // 4. Preserve manual section
  let manualSection = '';
  if (existingPtiPath && existsSync(existingPtiPath)) {
    const existing = readFileSync(existingPtiPath, 'utf-8');
    const manual = extractManualSection(existing);
    if (manual) {
      manualSection = '\n\n' + manual + '\n';
    }
  }
  if (!manualSection) {
    manualSection = `\n\n${MANUAL_START}\n\n# Assert architetturali\n# assert: dashboard.server.righe < 1200\n# assert: ogni_modulo.dipendenze.length < 6\n\n# Annotazioni\n# (aggiungi qui vincoli e note architetturali)\n\n${MANUAL_END}\n`;
  }

  // 5. Compose
  return `# ${project}.pti — Registry strutturale\n# Generato: ${new Date().toISOString()}\n\n` +
    '# ==================== DB REGISTRY ====================\n\n' +
    registry.ptiSource +
    codeSection +
    manualSection;
}

// ==================== SALVA SU DISCO ====================

const REGISTRY_DIR = join(process.env.HOME ?? '', '.alessio-os', 'registries');

export async function saveRegistry(project: string): Promise<string> {
  const registry = await generateRegistry(project);
  mkdirSync(REGISTRY_DIR, { recursive: true });
  const filePath = join(REGISTRY_DIR, `${project}.pti`);
  writeFileSync(filePath, registry.ptiSource, 'utf-8');
  return filePath;
}

export async function saveUnifiedPti(project: string, rootDir: string): Promise<string> {
  const outputPath = join(rootDir, `${project}.pti`);
  const ptiContent = await generateUnifiedPti(project, rootDir, outputPath);
  writeFileSync(outputPath, ptiContent, 'utf-8');
  return outputPath;
}

// ==================== CLI ====================

if (process.argv[1]?.includes('registry')) {
  const project = process.argv[2] ?? 'alessio-os';
  const rootDir = process.argv[3] ?? process.cwd();
  const unified = process.argv.includes('--unified');

  if (unified) {
    console.log(`[registry] Generando .pti unificato per "${project}" (root: ${rootDir})...`);
    saveUnifiedPti(project, rootDir)
      .then(path => console.log(`[registry] Salvato: ${path}`))
      .catch(console.error);
  } else {
    console.log(`[registry] Generando .pti per "${project}"...`);
    generateRegistry(project)
      .then(reg => {
        console.log(reg.ptiSource);
        console.log(`\n--- ${reg.ast.fatti.length} fatti, ${reg.ast.derivati.length} derivati, ${reg.ast.salti.length} salti ---`);
        return saveRegistry(project);
      })
      .then(path => console.log(`[registry] Salvato: ${path}`))
      .catch(console.error);
  }
}
