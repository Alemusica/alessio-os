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

-- ==================== PTI GRAPH TOPOLOGY ====================
-- Persistenza struttura grafo PTI per visualizzazione e debug

-- Nodo PTI persistito (fatto/derivato/azione/assert)
DEFINE TABLE IF NOT EXISTS pti_node SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS node_id ON pti_node TYPE string;
DEFINE FIELD IF NOT EXISTS tipo ON pti_node TYPE string;
DEFINE FIELD IF NOT EXISTS valore ON pti_node FLEXIBLE TYPE option<object>;
DEFINE FIELD IF NOT EXISTS livello ON pti_node TYPE int DEFAULT 0;
DEFINE FIELD IF NOT EXISTS sorgenti ON pti_node TYPE array DEFAULT [];
DEFINE FIELD IF NOT EXISTS salti ON pti_node TYPE array DEFAULT [];
DEFINE FIELD IF NOT EXISTS bloccante ON pti_node TYPE option<bool>;
DEFINE FIELD IF NOT EXISTS messaggio ON pti_node TYPE option<string>;
DEFINE FIELD IF NOT EXISTS graph_id ON pti_node TYPE string DEFAULT 'main';
DEFINE FIELD IF NOT EXISTS updated_at ON pti_node TYPE datetime DEFAULT time::now();

DEFINE INDEX IF NOT EXISTS idx_pti_node_id ON pti_node FIELDS node_id, graph_id UNIQUE;
DEFINE INDEX IF NOT EXISTS idx_pti_node_tipo ON pti_node FIELDS tipo;

-- Edge PTI: dipendenza o salto tra nodi
DEFINE TABLE IF NOT EXISTS pti_edge SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS from_node ON pti_edge TYPE string;
DEFINE FIELD IF NOT EXISTS to_node ON pti_edge TYPE string;
DEFINE FIELD IF NOT EXISTS tipo ON pti_edge TYPE string DEFAULT 'dipendenza';
DEFINE FIELD IF NOT EXISTS graph_id ON pti_edge TYPE string DEFAULT 'main';

DEFINE INDEX IF NOT EXISTS idx_pti_edge_pair ON pti_edge FIELDS from_node, to_node, graph_id UNIQUE;

-- Delta log: storia propagazioni
DEFINE TABLE IF NOT EXISTS pti_delta_log SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS nodo_id ON pti_delta_log TYPE string;
DEFINE FIELD IF NOT EXISTS delta ON pti_delta_log TYPE object;
DEFINE FIELD IF NOT EXISTS causa ON pti_delta_log TYPE string;
DEFINE FIELD IF NOT EXISTS graph_id ON pti_delta_log TYPE string DEFAULT 'main';
DEFINE FIELD IF NOT EXISTS created_at ON pti_delta_log TYPE datetime DEFAULT time::now();

DEFINE INDEX IF NOT EXISTS idx_pti_delta_nodo ON pti_delta_log FIELDS nodo_id;
DEFINE INDEX IF NOT EXISTS idx_pti_delta_ts ON pti_delta_log FIELDS created_at;

-- Snapshot grafo per time-travel
DEFINE TABLE IF NOT EXISTS pti_snapshot SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS graph_id ON pti_snapshot TYPE string DEFAULT 'main';
DEFINE FIELD IF NOT EXISTS snapshot ON pti_snapshot TYPE object;
DEFINE FIELD IF NOT EXISTS label ON pti_snapshot TYPE option<string>;
DEFINE FIELD IF NOT EXISTS created_at ON pti_snapshot TYPE datetime DEFAULT time::now();

-- Topologia completa in una query
DEFINE FUNCTION IF NOT EXISTS fn::pti_topology($gid: string) {
    RETURN {
        nodi: (SELECT * FROM pti_node WHERE graph_id = $gid ORDER BY livello ASC),
        edges: (SELECT * FROM pti_edge WHERE graph_id = $gid),
        delta_count: (SELECT count() FROM pti_delta_log WHERE graph_id = $gid GROUP ALL)[0].count
    };
};

-- ==================== AGENT ISSUE ASSIGNMENTS ====================

