import { tasksRepo, eventsRepo } from '../db.js';
import { settings } from '../settings.js';
import type { TaskStatus } from '@shared/types';

export interface LinearStatus {
  ok: boolean;
  user?: string;
  email?: string;
  message?: string;
}

interface GqlResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

interface ViewerResp {
  viewer: { id: string; name: string; email: string };
}

interface IssueNode {
  id: string;
  identifier: string; // e.g. ENG-123
  title: string;
  url: string;
  branchName?: string | null;
  updatedAt: string;
  state: { name: string; type: LinearStateType };
  team: { key: string; name: string };
  assignee: { id: string; name: string } | null;
  parent?: { id: string; title: string } | null;
}

type LinearStateType =
  | 'triage'
  | 'backlog'
  | 'unstarted'
  | 'started'
  | 'completed'
  | 'canceled';

interface IssuesResp {
  issues: { nodes: IssueNode[] };
}

const LINEAR_API = 'https://api.linear.app/graphql';

async function gql<T>(token: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(LINEAR_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token, // Linear PAT is sent as-is, not "Bearer ..."
      'User-Agent': 'Trail/0.1',
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as GqlResponse<T>;
  if (!res.ok || json.errors?.length) {
    const msg = json.errors?.map((e) => e.message).join('; ') ?? `HTTP ${res.status}`;
    throw new Error(`Linear: ${msg}`);
  }
  if (!json.data) throw new Error('Linear: empty response');
  return json.data;
}

export function statusFromLinearState(stateType: LinearStateType): TaskStatus {
  switch (stateType) {
    case 'completed':
      return 'done';
    case 'canceled':
      return 'blocked';
    case 'started':
      return 'in_progress';
    case 'triage':
    case 'backlog':
    case 'unstarted':
      return 'todo';
    default:
      return 'todo';
  }
}

export function teamPassesFilter(teamKey: string, filter: string[]): boolean {
  if (filter.length === 0) return true;
  return filter.some((f) => teamKey.toUpperCase().includes(f.toUpperCase()));
}

export async function diagnoseLinear(): Promise<LinearStatus> {
  const token = settings.getLinearToken();
  if (!token) return { ok: false, message: 'No API key set' };
  try {
    const data = await gql<ViewerResp>(token, 'query { viewer { id name email } }');
    return { ok: true, user: data.viewer.name, email: data.viewer.email };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

const ISSUES_QUERY = /* GraphQL */ `
  query AssignedIssues($cursor: String) {
    issues(
      first: 50
      after: $cursor
      filter: { assignee: { isMe: { eq: true } }, state: { type: { nin: ["canceled"] } } }
      orderBy: updatedAt
    ) {
      nodes {
        id
        identifier
        title
        url
        branchName
        updatedAt
        state { name type }
        team { key name }
        assignee { id name }
        parent { id title }
      }
    }
  }
`;

const RECENT_COMPLETED_QUERY = /* GraphQL */ `
  query RecentlyCompleted($since: DateTimeOrDuration!) {
    issues(
      first: 30
      filter: {
        assignee: { isMe: { eq: true } }
        state: { type: { eq: "completed" } }
        completedAt: { gte: $since }
      }
      orderBy: updatedAt
    ) {
      nodes {
        id
        identifier
        title
        url
        branchName
        updatedAt
        state { name type }
        team { key name }
        assignee { id name }
        parent { id title }
      }
    }
  }
`;

interface UpsertArgs {
  ref: string;
  title: string;
  url: string;
  status: TaskStatus;
  tags: string[];
  branch?: string | null;
}

function upsert(args: UpsertArgs): { created: boolean; statusChanged: boolean } {
  const existing = tasksRepo.bySourceRef('linear', args.ref);
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
        eventsRepo.log(
          'linear.status_change',
          { ref: args.ref, from: existing.status, to: args.status },
          existing.id,
        );
      }
    }
    return { created: false, statusChanged };
  }
  tasksRepo.upsertBySourceRef({
    title: args.title,
    source: 'linear',
    sourceRef: args.ref,
    url: args.url,
    tags: args.tags,
    notes: args.branch ? `branch: ${args.branch}` : null,
  });
  if (args.status !== 'todo') {
    const created = tasksRepo.bySourceRef('linear', args.ref);
    if (created) tasksRepo.update(created.id, { status: args.status });
  }
  return { created: true, statusChanged: false };
}

function titleForIssue(node: IssueNode): string {
  return `${node.identifier}: ${node.title}`;
}

export async function runLinearCollector(): Promise<{ created: number }> {
  const cfg = settings.getLinear();
  if (!cfg.enabled) {
    eventsRepo.log('collector.linear.skipped', { reason: 'disabled' });
    return { created: 0 };
  }
  const token = settings.getLinearToken();
  if (!token) {
    eventsRepo.log('collector.linear.skipped', { reason: 'no_token' });
    return { created: 0 };
  }

  let created = 0;
  let processed = 0;

  try {
    const active = await gql<IssuesResp>(token, ISSUES_QUERY);
    for (const node of active.issues.nodes) {
      if (!teamPassesFilter(node.team.key, cfg.teamFilter)) continue;
      const status = statusFromLinearState(node.state.type);
      const r = upsert({
        ref: node.id,
        title: titleForIssue(node),
        url: node.url,
        status,
        tags: ['linear', node.team.key, node.state.name.toLowerCase()],
        branch: node.branchName,
      });
      if (r.created) created++;
      processed++;
    }

    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const completed = await gql<IssuesResp>(token, RECENT_COMPLETED_QUERY, { since });
    for (const node of completed.issues.nodes) {
      if (!teamPassesFilter(node.team.key, cfg.teamFilter)) continue;
      const r = upsert({
        ref: node.id,
        title: titleForIssue(node),
        url: node.url,
        status: 'done',
        tags: ['linear', node.team.key, node.state.name.toLowerCase()],
        branch: node.branchName,
      });
      if (r.created) created++;
      processed++;
    }
  } catch (err) {
    eventsRepo.log('collector.linear.error', { message: (err as Error).message });
    throw err;
  }

  eventsRepo.log('collector.linear.run', { processed, created });
  return { created };
}
