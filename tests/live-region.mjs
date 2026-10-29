import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { useKorean } from './support/language.mjs';

const root = path.resolve(import.meta.dirname, '..');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'screen-mark-region-'));
const scale = Number(process.env.REGION_SCALE || 1);
const output = path.join(root, `test-results/region-${scale}`);
await mkdir(output, { recursive: true });
const guide = await readFile(path.join(root, 'scripts/fixtures/guide-demo.html'));
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (req.url === '/guide') { res.end(guide); return; }
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'nonce-fixture'");
  res.end('<!doctype html><title>Region fixture</title><style nonce="fixture">body{margin:0;background:#fffdf5;height:1800px}#target{position:absolute;left:100px;top:100px;width:300px;height:200px;background:#216b52}button{background:red!important}*{box-sizing:border-box}::backdrop{background:red!important;backdrop-filter:blur(3px)!important}</style><div id="target"></div>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let context, browserPid;
const checks = [], errors = [];
try {
  const extension = path.join(temporary, 'extension');
  await cp(path.join(root, 'extension'), extension, { recursive: true });
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    channel: 'chrome', headless: true, viewport: { width: 1200, height: 900 }, deviceScaleFactor: scale, acceptDownloads: true,
    ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging', `--force-device-scale-factor=${scale}`]
  });
  await useKorean(context);
  context.setDefaultTimeout(10000);
  context.on('weberror', event => errors.push(event.error().message));
  const cdp = await context.browser().newBrowserCDPSession();
  browserPid = (await cdp.send('SystemInfo.getProcessInfo')).processInfo.find(p => p.type === 'browser').id;
  const browser = await cdp.send('Browser.getVersion');
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: extension });
  const base = `chrome-extension://${id}`;
  const control = await context.newPage(); await control.goto(`${base}/popup.html`);
  const source = await context.newPage();
  const sourceUrl = `http://127.0.0.1:${server.address().port}/`;
  await source.goto(sourceUrl);
  const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
  const target = targetInfos.find(target => target.url === sourceUrl);
  const overlay = source.locator('[data-screen-mark-region]');
  async function records() {
    return control.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('screen-mark', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('captures', { keyPath: 'id' });
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      try { return await new Promise((resolve, reject) => {
        const request = db.transaction('captures').objectStore('captures').getAllKeys();
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      }); } finally { db.close(); }
    });
  }
  async function start() {
    await source.bringToFront();
    await cdp.send('Extensions.triggerAction', { id, targetId: target.targetId });
    const before = await records(), pages = context.pages().length, originalUrl = source.url();
    const result = await control.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      return chrome.runtime.sendMessage({ type: 'capture', mode: 'region', tabId: tab.id, language: 'ko' });
    });
    assert.equal(result.ok, true, result.error);
    assert.equal(context.pages().length, pages, 'region menu must not open a screenshot tab before dragging');
    assert.deepEqual(await records(), before, 'region menu must not store a whole-screen capture');
    await overlay.waitFor({ state: 'visible' });
    assert.equal(source.url(), originalUrl);
  }
  async function drag(x1, y1, x2, y2) {
    await source.mouse.move(x1, y1); await source.mouse.down();
    await source.mouse.move(x2, y2, { steps: 6 }); await source.mouse.up();
  }
  async function selected(x1 = 400, y1 = 300, x2 = 100, y2 = 100) {
    const opened = context.waitForEvent('page'); await drag(x1, y1, x2, y2);
    const editor = await opened; await editor.waitForURL('**/editor.html?id=*');
    await editor.locator('#canvas-frame').waitFor({ state: 'visible' });
    await overlay.waitFor({ state: 'detached' }); return editor;
  }
  await start();
  const beforeTiny = await records(); await drag(101, 101, 102, 102);
  assert.equal(await overlay.isVisible(), true); assert.deepEqual(await records(), beforeTiny);
  await source.screenshot({ path: path.join(output, 'region-ready.png') });
  checks.push('menu selects on the source page with no screenshot tab or stored capture; tiny gestures do nothing');
  await source.mouse.move(400, 300); await source.mouse.down(); await source.mouse.move(100, 100, { steps: 6 });
  await source.screenshot({ path: path.join(output, 'region-guide.png') });
  const opened = context.waitForEvent('page'); await source.mouse.up();
  const editor = await opened; await editor.waitForURL('**/editor.html?id=*');
  await editor.locator('#canvas-frame').waitFor({ state: 'visible' }); await overlay.waitFor({ state: 'detached' });
  const captureId = new URL(editor.url()).searchParams.get('id');
  const record = await control.evaluate(async id => {
    const { getCapture } = await import('./storage.js');
    const record = await getCapture(id), bitmap = await createImageBitmap(record.blob);
    const result = { width: bitmap.width, height: bitmap.height, pending: !!record.selectionPending };
    bitmap.close(); return result;
  }, captureId);
  assert.deepEqual(record, { width: 300 * scale, height: 200 * scale, pending: false });
  const downloadPromise = editor.waitForEvent('download'); await editor.locator('#download').click();
  const destination = path.join(output, 'region.png'); await (await downloadPromise).saveAs(destination);
  const pixels = await sharp(destination).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(pixels.info.width, record.width); assert.equal(pixels.info.height, record.height);
  for (let offset = 0; offset < pixels.data.length; offset += 4) assert.deepEqual([...pixels.data.subarray(offset, offset + 4)], [33, 107, 82, 255], 'output must exclude dimming, guide and selection border');
  assert.equal(await editor.locator('#undo').isDisabled(), true);
  checks.push('reverse drag physically crops the PNG and every exported pixel excludes the overlay');
  const canvas = await editor.locator('#canvas').boundingBox();
  await editor.mouse.move(canvas.x + 40, canvas.y + 40); await editor.mouse.down();
  await editor.mouse.move(canvas.x + 150, canvas.y + 100); await editor.mouse.up();
  await editor.locator('#status').filter({ hasText: '저장됨' }).waitFor();
  assert.equal(await editor.locator('#shape-count').textContent(), '표시 2개');
  await editor.locator('#copy').click(); await editor.locator('#status').filter({ hasText: '클립보드에 복사됨' }).waitFor();
  checks.push('cropped editor supports numbered annotations and actual clipboard writes');
  await start();
  const beforeCancel = await records(), pagesBeforeCancel = context.pages().length;
  await source.keyboard.press('Escape'); await overlay.waitFor({ state: 'detached' });
  assert.deepEqual(await records(), beforeCancel); assert.equal(context.pages().length, pagesBeforeCancel);
  await source.mouse.move(200, 200); await source.mouse.wheel(0, 300);
  await source.waitForFunction(() => scrollY > 0);
  await source.evaluate(() => scrollTo(0, 0));
  checks.push('Escape cancels without storing an image or opening a tab');
  await start();
  await source.mouse.move(200, 200); await source.mouse.wheel(0, 400);
  assert.equal(await source.evaluate(() => scrollY), 0);
  await source.setViewportSize({ width: 1000, height: 800 }); await overlay.waitFor({ state: 'detached' });
  await source.setViewportSize({ width: 1200, height: 900 }); assert.deepEqual(await records(), beforeCancel);
  checks.push('wheel is blocked while selecting and resize cancels safely');
  await start(); await start(); assert.equal(await overlay.count(), 1);
  await source.keyboard.press('Escape'); await overlay.waitFor({ state: 'detached' });
  checks.push('restarting replaces the previous overlay and remains cancellable');
  const worker = context.serviceWorkers().find(worker => worker.url().startsWith(base));
  await start();
  await worker.evaluate(() => {
    const original = chrome.tabs.captureVisibleTab.bind(chrome.tabs);
    globalThis.restoreScreenshot = () => { chrome.tabs.captureVisibleTab = original; };
    chrome.tabs.captureVisibleTab = async () => { throw new Error('Injected capture failure'); };
  });
  await drag(100, 100, 400, 300);
  await source.waitForFunction(() => document.querySelector('[data-screen-mark-region]')?.getAttribute('data-state') === 'selecting');
  assert.deepEqual(await records(), beforeCancel); await worker.evaluate(() => globalThis.restoreScreenshot());
  await selected(); checks.push('capture failure restores the overlay and allows retry');
  await start();
  const beforeStorageFailure = await records();
  await worker.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    globalThis.restorePut = () => { IDBObjectStore.prototype.put = original; };
    IDBObjectStore.prototype.put = function() { throw new Error('Injected persistence failure'); };
  });
  await drag(100, 100, 400, 300);
  await source.waitForFunction(() => document.querySelector('[data-screen-mark-region]')?.getAttribute('data-state') === 'selecting');
  assert.deepEqual(await records(), beforeStorageFailure); await worker.evaluate(() => globalThis.restorePut());
  await selected(); checks.push('storage failure does not leave a whole-screen record and allows another drag');
  const beforeSpoof = await records();
  const spoof = await control.evaluate(() => chrome.runtime.sendMessage({ type: 'capture-region', rect: { x: 0, y: 0, width: 1200, height: 900 } }));
  assert.equal(spoof.ok, false); assert.deepEqual(await records(), beforeSpoof);
  checks.push('a region completion message without a genuine source selection cannot create a capture');
  await start(); const edge = await selected(0, 0, 50, 60);
  assert.deepEqual(await edge.locator('#canvas').evaluate(canvas => ({ width: canvas.width, height: canvas.height })), { width: 50 * scale, height: 60 * scale });
  checks.push('viewport-edge selection uses the actual screenshot pixel scale');
  await start(); await source.reload(); await overlay.waitFor({ state: 'detached' });
  await start(); await source.keyboard.press('Escape'); await overlay.waitFor({ state: 'detached' });
  checks.push('navigation removes the overlay and subsequent selection still works');
  await source.goto(new URL('/guide', sourceUrl).href); await start();
  await source.mouse.move(60, 160); await source.mouse.down(); await source.mouse.move(850, 590, { steps: 6 });
  await source.screenshot({ path: path.join(output, 'region-demo.png') });
  await source.keyboard.press('Escape'); await source.mouse.up(); await overlay.waitFor({ state: 'detached' });
  assert.deepEqual(errors, []);
  const result = { ok: true, date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()), version: await control.evaluate(() => chrome.runtime.getManifest().version), browser, scale, checks, errors };
  await writeFile(path.join(output, 'verification.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} finally {
  if (context) {
    const closed = await Promise.race([context.close().then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 5000))]);
    if (!closed && browserPid) await new Promise(resolve => execFile('taskkill', ['/PID', String(browserPid), '/T', '/F'], { windowsHide: true, timeout: 10000 }, resolve));
  }
  await new Promise(resolve => server.close(resolve));
  const relative = path.relative(os.tmpdir(), temporary);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(temporary).startsWith('screen-mark-region-'));
  await rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
}
