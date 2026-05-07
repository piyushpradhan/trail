import { runGithubCollector } from './github.js';
import { runLinearCollector } from './linear.js';
import { runSlackCollector } from './slack.js';
import { runClaudeCollector } from './claude.js';
import { runCodexCollector } from './codex.js';
import { runOpencodeCollector } from './opencode.js';
import { runTmuxCollector } from './tmux.js';
import { runTerminalCollector } from './terminal.js';

export const collectors = {
  github: runGithubCollector,
  linear: runLinearCollector,
  slack: runSlackCollector,
  claude: runClaudeCollector,
  codex: runCodexCollector,
  opencode: runOpencodeCollector,
  tmux: runTmuxCollector,
  terminal: runTerminalCollector,
} as const;

export type CollectorName = keyof typeof collectors;

export async function runAllCollectors(): Promise<{ ran: string[]; created: number }> {
  let created = 0;
  const ran: string[] = [];
  for (const [name, fn] of Object.entries(collectors)) {
    try {
      const r = await fn();
      created += r.created;
      ran.push(name);
    } catch {
      // logged inside collector
    }
  }
  return { ran, created };
}
