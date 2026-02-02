/**
 * GitHub Integration — gh CLI Bridge
 *
 * Fatto:     github.issues.count = N
 * Derivato:  github.repo(project) := PROJECT_REPOS[project] ?? project_github
 * Salto:     github.issues.updated → [dashboard.github-view]
 *
 * Usa `gh` CLI (già installato) con output JSON.
 * Nessuna dipendenza npm — solo execSync.
 */

import { execSync } from 'child_process';
import { surqlQuery } from '../pti/surreal-bridge.js';
import { homedir } from 'os';
import { join } from 'path';

// ==================== TIPI ====================

export interface GhIssue {
  number: number;
  title: string;
  state: string;
  labels: Array<{ name: string }>;
  author: { login: string };
  createdAt: string;
  updatedAt: string;
  url: string;
  assignees: Array<{ login: string }>;
}

export interface GhPR {
  number: number;
  title: string;
  state: string;
  isDraft: boolean;
  author: { login: string };
  headRefName: string;
  baseRefName: string;
  url: string;
  mergeable: string;
  reviewDecision: string;
  createdAt: string;
  updatedAt: string;
}

export interface GhDiscussion {
  number: number;
  title: string;
  category: { name: string };
  author: { login: string };
  createdAt: string;
  url: string;
}

// ==================== REPO MAPPING ====================

const HOME = homedir();

const PROJECT_REPOS: Record<string, string> = {
  'alessio-os': 'Alemusica/alessio-os',
  'phonon-ui': 'Alemusica/phonon-ui',
  'trovatore': 'Alemusica/trovatore',
  'social-cli-mcp': 'Alemusica/social-cli-mcp',
  'ui-canvas-mcp': 'Alemusica/ui-canvas-mcp',
  'innesti-revamp-draft': 'Alemusica/innesti-revamp-draft',
  'nico': 'Alemusica/nico',
  'natale-order-manager-main': 'Alemusica/natale-order-manager',
};

const PROJECT_PATHS: Record<string, string> = {
  'alessio-os': join(HOME, 'alessio-os'),
  'phonon-ui': join(HOME, 'phonon-ui'),
  'nico': join(HOME, 'nico'),
  'trovatore': join(HOME, 'trovatore'),
  'innesti-revamp-draft': join(HOME, 'innesti-revamp-draft'),
  'natale-order-manager-main': join(HOME, 'natale-order-manager-main'),
};

/** Risolvi repo: DB override → hardcoded → null */
export async function resolveRepo(project: string): Promise<string | null> {
  // 1. DB override
  try {
    const res = await surqlQuery(
      `SELECT repo FROM project_github WHERE project = $project`,
      { project }
    );
    const result = res[0]?.result as Array<{ repo: string }>;
    if (result?.[0]?.repo) return result[0].repo;
  } catch { /* DB down, fallback */ }

  // 2. Hardcoded
  return PROJECT_REPOS[project] ?? null;
}

/** Risolvi path locale per operazioni git */
export function resolveProjectPath(project: string): string {
  return PROJECT_PATHS[project] ?? join(HOME, project);
}

// ==================== GITHUB DATA ====================

export function getIssues(repo: string, state = 'open', limit = 30): GhIssue[] {
  try {
    const out = execSync(
      `gh issue list --repo ${repo} --state ${state} --limit ${limit} --json number,title,state,labels,author,createdAt,updatedAt,url,assignees`,
      { encoding: 'utf-8', timeout: 15000 }
    );
    return JSON.parse(out);
  } catch {
    return [];
  }
}

export function getPRs(repo: string, state = 'open', limit = 30): GhPR[] {
  try {
    const out = execSync(
      `gh pr list --repo ${repo} --state ${state} --limit ${limit} --json number,title,state,isDraft,author,headRefName,baseRefName,url,mergeable,reviewDecision,createdAt,updatedAt`,
      { encoding: 'utf-8', timeout: 15000 }
    );
    return JSON.parse(out);
  } catch {
    return [];
  }
}

export function getDiscussions(repo: string, limit = 20): GhDiscussion[] {
  try {
    const out = execSync(
      `gh api graphql -f query='{ repository(owner: "${repo.split('/')[0]}", name: "${repo.split('/')[1]}") { discussions(first: ${limit}, orderBy: {field: CREATED_AT, direction: DESC}) { nodes { number title category { name } author { login } createdAt url } } } }' --jq '.data.repository.discussions.nodes'`,
      { encoding: 'utf-8', timeout: 15000 }
    );
    return JSON.parse(out);
  } catch {
    return [];
  }
}

export function getIssueBody(repo: string, number: number): string {
  try {
    const out = execSync(
      `gh issue view ${number} --repo ${repo} --json body --jq '.body'`,
      { encoding: 'utf-8', timeout: 10000 }
    );
    return out.trim();
  } catch {
    return '';
  }
}

// ==================== GIT OPERATIONS ====================

export function branchExists(repo: string, branch: string): boolean {
  try {
    execSync(`gh api repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, {
      encoding: 'utf-8', timeout: 10000
    });
    return true;
  } catch {
    return false;
  }
}

export function createBranch(projectPath: string, branchName: string, baseBranch = 'main'): void {
  execSync(`git fetch origin ${baseBranch} && git checkout -b ${branchName} origin/${baseBranch}`, {
    cwd: projectPath,
    encoding: 'utf-8',
    timeout: 30000,
  });
}

export function checkoutBranch(projectPath: string, branchName: string): void {
  execSync(`git checkout ${branchName}`, {
    cwd: projectPath,
    encoding: 'utf-8',
    timeout: 10000,
  });
}

export function createPR(repo: string, opts: {
  title: string;
  body: string;
  head: string;
  base?: string;
}): string {
  try {
    const out = execSync(
      `gh pr create --repo ${repo} --title "${opts.title.replace(/"/g, '\\"')}" --body "${opts.body.replace(/"/g, '\\"')}" --head ${opts.head}${opts.base ? ' --base ' + opts.base : ''}`,
      { encoding: 'utf-8', timeout: 30000 }
    );
    return out.trim();
  } catch (err) {
    throw new Error(`PR creation failed: ${err}`);
  }
}

// ==================== PROJECT GITHUB CONFIG ====================

export async function setGithubConfig(project: string, repo: string, defaultBranch = 'main'): Promise<void> {
  await surqlQuery(`
    UPSERT project_github SET
      project = $project,
      repo = $repo,
      default_branch = $default_branch,
      created_at = time::now()
    WHERE project = $project
  `, { project, repo, default_branch: defaultBranch } as Record<string, unknown>);
}

export async function getGithubConfig(project: string): Promise<{ repo: string; default_branch: string } | null> {
  const res = await surqlQuery(
    `SELECT repo, default_branch FROM project_github WHERE project = $project`,
    { project }
  );
  const result = res[0]?.result as Array<{ repo: string; default_branch: string }>;
  return result?.[0] ?? null;
}

// ==================== BRANCH NAME GENERATOR ====================

export function generateBranchName(issueNumber: number, issueTitle: string, labels: string[] = []): string {
  const isBug = labels.some(l => /bug|fix/i.test(l));
  const prefix = isBug ? 'fix' : 'feat';
  const slug = issueTitle
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 40)
    .replace(/-$/, '');
  return `${prefix}/issue-${issueNumber}-${slug}`;
}
