-- ============================================
-- ALESSIO-OS SCHEMA EXTENSION v1.0
-- Extends phonon-kb v4.0 for multi-agent PTI
-- ============================================

-- ==================== AGENT STATE ====================
-- Fatto base: agent.*.status, agent.*.task, agent.*.findings

DEFINE TABLE IF NOT EXISTS agent_state SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS agent_id ON agent_state TYPE string;
DEFINE FIELD IF NOT EXISTS session_id ON agent_state TYPE string;
DEFINE FIELD IF NOT EXISTS project ON agent_state TYPE string;
DEFINE FIELD IF NOT EXISTS role ON agent_state TYPE string;           -- coder|tester|reviewer|researcher
DEFINE FIELD IF NOT EXISTS status ON agent_state TYPE string;         -- idle|working|blocked|done
DEFINE FIELD IF NOT EXISTS current_task ON agent_state TYPE option<string>;
DEFINE FIELD IF NOT EXISTS findings ON agent_state TYPE option<array>;
DEFINE FIELD IF NOT EXISTS delta_log ON agent_state TYPE option<array>;  -- PTI: storia delta
DEFINE FIELD IF NOT EXISTS created_at ON agent_state TYPE datetime DEFAULT time::now();
DEFINE FIELD IF NOT EXISTS updated_at ON agent_state TYPE datetime DEFAULT time::now();

DEFINE INDEX IF NOT EXISTS idx_agent_session ON agent_state FIELDS session_id;
DEFINE INDEX IF NOT EXISTS idx_agent_status ON agent_state FIELDS status;
DEFINE INDEX IF NOT EXISTS idx_agent_project ON agent_state FIELDS project;

-- ==================== TASK QUEUE ====================
-- Fatto base: task.*.status, task.*.assigned

DEFINE TABLE IF NOT EXISTS task_queue SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS task ON task_queue TYPE string;
DEFINE FIELD IF NOT EXISTS priority ON task_queue TYPE int DEFAULT 5;
DEFINE FIELD IF NOT EXISTS assigned_to ON task_queue TYPE option<string>;
DEFINE FIELD IF NOT EXISTS status ON task_queue TYPE string DEFAULT 'pending';  -- pending|assigned|running|done|failed
DEFINE FIELD IF NOT EXISTS parent_task ON task_queue TYPE option<record<task_queue>>;
DEFINE FIELD IF NOT EXISTS deps ON task_queue TYPE option<array<record<task_queue>>>;  -- PTI: sorgenti
DEFINE FIELD IF NOT EXISTS result ON task_queue TYPE option<string>;
DEFINE FIELD IF NOT EXISTS delta ON task_queue TYPE option<object>;   -- PTI: delta prodotto
DEFINE FIELD IF NOT EXISTS project ON task_queue TYPE string;
DEFINE FIELD IF NOT EXISTS created_at ON task_queue TYPE datetime DEFAULT time::now();
DEFINE FIELD IF NOT EXISTS completed_at ON task_queue TYPE option<datetime>;

DEFINE INDEX IF NOT EXISTS idx_task_status ON task_queue FIELDS status;
DEFINE INDEX IF NOT EXISTS idx_task_project ON task_queue FIELDS project;
DEFINE INDEX IF NOT EXISTS idx_task_priority ON task_queue FIELDS priority;

-- ==================== SESSION CONTEXT ====================
-- PTI: derivato materializzato delle decisioni di sessione

DEFINE TABLE IF NOT EXISTS session_ctx SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS session_id ON session_ctx TYPE string;
DEFINE FIELD IF NOT EXISTS project ON session_ctx TYPE string;
DEFINE FIELD IF NOT EXISTS decisions ON session_ctx TYPE option<array>;
DEFINE FIELD IF NOT EXISTS blockers ON session_ctx TYPE option<array>;
DEFINE FIELD IF NOT EXISTS summary ON session_ctx TYPE option<string>;
DEFINE FIELD IF NOT EXISTS agent_roles ON session_ctx TYPE option<array>;  -- chi partecipa
DEFINE FIELD IF NOT EXISTS embedding ON session_ctx TYPE option<array<float>>;
DEFINE FIELD IF NOT EXISTS created_at ON session_ctx TYPE datetime DEFAULT time::now();
DEFINE FIELD IF NOT EXISTS updated_at ON session_ctx TYPE datetime DEFAULT time::now();

DEFINE INDEX IF NOT EXISTS idx_session_project ON session_ctx FIELDS project;
DEFINE INDEX IF NOT EXISTS idx_session_vec ON session_ctx FIELDS embedding HNSW DIMENSION 384 DIST COSINE;

-- ==================== PTI GRAPH RELATIONS ====================

-- Agent → Task (assegnazione)
DEFINE TABLE IF NOT EXISTS works_on TYPE RELATION IN agent_state OUT task_queue SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS started_at ON works_on TYPE datetime DEFAULT time::now();

-- Task → Task (dipendenza PTI: sorgente → derivato)
DEFINE TABLE IF NOT EXISTS depends_on TYPE RELATION IN task_queue OUT task_queue SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS dep_type ON depends_on TYPE string DEFAULT 'blocks';  -- blocks|informs

-- Agent → Agent (comunicazione: salto PTI)
DEFINE TABLE IF NOT EXISTS notifies TYPE RELATION IN agent_state OUT agent_state SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS channel ON notifies TYPE string DEFAULT 'findings';

-- ==================== PTI FUNCTIONS ====================

-- Derivato: agenti liberi (sempre materializzabile)
DEFINE FUNCTION IF NOT EXISTS fn::agents_idle($project: string) {
    RETURN SELECT * FROM agent_state
        WHERE project = $project AND status = 'idle'
        ORDER BY updated_at ASC;
};

-- Derivato: task pronti (deps soddisfatte)
DEFINE FUNCTION IF NOT EXISTS fn::tasks_ready($project: string) {
    RETURN SELECT * FROM task_queue
        WHERE project = $project
        AND status = 'pending'
        AND (deps IS NONE OR array::len(deps) == 0
             OR array::all(deps, |$d| $d.status == 'done'))
        ORDER BY priority DESC;
};

-- Derivato: stato sessione completo
DEFINE FUNCTION IF NOT EXISTS fn::session_state($session_id: string) {
    RETURN {
        agents: (SELECT agent_id, role, status, current_task FROM agent_state WHERE session_id = $session_id),
        tasks_pending: (SELECT count() FROM task_queue WHERE status = 'pending' GROUP ALL)[0].count,
        tasks_running: (SELECT count() FROM task_queue WHERE status = 'running' GROUP ALL)[0].count,
        tasks_done: (SELECT count() FROM task_queue WHERE status = 'done' GROUP ALL)[0].count,
        last_findings: (
            SELECT agent_id, findings, updated_at FROM agent_state
            WHERE session_id = $session_id AND findings IS NOT NONE
            ORDER BY updated_at DESC LIMIT 5
        )
    };
};
