import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { useKorean } from './support/language.mjs';

const root = path.resolve(import.meta.dirname, '..');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'screen-mark-regressions-'));
const output = path.join(root, 'test-results/review-regressions');
await mkdir(output, { recursive: true });
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html');
  const height = req.url === '/long' ? 32000 : 1020;
  res.end(`<!doctype html><title>Header fixture</title><style>body{margin:0;height:${height}px;background:white}header{position:fixed;top:0;left:0;width:100%;height:80px;background:rgb(200,0,0)}footer{position:absolute;top:${height - 20}px;height:20px;width:100%;background:rgb(0,100,200)}</style><header></header><footer></footer>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let context, browserPid;
const checks = [], errors = [];
async function check(name, run) {
  try { const details = await run(); checks.push({ name, ok: true, ...details }); console.log(`PASS: ${name}`); }
  catch (error) { checks.push({ name, ok: false, error: error.message }); console.error(`FAIL: ${name}: ${error.message}`); }
}
try {
  const extension = path.join(temporary, 'extension');
  await cp(path.join(root, 'extension'), extension, { recursive: true });
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    channel: 'chrome', headless: true, viewport: { width: 1200, height: 1000 },
    ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging']
  });
  await useKorean(context);
  context.setDefaultTimeout(10000);
  context.on('weberror', event => errors.push(event.error().message));
  const cdp = await context.browser().newBrowserCDPSession();
  browserPid = (await cdp.send('SystemInfo.getProcessInfo')).processInfo.find(p => p.type === 'browser').id;
  const browser = await cdp.send('Browser.getVersion');
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: extension });
  const base = `chrome-extension://${id}`;
  const fixture = path.join(output, 'A.png'), other = path.join(output, 'B.png');
  await sharp({ create: { width: 1000, height: 700, channels: 4, background: '#fffdf5' } }).png().toFile(fixture);
  await sharp({ create: { width: 800, height: 600, channels: 4, background: '#216b52' } }).png().toFile(other);
  const seed = await context.newPage();
  await seed.goto(`${base}/editor.html`);
  await seed.locator('#file-input').setInputFiles(fixture);
  await seed.locator('#canvas-frame').waitFor({ state: 'visible' });
  const oldUrl = seed.url();
  await seed.close();

  await check('initial restore blocks replacement; subsequent edits and reload target the new file', async () => {
    const page = await context.newPage();
    await page.addInitScript(() => {
      const original = globalThis.createImageBitmap;
      let first = true;
      globalThis.createImageBitmap = async (...args) => {
        if (first) {
          first = false; globalThis.decodeWaiting = true;
          await new Promise(resolve => { globalThis.releaseDecode = resolve; });
        }
        return original(...args);
      };
    });
    await page.goto(oldUrl, { waitUntil: 'commit' });
    await page.waitForFunction(() => globalThis.decodeWaiting);
    const disabled = await page.locator('#open-file').isDisabled();
    // Programmatic input bypasses the disabled UI and also exercises the loading guard.
    await page.locator('#file-input').setInputFiles(other);
    await page.evaluate(() => globalThis.releaseDecode());
    await page.waitForFunction(() => document.querySelector('#file-title').textContent === 'A.png');
    assert.equal(disabled, true, 'opening controls must be disabled during initial restore');
    assert.equal(page.url(), oldUrl, 'a file event during restore must not change the record URL');
    await page.locator('#file-input').setInputFiles(other);
    await page.waitForFunction(() => document.querySelector('#file-title').textContent === 'B.png');
    await page.locator('[data-tool=number]').click();
    const box = await page.locator('#canvas').boundingBox();
    await page.mouse.click(box.x + 100, box.y + 100);
    await page.locator('#status').filter({ hasText: '저장됨' }).waitFor();
    const records = await page.evaluate(async oldId => {
      const { getCapture } = await import('./storage.js');
      return [(await getCapture(oldId)).document.shapes.length, (await getCapture(new URLSearchParams(location.search).get('id'))).document.shapes.length];
    }, new URL(oldUrl).searchParams.get('id'));
    assert.deepEqual(records, [0, 1]);
    // Use a fresh tab so the deliberate first-decode barrier is not installed again.
    const reopened = await context.newPage();
    await reopened.goto(page.url());
    await reopened.locator('#canvas-frame').waitFor({ state: 'visible' });
    assert.equal(await reopened.locator('#file-title').textContent(), 'B.png');
    assert.equal(await reopened.locator('#shape-count').textContent(), '표시 1개');
    await reopened.close(); await page.close();
  });

  await check('failed initial decoding unlocks file opening and permits recovery', async () => {
    const page = await context.newPage();
    await page.addInitScript(() => {
      const original = globalThis.createImageBitmap; let first = true;
      globalThis.createImageBitmap = (...args) => {
        if (first) { first = false; return Promise.reject(new Error('test decode failure')); }
        return original(...args);
      };
    });
    await page.goto(oldUrl);
    await page.locator('#status.error').waitFor();
    assert.equal(await page.locator('#open-file').isEnabled(), true);
    await page.locator('#file-input').setInputFiles(other);
    await page.locator('#canvas-frame').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#file-title').textContent(), 'B.png');
    await page.close();
  });

  await check('arrow selection ignores empty corners and selects the rendered thick arrowhead', async () => {
    const page = await context.newPage();
    await page.goto(`${base}/editor.html`);
    await page.locator('#file-input').setInputFiles(fixture);
    await page.locator('#canvas-frame').waitFor({ state: 'visible' });
    await page.locator('#auto-number').uncheck();
    const box = await page.locator('#canvas').boundingBox();
    const point = (x, y) => [box.x + x * box.width / 1000, box.y + y * box.height / 700];
    async function drag(x, y, endX, endY) {
      await page.mouse.move(...point(x, y)); await page.mouse.down();
      await page.mouse.move(...point(endX, endY), { steps: 5 }); await page.mouse.up();
    }
    await drag(80, 300, 140, 360);
    await page.locator('[data-tool=arrow]').click();
    await drag(50, 50, 450, 450);
    await page.locator('[data-tool=select]').click();
    await page.mouse.click(...point(100, 330));
    await page.keyboard.press('Delete');
    await page.locator('#status').filter({ hasText: '저장됨' }).waitFor();
    const types = await page.evaluate(async () => {
      const { getCapture } = await import('./storage.js');
      return (await getCapture(new URLSearchParams(location.search).get('id'))).document.shapes.map(shape => shape.type);
    });
    assert.deepEqual(types, ['arrow'], 'empty corner must select the rectangle below the arrow');
    await page.locator('[data-tool=arrow]').click();
    await page.locator('#stroke').fill('16');
    await drag(100, 200, 500, 200);
    const pixel = await page.locator('#canvas').evaluate(canvas => [...canvas.getContext('2d').getImageData(448, 180, 1, 1).data]);
    assert.deepEqual(pixel, [228, 77, 53, 255]);
    await page.locator('[data-tool=select]').click();
    await page.mouse.click(...point(448, 180));
    assert.equal(await page.locator('#delete').isEnabled(), true);
    await page.keyboard.press('Delete');
    assert.equal(await page.locator('#shape-count').textContent(), '표시 1개');
    await page.locator('#status').filter({ hasText: '저장됨' }).waitFor();
    await page.close();
  });

  for (const long of process.argv.includes('--long') ? [false, true] : [false]) {
    await check(long ? 'real 32000px capture completes after the original 90-second deadline' : 'real full-page PNG preserves the entire fixed header and the final strip', async () => {
      const source = await context.newPage();
      const sourceUrl = `http://127.0.0.1:${server.address().port}/${long ? 'long' : ''}`;
      await source.goto(sourceUrl);
      const popup = await context.newPage(); await popup.goto(`${base}/popup.html`);
      await source.bringToFront();
      const tabId = await popup.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id);
      const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
      await cdp.send('Extensions.triggerAction', { id, targetId: targetInfos.find(t => t.url === sourceUrl).targetId });
      let worker;
      if (long) {
        await popup.evaluate(async () => { try { await chrome.runtime.sendMessage({ type: 'test-wake' }); } catch {} });
        worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
        // Simulate a slow capture API while keeping real screenshots, scrolling and the real 90s watchdog.
        await worker.evaluate(() => {
          const original = chrome.tabs.captureVisibleTab.bind(chrome.tabs);
          globalThis.longCaptureCount = 0;
          chrome.tabs.captureVisibleTab = async (...args) => {
            globalThis.longCaptureCount++;
            await new Promise(resolve => setTimeout(resolve, 3200));
            return original(...args);
          };
        });
      }
      const started = performance.now();
      if (long) console.log('CHECK: 32 real screenshots with 3200ms injected API delay each; waiting beyond 90 seconds');
      const result = await popup.evaluate(async tabId => chrome.runtime.sendMessage({ type: 'capture', mode: 'full', tabId }), tabId);
      const elapsedMs = performance.now() - started;
      assert.equal(result.ok, true, result.error);
      if (long) { assert.ok(elapsedMs > 90000); console.log(`Long capture: ${Math.round(elapsedMs)} ms`); }
      const bytes = await popup.evaluate(async captureId => {
        const { getCapture } = await import('./storage.js');
        return Array.from(new Uint8Array(await (await getCapture(captureId)).blob.arrayBuffer()));
      }, result.id);
      const pixels = await sharp(Buffer.from(bytes)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const pixel = y => [...pixels.data.subarray((y * pixels.info.width + 100) * 4, (y * pixels.info.width + 100) * 4 + 4)];
      await writeFile(path.join(output, long ? 'long-page.png' : 'full-page.png'), Buffer.from(bytes));
      assert.equal(pixels.info.height, long ? 32000 : 1020);
      assert.deepEqual(pixel(10), [200, 0, 0, 255]);
      assert.deepEqual(pixel(40), [200, 0, 0, 255], 'overlapping final screenshot must not erase the header');
      assert.deepEqual(pixel(79), [200, 0, 0, 255]);
      assert.deepEqual(pixel(80), [255, 255, 255, 255]);
      assert.deepEqual(pixel(long ? 31990 : 1010), [0, 100, 200, 255]);
      assert.equal(await source.locator('header').evaluate(node => node.style.visibility), '');
      assert.equal(await source.evaluate(() => scrollY), 0);
      if (long) assert.equal(await worker.evaluate(() => globalThis.longCaptureCount), 32);
      await source.close(); await popup.close();
      return { elapsedMs: Math.round(elapsedMs), screenshots: long ? 32 : 2, injectedApiDelayMs: long ? 3200 : 0 };
    });
  }
  const result = { ok: checks.every(check => check.ok) && errors.length === 0, date: new Date().toISOString(), browser, checks, errors };
  await writeFile(path.join(output, 'verification.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} finally {
  if (context) {
    const closed = await Promise.race([context.close().then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 5000))]);
    if (!closed && browserPid) await new Promise(resolve => execFile('taskkill', ['/PID', String(browserPid), '/T', '/F'], { windowsHide: true, timeout: 10000 }, resolve));
  }
  await new Promise(resolve => server.close(resolve));
  const relative = path.relative(os.tmpdir(), temporary);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(temporary).startsWith('screen-mark-regressions-'));
  await rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
}
