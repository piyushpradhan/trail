import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tasksRepo, eventsRepo } from '../db.js';
import { settings } from '../settings.js';
import type { TaskStatus } from '@shared/types';

const exec = promisify(execFile);

export type GithubMode = 'pat' | 'gh-cli' | 'unconfigured';

export interface GithubStatus {
  ok: boolean;
  mode: GithubMode;
  user?: string;
  message?: string;
  scopes?: string;
}

interface ApiSearchItem {
  number: number;
  title: string;
  html_url: string;
  draft?: boolean;
  state: 'open' | 'closed';
  user?: { login: string };
  repository_url: string;
  pull_request?: { merged_at: string | null };
  labels?: Array<{ name: string }>;
}

interface ApiPrDetail {
  number: number;
  title: string;
  html_url: string;
  state: 'open' | 'closed';
  draft: boolean;
  merged: boolean;
  mergeable_state?: string;
  base: { repo: { full_name: string } };
}

interface ApiReview {
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'PENDING' | 'DISMISSED';
  submitted_at: string | null;
}

export function repoFromApiUrl(url: string): string {
  const m = /\/repos\/([^/]+\/[^/]+)$/.exec(url);
  return m?.[1] ?? '';
}

export function repoMatchesFilter(
  repo: string,
  include: string[],
  exclude: string[],
): boolean {
  if (exclude.some((s) => repo.includes(s))) return false;
  if (include.length === 0) return true;
  return include.some((s) => repo.includes(s));
}

function passesFilter(repo: string): boolean {
  const cfg = settings.getGithub();
  return repoMatchesFilter(repo, cfg.repoInclude, cfg.repoExclude);
}

// ---------- HTTP helper ----------

async function ghFetch<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Trail/0.1',
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

async function searchIssues(token: string, query: string): Promise<ApiSearchItem[]> {
  const r = await ghFetch<{ items: ApiSearchItem[] }>(
    token,
    `/search/issues?q=${encodeURIComponent(query)}&per_page=50`,
  );
  return r.items;
}

async function fetchReviewDecision(token: string, owner: string, repo: string, n: number): Promise<string | null> {
  try {
    const reviews = await ghFetch<ApiReview[]>(token, `/repos/${owner}/${repo}/pulls/${n}/reviews?per_page=50`);
    const latestPerState = reviews
      .filter((r) => r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED')
      .sort((a, b) => (b.submitted_at ?? '').localeCompare(a.submitted_at ?? ''));
    return latestPerState[0]?.state ?? null;
  } catch {
    return null;
  }
}

// ---------- gh CLI fallback ----------

async function ghCli(args: string[]): Promise<unknown> {
  const { stdout } = await exec('gh', args, { maxBuffer: 10 * 1024 * 1024 });
  return JSON.parse(stdout);
}

interface CliPr {
  number: number;
  title: string;
  url: string;
  repository: { nameWithOwner: string };
  isDraft?: boolean;
  state?: string;
  mergedAt?: string;
}

async function cliSearch(query: string): Promise<CliPr[]> {
  return ghCli([
    'search', 'prs',
    ...query.split(' '),
    '--state', 'all',
    '--json', 'number,title,url,repository,isDraft,state,mergedAt',
    '--limit', '50',
  ]) as Promise<CliPr[]>;
}

// ---------- Lifecycle mapping ----------

export interface PrState {
  isOpen: boolean;
  isDraft: boolean;
  isMerged: boolean;
  reviewDecision: string | null; // 'APPROVED' | 'CHANGES_REQUESTED' | null
}

export function statusForMyPr(s: PrState): TaskStatus {
  if (s.isMerged) return 'done';
  if (!s.isOpen) return 'blocked'; // closed, not merged
  if (s.isDraft) return 'in_progress';
  if (s.reviewDecision === 'CHANGES_REQUESTED') return 'blocked';
  // PR open + not draft → typically waiting for review or ready to merge
  return 'in_progress';
}

export function statusForReviewRequested(s: PrState): TaskStatus {
  if (s.isMerged) return 'done';
  if (!s.isOpen) return 'done'; // closed → review no longer needed
  return 'todo';
}

// ---------- Diagnostics ----------

export async function diagnoseGithub(): Promise<GithubStatus> {
  const token = settings.getGithubToken();
  if (token) {
    try {
      const user = await ghFetch<{ login: string }>(token, '/user');
      return { ok: true, mode: 'pat', user: user.login };
    } catch (err) {
      return { ok: false, mode: 'pat', message: (err as Error).message };
    }
  }
  try {
    const { stdout } = await exec('gh', ['auth', 'status', '--show-token=false'], { maxBuffer: 1024 * 1024 });
    const userMatch = /Logged in to github\.com as (\S+)/i.exec(stdout) ?? /account (\S+)/i.exec(stdout);
    return {
      ok: true,
      mode: 'gh-cli',
      user: userMatch?.[1],
      message: stdout.trim().slice(0, 240),
    };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string };
    if (e.code === 'ENOENT') {
      return { ok: false, mode: 'unconfigured', message: 'gh CLI not installed and no token set' };
    }
    return { ok: false, mode: 'gh-cli', message: e.stderr ?? e.message };
  }
}

