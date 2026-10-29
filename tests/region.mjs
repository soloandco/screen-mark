import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'screen-mark-region-'));
const scale = Number(process.env.REGION_SCALE || 1);
const output = path.join(root, `test-results/region-${scale}`);
await mkdir(output, { recursive: true });
const guide = await readFile(path.join(root, 'scripts/fixtures/guide-demo.html'));
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (req.url === '/guide') { res.end(guide); return; }
  res.end('<!doctype html><title>Region fixture</title><style>body{margin:0;background:#fffdf5;height:1800px}#target{position:absolute;left:100px;top:100px;width:300px;height:200px;background:#216b52}</style><div id="target"></div>');
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
  context.setDefaultTimeout(10000);
  context.on('weberror', event => errors.push(event.error().message));
  const cdp = await context.browser().newBrowserCDPSession();
  browserPid = (await cdp.send('SystemInfo.getProcessInfo')).processInfo.find(p => p.type === 'browser').id;
  const browser = await cdp.send('Browser.getVersion');
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: extension });
  const base = `chrome-extension://${id}`;
  const control = await context.newPage(); await control.goto(`${base}/popup.html`);
  assert.deepEqual(await control.locator('[data-mode]').evaluateAll(nodes => nodes.map(node => node.dataset.mode)), ['visible', 'region', 'full']);
  await control.setViewportSize({ width: 344, height: 600 });
  await control.locator('body').screenshot({ path: path.join(output, 'capture-menu.png') });
  const source = await context.newPage();
  const sourceUrl = `http://127.0.0.1:${server.address().port}/`;
  await source.goto(sourceUrl);
  const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
  const target = targetInfos.find(target => target.url === sourceUrl);
  async function capture() {
    await source.bringToFront();
    await cdp.send('Extensions.triggerAction', { id, targetId: target.targetId });
    const tabId = await control.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id);
    const pagePromise = context.waitForEvent('page', page => page !== source && page !== control);
    const result = await control.evaluate(async tabId => chrome.runtime.sendMessage({ type: 'capture', mode: 'region', tabId }), tabId);
    assert.equal(result.ok, true, result.error);
    const page = await pagePromise;
    await page.waitForURL(`**/selection.html?id=${result.id}`);
    await page.locator('#surface').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('#capture-image').naturalWidth > 0);
    return { page, captureId: result.id };
  }
  async function getRecord(captureId) {
    return control.evaluate(async id => {
      const { getCapture } = await import('./storage.js');
      const record = await getCapture(id);
      if (!record) return null;
      const bitmap = await createImageBitmap(record.blob);
      const size = { width: bitmap.width, height: bitmap.height }; bitmap.close();
      return { ...size, pending: !!record.selectionPending, shapes: record.document.shapes.length };
    }, captureId);
  }
  async function drag(page, x1, y1, x2, y2, screenshot = false) {
    const box = await page.locator('#capture-image').boundingBox();
    const point = (x, y) => [Math.round(box.x + x * box.width / 1200), Math.round(box.y + y * box.height / 900)];
    await page.mouse.move(...point(x1, y1)); await page.mouse.down();
    await page.mouse.move(...point(x2, y2), { steps: 6 });
    if (screenshot) await page.screenshot({ path: path.join(output, 'region-guide.png') });
    await page.mouse.up();
    const first = point(x1, y1), last = point(x2, y2);
    const x = Math.floor((Math.min(first[0], last[0]) - box.x) * 1200 * scale / box.width);
    const y = Math.floor((Math.min(first[1], last[1]) - box.y) * 900 * scale / box.height);
    return {
      width: Math.ceil((Math.max(first[0], last[0]) - box.x) * 1200 * scale / box.width) - x,
      height: Math.ceil((Math.max(first[1], last[1]) - box.y) * 900 * scale / box.height) - y
    };
  }
  const quick = await capture();
  await quick.page.screenshot({ path: path.join(output, 'region-ready.png') });
  await drag(quick.page, 101, 101, 101.1, 101.1);
  assert.ok(quick.page.url().includes('selection.html'));
  const quickSize = await drag(quick.page, 400, 300, 100, 100);
  await quick.page.waitForURL('**/editor.html?*');
  assert.deepEqual(await getRecord(quick.captureId), { ...quickSize, pending: false, shapes: 0 });
  checks.push('default region drag opens the cropped editor without a confirm click; tiny gestures stay in selection');
  const automaticFailure = await capture();
  await automaticFailure.page.evaluate(() => {
    const original = OffscreenCanvas.prototype.convertToBlob;
    globalThis.restoreEncoding = () => { OffscreenCanvas.prototype.convertToBlob = original; };
    OffscreenCanvas.prototype.convertToBlob = async () => { throw new Error('Injected encoding failure'); };
  });
  await drag(automaticFailure.page, 100, 100, 400, 300);
  await automaticFailure.page.locator('#status.error').waitFor();
  assert.equal((await getRecord(automaticFailure.captureId)).pending, true);
  assert.equal(await automaticFailure.page.locator('#confirm').isVisible(), true);
  await automaticFailure.page.evaluate(() => globalThis.restoreEncoding());
  await automaticFailure.page.locator('#confirm').click();
  await automaticFailure.page.waitForURL('**/editor.html?*');
  checks.push('automatic confirmation errors preserve the original and expose an explicit retry button');
  const first = await capture();
  await first.page.locator('#auto-confirm').uncheck();
  await first.page.reload(); await first.page.locator('#surface').waitFor({ state: 'visible' });
  assert.equal(await first.page.locator('#auto-confirm').isChecked(), false);
  checks.push('manual confirmation preference survives reload and new selection tabs');
  assert.equal((await getRecord(first.captureId)).width, 1200 * scale);
  const earlyEditor = await context.newPage();
  await earlyEditor.goto(`${base}/editor.html?id=${first.captureId}`);
  await earlyEditor.locator('#status.error').filter({ hasText: '영역을 먼저 확정' }).waitFor();
  assert.equal(await earlyEditor.locator('#canvas-frame').isVisible(), false);
  await earlyEditor.close();
  checks.push('pending originals cannot be opened directly in the editor');
  await drag(first.page, 101, 101, 101.1, 101.1);
  assert.equal(await first.page.locator('#confirm').isDisabled(), true);
  const selectedSize = await drag(first.page, 400, 300, 100, 100);
  await first.page.screenshot({ path: path.join(output, 'selection.png') });
  const duplicate = await context.newPage(); await duplicate.goto(first.page.url());
  await duplicate.locator('#surface').waitFor({ state: 'visible' });
  await drag(duplicate, 150, 150, 250, 250);
  await first.page.locator('#confirm').click();
  await first.page.waitForURL('**/editor.html?*');
  await first.page.locator('#canvas-frame').waitFor({ state: 'visible' });
  const record = await getRecord(first.captureId);
  assert.deepEqual(record, { ...selectedSize, pending: false, shapes: 0 });
  const downloadPromise = first.page.waitForEvent('download'); await first.page.locator('#download').click();
  const destination = path.join(output, 'region.png'); await (await downloadPromise).saveAs(destination);
  const pixels = await sharp(destination).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(pixels.info.width, selectedSize.width); assert.equal(pixels.info.height, selectedSize.height);
  for (const [x, y] of [[5 * scale, 5 * scale], [150 * scale, 100 * scale], [290 * scale, 190 * scale]]) {
    const offset = (y * pixels.info.width + x) * 4;
    assert.deepEqual([...pixels.data.subarray(offset, offset + 4)], [33, 107, 82, 255]);
  }
  assert.equal(await first.page.locator('#undo').isDisabled(), true);
  checks.push('reverse selection physically crops PNG and cannot undo to reveal outside pixels');
  await duplicate.locator('#confirm').click();
  await duplicate.locator('#status.error').waitFor();
  assert.deepEqual(await getRecord(first.captureId), record);
  const duplicateClosing = duplicate.waitForEvent('close');
  await duplicate.locator('#cancel').click(); await duplicateClosing;
  assert.equal((await getRecord(first.captureId)).pending, false);
  checks.push('stale selection confirmation and cancellation cannot replace or delete a completed capture');
  await first.page.bringToFront();
  const canvas = await first.page.locator('#canvas').boundingBox();
  await first.page.mouse.move(canvas.x + 40, canvas.y + 40); await first.page.mouse.down();
  await first.page.mouse.move(canvas.x + 150, canvas.y + 100); await first.page.mouse.up();
  await first.page.locator('#status').filter({ hasText: '저장됨' }).waitFor();
  assert.equal(await first.page.locator('#shape-count').textContent(), '표시 2개');
  await first.page.locator('#copy').click(); await first.page.locator('#status').filter({ hasText: '클립보드에 복사됨' }).waitFor();
  checks.push('cropped image supports automatic numbering and actual clipboard image write');
  const cancelled = await capture();
  assert.equal(await cancelled.page.locator('#auto-confirm').isChecked(), false);
  await cancelled.page.reload(); await cancelled.page.locator('#surface').waitFor({ state: 'visible' });
  const closing = cancelled.page.waitForEvent('close'); await cancelled.page.keyboard.press('Escape'); await closing;
  assert.equal(await getRecord(cancelled.captureId), null);
  checks.push('pending reload works and Escape removes the temporary original');
  const retry = await capture();
  const retrySize = await drag(retry.page, 100, 100, 400, 300);
  await retry.page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    const add = IDBObjectStore.prototype.add;
    globalThis.restorePut = () => { IDBObjectStore.prototype.put = original; };
    IDBObjectStore.prototype.put = function(value, ...args) { return value.selectionPending === false ? add.call(this, value, ...args) : original.call(this, value, ...args); };
  });
  await retry.page.locator('#confirm').click(); await retry.page.locator('#status.error').waitFor();
  assert.doesNotMatch(await retry.page.locator('#status').textContent(), /다시 시도해 주세요/);
  assert.equal((await getRecord(retry.captureId)).pending, true);
  assert.equal(await retry.page.locator('#confirm').isEnabled(), true);
  await retry.page.evaluate(() => globalThis.restorePut());
  const dimensions = await retry.page.locator('#dimensions').textContent();
  await retry.page.setViewportSize({ width: 1000, height: 800 });
  assert.equal(await retry.page.locator('#dimensions').textContent(), dimensions);
  await retry.page.locator('#surface').focus();
  await retry.page.keyboard.press('Enter'); await retry.page.waitForURL('**/editor.html?*');
  assert.equal((await getRecord(retry.captureId)).width, retrySize.width);
  checks.push('failed crop persistence keeps original; resize preserves selection and Enter retries');
  await source.goto(new URL('/guide', sourceUrl).href);
  const demo = await capture();
  await demo.page.locator('#auto-confirm').check();
  await drag(demo.page, 60, 160, 850, 590, true);
  await demo.page.waitForURL('**/editor.html?*');
  assert.deepEqual(errors, []);
  const result = { ok: true, date: '2026-10-29', version: await control.evaluate(() => chrome.runtime.getManifest().version), browser, scale, checks, errors };
  await writeFile(path.join(output, 'verification.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
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
