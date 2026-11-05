import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { chromium } from 'playwright';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'docs/images');
await mkdir(output, { recursive: true });
await mkdir(path.join(root, 'test-results'), { recursive: true });
const fixture = await readFile(new URL('./fixtures/guide-demo.html', import.meta.url));
const server = http.createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(fixture);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const sourceUrl = `http://127.0.0.1:${server.address().port}/`;
const profile = await mkdtemp(path.join(tmpdir(), 'screen-mark-guide-'));
let context;

async function drag(page, first, last) {
  await page.mouse.move(...first); await page.mouse.down();
  await page.mouse.move(...last, { steps: 12 }); await page.mouse.up();
}

try {
  const extension = path.join(root, 'extension');
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, locale: 'en-US', viewport: { width: 1440, height: 1000 },
    args: ['--lang=en-US', '--enable-unsafe-extension-debugging', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 344, height: 620 });
  await popup.goto(`chrome-extension://${id}/popup.html`);
  assert.deepEqual(await popup.locator('[data-mode]').evaluateAll(buttons => buttons.map(button => button.dataset.mode)), ['visible', 'region', 'full']);
  await popup.locator('body').screenshot({ path: path.join(output, 'capture-menu.png') });

  const manager = await context.newPage();
  await manager.setViewportSize({ width: 1120, height: 680 });
  await manager.goto('chrome://extensions/');
  await manager.locator('extensions-toolbar').waitFor();
  const developerToggle = manager.locator('extensions-toolbar #devMode');
  if (!await developerToggle.evaluate(toggle => toggle.checked)) await developerToggle.click();
  await manager.locator('#loadUnpacked').waitFor({ state: 'visible' });
  await manager.locator('extensions-item').filter({ hasText: 'Screen Mark' }).waitFor();
  await manager.screenshot({ path: path.join(output, 'install-extension.png') });
  await manager.close();

  const source = await context.newPage();
  await source.setViewportSize({ width: 1000, height: 700 });
  await source.goto(sourceUrl); await source.bringToFront();
  const contact = await source.locator('#contact').boundingBox();
  const service = await source.locator('#service').boundingBox();
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id);
  const cdp = await context.browser().newBrowserCDPSession();
  const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
  const sourceTarget = targetInfos.find(target => target.url === sourceUrl);
  await cdp.send('Extensions.triggerAction', { id, targetId: sourceTarget.targetId });
  const newPage = context.waitForEvent('page');
  const reply = await popup.evaluate(async tabId => chrome.runtime.sendMessage({ type: 'capture', mode: 'visible', tabId }), tabId);
  assert.equal(reply.ok, true, reply.error);
  const editor = await newPage;
  await editor.setViewportSize({ width: 1440, height: 1000 });
  await editor.waitForURL(/editor\.html\?id=/);
  await editor.locator('#canvas-frame').waitFor({ state: 'visible' });
  await editor.locator('#status').filter({ hasText: 'Image copied' }).waitFor();
  assert.equal(await editor.locator('#dimensions').textContent(), '1000 × 700 px');
  const canvas = await editor.locator('#canvas').boundingBox();
  const point = (x, y) => [canvas.x + x * canvas.width / 1000, canvas.y + y * canvas.height / 700];
  await editor.getByRole('button', { name: 'Rectangle', exact: true }).click();
  assert.equal(await editor.locator('#auto-number').isChecked(), true);
  await drag(editor, point(contact.x - 9, contact.y - 9), point(contact.x + contact.width + 9, contact.y + contact.height + 9));
  await drag(editor, point(service.x - 6, service.y - 6), point(service.x + service.width + 6, service.y + service.height + 6));
  assert.equal(await editor.locator('#shape-count').textContent(), 'Marks: 4');
  await editor.locator('#status').filter({ hasText: 'Saved' }).waitFor();
  await editor.screenshot({ path: path.join(output, 'annotate-screen.png') });
  await editor.locator('#copy').click();
  await editor.locator('#status').filter({ hasText: 'Image copied' }).waitFor();
  await editor.screenshot({ path: path.join(output, 'copy-to-ai.png') });

  const blank = path.join(root, 'test-results/fixture.png');
  await sharp({ create: { width: 1000, height: 700, channels: 3, background: '#fffdf5' } }).png().toFile(blank);
  const numbered = await context.newPage();
  await numbered.setViewportSize({ width: 1440, height: 1000 });
  await numbered.goto(`chrome-extension://${id}/editor.html`);
  await numbered.locator('#file-input').setInputFiles(blank);
  await numbered.locator('#canvas-frame').waitFor({ state: 'visible' });
  const box = await numbered.locator('#canvas').boundingBox();
  await drag(numbered, [box.x + 120, box.y + 150], [box.x + 450, box.y + 350]);
  await drag(numbered, [box.x + 600, box.y + 250], [box.x + 800, box.y + 400]);
  assert.equal(await numbered.locator('#shape-count').textContent(), 'Marks: 4');
  await numbered.locator('#status').filter({ hasText: 'Saved' }).waitFor();
  await numbered.locator('#canvas').blur();
  await numbered.screenshot({ path: path.join(output, 'auto-number.png') });
  await numbered.close();

  await source.setViewportSize({ width: 1200, height: 900 });
  await source.bringToFront();
  await cdp.send('Extensions.triggerAction', { id, targetId: sourceTarget.targetId });
  await source.bringToFront();
  const selecting = await popup.evaluate(async tabId => chrome.runtime.sendMessage({ type: 'capture', mode: 'region', tabId }), tabId);
  assert.equal(selecting.ok, true, selecting.error);
  await source.locator('[data-screen-mark-region]').waitFor();
  await source.mouse.move(60, 160); await source.mouse.down();
  await source.mouse.move(850, 590, { steps: 12 });
  await source.screenshot({ path: path.join(output, 'region-capture.png') });
  await source.keyboard.press('Escape');
  await source.mouse.up();

  await writeFile(path.join(root, 'test-results/guide-verification.json'), JSON.stringify({
    extensionVersion: JSON.parse(await readFile(path.join(extension, 'manifest.json'))).version,
    fixture: 'scripts/fixtures/guide-demo.html',
    imageNames: ['install-extension.png', 'capture-menu.png', 'region-capture.png', 'auto-number.png', 'annotate-screen.png', 'copy-to-ai.png'],
    checks: ['unpacked load menu visible', 'three capture modes', 'actual visible capture 1000x700', 'capture copied without a copy action', 'region selection on the source page', 'two rectangles and labels 1,2', 'clipboard image write succeeded'],
    personalProfileUsed: false
  }, null, 2));
  console.log('Created and verified six real UI screenshots for README.');
} finally {
  if (context) await context.close();
  await new Promise(resolve => server.close(resolve));
  const relative = path.relative(tmpdir(), profile);
  if (!relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(profile).startsWith('screen-mark-guide-')) await rm(profile, { recursive: true, force: true });
}
