import { execFileSync } from 'node:child_process';

export const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function runGit(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

export function getTagFromEnv(env = process.env) {
  if (env.GITHUB_REF_NAME) return String(env.GITHUB_REF_NAME).trim();
  const ref = String(env.GITHUB_REF || '').trim();
  if (ref.startsWith('refs/tags/')) return ref.slice('refs/tags/'.length);
  return '';
}

export function normalizeTag(tag = '') {
  const clean = String(tag).replace(/^refs\/tags\//, '').trim();
  return clean.startsWith('v') ? clean.slice(1) : clean;
}

export function isValidSemver(version) {
  return SEMVER_RE.test(version);
}

export function versionFromTag(rawTag) {
  const version = normalizeTag(rawTag);
  if (!isValidSemver(version)) {
    throw new Error(`Tag "${rawTag}" does not map to a valid semver version.`);
  }
  return version;
}

export function resolveTag({ env = process.env, runGitFn = runGit } = {}) {
  const envTag = getTagFromEnv(env);
  if (envTag) return envTag;

  try {
    const exact = runGitFn(['describe', '--tags', '--exact-match', 'HEAD']);
    if (exact) return exact;
  } catch {
    // Ignore and try fallback.
  }

  const pointsAtHead = runGitFn(['tag', '--points-at', 'HEAD'])
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);

  if (pointsAtHead.length > 0) {
    return pointsAtHead[0];
  }

  throw new Error(
    'No git tag found for HEAD. Tag the commit (e.g., v0.1.0) before packing/publishing.'
  );
}
