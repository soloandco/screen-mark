import assert from 'node:assert/strict';
import { mkdir, mkdtemp, cp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { chromium } from 'playwright';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'test-results');
await mkdir(output, { recursive: true });
const temporary = await mkdtemp(path.join(tmpdir(), 'screen-mark-test-'));
let context;
const server = http.createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end('<!doctype html><html><head><title>Capture fixture</title><style>html{scroll-behavior:smooth}body{margin:0;font:24px sans-serif}header{position:fixed;top:0;height:60px;background:#235a47;color:white;width:100%}section{height:650px;padding:80px 30px;box-sizing:border-box}section:nth-of-type(1){background:#f4e8d1}section:nth-of-type(2){background:#d8e8df}section:nth-of-type(3){background:#e3eafa}section:nth-of-type(4){background:#f2d9d5}#sticky{position:sticky;top:0;height:40px;background:#cc00cc}</style></head><body><header>Fixed header</header><section>First section</section><section>Second section</section><section><aside id="sticky">Sticky section title</aside>Third section</section><section>Last section</section></body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const checks = [];

async function drag(page, x1, y1, x2, y2) {
  await page.mouse.move(x1, y1); await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 8 }); await page.mouse.up();
}

try {
  const extension = path.join(temporary, 'extension');
  await cp(path.join(root, 'extension'), extension, { recursive: true });
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    channel: 'chromium', headless: true, viewport: { width: 1440, height: 1000 }, acceptDownloads: true,
    args: ['--enable-unsafe-extension-debugging', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  let worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const versionPopup = await context.newPage();
  await versionPopup.goto(`chrome-extension://${id}/popup.html`);
  const expectedVersion = await versionPopup.evaluate(() => `v${chrome.runtime.getManifest().version}`);
  assert.equal(await versionPopup.locator('#version').textContent({ timeout: 3000 }), expectedVersion);
  await versionPopup.close();
  checks.push('popup displays the installed manifest version');
  const editor = await context.newPage();
  await editor.addInitScript(() => {
    window.renderChecks = { encodes: 0, redraws: 0, writes: 0, failCopy: false };
    const encode = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (...args) { window.renderChecks.encodes++; return encode.apply(this, args); };
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      if (this.canvas.id === 'canvas') window.renderChecks.redraws++;
      return clear.apply(this, args);
    };
    const write = navigator.clipboard.write.bind(navigator.clipboard);
    navigator.clipboard.write = (...args) => {
      window.renderChecks.writes++;
      if (window.renderChecks.failCopy) return Promise.reject(new Error('simulated clipboard failure'));
      return write(...args);
    };
  });
  const errors = [];
  context.on('weberror', event => errors.push(event.error().message));
  await editor.goto(`chrome-extension://${id}/editor.html`);
  await editor.locator('#empty-open').waitFor();
  const fixture = path.join(output, 'fixture.png');
  await sharp({ create: { width: 1000, height: 700, channels: 4, background: '#fffdf5' } }).png().toFile(fixture);
  await editor.locator('#file-input').setInputFiles(fixture);
  await editor.locator('#canvas-frame').waitFor({ state: 'visible' });
  await editor.locator('#status').filter({ hasText: '저장됨' }).waitFor();
  assert.equal(await editor.evaluate(() => window.renderChecks.redraws), 1, 'initial image must be drawn once');
  await editor.locator('#auto-number').uncheck();
  const bounds = await editor.locator('#canvas').boundingBox();
  const point = (x, y) => [bounds.x + x * bounds.width / 1000, bounds.y + y * bounds.height / 700];
  await editor.mouse.move(...point(120, 150)); await editor.mouse.down();
  const batch = await editor.evaluate(async () => {
    const canvas = document.querySelector('#canvas'); const box = canvas.getBoundingClientRect();
    const before = window.renderChecks.redraws;
    for (let i = 0; i < 120; i++) canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: box.x + 100 + i, clientY: box.y + 180, pointerId: 1, bubbles: true }));
    const immediate = window.renderChecks.redraws - before;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { immediate, frames: window.renderChecks.redraws - before };
  });
  assert.equal(batch.immediate, 0); assert.equal(batch.frames, 1);
  await editor.mouse.up();
  assert.equal(await editor.locator('#shape-count').textContent(), '표시 0개');
  checks.push('120 pointer updates share one redraw and pointerup clears the preview');
  await editor.getByRole('button', { name: '사각형', exact: true }).click();
  await drag(editor, ...point(120, 150), ...point(450, 350));
  await editor.getByRole('button', { name: '번호 라벨', exact: true }).click();
  await editor.mouse.click(...point(120, 150));
  await editor.mouse.click(...point(500, 150));
  await editor.getByRole('button', { name: '실행 취소', exact: true }).click();
  assert.equal(await editor.locator('#shape-count').textContent(), '표시 2개');
  await editor.getByRole('button', { name: '다시 실행', exact: true }).click();
  assert.equal(await editor.locator('#number-start').inputValue(), '3');
  checks.push('rectangle, sequential number labels, undo and redo');
  console.log('PASS: annotation and history');

  const downloadPromise = editor.waitForEvent('download');
  await editor.locator('#download').click();
  const download = await downloadPromise;
  const pngPath = path.join(output, 'marked.png');
  await download.saveAs(pngPath);
  const { data, info } = await sharp(pngPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 1000); assert.equal(info.height, 700);
  const pixel = (x, y) => [...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4)];
  assert.deepEqual(pixel(300, 150), [228, 77, 53, 255]);
  assert.deepEqual(pixel(111, 146), [228, 77, 53, 255]);
  assert.deepEqual(pixel(491, 146), [228, 77, 53, 255]);
  assert.deepEqual(pixel(800, 600), [255, 253, 245, 255]);
  checks.push('downloaded PNG contains rectangle and both circular labels at original resolution');
  const encodedBeforeCopy = await editor.evaluate(() => window.renderChecks.encodes);
  await editor.locator('#copy').click();
  await editor.locator('#status').filter({ hasText: '클립보드에 복사됨' }).waitFor();
  assert.equal(await editor.evaluate(() => window.renderChecks.encodes), encodedBeforeCopy, 'copy must reuse the current downloaded PNG');
  const writesBefore = await editor.evaluate(() => window.renderChecks.writes);
  await editor.evaluate(() => {
    for (let i = 0; i < 6; i++) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true }));
  });
  await editor.locator('#status').filter({ hasText: '클립보드에 복사됨' }).waitFor();
  assert.equal(await editor.evaluate(() => window.renderChecks.writes), writesBefore + 1, 'repeated shortcuts must share a pending clipboard write');
  checks.push('PNG result reuse and pending clipboard write deduplication');

  await editor.waitForFunction(async () => {
    const { getCapture } = await import('./storage.js');
    return (await getCapture(new URLSearchParams(location.search).get('id')))?.document.shapes.length === 3;
  });
  await editor.reload();
  await editor.locator('#canvas-frame').waitFor({ state: 'visible' });
  assert.equal(await editor.locator('#shape-count').textContent(), '표시 3개');
  await editor.getByRole('button', { name: '선택 / 이동', exact: true }).click();
  const rebound = await editor.locator('#canvas').boundingBox();
  const pt2 = (x, y) => [rebound.x + x * rebound.width / 1000, rebound.y + y * rebound.height / 700];
  await drag(editor, ...pt2(500, 150), ...pt2(600, 230));
  await editor.keyboard.press('Delete');
  assert.equal(await editor.locator('#shape-count').textContent(), '표시 2개');
  await editor.getByRole('button', { name: '실행 취소', exact: true }).click();
  checks.push('reload persistence, selection, moving and deleting labels');
  await editor.screenshot({ path: path.join(output, 'editor.png') });

  await editor.getByRole('button', { name: '자르기', exact: true }).click();
  await drag(editor, ...pt2(80, 100), ...pt2(800, 600));
  assert.match(await editor.locator('#dimensions').textContent(), /720 × 500/);
  await editor.getByRole('button', { name: '실행 취소', exact: true }).click();
  checks.push('crop and undo restore image dimensions');

  await editor.getByRole('button', { name: '화살표', exact: true }).click();
  await drag(editor, ...pt2(700, 300), ...pt2(550, 200));
  await editor.getByRole('button', { name: '텍스트', exact: true }).click();
  await editor.mouse.click(...pt2(120, 400));
  await editor.locator('#text-input').fill('검토할 부분');
  await editor.getByRole('button', { name: '추가', exact: true }).click();
  await editor.getByRole('button', { name: '모자이크', exact: true }).click();
  await drag(editor, ...pt2(700, 500), ...pt2(850, 580));
  await editor.locator('#status').filter({ hasText: '저장됨' }).waitFor();
  assert.equal(await editor.locator('#shape-count').textContent(), '표시 6개');
  await editor.locator('#copy').click();
  await editor.locator('#status').filter({ hasText: '클립보드에 복사됨' }).waitFor();
  checks.push('arrow, text dialog, mosaic, clipboard image write');
  const countAfterEdit = await editor.evaluate(() => window.renderChecks.encodes);
  assert.equal(countAfterEdit, 1, 'edits after reload must produce a new PNG');
  await editor.getByRole('button', { name: '사각형', exact: true }).click();
  await editor.locator('#canvas').focus();
  await editor.keyboard.press('Control+c');
  await editor.locator('#status').filter({ hasText: '클립보드에 복사됨' }).waitFor({ timeout: 3000 });
  checks.push('Ctrl+C copies the annotated image from the canvas');
  assert.equal(await editor.evaluate(() => window.renderChecks.encodes), countAfterEdit, 'unchanged repeat copy must not encode again');
  await editor.evaluate(() => { window.renderChecks.failCopy = true; });
  await editor.locator('#copy').click();
  await editor.locator('#status.error').waitFor();
  assert.equal(await editor.locator('#copy').isEnabled(), true);
  await editor.evaluate(() => { window.renderChecks.failCopy = false; });
  await editor.locator('#copy').click();
  await editor.locator('#status').filter({ hasText: '클립보드에 복사됨' }).waitFor();
  checks.push('clipboard failure unlocks the button and retry succeeds');

  await editor.getByRole('button', { name: '자르기', exact: true }).click();
  await drag(editor, ...pt2(80, 100), ...pt2(800, 600));
  const cropDownloadPromise = editor.waitForEvent('download');
  await editor.locator('#download').click();
  const cropDownload = await cropDownloadPromise;
  const cropPath = path.join(output, 'cropped.png');
  await cropDownload.saveAs(cropPath);
  const croppedInfo = await sharp(cropPath).metadata();
  assert.equal(croppedInfo.width, 720); assert.equal(croppedInfo.height, 500);
  assert.equal(await editor.evaluate(() => window.renderChecks.encodes), countAfterEdit + 1, 'crop must invalidate the PNG cache');
  checks.push('exported cropped PNG preserves cropped dimensions');
  await editor.getByRole('button', { name: '실행 취소', exact: true }).click();
  await editor.locator('#status').filter({ hasText: '저장됨' }).waitFor();
  await editor.locator('#copy').click();
  await editor.locator('#status').filter({ hasText: '클립보드에 복사됨' }).waitFor();
  assert.equal(await editor.evaluate(() => window.renderChecks.encodes), countAfterEdit + 2, 'undo must invalidate the PNG cache');
  await editor.getByRole('button', { name: '다시 실행', exact: true }).click();
  await editor.locator('#status').filter({ hasText: '저장됨' }).waitFor();
  await editor.locator('#copy').click();
  await editor.locator('#status').filter({ hasText: '클립보드에 복사됨' }).waitFor();
  assert.equal(await editor.evaluate(() => window.renderChecks.encodes), countAfterEdit + 3, 'redo must invalidate the PNG cache');
  await editor.locator('#file-input').setInputFiles(fixture);
  await editor.waitForFunction(() => document.querySelector('#shape-count').textContent === '표시 0개');
  await editor.locator('#copy').click();
  await editor.locator('#status').filter({ hasText: '클립보드에 복사됨' }).waitFor();
  assert.equal(await editor.evaluate(() => window.renderChecks.encodes), countAfterEdit + 4, 'image replacement must invalidate the PNG cache');
  const freshDownloadPromise = editor.waitForEvent('download');
  await editor.locator('#download').click();
  const freshPath = path.join(output, 'fresh-image.png');
  await (await freshDownloadPromise).saveAs(freshPath);
  const fresh = await sharp(freshPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(fresh.info.width, 1000); assert.equal(fresh.info.height, 700);
  const freshPixel = (150 * fresh.info.width + 300) * 4;
  assert.deepEqual([...fresh.data.subarray(freshPixel, freshPixel + 4)], [255, 253, 245, 255], 'new image must not contain a cached rectangle');
  checks.push('undo, redo and image replacement invalidate export cache; new PNG pixels are clean');
  console.log('PASS: exports, cache invalidation and clipboard recovery');

  // Trigger the real extension action via CDP to grant activeTab, without changing the shipped manifest.
  const source = await context.newPage();
  console.log('CHECK: capture setup');
  await source.goto(`http://127.0.0.1:${port}/`);
  console.log('CHECK: capture source loaded');
  await source.bringToFront();
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  console.log('CHECK: capture popup loaded');
  await source.bringToFront();
  const tabId = await popup.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id);
  console.log('CHECK: capture source tab ID');
  assert.deepEqual(await popup.locator('[data-mode]').evaluateAll(buttons => buttons.map(button => button.dataset.mode)), ['visible', 'region', 'full']);
  const cdp = await context.browser().newBrowserCDPSession();
  console.log('CHECK: capture CDP connected');
  const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
  const tabTarget = targetInfos.find(target => target.url === `http://127.0.0.1:${port}/`);
  assert.ok(tabTarget, JSON.stringify(targetInfos));
  await popup.evaluate(async () => { try { await chrome.runtime.sendMessage({ type: 'test-wake' }); } catch {} });
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => {
    globalThis.captureEncodes = 0;
    const encode = OffscreenCanvas.prototype.convertToBlob;
    OffscreenCanvas.prototype.convertToBlob = function (...args) {
      globalThis.captureEncodes++; return encode.apply(this, args);
    };
  });
  for (const mode of ['visible', 'full']) {
    console.log(`CHECK: ${mode} capture`);
    await source.bringToFront();
    await cdp.send('Extensions.triggerAction', { id, targetId: tabTarget.targetId });
    await source.evaluate(() => window.scrollTo({ top: 280, behavior: 'instant' }));
    const response = await popup.evaluate(async ({ mode, tabId }) => chrome.runtime.sendMessage({ type: 'capture', mode, tabId }), { mode, tabId });
    assert.equal(response.ok, true, response.error);
    console.log(`CHECK: ${mode} reply`);
    if (mode === 'visible') assert.equal(await worker.evaluate(() => globalThis.captureEncodes), 0, 'visible PNG must not be encoded again');
    const capture = await popup.evaluate(async id => {
      const { getCapture } = await import('./storage.js');
      const record = await getCapture(id);
      const bitmap = await createImageBitmap(record.blob);
      return { width: bitmap.width, height: bitmap.height };
    }, response.id);
    assert.equal(capture.width, 1440);
    assert.equal(capture.height, mode === 'full' ? 2600 : 1000);
    if (mode === 'full') {
      const blobBytes = await popup.evaluate(async id => {
        const { getCapture } = await import('./storage.js');
        return Array.from(new Uint8Array(await (await getCapture(id)).blob.arrayBuffer()));
      }, response.id);
      await writeFile(path.join(output, 'full-page.png'), Buffer.from(blobBytes));
      const full = await sharp(Buffer.from(blobBytes)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const stickyPixel = (1390 * full.info.width + 900) * 4;
      assert.deepEqual([...full.data.subarray(stickyPixel, stickyPixel + 4)], [204, 0, 204, 255], 'below-fold sticky title must remain in the stitched image');
      assert.equal(await source.evaluate(() => scrollY), 280);
      assert.equal(await source.locator('header').evaluate(el => el.style.visibility), '');
      assert.equal(await source.locator('#sticky').evaluate(el => getComputedStyle(el).position), 'sticky');
    }
    checks.push(`${mode} capture: ${capture.width}x${capture.height}`);
  }
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'verification.json'), JSON.stringify({ checks, errors, capturePermission: 'Unmodified production manifest. CDP Extensions.triggerAction granted activeTab in isolated Chromium.' }, null, 2));
  console.log(JSON.stringify({ ok: true, checks, errors }, null, 2));
} catch (error) {
  console.error(error);
  throw error;
} finally {
  if (context) await context.close();
  await new Promise(resolve => server.close(resolve));
  const relative = path.relative(path.resolve(tmpdir()), path.resolve(temporary));
  if (!relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(temporary).startsWith('screen-mark-test-')) await rm(temporary, { recursive: true, force: true });
  else throw new Error('Refusing to remove a path outside the test temporary directory');
}
