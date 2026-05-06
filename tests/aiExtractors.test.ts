import { describe, it, expect } from 'vitest';
import { extractUserText } from '../src/main/collectors/claude.js';
import { extractText } from '../src/main/collectors/codex.js';

describe('claude extractUserText', () => {
  it('returns string content as-is', () => {
    expect(extractUserText('hello world')).toBe('hello world');
  });

  it('joins text blocks from array', () => {
    const blocks = [
      { type: 'text', text: 'first' },
      { type: 'text', text: 'second' },
    ];
    expect(extractUserText(blocks)).toBe('first\nsecond');
  });

  it('ignores non-text blocks (tool_result etc.)', () => {
    const blocks = [
      { type: 'tool_result', content: 'noise' },
      { type: 'text', text: 'keep me' },
      { type: 'image', source: {} },
    ];
    expect(extractUserText(blocks)).toBe('keep me');
  });

  it('returns null for empty array (no text blocks)', () => {
    expect(extractUserText([])).toBeNull();
    expect(extractUserText([{ type: 'tool_result', content: 'x' }])).toBeNull();
  });

  it('returns null for null/undefined/object content', () => {
    expect(extractUserText(null)).toBeNull();
    expect(extractUserText(undefined)).toBeNull();
    expect(extractUserText({ random: 'shape' })).toBeNull();
  });

  it('handles malformed text block (missing text field)', () => {
    expect(extractUserText([{ type: 'text' }])).toBeNull();
  });
});

describe('codex extractText', () => {
  it('returns string content directly', () => {
    expect(extractText('plain')).toBe('plain');
  });

  it('extracts text and input_text block types', () => {
    const r = extractText([
      { type: 'text', text: 'a' },
      { type: 'input_text', text: 'b' },
      { type: 'image', text: 'should not appear' },
    ]);
    expect(r).toBe('a\nb');
  });

  it('extracts text from object with text field', () => {
    expect(extractText({ text: 'wrapped' })).toBe('wrapped');
  });

  it('returns null when object has no text field', () => {
    expect(extractText({ foo: 'bar' })).toBeNull();
  });

  it('returns null on empty/invalid input', () => {
    expect(extractText(null)).toBeNull();
    expect(extractText([])).toBeNull();
    expect(extractText(123)).toBeNull();
  });
});
