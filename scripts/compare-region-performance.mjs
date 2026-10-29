import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const trials = Number(process.env.BENCH_TRIALS || 3);
assert.ok(Number.isInteger(trials) && trials > 0 && trials <= 20);
const baselineSha = execFileSync('git', ['rev-parse', process.env.BENCH_BASELINE || '4df00cb'], { cwd: root, encoding: 'utf8' }).trim();
const temporary = await mkdtemp(path.join(os.tmpdir(), 'screen-mark-region-compare-'));
const baseline = path.join(temporary, 'baseline');
const output = path.resolve(root, process.env.BENCH_OUTPUT || 'test-results/performance-region-comparison');
await mkdir(output, { recursive: true });
const names = execFileSync('git', ['ls-tree', '-r', '--name-only', baselineSha, 'extension'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
for (const name of names) {
  const destination = path.join(baseline, name.slice('extension/'.length));
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, execFileSync('git', ['show', `${baselineSha}:${name}`], { cwd: root }));
}
const groups = {};
try {
  for (let trial = 1; trial <= trials; trial++) {
    for (const label of trial % 2 ? ['before', 'after'] : ['after', 'before']) {
      const destination = path.join(output, `${label}-${trial}`);
      console.log(`${label.toUpperCase()} ${trial}/${trials}`);
      await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(root, 'scripts/benchmark-region.mjs')], {
          cwd: root, windowsHide: true, stdio: 'inherit',
          env: { ...process.env, BENCH_TRIALS: '1', BENCH_EXTENSION: label === 'before' ? baseline : path.join(root, 'extension'), BENCH_OUTPUT: destination }
        });
        child.on('error', reject);
        child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${label} trial ${trial} exited with ${code}`)));
      });
      const data = JSON.parse(await readFile(path.join(destination, 'raw.json'), 'utf8'));
      assert.equal(data.runs.length, 1);
      if (!groups[label]) groups[label] = { ...data, baselineSha, environment: { ...data.environment, trials, comparisonOrder: 'Alternating before/after then after/before; a fresh isolated Chrome profile for each run' }, runs: [] };
      assert.equal(data.sourceSha256, groups[label].sourceSha256, 'source changed during the benchmark');
      groups[label].runs.push({ ...data.runs[0], trial });
      await writeFile(path.join(output, `${label}.json`), JSON.stringify(groups[label], null, 2));
    }
  }
} finally {
  const relative = path.relative(os.tmpdir(), temporary);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(temporary).startsWith('screen-mark-region-compare-'));
  await rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
}
