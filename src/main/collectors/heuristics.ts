const ACTION_VERBS = [
  'fix', 'add', 'create', 'build', 'write', 'refactor', 'debug',
  'review', 'test', 'deploy', 'run', 'generate', 'implement',
  'update', 'remove', 'delete', 'check', 'ensure', 'make',
  'investigate', 'follow up', 'followup', 'verify', 'audit',
  'rename', 'migrate', 'wire', 'hook', 'connect', 'finish',
  'rewrite', 'patch', 'merge',
];

const MARKERS = /\b(TODO|TASK|FIXME|FOLLOW[- ]?UP|REMINDER)\b/i;
const QUESTION_ONLY = /^(what|why|how|when|where|who|can you|could you|do you|is it|does it)\b.*\?$/i;

const MIN_LEN = 20;
const MAX_LEN = 300;

export interface ScoreResult {
  isTask: boolean;
  reason: string;
  title: string;
}

export function scorePrompt(raw: string): ScoreResult {
  const text = raw.trim().replace(/\s+/g, ' ');
  if (text.length < MIN_LEN) return { isTask: false, reason: 'too short', title: text };

  const truncated = text.length > MAX_LEN ? text.slice(0, MAX_LEN - 1) + '…' : text;
  const firstLine = text.split(/[.\n]/)[0]?.trim() ?? text;
  const title = firstLine.length > 120 ? firstLine.slice(0, 119) + '…' : firstLine;

  if (MARKERS.test(text)) return { isTask: true, reason: 'marker', title };

  const lower = text.toLowerCase();
  if (QUESTION_ONLY.test(text)) return { isTask: false, reason: 'pure question', title: truncated };

  const startsWithVerb = ACTION_VERBS.some(
    (v) => lower.startsWith(v + ' ') || lower.startsWith(v + ','),
  );
  if (startsWithVerb) return { isTask: true, reason: 'imperative', title };

  return { isTask: false, reason: 'no signal', title: truncated };
}

export function projectFromSlug(slug: string): string {
  // Reverse of Claude's path encoding: "C--Users-Piyush-projects-foo" → friendly name
  const parts = slug.split('-').filter(Boolean);
  return parts[parts.length - 1] ?? slug;
}
