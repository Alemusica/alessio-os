/**
 * Context Builder — Project-Scoped Context Injection
 *
 * Prima di ogni chiamata a Claude, costruisce un system prompt arricchito
 * con memoria del progetto, esperienze, sessione corrente, knowledge base.
 *
 * Tutto filtrato per project → l'agente vede SOLO il contesto rilevante.
 */

import { surqlQuery } from '../pti/surreal-bridge.js';
import { resolveParadigm } from '../pti/paradigm-registry.js';
import { getRecentActions } from './action-logger.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

// ==================== TIPI ====================

export type AgentRole = 'coder' | 'tester' | 'reviewer' | 'researcher' | 'auditor';

export interface ContextRequest {
  project: string;
  role: AgentRole;
  task: string;
  tags?: string[];           // tag extra per filtrare experiences/knowledge
  sessionId?: string;
  agentDefId?: string;       // per risoluzione paradigma agent-level
  customIdentity?: string;   // override di AGENT_IDENTITIES[role]
}

export interface BuiltContext {
  systemPrompt: string;      // prompt completo assemblato
  promptFile: string;        // path al file temp (per --system-prompt)
  sections: {
    projectMemory: number;   // quanti messaggi inclusi
    experiences: number;     // quante esperienze incluse
    knowledge: number;       // quanti knowledge items
    hasSessionCtx: boolean;
  };
}

// ==================== PROJECT → TAGS MAP ====================
// Derivato dall'analisi delle 7000+ conversazioni

const PROJECT_TAGS: Record<string, string[]> = {
  'trovatore':               ['scraping', 'crawler', 'data-extraction', 'python', 'automation'],
  'social-cli-mcp':          ['mcp', 'cli', 'social-media', 'api', 'typescript'],
  'ui-canvas-mcp':           ['ui', 'canvas', 'mcp', 'frontend', 'design'],
  'gestionale-nautica-main': ['gestionale', 'react', 'supabase', 'crud', 'fullstack'],
  'ricchexxa-main':          ['web', 'design', 'frontend', 'swiss-typography'],
  'dag-consulting-2-0':      ['consulting', 'web', 'vanilla', 'html', 'css'],
  'nico':                    ['ml', 'causal-discovery', 'python', 'research', 'ai'],
  'looperpedal':             ['audio', 'music', 'dsp', 'realtime'],
  'alessio-os':              ['orchestrator', 'multi-agent', 'pti', 'surrealdb', 'system'],
  'abletonscripts':          ['ableton', 'midi', 'music', 'automation', 'python'],
  'innesti-revamp-draft':    ['react', 'vite', 'typescript', 'portfolio'],
  'xyl-excel':               ['excel', 'data', 'automation', 'python'],
  'phonon-ui':               ['ui-framework', 'typescript', 'design-system'],
};

// ==================== AGENT IDENTITY ====================

const AGENT_IDENTITIES: Record<AgentRole, string> = {
  coder: `Sei un developer esperto. Scrivi codice funzionante, non spiegare.
Rispondi con codice pronto all'uso. Se devi modificare file esistenti, mostra il diff.
Preferisci soluzioni semplici e dirette. No over-engineering.`,

  researcher: `Sei un ricercatore tecnico. Cerca informazioni, analizza, sintetizza.
Presenta risultati come bullet points actionable.
Se trovi paper o risorse, cita la fonte.`,

  reviewer: `Sei un code reviewer esperto. Trova bug, vulnerabilità, problemi di design.
Sii specifico: file, linea, problema, fix suggerito.
Prioritizza: security > correctness > performance > style.`,

  tester: `Sei un QA engineer. Crea test che verificano il task completato.
Scrivi test eseguibili. Copri edge cases.
Se trovi bug durante il testing, segnala con severity.`,

  auditor: `Sei un auditor di sistema. Controlla architettura, sicurezza, performance.
Produci report strutturato: findings, severity, raccomandazioni.
Focus su OWASP top 10, dependency vulnerabilities, data leaks.`,
};

// ==================== USER PROFILE (costante) ====================

const USER_PROFILE = `## User Profile
L'utente è Alessio — developer autodidatta, musicista (perfect pitch), SAE Institute Milano.
- Preferisce: azione diretta, codice funzionante, niente spiegazioni lunghe
- Lingua: italiano per comunicazione, inglese per codice e variabili
- Design: Swiss Typography, Golden Ratio (φ = 1.618), Helvetica Neue / DM Sans
- Workflow: idea → prototipo veloce → iterate → fix bugs → deploy
- Pain point: ripetere contesto tra sessioni, perdere il filo tra progetti
- Usa voice input, drag&drop, screenshot per comunicare
- Quando dice "ancora" o "fixa" vuole azione immediata, non spiegazione`;

// ==================== CONTEXT BUILDER ====================

