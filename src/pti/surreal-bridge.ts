/**
 * PTI ↔ SurrealDB Bridge
 *
 * Connette il grafo PTI alla persistenza SurrealDB.
 * Fatti → SurrealDB (persist)
 * SurrealDB → Fatti (hydrate)
 * Delta → SurrealDB event log (time travel)
 */

const SURREAL_URL = 'http://127.0.0.1:8000/sql';
const SURREAL_NS = 'research';
const SURREAL_DB = 'knowledge';
const SURREAL_USER = process.env.SURREAL_USER ?? 'root';
const SURREAL_PASS = process.env.SURREAL_PASS ?? 'root';
const SURREAL_AUTH = Buffer.from(`${SURREAL_USER}:${SURREAL_PASS}`).toString('base64');

export interface SurrealResponse {
  result: unknown[];
  status: string;
  time: string;
}

// --- Escape stringa per SurrealQL ---
function esc(val: unknown): string {
  if (val === null || val === undefined) return 'NONE';
  if (typeof val === 'number') return String(val);
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (Array.isArray(val)) return `[${val.map(esc).join(', ')}]`;
  if (typeof val === 'object') return JSON.stringify(val).replace(/'/g, "\\'");
  const s = String(val);
  // Record IDs (table:id) non vanno quotati
  if (/^[a-z_]+:[a-z0-9]+$/i.test(s)) return s;
  return `'${s.replace(/'/g, "\\'")}'`;
}

// --- Interpola variabili $name nel query ---
function interpolate(query: string, vars?: Record<string, unknown>): string {
  if (!vars) return query;
  let result = query;
  for (const [key, val] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\$${key}\\b`, 'g'), esc(val));
  }
  return result;
}

// --- Query SurrealDB ---
export async function surqlQuery(query: string, vars?: Record<string, unknown>): Promise<SurrealResponse[]> {
  const body = interpolate(query, vars);

  const res = await fetch(SURREAL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
      'Accept': 'application/json',
      'Authorization': `Basic ${SURREAL_AUTH}`,
      'surreal-ns': SURREAL_NS,
      'surreal-db': SURREAL_DB,
    },
    body,
  });

  if (!res.ok) {
    let body = '';
    try { body = await res.text(); } catch { /* network error */ }
    throw new Error(`SurrealDB ${res.status}: ${body}`);
  }
  return res.json() as Promise<SurrealResponse[]>;
}

// --- Agent State ---

export async function upsertAgentState(agentId: string, data: {
  session_id: string;
  project: string;
  role: string;
  status: string;
  current_task?: string;
  findings?: unknown[];
}): Promise<void> {
  await surqlQuery(`
    UPSERT agent_state SET
      agent_id = $agent_id,
      session_id = $session_id,
      project = $project,
      role = $role,
      status = $status,
      current_task = $current_task,
      findings = $findings,
      updated_at = time::now()
    WHERE agent_id = $agent_id AND session_id = $session_id
  `, {
    agent_id: agentId,
    ...data,
    current_task: data.current_task ?? null,
    findings: data.findings ?? [],
  } as Record<string, unknown>);
}

export async function getIdleAgents(project: string): Promise<unknown[]> {
  const res = await surqlQuery(`
    SELECT * FROM agent_state
    WHERE project = $project AND status = 'idle'
    ORDER BY updated_at ASC
  `, { project });
  const result = res[0]?.result;
  return Array.isArray(result) ? result : [];
}

// --- Task Queue ---

export async function createTask(data: {
  task: string;
  project: string;
  priority?: number;
  parent_task?: string;
}): Promise<string> {
  const res = await surqlQuery(`
    CREATE task_queue SET
      task = $task,
      project = $project,
      priority = $priority,
      status = 'pending',
      created_at = time::now()
  `, {
    task: data.task,
    project: data.project,
    priority: data.priority ?? 5,
  } as Record<string, unknown>);

  const result = res[0]?.result as Array<{ id: string }>;
  return result?.[0]?.id ?? '';
}

export async function assignTask(taskId: string, agentId: string): Promise<void> {
  await surqlQuery(`
    UPDATE $task_id SET
      assigned_to = $agent_id,
      status = 'running'
  `, { task_id: taskId, agent_id: agentId } as Record<string, unknown>);
}

export async function completeTask(taskId: string, result: string, delta?: unknown): Promise<void> {
  await surqlQuery(`
    UPDATE $task_id SET
      status = 'done',
      result = $result,
      delta = $delta,
      completed_at = time::now()
  `, { task_id: taskId, result, delta: delta ?? null } as Record<string, unknown>);
}

export async function getReadyTasks(project: string): Promise<unknown[]> {
  const res = await surqlQuery(`
    SELECT * FROM task_queue
    WHERE project = $project AND status = 'pending'
    ORDER BY priority DESC
  `, { project });
  const result = res[0]?.result;
  return Array.isArray(result) ? result : [];
}

// --- Session Context ---

export async function saveSessionContext(data: {
  session_id: string;
  project: string;
  decisions?: string[];
  blockers?: string[];
  summary?: string;
  agent_roles?: string[];
}): Promise<void> {
  await surqlQuery(`
    UPSERT session_ctx SET
      session_id = $session_id,
      project = $project,
      decisions = $decisions,
      blockers = $blockers,
      summary = $summary,
      agent_roles = $agent_roles,
      updated_at = time::now()
    WHERE session_id = $session_id
  `, {
    ...data,
    decisions: data.decisions ?? [],
    blockers: data.blockers ?? [],
    summary: data.summary ?? '',
    agent_roles: data.agent_roles ?? [],
  } as Record<string, unknown>);
}

// --- Session State (derivato completo) ---

export async function getSessionState(sessionId: string): Promise<unknown> {
  const res = await surqlQuery(`fn::session_state($session_id)`, { session_id: sessionId });
  return res[0]?.result;
}

// --- Chat auto-save ---

export async function saveChatMessage(data: {
  session_id: string;
  role: string;
  content: string;
  project: string;
  embedding?: number[];
}): Promise<void> {
  await surqlQuery(`
    CREATE chat_message SET
      session_id = $session_id,
      role = $role,
      content = $content,
      project = $project,
      embedding = $embedding,
      created_at = time::now()
  `, {
    ...data,
    embedding: data.embedding ?? null,
  } as Record<string, unknown>);
}

// --- Health check ---

export async function surrealHealthCheck(): Promise<boolean> {
  try {
    const res = await fetch('http://127.0.0.1:8000/health');
    return res.ok;
  } catch {
    return false;
  }
}
