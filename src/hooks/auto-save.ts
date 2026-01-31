/**
 * Auto-Save Hook — Claude Code Chat → SurrealDB
 *
 * PTI: ogni messaggio è un fatto che propaga
 *   message.new → [surreal.chat_log, session_ctx.update]
 *
 * Miglioramenti v2:
 *   - Preserva timestamp originale dal JSONL (non time::now())
 *   - Ingestion incrementale: traccia line count per sessione
 *   - source: 'claude-code' per distinguere da chat dashboard
 *   - Estrae tool_use come contesto (nomi tool, non body intero)
 *   - Estrae gitBranch e cwd dal JSONL per arricchire il contesto
 *
 * Uso:
 *   npm run auto-save          # ultimi 1 giorno
 *   npm run auto-save:week     # ultimi 7 giorni
 */

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { surqlQuery } from '../pti/surreal-bridge.js';

const CLAUDE_PROJECTS_DIR = join(process.env.HOME ?? '', '.claude', 'projects');
const STATE_FILE = join(process.env.HOME ?? '', '.claude', '.auto-save-state.json');

// ==================== TIPI ====================

interface JournalEntry {
  type: string;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  gitBranch?: string;
  uuid?: string;
  message?: {
    role: string;
    content: string | ContentBlock[];
  };
}

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;    // tool_use name
  input?: unknown;  // tool_use input
}

interface IngestState {
  sessions: Record<string, number>;  // sessionId → last ingested line count
}

// ==================== TESTO ====================

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (block.type === 'text' && block.text) {
        parts.push(block.text);
      } else if (block.type === 'tool_use' && block.name) {
        // Registra solo il nome del tool, non il body
        parts.push(`[tool: ${block.name}]`);
      }
    }
    return parts.join('\n');
  }
  return '';
}

// ==================== STATE PERSISTENCE ====================

function loadState(): IngestState {
  try {
    if (existsSync(STATE_FILE)) {
      return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch { /* corrupted → reset */ }
  return { sessions: {} };
}

function saveState(state: IngestState): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

// ==================== INGESTION ====================

async function ingestSession(
  filePath: string,
  project: string,
  state: IngestState,
): Promise<number> {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(Boolean);
  const sessionId = filePath.split('/').pop()?.replace('.jsonl', '') ?? 'unknown';

  // Ingestion incrementale: parti da dove avevi lasciato
  const lastCount = state.sessions[sessionId] ?? 0;
  if (lines.length <= lastCount) return 0; // niente di nuovo

  let saved = 0;
  let gitBranch = '';
  let cwd = '';

  for (let i = lastCount; i < lines.length; i++) {
    try {
      const entry: JournalEntry = JSON.parse(lines[i]);

      // Traccia metadata dal primo entry utile
      if (entry.gitBranch) gitBranch = entry.gitBranch;
      if (entry.cwd) cwd = entry.cwd;

      if ((entry.type === 'user' || entry.type === 'assistant') && entry.message) {
        const text = extractText(entry.message.content);
        if (!text || text.length < 5) continue;

        // Usa timestamp originale, fallback a now
        const timestamp = entry.timestamp ?? new Date().toISOString();

        await surqlQuery(`
          CREATE chat_log SET
            session_id = $session_id,
            role = $role,
            content = $content,
            project = $project,
            source = 'claude-code',
            git_branch = $git_branch,
            cwd = $cwd,
            created_at = $created_at
        `, {
          session_id: sessionId,
          role: entry.message.role,
          content: text.slice(0, 10000),
          project,
          git_branch: gitBranch,
          cwd,
          created_at: timestamp,
        } as Record<string, unknown>);

        saved++;
      }
    } catch {
      // Skip linee malformate
    }
  }

  // Aggiorna state
  state.sessions[sessionId] = lines.length;

  return saved;
}

// ==================== DISCOVERY ====================

function findSessions(sinceDays: number): Array<{ path: string; project: string }> {
  const cutoff = Date.now() - sinceDays * 86400000;
  const sessions: Array<{ path: string; project: string }> = [];

  try {
    const projectDirs = readdirSync(CLAUDE_PROJECTS_DIR);
    const PREFIX = '-Users-alessioivoycazzaniga-';
    const SKIP_SEGMENTS = new Set([
      'Desktop', 'Documents', 'Projects', 'DOCUMENTI', 'PERSONALI', 'Web', 'Finnord',
    ]);

    for (const dir of projectDirs) {
      const fullDir = join(CLAUDE_PROJECTS_DIR, dir);
      try {
        if (!statSync(fullDir).isDirectory()) continue;
      } catch { continue; }

      // Estrai nome progetto dal path encoded
      let project = 'home';
      if (dir.startsWith(PREFIX) && dir.length > PREFIX.length) {
        const rest = dir.slice(PREFIX.length);
        const segments = rest.split('-').filter(Boolean);
        const meaningful = segments.filter(s => !SKIP_SEGMENTS.has(s));
        project = meaningful.length > 0 ? meaningful.join('-').toLowerCase() : rest.toLowerCase();
      }

      // Cerca .jsonl recenti
      try {
        const files = readdirSync(fullDir).filter(f => f.endsWith('.jsonl'));
        for (const f of files) {
          const fPath = join(fullDir, f);
          try {
            if (statSync(fPath).mtimeMs > cutoff) {
              sessions.push({ path: fPath, project });
            }
          } catch { continue; }
        }
      } catch { continue; }
    }
  } catch {
    // Directory non esiste
  }

  return sessions;
}

// ==================== MAIN ====================

async function main(): Promise<void> {
  const days = parseInt(process.argv[2] ?? '1', 10);
  console.log(`[auto-save] Cerco sessioni degli ultimi ${days} giorni...`);

  const sessions = findSessions(days);
  console.log(`[auto-save] Trovate ${sessions.length} sessioni recenti`);

  const state = loadState();
  let totalSaved = 0;

  for (const session of sessions) {
    const saved = await ingestSession(session.path, session.project, state);
    if (saved > 0) {
      console.log(`  ${session.project}: +${saved} messaggi`);
      totalSaved += saved;
    }
  }

  saveState(state);
  console.log(`[auto-save] Totale: ${totalSaved} nuovi messaggi salvati in SurrealDB`);
}

main().catch(console.error);
