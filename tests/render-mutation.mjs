import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'screen-mark-render-mutation-'));
const changes = [
  ['frame batching', 'if (frame !== null) return;', 'if (false) return;', 'pointer redraw requests share one frame'],
  ['export sharing', 'if (entry) return entry.promise;', 'if (false) return entry.promise;', 'PNG export shares pending work'],
  ['edit invalidation', 'invalidate() { entry = null; }', 'invalidate() {}', 'an edit invalidates PNG results']
];
try {
  await mkdir(path.join(temporary, 'extension'));
  await mkdir(path.join(temporary, 'tests'));
  await writeFile(path.join(temporary, 'package.json'), '{"type":"module"}');
  for (const name of ['model.js', 'render.js']) await cp(path.join(root, 'extension', name), path.join(temporary, 'extension', name));
  await cp(path.join(root, 'tests/render-work.test.js'), path.join(temporary, 'tests/render-work.test.js'));
  const original = await readFile(path.join(temporary, 'extension/render.js'), 'utf8');
  for (const [name, before, after, testName] of changes) {
    assert.ok(original.includes(before), `${name}: mutation target missing`);
    const modified = original.replace(before, after); assert.notEqual(original, modified);
    await writeFile(path.join(temporary, 'extension/render.js'), modified);
    const run = spawnSync(process.execPath, ['--test', 'tests/render-work.test.js'], { cwd: temporary, encoding: 'utf8', timeout: 15000 });
    assert.equal(run.status, 1, `${name}: mutation did not fail as expected\n${run.stdout}\n${run.stderr}`);
    assert.ok(run.stdout.split('\n').some(line => line.startsWith('not ok') && line.includes(testName)), `${name}: expected regression test did not catch the mutation\n${run.stdout}`);
    console.log(`PASS: ${name} mutation rejected by its regression test`);
  }
  await writeFile(path.join(temporary, 'extension/render.js'), original);
  execFileSync(process.execPath, ['--test', 'tests/render-work.test.js'], { cwd: temporary, stdio: 'pipe' });
  console.log('PASS: restored source passes all render-work tests');
} finally {
  const relative = path.relative(os.tmpdir(), temporary);
  if (!relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(temporary).startsWith('screen-mark-render-mutation-')) await rm(temporary, { recursive: true, force: true });
  else throw new Error('Refusing to delete outside the mutation test temporary directory');
}
