import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const legacyNames = ['pay' + 'replayy', 'pay' + 'relayy', 'pay' + 'relay'];
const legacyPattern = new RegExp(legacyNames.join('|'), 'i');

const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { encoding: 'utf8' },
)
  .split('\0')
  .filter(Boolean);

const violations = [];

for (const file of files) {
  const normalizedFile = file.replaceAll('\\', '/');

  // Applied migrations are immutable audit history. The forward rename migration
  // also needs the legacy role names in order to rename them safely by role OID.
  if (normalizedFile.startsWith('supabase/migrations/')) {
    continue;
  }

  if (!existsSync(file)) {
    continue;
  }

  if (legacyPattern.test(normalizedFile)) {
    violations.push(`${normalizedFile}: legacy brand in path`);
  }

  const contents = readFileSync(file);
  if (contents.includes(0)) {
    continue;
  }

  const lines = contents.toString('utf8').split(/\r?\n/u);
  for (const [index, line] of lines.entries()) {
    if (legacyPattern.test(line)) {
      violations.push(`${normalizedFile}:${index + 1}: legacy brand in content`);
    }
  }
}

if (violations.length > 0) {
  console.error('FetanAgent brand verification failed:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exitCode = 1;
} else {
  console.log('FetanAgent brand verification passed.');
}