export async function buildContext(req: ContextRequest): Promise<BuiltContext> {
  const sections: string[] = [];
  let projectMemoryCount = 0;
  let experienceCount = 0;
  let knowledgeCount = 0;
  let hasSessionCtx = false;

  // --- 0. Paradigm Resolution (dischetto attivo: agent → project → default PTI) ---
  const paradigm = await resolveParadigm(req.project, req.agentDefId);
  sections.push(`## Paradigma: ${paradigm.name} v${paradigm.version}\n${paradigm.compact}`);

  // --- 1. Agent Identity ---
  const identity = req.customIdentity ?? AGENT_IDENTITIES[req.role];
  sections.push(`## Ruolo\n${identity}`);

  // --- 2. User Profile ---
  sections.push(USER_PROFILE);

  // --- 3. Project Memory (ultime N chat del progetto) ---
  try {
    const chatRes = await surqlQuery(`
      SELECT role, content, created_at FROM chat_log
      WHERE project = $project
      ORDER BY created_at DESC LIMIT 30
    `, { project: req.project });

    const messages = chatRes[0]?.result;
    if (Array.isArray(messages) && messages.length > 0) {
      // Inverti per ordine cronologico
      const sorted = (messages as Array<{ role: string; content: string; created_at: string }>).reverse();
      projectMemoryCount = sorted.length;

      const chatLines = sorted.map(m => {
        const prefix = m.role === 'user' ? 'USER' : 'ASSISTANT';
        // Tronca messaggi lunghi
        const content = m.content.length > 500 ? m.content.slice(0, 500) + '...' : m.content;
        return `[${prefix}] ${content}`;
      });

      sections.push(`## Conversazione recente del progetto "${req.project}" (${projectMemoryCount} msg)\n${chatLines.join('\n')}`);
    }
  } catch { /* SurrealDB down → procedi senza */ }

  // --- 3b. Action History (azioni recenti del progetto) ---
  try {
    const actions = await getRecentActions(req.project, 15);
    if (actions.length > 0) {
      const actionLines = actions.map(a =>
        `[${a.action_type}] ${a.title}${a.details ? ': ' + a.details.slice(0, 100) : ''}`
      );
      sections.push(`## Azioni recenti del progetto (${actions.length})\n${actionLines.join('\n')}`);
    }
  } catch { /* ok */ }

  // --- 4. Session Context (decisioni, blockers) ---
  try {
    const ctxRes = await surqlQuery(`
      SELECT decisions, blockers, summary, agent_roles, updated_at FROM session_ctx
      WHERE project = $project
      ORDER BY updated_at DESC LIMIT 1
    `, { project: req.project });

    const ctx = (ctxRes[0]?.result as Array<{
      decisions?: string[];
      blockers?: string[];
      summary?: string;
      agent_roles?: string[];
    }>)?.[0];

    if (ctx) {
      hasSessionCtx = true;
      const parts: string[] = [];
      if (ctx.summary) parts.push(`Riassunto: ${ctx.summary}`);
      if (ctx.decisions?.length) parts.push(`Decisioni prese: ${ctx.decisions.join('; ')}`);
      if (ctx.blockers?.length) parts.push(`Blockers: ${ctx.blockers.join('; ')}`);
      if (ctx.agent_roles?.length) parts.push(`Agenti attivi: ${ctx.agent_roles.join(', ')}`);

      if (parts.length > 0) {
        sections.push(`## Contesto sessione\n${parts.join('\n')}`);
      }
    }
  } catch { /* ok */ }

  // --- 5. Esperienze simili (successi passati) ---
  try {
    // Usa i tag del progetto + eventuali tag custom
    const projectTags = PROJECT_TAGS[req.project] ?? [];
    const allTags = [...new Set([...projectTags, ...(req.tags ?? [])])];

    if (allTags.length > 0) {
      const tagList = allTags.map(t => `'${t}'`).join(', ');
      const expRes = await surqlQuery(`
        SELECT problem_type, problem_description, solution_steps, outcome, tags FROM experience
        WHERE outcome = 'success'
        AND tags CONTAINSANY [${tagList}]
        ORDER BY created_at DESC LIMIT 5
      `);

      const exps = expRes[0]?.result;
      if (Array.isArray(exps) && exps.length > 0) {
        experienceCount = exps.length;
        const expLines = (exps as Array<{
          problem_type: string;
          problem_description: string;
          solution_steps: Array<{ action?: string; description?: string }>;
        }>).map((e, i) => {
          const steps = Array.isArray(e.solution_steps)
            ? e.solution_steps.map(s => s.action || s.description || JSON.stringify(s)).join(' → ')
            : '';
          return `${i + 1}. [${e.problem_type}] ${e.problem_description}\n   Soluzione: ${steps}`;
        });

        sections.push(`## Esperienze simili (${experienceCount} successi)\n${expLines.join('\n')}`);
      }
    }
  } catch { /* ok */ }

  // --- 6. Knowledge pertinente (dalla KB) ---
  try {
    // Estrai keyword dal task per cercare nella KB
    const keywords = extractKeywords(req.task, req.project);
    if (keywords.length > 0) {
      // Parametrized query — no SQL injection
      const kwFilter = keywords.map((_, i) => `content CONTAINS $kw${i}`).join(' OR ');
      const kwParams: Record<string, unknown> = {};
      keywords.forEach((k, i) => { kwParams[`kw${i}`] = k; });
      const kbRes = await surqlQuery(`
        SELECT title, content, source FROM knowledge
        WHERE ${kwFilter}
        ORDER BY created_at DESC LIMIT 5
      `, kwParams);

      const docs = kbRes[0]?.result;
      if (Array.isArray(docs) && docs.length > 0) {
        knowledgeCount = docs.length;
        const kbLines = (docs as Array<{ title?: string; content: string; source?: string }>).map((d, i) => {
          const title = d.title || 'untitled';
          const content = d.content.length > 300 ? d.content.slice(0, 300) + '...' : d.content;
          return `${i + 1}. **${title}**${d.source ? ` (${d.source})` : ''}\n   ${content}`;
        });

        sections.push(`## Knowledge base rilevante (${knowledgeCount} docs)\n${kbLines.join('\n')}`);
      }
    }
  } catch { /* ok */ }

  // --- 7. Stack del progetto (se noto) ---
  const projectTags = PROJECT_TAGS[req.project];
  if (projectTags) {
    sections.push(`## Stack progetto\nTecnologie: ${projectTags.join(', ')}`);
  }

  // --- 8. Fonti dati (source awareness) ---
  sections.push(`## Fonti dati
I dati sopra (conversazioni, esperienze, knowledge) provengono da SurrealDB di sistema.
Hai anche accesso a tool MCP — usali SOLO se pertinenti al task:
- **code-catalog**: componenti UI, design system, codice catalogato. NON è SurrealDB.
- **phonon-kb**: knowledge base esterna, paper, algoritmi. NON è SurrealDB.
Se l'utente chiede "vai nel database" o "cerca nel surreal", i dati sono GIÀ inclusi sopra.
Non confondere mai le fonti: cita sempre da dove viene ogni dato.
Rispondi UNA sola volta — mai risposte duplicate o contraddittorie.`);

  // --- 9. Task corrente ---
  sections.push(`## Task corrente\n${req.task}`);

  // --- Assembla system prompt ---
  const systemPrompt = sections.join('\n\n---\n\n');

  // --- Scrivi su file temp ---
  const tmpDir = join(tmpdir(), 'alessio-os-ctx');
  mkdirSync(tmpDir, { recursive: true });
  const promptFile = join(tmpDir, `ctx-${randomUUID().slice(0, 8)}.md`);
  writeFileSync(promptFile, systemPrompt, 'utf-8');

  return {
    systemPrompt,
    promptFile,
    sections: {
      projectMemory: projectMemoryCount,
      experiences: experienceCount,
      knowledge: knowledgeCount,
      hasSessionCtx,
    },
  };
}

