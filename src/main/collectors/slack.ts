import { tasksRepo, eventsRepo } from '../db.js';
import { settings } from '../settings.js';
import { getCursor, setCursor } from './state.js';

const SLACK_API = 'https://slack.com/api';
const MAX_CHANNELS = 50;
const MAX_MESSAGES_PER_CHANNEL = 30;

export interface SlackStatus {
  ok: boolean;
  user?: string;
  team?: string;
  userId?: string;
  message?: string;
}

interface AuthTest {
  ok: boolean;
  url?: string;
  team?: string;
  user?: string;
  team_id?: string;
  user_id?: string;
  error?: string;
}

interface Channel {
  id: string;
  name?: string; // not present on IM
  is_im?: boolean;
  is_mpim?: boolean;
  is_channel?: boolean;
  is_group?: boolean;
  user?: string; // for IM, the other user's id
  is_archived?: boolean;
}

interface ConversationsList {
  ok: boolean;
  channels?: Channel[];
  error?: string;
  response_metadata?: { next_cursor?: string };
}

interface SlackMessage {
  type: string;
  subtype?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  ts: string; // "1700000000.123456"
  thread_ts?: string;
  reply_count?: number;
}

interface ConversationsHistory {
  ok: boolean;
  messages?: SlackMessage[];
  has_more?: boolean;
  error?: string;
}

interface UsersInfoResp {
  ok: boolean;
  user?: { id: string; name?: string; real_name?: string };
  error?: string;
}

async function slackGet<T>(token: string, endpoint: string, params: Record<string, string | number>): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
  const res = await fetch(`${SLACK_API}/${endpoint}?${qs.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Slack ${endpoint} HTTP ${res.status}`);
  const json = (await res.json()) as T & { ok?: boolean; error?: string };
  if (!json.ok) throw new Error(`Slack ${endpoint}: ${json.error ?? 'unknown_error'}`);
  return json;
}

