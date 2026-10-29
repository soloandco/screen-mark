import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { useKorean } from '../tests/support/language.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselineRef = process.env.BENCH_BASELINE || 'd5aed23';
const trials = Number(process.env.BENCH_TRIALS || 5);
assert.ok(Number.isInteger(trials) && trials > 0 && trials <= 20);
const output = path.resolve(root, process.env.BENCH_OUTPUT || 'test-results/performance');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'screen-mark-bench-'));
await mkdir(output, { recursive: true });
const baseline = path.join(temporary, 'before');
const after = path.join(temporary, 'after');
await mkdir(baseline);
const baselineSha = execFileSync('git', ['rev-parse', baselineRef], { cwd: root, encoding: 'utf8' }).trim();
const baselineFiles = execFileSync('git', ['ls-tree', '-r', '--name-only', baselineSha, 'extension'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
for (const file of baselineFiles) {
  const destination = path.join(baseline, file.slice('extension/'.length));
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, execFileSync('git', ['show', `${baselineSha}:${file}`], { cwd: root, maxBuffer: 4 * 1024 * 1024 }));
}
await cp(path.join(root, 'extension'), after, { recursive: true });

// A deterministic, non-personal long image with text, gradients and thin edges.
const fixture = path.join(temporary, 'long.png');
const sections = Array.from({ length: 40 }, (_, i) => `<rect x="40" y="${i * 250 + 20}" width="1520" height="210" rx="12" fill="${i % 2 ? '#e4ece3' : '#fffdf5'}" stroke="#809480"/><text x="80" y="${i * 250 + 100}" font-size="36" fill="#245b46">Screen Mark benchmark section ${i + 1}</text><path d="M80 ${i * 250 + 130}h1300m-1300 30h1100m-1100 30h1200" stroke="#9aab93"/>`).join('');
await sharp(Buffer.from(`<svg width="1600" height="10000" xmlns="http://www.w3.org/2000/svg"><rect width="1600" height="10000" fill="#d4dfd0"/>${sections}</svg>`)).png().toFile(fixture);
const fixtureBytes = await readFile(fixture);

const server = http.createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end('<!doctype html><title>Screen Mark performance fixture</title><style>body{margin:0;background:#f7f5ee;font:22px sans-serif}header{height:90px;background:#245b46;color:white;padding:24px;box-sizing:border-box}article{display:grid;grid-template-columns:repeat(4,1fr);gap:20px;padding:30px}section{padding:30px;background:linear-gradient(120deg,#d4dfd0,#fffdf5);border:1px solid #809480;height:200px}h2{color:#245b46}</style><header>Screen Mark performance fixture</header><article>' + Array.from({ length: 32 }, (_, i) => `<section><h2>Section ${i + 1}</h2><p>Rectangle, number label and clipboard.</p></section>`).join('') + '</article>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const sourceUrl = `http://127.0.0.1:${server.address().port}/`;

// Private working set includes native image/canvas memory, unlike JS heap size.
let reader;
const responses = new Map(); let sequence = 0;
if (process.platform === 'win32') {
  reader = spawn(process.env.BENCH_PYTHON || 'python', [path.join(root, 'scripts/process-memory.py')], { windowsHide: true, stdio: ['pipe', 'pipe', 'inherit'] });
  createInterface({ input: reader.stdout }).on('line', line => {
    const result = JSON.parse(line); const pending = responses.get(result.id);
    if (pending) { responses.delete(result.id); clearTimeout(pending.timer); pending.resolve(result); }
  });
  reader.on('error', error => {
    for (const pending of responses.values()) { clearTimeout(pending.timer); pending.reject(error); }
    responses.clear();
  });
}
async function memory(cdp, stage) {
  if (!reader) return null;
  const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
  const result = await new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { responses.delete(id); reject(new Error('Process memory reader timed out')); }, 10000);
    responses.set(id, { resolve, reject, timer });
    reader.stdin.write(JSON.stringify({ id, processes: processInfo.map(({ id, type }) => ({ id, type })) }) + '\n');
  });
  assert.ok(result.processes?.length, JSON.stringify(result));
  // A short-lived Chrome utility process may exit between the PID and memory calls.
  const missing = result.processes.filter(item => item.error);
  assert.ok(missing.every(item => item.type !== 'browser' && item.type !== 'renderer'), JSON.stringify(missing));
  return { stage, at: Date.now(), processCount: result.processes.length, unavailable: missing.map(({ type, error }) => ({ type, error })), privateWorkingSetBytes: result.processes.reduce((sum, item) => sum + (item.privateWorkingSetBytes || 0), 0) };
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function measured(cdp, run, stage, operation) {
  let active = true;
  const sampling = (async () => {
    while (active) {
      const value = await memory(cdp, stage); if (value) run.memory.push(value);
      await delay(100);
    }
  })();
  try { return await operation(); }
  finally { active = false; await sampling; }
}

