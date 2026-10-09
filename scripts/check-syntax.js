// check-syntax.js — syntax-check all JS sources via node --check, driven by a
// single Node process (avoids flaky per-file bash->node spawns on Windows).
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const files = ['server.js'];
for (const dir of ['src', 'test']) {
  for (const f of readdirSync(dir)) if (f.endsWith('.js')) files.push(join(dir, f));
}

let failed = 0;
for (const file of files) {
  const r = spawnSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  if (r.status !== 0) {
    failed++;
    console.error(`SYNTAX ERROR in ${file}:\n${r.stderr}`);
  }
}
if (failed) {
  console.error(`${failed} of ${files.length} file(s) failed the syntax check`);
  process.exit(1);
}
console.log(`Syntax OK (${files.length} files)`);
