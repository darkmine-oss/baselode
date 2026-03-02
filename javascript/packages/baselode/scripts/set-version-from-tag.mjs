import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveTag, versionFromTag } from './versionFromTagCore.mjs';

function updatePackageVersion(version) {
  const here = dirname(fileURLToPath(import.meta.url));
  const packageJsonPath = join(here, '..', 'package.json');
  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

  if (pkg.version === version) {
    console.log(`package.json already at version ${version}`);
  } else {
    pkg.version = version;
    writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
    console.log(`Updated package.json version -> ${version}`);
  }

  // Keep package-lock.json in sync so npm does not regenerate it during publish.
  const lockPath = join(here, '..', 'package-lock.json');
  try {
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    let changed = false;
    if (lock.version !== version) {
      lock.version = version;
      changed = true;
    }
    // The root package entry is also stored under packages['']
    if (lock.packages?.['']?.version !== version) {
      lock.packages[''].version = version;
      changed = true;
    }
    if (changed) {
      writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
      console.log(`Updated package-lock.json version -> ${version}`);
    } else {
      console.log(`package-lock.json already at version ${version}`);
    }
  } catch {
    // No lock file present — nothing to do.
  }
}

const rawTag = resolveTag();
const version = versionFromTag(rawTag);

updatePackageVersion(version);