// ---------- Main collector ----------

export async function runGithubCollector(): Promise<{ created: number }> {
  const cfg = settings.getGithub();
  if (!cfg.enabled) {
    eventsRepo.log('collector.github.skipped', { reason: 'disabled' });
    return { created: 0 };
  }

  const token = settings.getGithubToken();
  let created = 0;

  if (token) {
    created = await runViaPat(token);
  } else {
    created = await runViaCli();
  }

  return { created };
}

async function runViaPat(token: string): Promise<number> {
  let created = 0;
  const reviewItems = await searchIssues(token, 'is:pr is:open review-requested:@me');
  const myPrItems = await searchIssues(token, 'is:pr author:@me state:all created:>=' + isoMinusDays(14));
  const issueItems = await searchIssues(token, 'is:issue is:open assignee:@me');

  for (const pr of reviewItems) {
    const repo = repoFromApiUrl(pr.repository_url);
    if (!passesFilter(repo)) continue;
    const ref = `${repo}#${pr.number}`;
    const before = tasksRepo.bySourceRef('github', ref);
    const state: PrState = {
      isOpen: pr.state === 'open',
      isDraft: !!pr.draft,
      isMerged: !!pr.pull_request?.merged_at,
      reviewDecision: null,
    };
    const status = statusForReviewRequested(state);
    upsertTask({
      title: `Review: ${pr.title} (${ref})`,
      ref,
      url: pr.html_url,
      status,
      tags: ['review-requested', repo],
    });
    if (!before) created++;
  }

  for (const pr of myPrItems) {
    const repo = repoFromApiUrl(pr.repository_url);
    if (!passesFilter(repo)) continue;
    const [owner, name] = repo.split('/');
    if (!owner || !name) continue;
    const ref = `mine:${repo}#${pr.number}`;
    const before = tasksRepo.bySourceRef('github', ref);

    let reviewDecision: string | null = null;
    const isOpen = pr.state === 'open';
    const isMerged = !!pr.pull_request?.merged_at;
    if (isOpen && !pr.draft) {
      reviewDecision = await fetchReviewDecision(token, owner, name, pr.number);
    }

    const state: PrState = {
      isOpen,
      isDraft: !!pr.draft,
      isMerged,
      reviewDecision,
    };
    const status = statusForMyPr(state);

    const titlePrefix =
      status === 'done' ? 'Merged' :
      status === 'blocked' ? (isMerged ? 'Closed' : 'Blocked') :
      pr.draft ? 'Draft' :
      reviewDecision === 'CHANGES_REQUESTED' ? 'Changes requested' :
      'In review';

    upsertTask({
      title: `${titlePrefix}: ${pr.title} (${repo}#${pr.number})`,
      ref,
      url: pr.html_url,
      status,
      tags: ['my-pr', repo, ...(reviewDecision ? [reviewDecision.toLowerCase()] : [])],
    });
    if (!before) created++;
  }

  for (const issue of issueItems) {
    const repo = repoFromApiUrl(issue.repository_url);
    if (!passesFilter(repo)) continue;
    const ref = `issue:${repo}#${issue.number}`;
    const before = tasksRepo.bySourceRef('github', ref);
    upsertTask({
      title: `Issue: ${issue.title} (${repo}#${issue.number})`,
      ref,
      url: issue.html_url,
      status: 'todo',
      tags: ['assigned-issue', repo],
    });
    if (!before) created++;
  }

  eventsRepo.log('collector.github.run', {
    mode: 'pat',
    created,
    reviews: reviewItems.length,
    mine: myPrItems.length,
    issues: issueItems.length,
  });
  return created;
}