const result = {
  date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()),
  baselineSha,
  beforeVersion: JSON.parse(await readFile(path.join(baseline, 'manifest.json'), 'utf8')).version,
  afterVersion: JSON.parse(await readFile(path.join(after, 'manifest.json'), 'utf8')).version,
  environment: { os: `${os.platform()} ${os.release()}`, arch: os.arch(), cpu: os.cpus()[0].model, playwright: '1.62.1', headless: true, browser: 'Installed Google Chrome', viewport: { width: 1920, height: 1080 }, longImage: { width: 1600, height: 10000, pngBytes: fixtureBytes.length }, trials, order: 'Alternating before/after then after/before; fresh profile for every run; one direct screenshot warmup before measured capture', memoryMetric: reader ? 'Sum of Windows PrivateWorkingSetSize of all isolated Chrome processes, sampled about every 100ms; not extension-only or an exact peak' : 'Unavailable outside Windows', clipboard: 'Actual navigator.clipboard.write image/png; click capture phase to write completion includes synchronous export rendering; no mocked writes' },
  runs: []
};

async function runTrial(label, trial, extension) {
  let context;
  let browserPid;
  const run = { label, trial, memory: [] }; result.runs.push(run);
  console.log(`START ${label} ${trial}`);
  try {
    context = await chromium.launchPersistentContext(path.join(temporary, `profile-${label}-${trial}`), {
      channel: process.env.BENCH_CHANNEL || 'chrome', headless: true, viewport: result.environment.viewport,
      ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging']
    });
    await useKorean(context);
    const cdp = await context.browser().newBrowserCDPSession();
    browserPid = (await cdp.send('SystemInfo.getProcessInfo')).processInfo.find(item => item.type === 'browser')?.id;
    result.environment.chrome = await cdp.send('Browser.getVersion');
    const { id } = await cdp.send('Extensions.loadUnpacked', { path: extension });
    const worker = context.serviceWorkers().find(item => item.url().includes(id)) || await context.waitForEvent('serviceworker', { predicate: item => item.url().includes(id) });
    await context.addInitScript(() => {
      window.__bench = { encodes: 0, clears: 0, writes: [], errors: [], clickAt: 0 };
      document.addEventListener('click', event => {
        if (event.target.closest?.('#copy')) window.__bench.clickAt = performance.now();
      }, true);
      const clear = CanvasRenderingContext2D.prototype.clearRect;
      CanvasRenderingContext2D.prototype.clearRect = function (...args) {
        if (this.canvas.id === 'canvas') window.__bench.clears++;
        return clear.apply(this, args);
      };
      const encode = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (...args) { window.__bench.encodes++; return encode.apply(this, args); };
      const write = navigator.clipboard.write.bind(navigator.clipboard);
      navigator.clipboard.write = async function (...args) {
        const start = performance.now();
        try {
          await write(...args);
          window.__bench.writes.push({ apiMs: performance.now() - start, copyMs: performance.now() - window.__bench.clickAt });
        }
        catch (error) { window.__bench.errors.push(error.message); throw error; }
      };
    });
    const source = context.pages()[0]; await source.goto(sourceUrl);
    const popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/popup.html`);
    await source.bringToFront();
    const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id);
    const targets = await cdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
    const target = targets.targetInfos.find(item => item.url === sourceUrl); assert.ok(target);
    await cdp.send('Extensions.triggerAction', { id, targetId: target.targetId });
    // Exclude first-use GPU/encoder initialization from the extension-path comparison.
    await popup.evaluate(async () => { await chrome.tabs.captureVisibleTab(null, { format: 'png' }); });
    await delay(700);
    const beforePages = new Set(context.pages());
    let editor;
    console.log(`CAPTURE ${label} ${trial}`);
    await measured(cdp, run, 'visible-capture', async () => {
      const start = performance.now();
      const reply = await popup.evaluate(async tabId => {
        const start = performance.now();
        const response = await chrome.runtime.sendMessage({ type: 'capture', mode: 'visible', tabId });
        return { response, ms: performance.now() - start };
      }, tabId);
      assert.equal(reply.response.ok, true, reply.response.error); run.captureRequestMs = reply.ms;
      editor = context.pages().find(page => !beforePages.has(page) && page.url().includes('/editor.html'));
      if (!editor) editor = await context.waitForEvent('page', { predicate: page => page.url().includes('/editor.html') });
      await editor.locator('#canvas-frame').waitFor({ state: 'visible' });
      await editor.bringToFront();
      await editor.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      run.editorReadyMs = performance.now() - start;
    });
    await popup.close(); await source.close();
    console.log(`LONG IMAGE ${label} ${trial}`);
    await editor.locator('#file-input').setInputFiles(fixture);
    await editor.waitForFunction(() => document.querySelector('#dimensions').textContent.includes('1600 × 10000'));
    await editor.locator('#status').filter({ hasText: '저장됨' }).waitFor();
    await delay(300);
    // Keep the original rectangle-plus-manual-label workload across versions.
    if (await editor.locator('#auto-number').count()) await editor.locator('#auto-number').uncheck();
    if (reader) run.memory.push(await memory(cdp, 'long-image-idle'));

    const bounds = await editor.locator('#canvas').boundingBox(); assert.ok(bounds);
    const x = bounds.x + bounds.width * .2; const y = bounds.y + bounds.height * .1;
    await editor.mouse.move(x, y); await editor.mouse.down();
    const editorCdp = await context.newCDPSession(editor);
    await editorCdp.send('Performance.enable');
    await measured(cdp, run, 'drag', async () => {
      const before = await editorCdp.send('Performance.getMetrics');
      run.drag = await editor.evaluate(async ({ x, y, width, height }) => {
        const canvas = document.querySelector('#canvas'); const before = window.__bench.clears;
        let handlerMs = 0; const gaps = []; let previous = performance.now(); const start = previous;
        // Four pointer updates per display frame, 30 frames: a repeatable high-frequency workload.
        for (let frame = 0; frame < 30; frame++) {
          await new Promise(requestAnimationFrame);
          const now = performance.now(); gaps.push(now - previous); previous = now;
          for (let move = 0; move < 4; move++) {
            const progress = (frame * 4 + move + 1) / 120;
            const tick = performance.now();
            canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: x + width * .5 * progress, clientY: y + height * .5 * progress, pointerId: 1, bubbles: true }));
            handlerMs += performance.now() - tick;
          }
        }
        await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
        return { handlerMs, elapsedMs: performance.now() - start, redraws: window.__bench.clears - before, frameGapsMs: gaps, moves: 120, frames: 30 };
      }, { x, y, width: bounds.width, height: bounds.height });
      const after = await editorCdp.send('Performance.getMetrics');
      const metric = (result, name) => result.metrics.find(item => item.name === name).value;
      run.drag.mainThreadTaskMs = (metric(after, 'TaskDuration') - metric(before, 'TaskDuration')) * 1000;
    });
    await editor.mouse.move(x + bounds.width * .5, y + bounds.height * .5); await editor.mouse.up();
    await editor.locator('#status').filter({ hasText: '저장됨' }).waitFor();
    await editor.locator('[data-tool="number"]').click();
    await editor.mouse.click(x, y);
    await editor.locator('#status').filter({ hasText: '저장됨' }).waitFor();

    async function copy(stage) {
      return measured(cdp, run, stage, async () => {
        const state = await editor.evaluate(() => ({ writes: window.__bench.writes.length, encodes: window.__bench.encodes }));
        const start = performance.now(); await editor.locator('#copy').click();
        await editor.waitForFunction(count => window.__bench.writes.length > count || window.__bench.errors.length, state.writes);
        const value = await editor.evaluate(() => ({ ms: window.__bench.writes.at(-1), encodes: window.__bench.encodes, errors: window.__bench.errors }));
        assert.deepEqual(value.errors, []);
        return { ...value.ms, actionMs: performance.now() - start, encodes: value.encodes - state.encodes };
      });
    }
    run.firstCopy = await copy('first-copy'); run.repeatCopies = [];
    for (let i = 0; i < 3; i++) run.repeatCopies.push(await copy('repeat-copy'));
    await delay(300);
    if (reader) run.memory.push(await memory(cdp, 'after-copy-idle'));
    assert.equal(await editor.locator('#shape-count').textContent(), '표시 2개');
    run.ok = true;
    await writeFile(path.join(output, 'raw.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ label, trial, captureMs: Math.round(run.captureRequestMs), readyMs: Math.round(run.editorReadyMs), dragMs: Math.round(run.drag.handlerMs), redraws: run.drag.redraws, firstCopyMs: Math.round(run.firstCopy.copyMs), repeatCopyMs: run.repeatCopies.map(item => Math.round(item.copyMs)) }));
  } catch (error) {
    run.error = error.stack; console.error(error); throw error;
  } finally {
    if (context) {
      console.log(`CLOSE ${label} ${trial}`);
      const close = context.close();
      let timer;
      const closed = await Promise.race([close.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), 5000); })]);
      clearTimeout(timer);
      if (!closed && process.platform === 'win32' && Number.isInteger(browserPid)) {
        // PID came from this isolated instance's CDP session, never from a user's Chrome profile.
        await new Promise((resolve, reject) => execFile('taskkill.exe', ['/PID', String(browserPid), '/T', '/F'], { timeout: 10000, windowsHide: true }, error => {
          if (!error || error.code === 128) resolve(); else reject(error);
        }));
        run.cleanup = 'Isolated benchmark browser needed forced shutdown after measurements';
      }
      await Promise.race([close, delay(5000)]);
      console.log(`CLOSED ${label} ${trial}`);
    }
  }
}

try {
  for (let trial = 1; trial <= trials; trial++) {
    for (const [label, extension] of trial % 2 ? [['before', baseline], ['after', after]] : [['after', after], ['before', baseline]]) {
      await runTrial(label, trial, extension);
      await writeFile(path.join(output, 'raw.json'), JSON.stringify(result, null, 2));
    }
  }
} finally {
  await writeFile(path.join(output, 'raw.json'), JSON.stringify(result, null, 2));
  reader?.stdin.end();
  await new Promise(resolve => server.close(resolve));
  const relative = path.relative(os.tmpdir(), temporary);
  if (!relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(temporary).startsWith('screen-mark-bench-')) await rm(temporary, { recursive: true, force: true, maxRetries: 25, retryDelay: 200 });
  else throw new Error('Refusing to remove a path outside the benchmark temporary directory');
}
