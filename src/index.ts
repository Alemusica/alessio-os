/**
 * ALESSIO-OS — Entry point
 *
 * PTI Multi-Agent Hub
 *   input.* → [router → agents.* → shared_memory → dashboard]
 *
 * Componenti:
 *   - GrafoPTI: runtime delta propagation
 *   - SurrealDB: shared memory persistente
 *   - Orchestrator: gestione agenti paralleli
 *   - OCR: Apple Vision locale
 *   - STT: whisper.cpp locale
 */

import { Orchestrator } from './agents/orchestrator.js';
import { surrealHealthCheck } from './pti/surreal-bridge.js';
import { ocr } from './tools/ocr-mcp.js';
import { startDashboard } from './dashboard/server.js';

async function main(): Promise<void> {
  console.log('=== ALESSIO-OS v0.1.0 ===');
  console.log('PTI Multi-Agent Hub');
  console.log('');

  // Health check SurrealDB
  const surrealOk = await surrealHealthCheck();
  console.log(`SurrealDB: ${surrealOk ? '✓ online' : '✗ offline'}`);

  if (!surrealOk) {
    console.error('SurrealDB non raggiungibile su :8000. Avvialo con:');
    console.error('  launchctl start com.surrealdb.knowledge');
    process.exit(1);
  }

  // Rileva progetto dalla directory corrente
  const project = process.cwd().split('/').pop() ?? 'unknown';

  // Inizializza orchestratore
  const orch = new Orchestrator({
    project,
    maxParallelAgents: 5,
  });

  const health = await orch.health();
  console.log(`Orchestratore PTI v4: ✓ sessione attiva`);
  console.log(`  Agenti: ${health.agents}`);
  console.log(`  PTI: ${JSON.stringify(health.pti)}`);
  console.log('');

  // Modalità interattiva o comando singolo
  const args = process.argv.slice(2);

  if (args[0] === '--ocr' && args[1]) {
    // OCR mode: alessio-os --ocr file1.png file2.jpg
    const files = args.slice(1);
    console.log(`[OCR] Analisi ${files.length} file...`);
    const results = ocr(files);
    for (const r of results) {
      console.log(`\n--- ${r.file} (${(r.confidence * 100).toFixed(1)}%) ---`);
      console.log(r.text);
    }
    return;
  }

  if (args[0] === '--task') {
    // Task mode: alessio-os --task "fixa il bug nel login"
    const taskText = args.slice(1).join(' ');
    console.log(`[TASK] "${taskText}"`);
    // PTI: setta fatti, il grafo fa il resto
    orch.input(taskText, project);
    console.log(`[TASK] Input inviato al grafo PTI — propagazione reattiva in corso`);
    return;
  }

  if (args[0] === '--status') {
    const stato = orch.stato();
    console.log(JSON.stringify(stato, (_k, v) =>
      v instanceof Map ? Object.fromEntries(v) : v
    , 2));
    return;
  }

  if (args[0] === '--dashboard' || args.length === 0) {
    // Dashboard mode: avvia server web + SSE live
    startDashboard();
    console.log('Dashboard avviata. Premi Ctrl+C per fermare.');
    // Mantieni processo vivo
    return;
  }
}

main().catch(console.error);
