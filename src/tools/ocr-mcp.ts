/**
 * OCR MCP Tool — Bridge tra Apple Vision e Claude Agent SDK
 *
 * PTI: input.image → [ocr_node → orchestrator]
 *
 * Registrabile come MCP tool per tutti gli agenti.
 * Chiama il Swift CLI wrapper localmente.
 */

import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OCR_BINARY = resolve(__dirname, '..', 'tools', 'ocr-vision');
const OCR_SWIFT = resolve(__dirname, '..', 'tools', 'ocr-vision.swift');

interface OCRBlock {
  text: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface OCRResult {
  file: string;
  text: string;
  blocks: OCRBlock[];
  language: string;
  confidence: number;
}

// --- Compila Swift se binary non esiste ---
function ensureBinary(): string {
  if (existsSync(OCR_BINARY)) return OCR_BINARY;

  console.log('[OCR] Compilazione ocr-vision.swift...');
  execFileSync('swiftc', [
    '-O',                    // ottimizzato
    '-framework', 'Vision',
    '-framework', 'AppKit',
    '-o', OCR_BINARY,
    OCR_SWIFT,
  ]);
  console.log('[OCR] Compilato ✓');
  return OCR_BINARY;
}

// --- OCR su file singolo o multipli ---
export function ocr(filePaths: string[]): OCRResult[] {
  const binary = ensureBinary();

  const validPaths = filePaths.filter(p => {
    if (!existsSync(p)) {
      console.warn(`[OCR] File non trovato: ${p}`);
      return false;
    }
    return true;
  });

  if (validPaths.length === 0) return [];

  try {
    const output = execFileSync(binary, validPaths, {
      timeout: 30000,   // 30s max
      encoding: 'utf-8',
    });

    return JSON.parse(output) as OCRResult[];
  } catch (err) {
    console.error('[OCR] Errore:', err);
    return [];
  }
}

// --- MCP Tool definition ---
export const ocrToolDefinition = {
  name: 'ocr_vision',
  description: 'Riconoscimento testo da immagini usando Apple Vision (locale, zero token). Supporta italiano e inglese. Accetta PNG, JPG, PDF.',
  input_schema: {
    type: 'object' as const,
    properties: {
      file_paths: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description: 'Lista di path assoluti alle immagini da analizzare',
      },
    },
    required: ['file_paths'],
  },
};

export function handleOcrTool(input: { file_paths: string[] }): string {
  const results = ocr(input.file_paths);

  if (results.length === 0) return 'Nessun testo riconosciuto.';

  return results.map(r =>
    `--- ${r.file} (confidence: ${(r.confidence * 100).toFixed(1)}%) ---\n${r.text}`
  ).join('\n\n');
}
