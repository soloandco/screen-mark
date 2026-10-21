import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const temp = await mkdtemp(path.join(tmpdir(), 'screen-mark-mutation-'));
try {
  await mkdir(path.join(temp, 'extension')); await mkdir(path.join(temp, 'tests'));
  await writeFile(path.join(temp, 'package.json'), '{"type":"module"}');
  const model = await readFile(new URL('../extension/model.js', import.meta.url), 'utf8');
  const mutated = model.replace('index = Math.max(0, index - 1)', 'index = index');
  assert.notEqual(mutated, model, 'undo mutation must actually alter the source');
  await writeFile(path.join(temp, 'extension/model.js'), mutated);
  await writeFile(path.join(temp, 'tests/model.test.js'), await readFile(new URL('./model.test.js', import.meta.url)));
  const run = spawnSync(process.execPath, ['--test', 'tests/model.test.js'], { cwd: temp, encoding: 'utf8' });
  assert.notEqual(run.status, 0);
  assert.match(run.stdout, /not ok .*undo restores number availability/);
  console.log('PASS: disabling undo is caught by the number/history regression test. Production files were not modified.');
} finally {
  const relative = path.relative(path.resolve(tmpdir()), path.resolve(temp));
  if (!relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(temp).startsWith('screen-mark-mutation-')) await rm(temp, { recursive: true, force: true });
  else throw new Error('Refusing to remove a path outside the mutation temporary directory');
}
