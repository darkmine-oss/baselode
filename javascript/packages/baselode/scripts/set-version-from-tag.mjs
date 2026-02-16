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
    return;
  }

  pkg.version = version;
  writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  console.log(`Updated package.json version -> ${version}`);
}

const rawTag = resolveTag();
const version = versionFromTag(rawTag);

updatePackageVersion(version);
