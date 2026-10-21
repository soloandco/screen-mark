import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'screen-mark-auto-number-'));
const output = path.join(root, 'test-results/auto-number');
await mkdir(output, { recursive: true });
const checks = [], errors = [];
let context, browserPid;
try {
  const extension = path.join(temporary, 'extension');
  await cp(path.join(root, 'extension'), extension, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    channel: 'chrome', headless: true, viewport: { width: 1440, height: 1000 }, acceptDownloads: true,
    ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging']
  });
  context.on('weberror', event => errors.push(event.error().message));
  const cdp = await context.browser().newBrowserCDPSession();
  browserPid = (await cdp.send('SystemInfo.getProcessInfo')).processInfo.find(item => item.type === 'browser')?.id;
  const browser = await cdp.send('Browser.getVersion');
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: extension });
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  assert.equal(await popup.locator('#version').textContent(), `v${manifest.version}`);
  await popup.close();
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/editor.html`);
  assert.equal(await page.locator('#auto-number').isChecked({ timeout: 3000 }), true);
  const fixture = path.join(output, 'fixture.png');
  await sharp({ create: { width: 1000, height: 700, channels: 4, background: '#fffdf5' } }).png().toFile(fixture);
  await page.locator('#file-input').setInputFiles(fixture);
  await page.locator('#canvas-frame').waitFor({ state: 'visible' });
  async function drag(x1, y1, x2, y2) {
    const box = await page.locator('#canvas').boundingBox();
    const crop = await page.evaluate(async () => {
      const { getCapture } = await import('./storage.js');
      const record = await getCapture(new URLSearchParams(location.search).get('id'));
      return record.document.crop || { x: 0, y: 0, width: 1000, height: 700 };
    });
    const point = (x, y) => [box.x + (x - crop.x) * box.width / crop.width, box.y + (y - crop.y) * box.height / crop.height];
    await page.mouse.move(...point(x1, y1)); await page.mouse.down();
    await page.mouse.move(...point(x2, y2), { steps: 5 }); await page.mouse.up();
  }
  async function documentWith(count) {
    await page.waitForFunction(async expected => {
      const { getCapture } = await import('./storage.js');
      const record = await getCapture(new URLSearchParams(location.search).get('id'));
      return record.document.shapes.length === expected;
    }, count);
    return page.evaluate(async () => {
      const { getCapture } = await import('./storage.js');
      return (await getCapture(new URLSearchParams(location.search).get('id'))).document;
    });
  }
  await drag(120, 150, 450, 350);
  let doc = await documentWith(2);
  assert.deepEqual(doc.shapes.map(shape => shape.type), ['rectangle', 'number']);
  assert.equal(doc.shapes[1].number, 1); assert.equal(doc.shapes[1].color, doc.shapes[0].color);
  assert.equal(await page.locator('#number-start').inputValue(), '2');
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  await documentWith(0); assert.equal(await page.locator('#number-start').inputValue(), '1');
  await page.getByRole('button', { name: '다시 실행', exact: true }).click();
  doc = await documentWith(2); assert.equal(doc.shapes[1].number, 1);
  checks.push('default automatic label and one-step undo/redo for rectangle plus number');

  await drag(800, 400, 600, 250);
  doc = await documentWith(4);
  const label2 = doc.shapes[3];
  assert.equal(label2.number, 2); assert.ok(Math.abs(label2.x - 600) < 2); assert.ok(Math.abs(label2.y - 250) < 2);
  await page.screenshot({ path: path.join(output, 'automatic-numbers.png') });
  checks.push('reverse drag labels the normalized top-left corner and increments the number');

  await page.locator('[data-tool="number"]').click();
  await page.locator('#canvas').click({ position: { x: 300, y: 350 } });
  doc = await documentWith(5); assert.equal(doc.shapes[4].number, 3);
  await page.locator('[data-tool="rectangle"]').click();
  await page.locator('#auto-number').uncheck();
  await drag(350, 250, 500, 350);
  doc = await documentWith(6); assert.equal(doc.shapes[5].type, 'rectangle');
  assert.equal(await page.locator('#number-start').inputValue(), '4');
  await page.locator('#auto-number').check();
  await drag(100, 600, 101, 601);
  assert.equal(await page.locator('#shape-count').textContent(), '표시 6개');
  assert.equal(await page.locator('#number-start').inputValue(), '4');
  checks.push('manual labels share the sequence; disabled automatic numbering and tiny gestures consume no number');

  await page.locator('#auto-number').check();
  await page.locator('#number-start').fill('40');
  await page.locator('#label-size').selectOption('30');
  await page.getByRole('button', { name: '초록', exact: true }).click();
  await drag(0, 0, 150, 100);
  doc = await documentWith(8);
  const custom = doc.shapes[7];
  assert.equal(custom.number, 40); assert.equal(custom.radius, 30); assert.equal(custom.color, '#216b52');
  assert.equal(custom.x, 31); assert.equal(custom.y, 31);
  assert.equal(await page.locator('#number-start').inputValue(), '41');
  checks.push('custom starting number, size and color; label stays within the top image edge');

  await page.locator('#auto-number').uncheck();
  await page.reload(); await page.locator('#canvas-frame').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#auto-number').isChecked(), true);
  assert.equal(await page.locator('#number-start').inputValue(), '41');
  doc = await documentWith(8);
  assert.deepEqual(doc.shapes.filter(shape => shape.type === 'number').map(shape => shape.number), [1, 2, 3, 40]);
  await page.bringToFront(); await page.locator('#copy').click();
  await page.locator('#status').filter({ hasText: '클립보드에 복사됨' }).waitFor();
  const pending = page.waitForEvent('download'); await page.locator('#download').click();
  const png = path.join(output, 'annotated.png'); await (await pending).saveAs(png);
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixel = (x, y) => [...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4)];
  assert.deepEqual(pixel(104, 150), [228, 77, 53, 255]);
  assert.deepEqual(pixel(584, 250), [228, 77, 53, 255]);
  assert.deepEqual(pixel(6, 31), [33, 107, 82, 255]);
  checks.push('reload preserves labels; actual clipboard write and exported PNG retain all automatic labels');

  await page.locator('[data-tool="crop"]').click();
  await drag(80, 100, 800, 600);
  await page.waitForFunction(() => document.querySelector('#dimensions').textContent === '720 × 500 px');
  await page.locator('#label-size').selectOption('30');
  await drag(80, 100, 200, 200);
  doc = await documentWith(10);
  assert.equal(doc.shapes[9].number, 41); assert.equal(doc.shapes[9].x, 111); assert.equal(doc.shapes[9].y, 131);
  checks.push('automatic label stays within a cropped image and continues the saved sequence');
  await page.locator('#number-start').fill('999');
  await drag(250, 350, 450, 450);
  doc = await documentWith(12);
  assert.equal(doc.shapes[11].number, 999); assert.equal(await page.locator('#number-start').inputValue(), '999');
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  await documentWith(10); assert.equal(await page.locator('#number-start').inputValue(), '42');
  checks.push('upper number limit is preserved and undo restores the previous sequence');
  assert.deepEqual(errors, []);
  const result = { ok: true, version: manifest.version, date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()), browser, checks, errors };
  await writeFile(path.join(output, 'verification.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (context) {
    let closed = false;
    const closing = context.close().then(() => { closed = true; });
    await Promise.race([closing, new Promise(resolve => setTimeout(resolve, 5000))]);
    if (!closed && browserPid) await new Promise(resolve => execFile('taskkill', ['/PID', String(browserPid), '/T', '/F'], { windowsHide: true, timeout: 10000 }, resolve));
  }
  const relative = path.relative(os.tmpdir(), temporary);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(temporary).startsWith('screen-mark-auto-number-'));
  await rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
}
