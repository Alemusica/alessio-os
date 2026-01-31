/**
 * Auto-Save Hook — Chat → SurrealDB
 *
 * PTI: ogni messaggio è un fatto che propaga
 *   message.new → [surreal.chat_log, session_ctx.update, embedding.queue]
 *
 * Installazione come Claude Code hook:
 *   In .claude/settings.json → hooks.postMessage
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { surqlQuery } from '../pti/surreal-bridge.js';

const CLAUDE_PROJECTS_DIR = join(process.env.HOME ?? '', '.claude', 'projects');

interface ChatLine {
  type: string;
  message?: {
    role: string;
    content: string | Array<{ type: string; text?: string }>;
  };
  timestamp?: number;
}

// --- Estrai testo dal content (può essere stringa o array) ---
function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((c: { type: string }) => c.type === 'text')
      .map((c: { text?: string }) => c.text ?? '')
      .join('\n');
  }
  return '';
}

// --- Salva una sessione JSONL in SurrealDB ---
async function ingestSession(filePath: string, project: string): Promise<number> {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(Boolean);

  let saved = 0;
  const sessionId = filePath.split('/').pop()?.replace('.jsonl', '') ?? 'unknown';

  for (const line of lines) {
    try {
      const entry: ChatLine = JSON.parse(line);

      // Claude Code JSONL: type è "user" o "assistant", non "message"
      if ((entry.type === 'user' || entry.type === 'assistant') && entry.message) {
        const text = extractText(entry.message.content);
        if (!text || text.length < 5) continue;  // skip vuoti

        await surqlQuery(`
          CREATE chat_log SET
            session_id = $session_id,
            role = $role,
            content = $content,
            project = $project,
            created_at = time::now()
        `, {
          session_id: sessionId,
          role: entry.message.role,
          content: text.slice(0, 10000),  // cap per sicurezza
          project,
        } as Record<string, unknown>);

        saved++;
      }
    } catch {
      // Skip linee malformate
    }
  }

  return saved;
}

// --- Trova sessioni recenti non ancora ingerite ---
async function findNewSessions(sinceDays = 1): Promise<Array<{ path: string; project: string }>> {
  const cutoff = Date.now() - sinceDays * 86400000;
  const sessions: Array<{ path: string; project: string }> = [];

  try {
    const projectDirs = readdirSync(CLAUDE_PROJECTS_DIR);

    for (const dir of projectDirs) {
      const fullDir = join(CLAUDE_PROJECTS_DIR, dir);
      const stat = statSync(fullDir);
      if (!stat.isDirectory()) continue;

      // Estrai nome progetto dal path encoded
      // Dir format: -Users-alessioivoycazzaniga-projectname or -Users-alessioivoycazzaniga-path-to-project
      // Known prefix is the username, rest is the actual path with - as separator
      const PREFIX = '-Users-alessioivoycazzaniga-';
      let project = 'home';
      if (dir.startsWith(PREFIX) && dir.length > PREFIX.length) {
        const rest = dir.slice(PREFIX.length);
        // Skip common intermediate dirs, get meaningful project name
        const skip = ['Desktop', 'Documents', 'Projects', 'DOCUMENTI', 'PERSONALI', 'Web', 'Finnord'];
        const segments = rest.split('-').filter(Boolean);
        const meaningful = segments.filter(s => !skip.includes(s));
        project = meaningful.length > 0 ? meaningful.join('-').toLowerCase() : rest.toLowerCase();
      }

      // Cerca .jsonl recenti
      const files = readdirSync(fullDir).filter(f => f.endsWith('.jsonl'));
      for (const f of files) {
        const fPath = join(fullDir, f);
        const fStat = statSync(fPath);
        if (fStat.mtimeMs > cutoff) {
          sessions.push({ path: fPath, project });
        }
      }
    }
  } catch {
    // Directory non esiste
  }

  return sessions;
}

// --- MAIN: esegui ingestione ---
async function main(): Promise<void> {
  const days = parseInt(process.argv[2] ?? '1', 10);
  console.log(`[auto-save] Cerco sessioni degli ultimi ${days} giorni...`);

  const sessions = await findNewSessions(days);
  console.log(`[auto-save] Trovate ${sessions.length} sessioni recenti`);

  // Trova sessioni già ingerite per evitare duplicati
  let existingSessionIds = new Set<string>();
  try {
    const res = await surqlQuery('SELECT array::distinct(session_id) AS ids FROM chat_log GROUP ALL');
    const ids = (res[0]?.result as Array<{ ids: string[] }>)?.[0]?.ids ?? [];
    existingSessionIds = new Set(ids);
  } catch { /* skip */ }

  let totalSaved = 0;
  for (const session of sessions) {
    const sessionId = session.path.split('/').pop()?.replace('.jsonl', '') ?? '';
    if (existingSessionIds.has(sessionId)) continue;  // già ingerita

    const saved = await ingestSession(session.path, session.project);
    if (saved > 0) {
      console.log(`  ${session.project}: ${saved} messaggi`);
      totalSaved += saved;
    }
  }

  console.log(`[auto-save] Totale: ${totalSaved} messaggi salvati in SurrealDB`);
}

main().catch(console.error);
