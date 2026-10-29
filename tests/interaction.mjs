import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'screen-mark-interaction-'));
const output = path.join(root, 'test-results/interaction');
await mkdir(output, { recursive: true });
const checks = [], errors = [];
let context, browserPid;
async function check(name, run) {
  try { await run(); checks.push({ name, ok: true }); console.log(`PASS: ${name}`); }
  catch (error) { checks.push({ name, ok: false, error: error.message }); console.error(`FAIL: ${name}: ${error.message}`); }
}
try {
  const extension = path.join(temporary, 'extension');
  await cp(path.join(root, 'extension'), extension, { recursive: true });
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    channel: 'chrome', headless: true, viewport: { width: 1400, height: 1000 }, acceptDownloads: true,
    ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging']
  });
  context.setDefaultTimeout(7000);
  context.on('weberror', event => errors.push(event.error().message));
  const cdp = await context.browser().newBrowserCDPSession();
  browserPid = (await cdp.send('SystemInfo.getProcessInfo')).processInfo.find(p => p.type === 'browser').id;
  const browser = await cdp.send('Browser.getVersion');
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: extension });
  const base = `chrome-extension://${id}`;
  const fixture = path.join(output, 'clipboard-source.png');
  await sharp({ create: { width: 800, height: 600, channels: 4, background: '#f8edca' } }).png().toFile(fixture);
  const seed = await context.newPage(); await seed.goto(`${base}/editor.html`);
  await seed.locator('#file-input').setInputFiles(fixture);
  await seed.locator('#canvas-frame').waitFor({ state: 'visible' });
  async function readDocument(page) {
    return page.evaluate(async () => {
      const { getCapture } = await import('./storage.js');
      return (await getCapture(new URLSearchParams(location.search).get('id'))).document;
    });
  }
  async function drag(page, start, end, modifier = false, expectedStatus = '저장됨') {
    const box = await page.locator('#canvas').boundingBox();
    const point = ({ x, y }) => [box.x + x * box.width / 800, box.y + y * box.height / 600];
    if (modifier) await page.keyboard.down('Control');
    try {
      await page.mouse.move(...point(start)); await page.mouse.down();
      await page.mouse.move(...point(end), { steps: 4 }); await page.mouse.up();
    } finally { if (modifier) await page.keyboard.up('Control'); }
    await page.locator('#status').filter({ hasText: expectedStatus }).waitFor();
  }
  await check('modifier drag moves an existing label without tool clicks, supports Undo and resumes drawing', async () => {
    await drag(seed, { x: 100, y: 100 }, { x: 300, y: 250 });
    const before = await readDocument(seed);
    const label = before.shapes.find(s => s.type === 'number');
    await drag(seed, label, { x: label.x + 60, y: label.y + 80 }, true);
    const moved = await readDocument(seed);
    assert.equal(moved.shapes.length, 2);
    const newLabel = moved.shapes.find(s => s.id === label.id);
    assert.ok(Math.abs(newLabel.x - label.x - 60) < 1 && Math.abs(newLabel.y - label.y - 80) < 1);
    assert.equal(await seed.locator('[data-tool="rectangle"]').getAttribute('aria-pressed'), 'true');
    await seed.keyboard.press('Control+z');
    await seed.locator('#status').filter({ hasText: '저장됨' }).waitFor();
    assert.deepEqual((await readDocument(seed)).shapes, before.shapes);
    await drag(seed, { x: 420, y: 350 }, { x: 650, y: 500 });
    assert.equal((await readDocument(seed)).shapes.length, 4);
    assert.equal(await seed.locator('#delete').isDisabled(), true);
  });
  await seed.locator('#copy').click();
  await seed.locator('#status').filter({ hasText: '클립보드에 복사됨' }).waitFor();
  const pasted = await context.newPage(); await pasted.goto(`${base}/editor.html`);
  await check('actual clipboard image paste opens an editable persistent image without file selection', async () => {
    await pasted.bringToFront(); await pasted.keyboard.press('Control+v');
    await pasted.locator('#canvas-frame').waitFor({ state: 'visible' });
    assert.equal(await pasted.locator('#dimensions').textContent(), '800 × 600 px');
    const original = await readDocument(pasted);
    assert.equal(original.shapes.length, 0);
    await drag(pasted, { x: 430, y: 80 }, { x: 650, y: 200 });
    await pasted.reload(); await pasted.locator('#canvas-frame').waitFor({ state: 'visible' });
    assert.equal((await readDocument(pasted)).shapes.length, 2);
    const download = pasted.waitForEvent('download'); await pasted.locator('#download').click();
    const file = path.join(output, 'pasted-marked.png'); await (await download).saveAs(file);
    const pixel = await sharp(file).extract({ left: 750, top: 550, width: 1, height: 1 }).ensureAlpha().raw().toBuffer();
    assert.deepEqual([...pixel], [248, 237, 202, 255]);
    await pasted.screenshot({ path: path.join(output, 'editor.png') });
  });
  await check('modifier movement also works in number and text tools without adding marks or opening a dialog', async () => {
    for (const tool of ['number', 'text']) {
      await seed.locator(`[data-tool="${tool}"]`).click();
      const original = await readDocument(seed);
      const label = original.shapes.find(s => s.type === 'number');
      await drag(seed, label, { x: label.x + 10, y: label.y + 10 }, true);
      assert.equal((await readDocument(seed)).shapes.length, original.shapes.length);
      assert.equal(await seed.locator(`#text-dialog`).evaluate(dialog => dialog.open), false);
      assert.equal(await seed.locator(`[data-tool="${tool}"]`).getAttribute('aria-pressed'), 'true');
    }
  });
  await check('pasting text inside the text dialog keeps normal text editing', async () => {
    await seed.bringToFront();
    await seed.evaluate(() => navigator.clipboard.writeText('붙여넣기 확인'));
    await seed.locator('[data-tool="text"]').click();
    const box = await seed.locator('#canvas').boundingBox(); await seed.mouse.click(box.x + 450, box.y + 150);
    await seed.locator('#text-input').focus(); await seed.keyboard.press('Control+v');
    assert.equal(await seed.locator('#text-input').inputValue(), '붙여넣기 확인');
    await seed.getByRole('button', { name: '취소', exact: true }).click();
  });
  await check('unsupported pasted images report an error and retain the current capture', async () => {
    const oldUrl = seed.url(); const old = await readDocument(seed);
    await seed.evaluate(() => {
      const data = new DataTransfer(); data.items.add(new File(['<svg/>'], 'unsupported.svg', { type: 'image/svg+xml' }));
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await seed.locator('#status.error').filter({ hasText: 'PNG, JPG, WebP' }).waitFor();
    assert.equal(seed.url(), oldUrl); assert.deepEqual(await readDocument(seed), old);
  });
  await check('cancelling image paste after a save conflict preserves the local marks and URL', async () => {
    await seed.bringToFront(); await seed.locator('#copy').click();
    await seed.locator('#status').filter({ hasText: '클립보드에 복사됨' }).waitFor();
    const stale = await context.newPage(); await stale.goto(seed.url());
    await stale.locator('#canvas-frame').waitFor({ state: 'visible' });
    await seed.locator('[data-tool="rectangle"]').click();
    await drag(seed, { x: 550, y: 280 }, { x: 700, y: 380 });
    await drag(stale, { x: 550, y: 420 }, { x: 700, y: 520 }, false, '다른 탭');
    await stale.locator('#status.error').filter({ hasText: '다른 탭' }).waitFor();
    const url = stale.url(), count = await stale.locator('#shape-count').textContent();
    const confirmation = stale.waitForEvent('dialog').then(async dialog => { assert.equal(dialog.type(), 'confirm'); await dialog.dismiss(); });
    await stale.bringToFront(); await stale.keyboard.press('Control+v'); await confirmation;
    assert.equal(stale.url(), url); assert.equal(await stale.locator('#shape-count').textContent(), count);
    await stale.close();
  });
  await check('paste during initial decoding cannot replace the pending image', async () => {
    await seed.bringToFront(); await seed.locator('#copy').click();
    await seed.locator('#status').filter({ hasText: '클립보드에 복사됨' }).waitFor();
    const page = await context.newPage();
    await page.addInitScript(() => {
      const original = globalThis.createImageBitmap;
      globalThis.createImageBitmap = async (...args) => {
        globalThis.decodeWaiting = true;
        await new Promise(resolve => { globalThis.releaseDecode = resolve; });
        return original(...args);
      };
    });
    await page.goto(seed.url(), { waitUntil: 'commit' });
    await page.waitForFunction(() => globalThis.decodeWaiting);
    await page.keyboard.press('Control+v');
    await page.evaluate(() => globalThis.releaseDecode());
    await page.locator('#canvas-frame').waitFor({ state: 'visible' });
    assert.equal(page.url(), seed.url());
    assert.deepEqual((await readDocument(page)).shapes, (await readDocument(seed)).shapes);
    await page.close();
  });
  const result = { ok: checks.every(c => c.ok) && !errors.length, version: await seed.evaluate(() => chrome.runtime.getManifest().version), date: '2026-10-29', browser, checks, errors };
  await writeFile(path.join(output, 'verification.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  assert.equal(result.ok, true);
} finally {
  if (context) {
    const closed = await Promise.race([context.close().then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 5000))]);
    if (!closed && browserPid) await new Promise(resolve => execFile('taskkill', ['/PID', String(browserPid), '/T', '/F'], { windowsHide: true, timeout: 10000 }, resolve));
  }
  const relative = path.relative(os.tmpdir(), temporary);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(temporary).startsWith('screen-mark-interaction-'));
  await rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
}
