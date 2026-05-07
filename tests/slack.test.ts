import { describe, it, expect } from 'vitest';
import {
  tsToMs,
  isMessageActionable,
  channelPassesExclude,
  deriveTitle,
} from '../src/main/collectors/slack.js';

describe('tsToMs', () => {
  it('parses Slack ts format with microseconds', () => {
    expect(tsToMs('1700000000.123456')).toBe(1700000000_123);
  });
  it('handles ts without microseconds', () => {
    expect(tsToMs('1700000000.000000')).toBe(1700000000_000);
  });
  it('handles malformed input gracefully', () => {
    expect(tsToMs('')).toBe(0);
  });
});

describe('isMessageActionable', () => {
  const me = 'U_ME';

  it('rejects own messages', () => {
    expect(
      isMessageActionable({ type: 'message', user: me, text: 'hi', ts: '1' }, me, 'im'),
    ).toBe(false);
  });

  it('accepts DM from another user', () => {
    expect(
      isMessageActionable({ type: 'message', user: 'U_OTHER', text: 'hey', ts: '1' }, me, 'im'),
    ).toBe(true);
  });

  it('rejects bot messages', () => {
    expect(
      isMessageActionable(
        { type: 'message', bot_id: 'B1', text: 'beep', ts: '1' },
        me,
        'im',
      ),
    ).toBe(false);
    expect(
      isMessageActionable(
        { type: 'message', subtype: 'bot_message', text: 'beep', ts: '1' },
        me,
        'channel',
      ),
    ).toBe(false);
  });

  it('rejects channel join/leave subtypes', () => {
    expect(
      isMessageActionable(
        { type: 'message', subtype: 'channel_join', user: 'U_OTHER', text: 'joined', ts: '1' },
        me,
        'channel',
      ),
    ).toBe(false);
  });

  it('rejects channel messages without mention', () => {
    expect(
      isMessageActionable(
        { type: 'message', user: 'U_OTHER', text: 'hello world', ts: '1' },
        me,
        'channel',
      ),
    ).toBe(false);
  });

  it('accepts channel messages with mention of self', () => {
    expect(
      isMessageActionable(
        { type: 'message', user: 'U_OTHER', text: 'hey <@U_ME> ping', ts: '1' },
        me,
        'channel',
      ),
    ).toBe(true);
  });

  it('rejects channel messages mentioning someone else', () => {
    expect(
      isMessageActionable(
        { type: 'message', user: 'U_OTHER', text: 'hey <@U_OTHER2> ping', ts: '1' },
        me,
        'channel',
      ),
    ).toBe(false);
  });

  it('rejects empty text', () => {
    expect(
      isMessageActionable({ type: 'message', user: 'U_OTHER', text: '', ts: '1' }, me, 'im'),
    ).toBe(false);
  });
});

describe('channelPassesExclude', () => {
  it('empty exclude → all pass', () => {
    expect(channelPassesExclude('general', [])).toBe(true);
  });
  it('substring excludes (case-insensitive)', () => {
    expect(channelPassesExclude('alerts-prod', ['alerts'])).toBe(false);
    expect(channelPassesExclude('Bot-Notifications', ['bot'])).toBe(false);
  });
  it('non-matching channel passes', () => {
    expect(channelPassesExclude('general', ['alerts', 'bot'])).toBe(true);
  });
  it('undefined name passes (e.g. IM channel)', () => {
    expect(channelPassesExclude(undefined, ['anything'])).toBe(true);
  });
});

describe('deriveTitle', () => {
  it('DM uses "DM from <user>" prefix', () => {
    expect(
      deriveTitle({ type: 'm', text: 'hello', ts: '1' } as any, 'from Alice', true),
    ).toBe('DM from Alice: hello');
  });
  it('mention uses channel name', () => {
    expect(
      deriveTitle({ type: 'm', text: 'review please', ts: '1' } as any, '#eng', false),
    ).toBe('Mention #eng: review please');
  });
  it('truncates long messages to 100 chars', () => {
    const long = 'a'.repeat(500);
    const t = deriveTitle({ type: 'm', text: long, ts: '1' } as any, '#x', false);
    // Prefix "Mention #x: " plus truncated body capped at ~100
    expect(t.endsWith('…')).toBe(true);
    expect(t.length).toBeLessThan(120);
  });
  it('strips Slack user mention encoding from title text', () => {
    const t = deriveTitle(
      { type: 'm', text: 'pls <@U999> check this', ts: '1' } as any,
      '#eng',
      false,
    );
    expect(t).toContain('@user');
    expect(t).not.toContain('U999');
  });
  it('rewrites <#C123|name> channel mentions to #name', () => {
    const t = deriveTitle(
      { type: 'm', text: 'see <#C123|design> for details', ts: '1' } as any,
      '#eng',
      false,
    );
    expect(t).toContain('#design');
    expect(t).not.toContain('C123');
  });
});
