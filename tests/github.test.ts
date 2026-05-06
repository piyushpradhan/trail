import { describe, it, expect } from 'vitest';
import {
  repoFromApiUrl,
  repoMatchesFilter,
  statusForMyPr,
  statusForReviewRequested,
} from '../src/main/collectors/github.js';

describe('repoFromApiUrl', () => {
  it('extracts owner/name', () => {
    expect(repoFromApiUrl('https://api.github.com/repos/foo/bar')).toBe('foo/bar');
  });

  it('returns empty for non-matching URL', () => {
    expect(repoFromApiUrl('not-a-url')).toBe('');
    expect(repoFromApiUrl('https://api.github.com/users/foo')).toBe('');
  });

  it('handles dots and hyphens in repo names', () => {
    expect(repoFromApiUrl('https://api.github.com/repos/owner/my-repo.js')).toBe(
      'owner/my-repo.js',
    );
  });
});

describe('repoMatchesFilter', () => {
  it('include empty + exclude empty → match all', () => {
    expect(repoMatchesFilter('foo/bar', [], [])).toBe(true);
  });

  it('exclude wins over include', () => {
    expect(repoMatchesFilter('acme/sandbox', ['acme/'], ['sandbox'])).toBe(false);
  });

  it('include with substring match', () => {
    expect(repoMatchesFilter('acme/foo', ['acme/'], [])).toBe(true);
    expect(repoMatchesFilter('other/foo', ['acme/'], [])).toBe(false);
  });

  it('exclude only — everything else passes', () => {
    expect(repoMatchesFilter('foo/bar', [], ['archive'])).toBe(true);
    expect(repoMatchesFilter('archive-org/x', [], ['archive'])).toBe(false);
  });
});

describe('statusForMyPr', () => {
  it('merged → done regardless of other state', () => {
    expect(statusForMyPr({ isOpen: true, isDraft: true, isMerged: true, reviewDecision: null })).toBe('done');
    expect(statusForMyPr({ isOpen: false, isDraft: false, isMerged: true, reviewDecision: 'CHANGES_REQUESTED' })).toBe('done');
  });

  it('closed and not merged → blocked', () => {
    expect(statusForMyPr({ isOpen: false, isDraft: false, isMerged: false, reviewDecision: null })).toBe('blocked');
  });

  it('open + draft → in_progress', () => {
    expect(statusForMyPr({ isOpen: true, isDraft: true, isMerged: false, reviewDecision: null })).toBe('in_progress');
  });

  it('open + changes_requested → blocked', () => {
    expect(
      statusForMyPr({ isOpen: true, isDraft: false, isMerged: false, reviewDecision: 'CHANGES_REQUESTED' }),
    ).toBe('blocked');
  });

  it('open + ready + approved (or no decision) → in_progress', () => {
    expect(statusForMyPr({ isOpen: true, isDraft: false, isMerged: false, reviewDecision: null })).toBe('in_progress');
    expect(statusForMyPr({ isOpen: true, isDraft: false, isMerged: false, reviewDecision: 'APPROVED' })).toBe('in_progress');
  });
});

describe('statusForReviewRequested', () => {
  it('merged or closed → done (review no longer needed)', () => {
    expect(statusForReviewRequested({ isOpen: false, isDraft: false, isMerged: true, reviewDecision: null })).toBe('done');
    expect(statusForReviewRequested({ isOpen: false, isDraft: false, isMerged: false, reviewDecision: null })).toBe('done');
  });

  it('open → todo', () => {
    expect(statusForReviewRequested({ isOpen: true, isDraft: false, isMerged: false, reviewDecision: null })).toBe('todo');
  });
});
