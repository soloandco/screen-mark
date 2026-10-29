import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { LANGUAGES, t, regionCopy } from '../extension/i18n.js';
import { messages } from '../extension/translations.js';

const root = path.resolve(import.meta.dirname, '..');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'screen-mark-languages-'));
const output = path.join(root, 'test-results/languages'); await mkdir(output, { recursive: true });
const server = http.createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end('<!doctype html><title>Language fixture</title><style>body{margin:0;background:#fffdf5}main{position:absolute;left:100px;top:100px;width:300px;height:200px;background:#216b52}</style><main></main>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let context, browserPid;
const checks = [], errors = [];
try {
  const extension = path.join(temporary, 'extension'); await cp(path.join(root, 'extension'), extension, { recursive: true });
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    channel: 'chrome', headless: true, viewport: { width: 1200, height: 900 }, acceptDownloads: true,
    ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging']
  });
  context.setDefaultTimeout(12000); context.on('weberror', event => errors.push(event.error().message));
  const cdp = await context.browser().newBrowserCDPSession();
  browserPid = (await cdp.send('SystemInfo.getProcessInfo')).processInfo.find(item => item.type === 'browser').id;
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: extension });
  const base = `chrome-extension://${id}`;
  const control = await context.newPage(); await control.goto(`${base}/popup.html`); await control.setViewportSize({ width: 344, height: 720 });
  assert.equal(await control.locator('html').getAttribute('lang'), 'en');
  assert.deepEqual(await control.locator('[data-language-picker] option').evaluateAll(nodes => nodes.map(node => [node.value, node.textContent])), LANGUAGES.map(item => [item.code, item.name]));
  assert.equal(await control.locator('[data-mode="region"] strong').textContent(), 'Select an area');
  checks.push('fresh install defaults to English with English, Korean, Japanese and Spanish in the requested order');
  const fixture = path.join(temporary, 'Customer 日本語 한국어.png');
  await sharp({ create: { width: 800, height: 600, channels: 4, background: '#fffdf5' } }).png().toFile(fixture);
  const editor = await context.newPage(); await editor.goto(`${base}/editor.html`);
  await editor.locator('#file-input').setInputFiles(fixture); await editor.locator('#canvas-frame').waitFor({ state: 'visible' });
  const canvas = await editor.locator('#canvas').boundingBox();
  await editor.mouse.move(canvas.x + 30, canvas.y + 30); await editor.mouse.down(); await editor.mouse.move(canvas.x + 140, canvas.y + 100); await editor.mouse.up();
  await editor.locator('#status').filter({ hasText: 'Saved in this browser' }).waitFor();
  const captureId = new URL(editor.url()).searchParams.get('id'), editorUrl = editor.url();
  const record = () => control.evaluate(async id => {
    const record = await (await import('./storage.js')).getCapture(id);
    return { document: record.document, revision: record.revision, title: record.title };
  }, captureId);
  const original = await record(), zoom = await editor.locator('#zoom-value').textContent();
  await editor.locator('[data-tool="arrow"]').click();
  const source = await context.newPage(), sourceUrl = `http://127.0.0.1:${server.address().port}/`;
  await source.goto(sourceUrl);
  const targets = await cdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
  const target = targets.targetInfos.find(item => item.url === sourceUrl);
  for (const { code } of LANGUAGES) {
    await control.locator('[data-language-picker]').selectOption(code);
    await editor.waitForFunction(code => document.documentElement.lang === code, code);
    assert.equal(await editor.locator('#shape-count').textContent(), t('표시 {count}개', { count: 2 }, code));
    assert.equal(await editor.locator('#status').textContent(), t('드래그해 화살표 추가', {}, code));
    assert.equal(await editor.locator('[data-tool="arrow"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await editor.locator('#zoom-value').textContent(), zoom);
    assert.equal(editor.url(), editorUrl); assert.deepEqual(await record(), original);
    assert.equal(await editor.locator('#file-title').textContent(), 'Customer 日本語 한국어.png');
    assert.ok((await editor.title()).startsWith('Customer 日本語 한국어.png'));
    assert.equal(await editor.locator('#undo').isEnabled(), true);
    assert.equal(await control.locator('[data-mode="visible"] strong').textContent(), t('현재 화면', {}, code));
    if (process.env.LANGUAGE_SCREENSHOTS !== '0') {
      await control.screenshot({ path: path.join(output, `popup-${code}.png`) });
      await editor.screenshot({ path: path.join(output, `editor-${code}.png`) });
    }
    for (const page of [control, editor]) {
      const translatedNodes = await page.locator('[data-i18n], [data-i18n-title], [data-i18n-aria], [data-i18n-alt]').evaluateAll(nodes => nodes.flatMap(node => [...node.attributes].filter(attribute => attribute.name.startsWith('data-i18n')).map(attribute => attribute.value)));
      for (const key of translatedNodes) assert.ok(Object.hasOwn(messages, key), `missing translation: ${key}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${code} page overflow`);
    }
    await control.reload(); assert.equal(await control.locator('[data-language-picker]').inputValue(), code);
    await source.bringToFront(); await cdp.send('Extensions.triggerAction', { id, targetId: target.targetId });
    const tabId = await control.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id);
    const started = await control.evaluate(({ tabId, language }) => chrome.runtime.sendMessage({ type: 'capture', mode: 'region', tabId, language }), { tabId, language: code });
    assert.equal(started.ok, true, started.error);
    await source.locator('[data-screen-mark-region]').waitFor();
    assert.equal(await source.locator('[data-screen-mark-region]').getAttribute('aria-label'), regionCopy(code).copy.label);
    if (process.env.LANGUAGE_SCREENSHOTS !== '0') await source.screenshot({ path: path.join(output, `region-${code}.png`) });
    const opened = context.waitForEvent('page');
    await source.mouse.move(100, 100); await source.mouse.down(); await source.mouse.move(400, 300, { steps: 6 }); await source.mouse.up();
    const captured = await opened; await captured.waitForURL('**/editor.html?id=*'); await captured.locator('#canvas-frame').waitFor({ state: 'visible' });
    assert.equal(await captured.locator('html').getAttribute('lang'), code);
    assert.equal(await captured.locator('#dimensions').textContent(), '300 × 200 px');
    if (code === 'es') {
      const downloaded = captured.waitForEvent('download'); await captured.locator('#download').click();
      const destination = path.join(output, 'spanish-capture.png'); await (await downloaded).saveAs(destination);
      const pixels = await sharp(destination).ensureAlpha().raw().toBuffer();
      for (let offset = 0; offset < pixels.length; offset += 4) assert.deepEqual([...pixels.subarray(offset, offset + 4)], [33, 107, 82, 255]);
      await captured.locator('#copy').click(); await captured.locator('#status').filter({ hasText: 'Imagen copiada' }).waitFor();
    }
    await captured.close();
  }
  checks.push('all four languages update popup, editor, titles, accessibility labels and source overlay; no page overflow');
  checks.push('language switches and popup reloads preserve language, image, file name, marks, history, tool, zoom and storage revision');
  checks.push('all four region captures open the selected language; Spanish export keeps exact source pixels and clipboard writes succeed');
  for (const code of ['en', 'es']) {
    await control.locator('[data-language-picker]').selectOption(code);
    await source.bringToFront(); await cdp.send('Extensions.triggerAction', { id, targetId: target.targetId });
    const tabId = await control.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id);
    const result = await control.evaluate(({ tabId, language }) => chrome.runtime.sendMessage({ type: 'capture', mode: 'region', tabId, language }), { tabId, language: code });
    assert.equal(result.ok, true, result.error);
    assert.equal(await source.locator('[data-screen-mark-region]').getAttribute('aria-label'), regionCopy(code).copy.label);
  }
  await source.keyboard.press('Escape'); await source.locator('[data-screen-mark-region]').waitFor({ state: 'detached' });
  checks.push('restarting an active area selection uses the newly selected language instead of the previous session copy');
  const legacyId = await control.evaluate(async id => {
    const { getCapture, putCapture } = await import('./storage.js');
    const original = await getCapture(id), pending = { ...original, id: crypto.randomUUID(), selectionPending: true, document: { shapes: [], crop: null } };
    await putCapture(pending); return pending.id;
  }, captureId);
  const legacy = await context.newPage(); await legacy.goto(`${base}/selection.html?id=${legacyId}`);
  await legacy.locator('#surface').waitFor({ state: 'visible' }); await legacy.locator('#auto-confirm').uncheck();
  const legacyImage = await legacy.locator('#capture-image').boundingBox();
  await legacy.mouse.move(legacyImage.x + 20, legacyImage.y + 20); await legacy.mouse.down();
  await legacy.mouse.move(legacyImage.x + 100, legacyImage.y + 100); await legacy.mouse.up();
  const legacyDimensions = await legacy.locator('#dimensions').textContent();
  for (const { code } of LANGUAGES) {
    await control.locator('[data-language-picker]').selectOption(code);
    await legacy.waitForFunction(code => document.documentElement.lang === code, code);
    assert.equal(await legacy.locator('#cancel span').textContent(), t('취소', {}, code));
    assert.equal(await legacy.locator('#confirm').isEnabled(), true);
    assert.equal(await legacy.locator('#dimensions').textContent(), legacyDimensions);
    assert.equal(await legacy.locator('#auto-confirm').isChecked(), false);
  }
  const closing = legacy.waitForEvent('close'); await legacy.locator('#cancel').click(); await closing;
  checks.push('existing pending selection tabs switch all four languages without resetting the selection or confirmation preference');
  await editor.locator('#file-input').setInputFiles({ name: 'wrong.gif', mimeType: 'image/gif', buffer: Buffer.from('invalid') });
  await editor.locator('#status.error').waitFor();
  await control.locator('[data-language-picker]').selectOption('ja');
  await editor.locator('#status.error').filter({ hasText: 'PNG、JPG、WebP' }).waitFor();
  assert.deepEqual(await record(), original);
  await editor.locator('[data-tool="text"]').click(); await editor.mouse.click(canvas.x + 80, canvas.y + 80);
  await editor.locator('#text-input').fill('Hola 日本語 한국어');
  await control.locator('[data-language-picker]').selectOption('es');
  await editor.locator('#text-dialog h2').filter({ hasText: 'Añadir texto' }).waitFor();
  assert.equal(await editor.locator('#text-input').inputValue(), 'Hola 日本語 한국어');
  await editor.locator('#text-dialog [value="cancel"]').click();
  checks.push('existing errors and open text dialogs retranslate while user text and marks remain unchanged');
  await control.evaluate(() => {
    const original = Storage.prototype.setItem;
    globalThis.restoreLanguageStorage = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function(key, value) { if (key === 'screen-mark.language') throw new Error('Blocked preference'); return original.call(this, key, value); };
  });
  await control.locator('[data-language-picker]').selectOption('en');
  await control.locator('[data-language-error]').waitFor({ state: 'visible' });
  assert.equal(await control.locator('html').getAttribute('lang'), 'es');
  assert.equal(await control.locator('[data-language-picker]').inputValue(), 'es');
  await control.evaluate(() => globalThis.restoreLanguageStorage());
  checks.push('failed preference writes keep the previous language and show a localized retry message');
  assert.deepEqual(errors, []);
  const result = { ok: true, version: await control.evaluate(() => chrome.runtime.getManifest().version), checks, errors };
  await writeFile(path.join(output, 'verification.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} finally {
  if (context) {
    let deadline; const closing = context.close();
    const closed = await Promise.race([closing.then(() => true), new Promise(resolve => { deadline = setTimeout(() => resolve(false), 5000); })]); clearTimeout(deadline);
    if (!closed && browserPid) await new Promise(resolve => execFile('taskkill', ['/PID', String(browserPid), '/T', '/F'], { windowsHide: true, timeout: 10000 }, resolve));
  }
  await new Promise(resolve => server.close(resolve));
  const relative = path.relative(os.tmpdir(), temporary);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(temporary).startsWith('screen-mark-languages-'));
  await rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
}
