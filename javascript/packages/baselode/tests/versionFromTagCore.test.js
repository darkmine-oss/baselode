import { describe, expect, it } from 'vitest';

import {
  getTagFromEnv,
  isValidSemver,
  normalizeTag,
  resolveTag,
  versionFromTag
} from '../scripts/versionFromTagCore.mjs';

describe('normalizeTag', () => {
  it('strips refs/tags/ and leading v prefix', () => {
    expect(normalizeTag('refs/tags/v0.1.0')).toBe('0.1.0');
  });

  it('strips only the leading v prefix', () => {
    expect(normalizeTag('v1.2.3')).toBe('1.2.3');
  });

  it('leaves plain semver unchanged', () => {
    expect(normalizeTag('2.0.0')).toBe('2.0.0');
  });
});

describe('semver validation', () => {
  it('accepts valid versions', () => {
    expect(isValidSemver('0.1.0')).toBe(true);
    expect(isValidSemver('1.2.3-rc.1')).toBe(true);
    expect(isValidSemver('1.2.3+build.5')).toBe(true);
  });

  it('rejects invalid versions', () => {
    expect(isValidSemver('v0.1.0')).toBe(false);
    expect(isValidSemver('1.2')).toBe(false);
    expect(isValidSemver('main')).toBe(false);
  });

  it('throws when tag does not normalize to valid semver', () => {
    expect(() => versionFromTag('release-2026-02-16')).toThrow(
      'does not map to a valid semver'
    );
  });
});

describe('resolveTag', () => {
  it('prefers GITHUB_REF_NAME from env', () => {
    const tag = resolveTag({
      env: { GITHUB_REF_NAME: 'v0.1.0' },
      runGitFn: () => {
        throw new Error('runGit should not be called');
      }
    });
    expect(tag).toBe('v0.1.0');
  });

  it('uses GITHUB_REF refs/tags fallback from env', () => {
    const tag = getTagFromEnv({ GITHUB_REF: 'refs/tags/v0.2.0' });
    expect(tag).toBe('v0.2.0');
  });

  it('falls back to exact git tag on HEAD', () => {
    const tag = resolveTag({
      env: {},
      runGitFn: (args) => {
        if (args.join(' ') === 'describe --tags --exact-match HEAD') {
          return 'v0.3.0';
        }
        return '';
      }
    });
    expect(tag).toBe('v0.3.0');
  });

  it('falls back to first tag from git tag --points-at HEAD', () => {
    const tag = resolveTag({
      env: {},
      runGitFn: (args) => {
        if (args.join(' ') === 'describe --tags --exact-match HEAD') {
          throw new Error('no exact tag');
        }
        if (args.join(' ') === 'tag --points-at HEAD') {
          return '\n\nv0.4.0\nv0.3.9\n';
        }
        return '';
      }
    });
    expect(tag).toBe('v0.4.0');
  });

  it('throws when no environment or git tags resolve', () => {
    expect(() =>
      resolveTag({
        env: {},
        runGitFn: (args) => {
          if (args.join(' ') === 'describe --tags --exact-match HEAD') {
            throw new Error('no exact tag');
          }
          return '';
        }
      })
    ).toThrow('No git tag found for HEAD');
  });
});