// ==================== HELPERS ====================

/** Estrai keyword rilevanti dal task per query sulla KB */
function extractKeywords(task: string, project: string): string[] {
  const words = task.toLowerCase()
    .replace(/[^a-z0-9àèéìòù\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3);

  // Stop words italiane + inglesi comuni
  const stopWords = new Set([
    'come', 'cosa', 'dove', 'quando', 'perché', 'questo', 'quello', 'sono',
    'fare', 'fatto', 'della', 'delle', 'degli', 'nella', 'nelle', 'negli',
    'with', 'from', 'that', 'this', 'have', 'been', 'will', 'would', 'could',
    'should', 'about', 'their', 'there', 'which', 'these', 'those', 'than',
    'also', 'just', 'more', 'some', 'very', 'into', 'only', 'other',
  ]);

  const keywords = words.filter(w => !stopWords.has(w));

  // Aggiungi tag del progetto come keyword extra
  const projectTags = PROJECT_TAGS[project] ?? [];
  return [...new Set([...keywords.slice(0, 5), ...projectTags.slice(0, 3)])];
}

/** Rileva progetto dal cwd o dal contesto */
export function detectProject(cwd: string): string {
  // Estrai nome cartella dal path
  const parts = cwd.split('/').filter(Boolean);
  const folderName = parts[parts.length - 1] ?? 'unknown';

  // Mappa cartelle note → nomi progetto
  if (folderName in PROJECT_TAGS) return folderName;

  // Alias comuni
  const aliases: Record<string, string> = {
    'natale-order-manager-main': 'gestionale-nautica-main',
    'natale-order-manager':      'gestionale-nautica-main',
    'dag-consulting':            'dag-consulting-2-0',
    'innesti':                   'innesti-revamp-draft',
    'code-catalog':              'phonon-ui',
  };

  return aliases[folderName] ?? folderName;
}

/** Lista progetti noti */
export function getKnownProjects(): string[] {
  return Object.keys(PROJECT_TAGS);
}
