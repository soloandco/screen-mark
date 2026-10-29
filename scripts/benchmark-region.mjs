import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const trials = Number(process.env.BENCH_TRIALS || 3);
assert.ok(Number.isInteger(trials) && trials > 0 && trials <= 20);
const temporary = await mkdtemp(path.join(os.tmpdir(), 'screen-mark-region-bench-'));
const output = path.resolve(root, process.env.BENCH_OUTPUT || 'test-results/performance-region');
await mkdir(output, { recursive: true });
const extension = path.join(temporary, 'extension');
await cp(path.resolve(root, process.env.BENCH_EXTENSION || 'extension'), extension, { recursive: true });
const sourceHash = createHash('sha256');
for (const name of (await readdir(extension, { recursive: true })).sort()) {
  const full = path.join(extension, name);
  if ((await stat(full)).isDirectory()) continue;
  sourceHash.update(name.replaceAll('\\', '/') + '\0'); sourceHash.update(await readFile(full));
}
const server = http.createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end('<!doctype html><title>Region performance fixture</title><style>body{margin:0;background:#fffdf5;height:1800px}main{position:absolute;left:100px;top:100px;width:600px;height:400px;background:#216b52}</style><main></main>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const result = {
  methodologyVersion: 2, sourceSha256: sourceHash.digest('hex'),
  date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()),
  environment: { browser: 'Installed Google Chrome', headless: true, viewport: { width: 1200, height: 900 }, trials, input: '120 synthetic pointermoves over 30 animation frames after a real mouse down', limitations: 'Isolated profiles and a local fixture. Native toolbar popup opening, user sites and browser startup are excluded. Frame gaps are a synthetic workload indicator, not physical input latency.' },
  runs: []
};
try {
  for (let trial = 1; trial <= trials; trial++) {
    let context, browserPid;
    try {
      context = await chromium.launchPersistentContext(path.join(temporary, `profile-${trial}`), {
        channel: 'chrome', headless: true, viewport: result.environment.viewport,
        ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging']
      });
      context.setDefaultTimeout(15000);
      await context.addInitScript(() => {
        if (!location.pathname.endsWith('/editor.html')) return;
        const observer = new MutationObserver(() => {
          const frame = document.querySelector('#canvas-frame');
          if (!frame || frame.hidden || !frame.clientWidth) return;
          observer.disconnect();
          requestAnimationFrame(() => requestAnimationFrame(() => { window.__regionEditorReadyAt = performance.timeOrigin + performance.now(); }));
        });
        observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'style'] });
      });
      const cdp = await context.browser().newBrowserCDPSession();
      browserPid = (await cdp.send('SystemInfo.getProcessInfo')).processInfo.find(item => item.type === 'browser').id;
      result.environment.chrome = await cdp.send('Browser.getVersion');
      const { id } = await cdp.send('Extensions.loadUnpacked', { path: extension });
      const base = `chrome-extension://${id}`;
      const source = context.pages()[0];
      const sourceUrl = `http://127.0.0.1:${server.address().port}/`;
      await source.goto(sourceUrl);
      const control = await context.newPage(); await control.goto(`${base}/popup.html`);
      const worker = context.serviceWorkers().find(item => item.url().startsWith(base));
      assert.ok(worker);
      await source.bringToFront();
      const targets = await cdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
      await cdp.send('Extensions.triggerAction', { id, targetId: targets.targetInfos.find(item => item.url === sourceUrl).targetId });
      const tabId = await control.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id);
      result.version = await control.evaluate(() => chrome.runtime.getManifest().version);
      await worker.evaluate(async tabId => {
        globalThis.__regionTimings = { scripts: [], databaseOpenMs: [], transactions: [] };
        const execute = chrome.scripting.executeScript.bind(chrome.scripting);
        chrome.scripting.executeScript = async options => {
          const start = performance.now();
          try { return await execute(options); }
          finally {
            const action = options.args?.[0];
            if (['start', 'take', 'verify'].includes(action)) globalThis.__regionTimings.scripts.push({ action, ms: performance.now() - start });
          }
        };
        const decode = globalThis.createImageBitmap;
        globalThis.createImageBitmap = async (...args) => {
          const start = performance.now();
          try { return await decode(...args); }
          finally { globalThis.__regionTimings.decodeMs = performance.now() - start; }
        };
        const create = chrome.tabs.create.bind(chrome.tabs);
        chrome.tabs.create = async (...args) => {
          const start = performance.now();
          try { return await create(...args); }
          finally { globalThis.__regionTimings.tabCreateMs = performance.now() - start; }
        };
        const open = indexedDB.open.bind(indexedDB);
        indexedDB.open = (...args) => {
          const start = performance.now(), request = open(...args);
          request.addEventListener('success', () => globalThis.__regionTimings.databaseOpenMs.push(performance.now() - start), { once: true });
          return request;
        };
        const transaction = IDBDatabase.prototype.transaction;
        IDBDatabase.prototype.transaction = function(...args) {
          const start = performance.now(), tx = transaction.apply(this, args);
          tx.addEventListener('complete', () => globalThis.__regionTimings.transactions.push({ mode: tx.mode, ms: performance.now() - start }), { once: true });
          return tx;
        };
        const capture = chrome.tabs.captureVisibleTab.bind(chrome.tabs);
        chrome.tabs.captureVisibleTab = async (...args) => {
          const start = performance.now();
          try { return await capture(...args); }
          finally { globalThis.__regionTimings.captureApiMs = performance.now() - start; }
        };
        const encode = OffscreenCanvas.prototype.convertToBlob;
        OffscreenCanvas.prototype.convertToBlob = async function(...args) {
          const start = performance.now();
          try { return await encode.apply(this, args); }
          finally { globalThis.__regionTimings.encodeMs = performance.now() - start; }
        };
        await chrome.scripting.executeScript({ target: { tabId }, func: () => {
          const stats = globalThis.__regionBench = { handlerMs: [], frameGapsMs: [], longTasksMs: [], active: false };
          const add = EventTarget.prototype.addEventListener;
          EventTarget.prototype.addEventListener = function(type, callback, options) {
            if (type === 'pointerdown' && this.id === 'surface') return add.call(this, type, function(event) {
              stats.pointerId = event.pointerId; return callback.call(this, event);
            }, options);
            if (type === 'pointermove' && this.id === 'surface') {
              stats.surface = this;
              return add.call(this, type, function(event) {
                const start = performance.now();
                try { return callback.call(this, event); }
                finally { if (stats.active) stats.handlerMs.push(performance.now() - start); }
              }, options);
            }
            return add.call(this, type, callback, options);
          };
          const observer = new PerformanceObserver(list => {
            if (stats.active) stats.longTasksMs.push(...list.getEntries().map(entry => entry.duration));
          });
          observer.observe({ type: 'longtask', buffered: false });
          const send = chrome.runtime.sendMessage.bind(chrome.runtime);
          chrome.runtime.sendMessage = async message => {
            if (message.type !== 'capture-region') return send(message);
            stats.releaseAt = performance.timeOrigin + performance.now();
            try { return await send(message); }
            finally { stats.captureRequestMs = performance.timeOrigin + performance.now() - stats.releaseAt; }
          };
        } });
      }, tabId);
      const startSelection = performance.now();
      const started = await control.evaluate(async tabId => {
        const start = performance.now();
        const response = await chrome.runtime.sendMessage({ type: 'capture', mode: 'region', tabId });
        return { response, requestMs: performance.now() - start };
      }, tabId);
      assert.equal(started.response.ok, true, started.response.error);
      await source.locator('[data-screen-mark-region]').waitFor({ state: 'visible' });
      const selectionReadyMs = performance.now() - startSelection;
      await source.mouse.move(100, 100); await source.mouse.down();
      const [{ result: drag }] = await worker.evaluate(tabId => chrome.scripting.executeScript({ target: { tabId }, func: async () => {
        const stats = globalThis.__regionBench;
        if (!stats.surface) throw new Error('Region pointer surface was not instrumented');
        stats.active = true;
        let previous = performance.now();
        for (let frame = 0; frame < 30; frame++) {
          await new Promise(requestAnimationFrame);
          const now = performance.now(); stats.frameGapsMs.push(now - previous); previous = now;
          for (let move = 0; move < 4; move++) {
            const fraction = (frame * 4 + move + 1) / 120;
            stats.surface.dispatchEvent(new PointerEvent('pointermove', { clientX: 100 + 300 * fraction, clientY: 100 + 200 * fraction, pointerId: stats.pointerId, isPrimary: true, bubbles: true }));
          }
        }
        await new Promise(requestAnimationFrame); stats.active = false;
        const box = stats.surface.querySelector('#box');
        return { handlerMs: stats.handlerMs, frameGapsMs: stats.frameGapsMs, longTasksMs: stats.longTasksMs, selection: { width: box.style.width, height: box.style.height } };
      } }), tabId);
      assert.equal(drag.handlerMs.length, 120);
      assert.deepEqual(drag.selection, { width: '300px', height: '200px' });
      await source.mouse.move(400, 300);
      const opened = context.waitForEvent('page');
      const releaseAt = performance.now(); await source.mouse.up();
      const editor = await opened; await editor.waitForURL('**/editor.html?id=*');
      await editor.locator('#canvas-frame').waitFor({ state: 'visible' });
      await editor.waitForFunction(() => Number.isFinite(window.__regionEditorReadyAt));
      const releaseToEditorMs = performance.now() - releaseAt;
      const dimensions = await editor.locator('#dimensions').textContent();
      assert.equal(dimensions, '300 × 200 px');
      const [{ result: content }] = await worker.evaluate(tabId => chrome.scripting.executeScript({ target: { tabId }, func: () => {
        const stats = globalThis.__regionBench; return { releaseAt: stats.releaseAt, captureRequestMs: stats.captureRequestMs };
      } }), tabId);
      const editorReadyAt = await editor.evaluate(() => window.__regionEditorReadyAt);
      const run = { trial, selectionReadyMs, selectionRequestMs: started.requestMs, releaseToEditorMs, releaseToPaintMs: editorReadyAt - content.releaseAt, contentCaptureRequestMs: content.captureRequestMs, dimensions, drag, ...await worker.evaluate(() => globalThis.__regionTimings) };
      result.runs.push(run);
      console.log(JSON.stringify({ ...run, drag: { pointerHandlerTotalMs: drag.handlerMs.reduce((a, b) => a + b, 0), longTasks: drag.longTasksMs.length } }));
      await writeFile(path.join(output, 'raw.json'), JSON.stringify(result, null, 2));
    } finally {
      if (context) {
        let deadline;
        const closing = context.close();
        const closed = await Promise.race([closing.then(() => true), new Promise(resolve => { deadline = setTimeout(() => resolve(false), 5000); })]);
        clearTimeout(deadline);
        if (!closed && process.platform === 'win32') await new Promise(resolve => execFile('taskkill', ['/PID', String(browserPid), '/T', '/F'], { windowsHide: true, timeout: 10000 }, resolve));
      }
    }
  }
} finally {
  await writeFile(path.join(output, 'raw.json'), JSON.stringify(result, null, 2));
  await new Promise(resolve => server.close(resolve));
  const relative = path.relative(os.tmpdir(), temporary);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(temporary).startsWith('screen-mark-region-bench-'));
  await rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
}
