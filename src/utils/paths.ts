/**
 * Project path resolution — Canonical registry
 *
 * Unifica le 3 mappe duplicate in server.ts, github.ts, orchestrator.ts.
 * Atomo: 0 dipendenze.
 */

import { homedir } from 'os';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const HOME = homedir();
const __dirname = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(__dirname, '..', '..');

/** Canonical project → filesystem path map */
export const PROJECT_PATHS: Record<string, string> = {
  'alessio-os':                PROJECT_ROOT,
  'phonon-ui':                 join(HOME, 'phonon-ui'),
  'nico':                      join(HOME, 'nico'),
  'rememberance':              join(HOME, 'Rememberance'),
  'innesti':                   join(HOME, 'innesti-revamp-draft'),
  'innesti-revamp-draft':      join(HOME, 'innesti-revamp-draft'),
  'dag-consulting':            join(HOME, 'Documents/Web/Dag Consulting 2.0'),
  'dag-consulting-2-0':        join(HOME, 'Documents/Web/Dag Consulting 2.0'),
  'phi-docs':                  join(HOME, 'phi-docs'),
  'natale-order-manager':      join(HOME, 'natale-order-manager-main'),
  'natale-order-manager-main': join(HOME, 'natale-order-manager-main'),
  'trovatore':                 join(HOME, 'trovatore'),
  'social-cli-mcp':            join(HOME, 'social-cli-mcp'),
  'ui-canvas-mcp':             join(HOME, 'ui-canvas-mcp'),
  'gestionale-nautica-main':   join(HOME, 'gestionale-nautica-main'),
  'ricchexxa-main':            join(HOME, 'ricchexxa-main'),
  'looperpedal':               join(HOME, 'looperpedal'),
  'abletonscripts':            join(HOME, 'abletonscripts'),
  'xyl-excel':                 join(HOME, 'xyl-excel'),
};

/** Resolve project name → absolute filesystem path */
export function resolveProjectPath(project?: string): string {
  if (!project || project === 'alessio-os') return PROJECT_ROOT;
  const registered = PROJECT_PATHS[project.toLowerCase()];
  if (registered) return registered;
  return join(HOME, project);
}