async function runViaCli(): Promise<number> {
  let created = 0;
  try {
    const reviews = await cliSearch('--review-requested @me --state open');
    const mine = await cliSearch('--author @me');
    const issues = (await ghCli([
      'search', 'issues', '--assignee', '@me', '--state', 'open',
      '--json', 'number,title,url,repository',
      '--limit', '50',
    ])) as Array<{ number: number; title: string; url: string; repository: { nameWithOwner: string } }>;

    for (const pr of reviews) {
      const repo = pr.repository.nameWithOwner;
      if (!passesFilter(repo)) continue;
      const ref = `${repo}#${pr.number}`;
      const before = tasksRepo.bySourceRef('github', ref);
      upsertTask({
        title: `Review: ${pr.title} (${ref})`,
        ref,
        url: pr.url,
        status: 'todo',
        tags: ['review-requested', repo],
      });
      if (!before) created++;
    }

    for (const pr of mine) {
      const repo = pr.repository.nameWithOwner;
      if (!passesFilter(repo)) continue;
      const ref = `mine:${repo}#${pr.number}`;
      const before = tasksRepo.bySourceRef('github', ref);
      const isMerged = !!pr.mergedAt;
      const isOpen = pr.state === 'OPEN';
      const state: PrState = {
        isOpen,
        isDraft: !!pr.isDraft,
        isMerged,
        reviewDecision: null,
      };
      const status = statusForMyPr(state);
      const prefix = isMerged ? 'Merged' : isOpen ? (pr.isDraft ? 'Draft' : 'In review') : 'Closed';
      upsertTask({
        title: `${prefix}: ${pr.title} (${repo}#${pr.number})`,
        ref,
        url: pr.url,
        status,
        tags: ['my-pr', repo],
      });
      if (!before) created++;
    }

    for (const issue of issues) {
      const repo = issue.repository.nameWithOwner;
      if (!passesFilter(repo)) continue;
      const ref = `issue:${repo}#${issue.number}`;
      const before = tasksRepo.bySourceRef('github', ref);
      upsertTask({
        title: `Issue: ${issue.title} (${repo}#${issue.number})`,
        ref,
        url: issue.url,
        status: 'todo',
        tags: ['assigned-issue', repo],
      });
      if (!before) created++;
    }

    eventsRepo.log('collector.github.run', {
      mode: 'gh-cli',
      created,
      reviews: reviews.length,
      mine: mine.length,
      issues: issues.length,
    });
  } catch (err) {
    eventsRepo.log('collector.github.error', { mode: 'gh-cli', message: (err as Error).message });
    throw err;
  }
  return created;
}

// ---------- shared upsert with status update ----------

interface UpsertArgs {
  title: string;
  ref: string;
  url: string;
  status: TaskStatus;
  tags: string[];
}

function upsertTask(args: UpsertArgs): void {
  const existing = tasksRepo.bySourceRef('github', args.ref);
  if (existing) {
    const statusChanged = existing.status !== args.status;
    const titleChanged = existing.title !== args.title;
    if (statusChanged || titleChanged) {
      tasksRepo.update(existing.id, {
        title: args.title,
        status: args.status,
        url: args.url,
        tags: args.tags,
        lastTouchedAt: Date.now(),
      });
      if (statusChanged) {
        eventsRepo.log('github.status_change', {
          ref: args.ref,
          from: existing.status,
          to: args.status,
        }, existing.id);
      }
    }
    return;
  }
  tasksRepo.upsertBySourceRef({
    title: args.title,
    source: 'github',
    sourceRef: args.ref,
    url: args.url,
    tags: args.tags,
  });
  // upsertBySourceRef defaults status to 'todo'; update if different
  if (args.status !== 'todo') {
    const created = tasksRepo.bySourceRef('github', args.ref);
    if (created) tasksRepo.update(created.id, { status: args.status });
  }
}

function isoMinusDays(days: number): string {
  return new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10);
}