DEFINE TABLE IF NOT EXISTS agent_issue_assignment SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS agent_def_id ON agent_issue_assignment TYPE string;
DEFINE FIELD IF NOT EXISTS project ON agent_issue_assignment TYPE string;
DEFINE FIELD IF NOT EXISTS issue_number ON agent_issue_assignment TYPE int;
DEFINE FIELD IF NOT EXISTS issue_title ON agent_issue_assignment TYPE string;
DEFINE FIELD IF NOT EXISTS branch_name ON agent_issue_assignment TYPE string;
DEFINE FIELD IF NOT EXISTS status ON agent_issue_assignment TYPE string DEFAULT 'pending';
DEFINE FIELD IF NOT EXISTS task_id ON agent_issue_assignment TYPE option<string>;
DEFINE FIELD IF NOT EXISTS result_summary ON agent_issue_assignment TYPE option<string>;
DEFINE FIELD IF NOT EXISTS pr_url ON agent_issue_assignment TYPE option<string>;
DEFINE FIELD IF NOT EXISTS created_at ON agent_issue_assignment TYPE datetime DEFAULT time::now();
DEFINE FIELD IF NOT EXISTS completed_at ON agent_issue_assignment TYPE option<datetime>;

DEFINE INDEX IF NOT EXISTS idx_agent_issue ON agent_issue_assignment FIELDS agent_def_id, issue_number;
DEFINE INDEX IF NOT EXISTS idx_agent_issue_status ON agent_issue_assignment FIELDS status;

-- ==================== PROJECT GITHUB CONFIG ====================

DEFINE TABLE IF NOT EXISTS project_github SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS project ON project_github TYPE string;
DEFINE FIELD IF NOT EXISTS repo ON project_github TYPE string;
DEFINE FIELD IF NOT EXISTS default_branch ON project_github TYPE string DEFAULT 'main';
DEFINE FIELD IF NOT EXISTS created_at ON project_github TYPE datetime DEFAULT time::now();

DEFINE INDEX IF NOT EXISTS idx_project_github ON project_github FIELDS project UNIQUE;

-- ==================== AGENT DEFINITIONS (persistent, per-project) ====================

DEFINE TABLE IF NOT EXISTS agent_definition SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS agent_def_id ON agent_definition TYPE string;
DEFINE FIELD IF NOT EXISTS project ON agent_definition TYPE string;
DEFINE FIELD IF NOT EXISTS name ON agent_definition TYPE string;
DEFINE FIELD IF NOT EXISTS role ON agent_definition TYPE string;
DEFINE FIELD IF NOT EXISTS custom_identity ON agent_definition TYPE option<string>;
DEFINE FIELD IF NOT EXISTS paradigm_id ON agent_definition TYPE option<string>;
DEFINE FIELD IF NOT EXISTS mcp_config ON agent_definition FLEXIBLE TYPE option<object>;
DEFINE FIELD IF NOT EXISTS tags ON agent_definition TYPE array DEFAULT [];
DEFINE FIELD IF NOT EXISTS is_active ON agent_definition TYPE bool DEFAULT true;
DEFINE FIELD IF NOT EXISTS created_at ON agent_definition TYPE datetime DEFAULT time::now();
DEFINE FIELD IF NOT EXISTS updated_at ON agent_definition TYPE datetime DEFAULT time::now();

DEFINE INDEX IF NOT EXISTS idx_agent_def_id ON agent_definition FIELDS agent_def_id UNIQUE;
DEFINE INDEX IF NOT EXISTS idx_agent_def_project ON agent_definition FIELDS project;

-- ==================== PARADIGM REGISTRY ====================
-- Dischetti swappabili: ogni paradigma è un set di istruzioni per agenti

DEFINE TABLE IF NOT EXISTS paradigm SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS paradigm_id ON paradigm TYPE string;
DEFINE FIELD IF NOT EXISTS name ON paradigm TYPE string;
DEFINE FIELD IF NOT EXISTS version ON paradigm TYPE string;
DEFINE FIELD IF NOT EXISTS description ON paradigm TYPE string;
DEFINE FIELD IF NOT EXISTS compact ON paradigm TYPE string;
DEFINE FIELD IF NOT EXISTS full_text ON paradigm TYPE string;
DEFINE FIELD IF NOT EXISTS tags ON paradigm TYPE array DEFAULT [];
DEFINE FIELD IF NOT EXISTS created_at ON paradigm TYPE datetime DEFAULT time::now();

DEFINE INDEX IF NOT EXISTS idx_paradigm_id ON paradigm FIELDS paradigm_id UNIQUE;

-- Assignment: quale paradigma è attivo per un progetto o agente
DEFINE TABLE IF NOT EXISTS paradigm_assignment SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS target_type ON paradigm_assignment TYPE string;
DEFINE FIELD IF NOT EXISTS target_id ON paradigm_assignment TYPE string;
DEFINE FIELD IF NOT EXISTS paradigm_id ON paradigm_assignment TYPE string;
DEFINE FIELD IF NOT EXISTS assigned_at ON paradigm_assignment TYPE datetime DEFAULT time::now();

DEFINE INDEX IF NOT EXISTS idx_paradigm_assign ON paradigm_assignment FIELDS target_type, target_id UNIQUE;

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
