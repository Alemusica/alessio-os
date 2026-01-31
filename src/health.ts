/**
 * Health check rapido per ALESSIO-OS
 */

import { surrealHealthCheck, surqlQuery } from './pti/surreal-bridge.js';

async function main(): Promise<void> {
  console.log('=== ALESSIO-OS Health Check ===\n');

  // SurrealDB
  const surrealOk = await surrealHealthCheck();
  console.log(`SurrealDB:     ${surrealOk ? '✓' : '✗'}`);

  if (surrealOk) {
    try {
      const res = await surqlQuery('fn::kb_stats_v4()');
      const stats = res[0]?.result as Record<string, unknown>;
      console.log(`  Knowledge:   ${stats?.knowledge_count ?? '?'} items`);
      console.log(`  Papers:      ${stats?.paper_count ?? '?'}`);
      console.log(`  Experiences: ${stats?.experience_count ?? '?'}`);
      console.log(`  Entities:    ${stats?.entity_count ?? '?'}`);
    } catch {
      console.log('  Stats: errore query');
    }

    // Agent tables
    try {
      const agents = await surqlQuery('SELECT count() FROM agent_state GROUP ALL');
      const tasks = await surqlQuery('SELECT count() FROM task_queue GROUP ALL');
      const sessions = await surqlQuery('SELECT count() FROM session_ctx GROUP ALL');
      const agentCount = (agents[0]?.result as Array<{ count: number }>)?.[0]?.count ?? 0;
      const taskCount = (tasks[0]?.result as Array<{ count: number }>)?.[0]?.count ?? 0;
      const sessionCount = (sessions[0]?.result as Array<{ count: number }>)?.[0]?.count ?? 0;
      console.log(`  Agents:      ${agentCount}`);
      console.log(`  Tasks:       ${taskCount}`);
      console.log(`  Sessions:    ${sessionCount}`);
    } catch {
      console.log('  Agent tables: non ancora create');
    }
  }

  // OCR binary
  const { existsSync } = await import('fs');
  const ocrBin = `${process.env.HOME}/alessio-os/src/tools/ocr-vision`;
  console.log(`\nOCR Vision:    ${existsSync(ocrBin) ? '✓ compilato' : '○ da compilare (npm run ocr:compile)'}`);

  // Whisper
  const whisperDir = `${process.env.HOME}/.local/share/whisper.cpp`;
  const whisperModel = `${whisperDir}/models/ggml-large-v3-turbo.bin`;
  console.log(`Whisper STT:   ${existsSync(whisperModel) ? '✓ modello presente' : '○ da installare (npm run stt:setup)'}`);

  console.log('\n=== Done ===');
}

main().catch(console.error);