export async function diagnoseSlack(): Promise<SlackStatus> {
  const token = settings.getSlackToken();
  if (!token) return { ok: false, message: 'No token set' };
  try {
    const r = await slackGet<AuthTest>(token, 'auth.test', {});
    return { ok: true, user: r.user, team: r.team, userId: r.user_id };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export function tsToMs(ts: string): number {
  // Slack ts format: "1700000000.123456" — seconds with microseconds.
  if (!ts) return 0;
  const [s, micro] = ts.split('.');
  const seconds = parseInt(s ?? '', 10);
  if (!Number.isFinite(seconds)) return 0;
  const millisFromMicro = parseInt((micro ?? '0').slice(0, 3), 10) || 0;
  return Math.round(seconds * 1000 + millisFromMicro);
}

export function isMessageActionable(
  msg: SlackMessage,
  selfUserId: string,
  channelType: 'im' | 'channel',
): boolean {
  if (!msg.text) return false;
  if (msg.bot_id) return false;
  if (msg.user === selfUserId) return false; // own messages
  if (msg.subtype === 'channel_join' || msg.subtype === 'channel_leave') return false;
  if (msg.subtype === 'bot_message') return false;
  if (channelType === 'im') return true; // any DM from another user is actionable
  // channel message: only if it mentions us
  return msg.text.includes(`<@${selfUserId}>`);
}

export function channelPassesExclude(name: string | undefined, exclude: string[]): boolean {
  if (!name) return true;
  return !exclude.some((s) => name.toLowerCase().includes(s.toLowerCase()));
}

export function deriveTitle(msg: SlackMessage, channelLabel: string, isDm: boolean): string {
  const text = (msg.text ?? '').replace(/<@\w+>/g, '@user').replace(/<#\w+\|([^>]+)>/g, '#$1');
  const trimmed = text.length > 100 ? text.slice(0, 99) + '…' : text;
  const prefix = isDm ? `DM ${channelLabel}` : `Mention ${channelLabel}`;
  return `${prefix}: ${trimmed}`;
}

async function resolveUserName(token: string, userId: string, cache: Map<string, string>): Promise<string> {
  if (cache.has(userId)) return cache.get(userId)!;
  try {
    const r = await slackGet<UsersInfoResp>(token, 'users.info', { user: userId });
    const name = r.user?.real_name ?? r.user?.name ?? userId;
    cache.set(userId, name);
    return name;
  } catch {
    cache.set(userId, userId);
    return userId;
  }
}

export async function runSlackCollector(): Promise<{ created: number }> {
  const cfg = settings.getSlack();
  if (!cfg.enabled) {
    eventsRepo.log('collector.slack.skipped', { reason: 'disabled' });
    return { created: 0 };
  }
  const token = settings.getSlackToken();
  if (!token) {
    eventsRepo.log('collector.slack.skipped', { reason: 'no_token' });
    return { created: 0 };
  }

  let auth: AuthTest;
  try {
    auth = await slackGet<AuthTest>(token, 'auth.test', {});
  } catch (err) {
    eventsRepo.log('collector.slack.error', { stage: 'auth', message: (err as Error).message });
    throw err;
  }
  const selfId = auth.user_id;
  if (!selfId) {
    eventsRepo.log('collector.slack.error', { stage: 'auth', message: 'no user_id in auth response' });
    return { created: 0 };
  }

  const types: string[] = [];
  if (cfg.includeDms) types.push('im', 'mpim');
  if (cfg.includeMentions) types.push('public_channel', 'private_channel');
  if (types.length === 0) {
    eventsRepo.log('collector.slack.skipped', { reason: 'no_types_enabled' });
    return { created: 0 };
  }

  let channels: Channel[];
  try {
    const r = await slackGet<ConversationsList>(token, 'conversations.list', {
      types: types.join(','),
      limit: MAX_CHANNELS,
      exclude_archived: 'true',
    });
    channels = r.channels ?? [];
  } catch (err) {
    eventsRepo.log('collector.slack.error', { stage: 'list', message: (err as Error).message });
    throw err;
  }

  const userCache = new Map<string, string>();
  let created = 0;
  let scanned = 0;

  for (const ch of channels) {
    if (ch.is_archived) continue;
    if (!channelPassesExclude(ch.name, cfg.channelExclude)) continue;

    const isDm = !!ch.is_im || !!ch.is_mpim;
    if (!isDm && !cfg.includeMentions) continue;
    if (isDm && !cfg.includeDms) continue;

    const cursorKey = `slack:${ch.id}`;
    const lastTs = getCursor(cursorKey);
    let newestSeen = lastTs;

    let history: ConversationsHistory;
    try {
      const params: Record<string, string | number> = { channel: ch.id, limit: MAX_MESSAGES_PER_CHANNEL };
      if (lastTs) params['oldest'] = lastTs;
      history = await slackGet<ConversationsHistory>(token, 'conversations.history', params);
    } catch (err) {
      eventsRepo.log('collector.slack.error', {
        stage: 'history',
        channel: ch.id,
        message: (err as Error).message,
      });
      continue;
    }

    const messages = history.messages ?? [];
    for (const msg of messages) {
      scanned++;
      if (!newestSeen || msg.ts > newestSeen) newestSeen = msg.ts;
      if (!isMessageActionable(msg, selfId, isDm ? 'im' : 'channel')) continue;

      let label: string;
      if (isDm) {
        const otherUser = ch.user ?? msg.user ?? 'unknown';
        label = `from ${await resolveUserName(token, otherUser, userCache)}`;
      } else {
        label = ch.name ? `#${ch.name}` : 'channel';
      }

      const ref = `${ch.id}:${msg.ts}`;
      if (tasksRepo.bySourceRef('slack', ref)) continue;

      tasksRepo.upsertBySourceRef({
        title: deriveTitle(msg, label, isDm),
        source: 'slack',
        sourceRef: ref,
        tags: ['slack', isDm ? 'dm' : 'mention', ch.name ?? ch.id],
        notes: msg.text ?? null,
      });
      created++;
    }

    if (newestSeen && newestSeen !== lastTs) setCursor(cursorKey, newestSeen);
  }

  eventsRepo.log('collector.slack.run', { channels: channels.length, scanned, created });
  return { created };
}
