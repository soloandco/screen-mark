import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { regionCapture } from '../extension/region-capture.js';

test('region capture cannot hang when the source tab stops producing animation frames', async () => {
  const rect = { x: 20, y: 40, width: 200, height: 100, viewportWidth: 1200, viewportHeight: 900, scrollX: 0, scrollY: 0, scale: 2 };
  const session = { phase: 'selected', rect };
  const context = vm.createContext({
    __screenMarkRegion: session, innerWidth: 1200, innerHeight: 900, scrollX: 0, scrollY: 0, devicePixelRatio: 2,
    requestAnimationFrame: () => 1, cancelAnimationFrame: () => {}, setTimeout, clearTimeout
  });
  const call = vm.runInContext(`(${regionCapture.toString()})`, context);
  let deadline;
  try {
    const result = await Promise.race([call('take'), new Promise((resolve, reject) => { deadline = setTimeout(() => reject(new Error('capture is still waiting for animation frames')), 1000); })]);
    assert.equal(result, rect);
    assert.equal(session.phase, 'capturing');
  } finally { clearTimeout(deadline); }
});

function selectedSession(overrides = {}) {
  const rect = { x: 20, y: 40, width: 200, height: 100, viewportWidth: 1200, viewportHeight: 900, scrollX: 15, scrollY: 80, scale: 2 };
  const session = { phase: 'selected', rect };
  const context = vm.createContext({
    __screenMarkRegion: session, innerWidth: 1200, innerHeight: 900, scrollX: 15, scrollY: 80, devicePixelRatio: 2,
    requestAnimationFrame: callback => setTimeout(callback, 0), cancelAnimationFrame: clearTimeout, setTimeout, clearTimeout,
    ...overrides
  });
  return { session, context, call: vm.runInContext(`(${regionCapture.toString()})`, context) };
}

test('region selection is consumed once and only an active capture may be verified', async () => {
  const { session, call } = selectedSession();
  await assert.rejects(call('verify'), /먼저 캡처할 영역/);
  assert.equal(await call('take'), session.rect);
  assert.equal(await call('verify'), session.rect);
  await assert.rejects(call('take'), /먼저 캡처할 영역/);
});

test('region verification rejects changes to any viewport coordinate or scale', async () => {
  for (const property of ['innerWidth', 'innerHeight', 'scrollX', 'scrollY', 'devicePixelRatio']) {
    const { context, call } = selectedSession();
    await call('take'); context[property] += 1;
    await assert.rejects(call('verify'), /화면 크기나 스크롤 위치/, property);
  }
});

test('a replaced selection cannot finish the previous capture after its paint wait', async () => {
  const { context, call } = selectedSession();
  const pending = call('take');
  context.__screenMarkRegion = { phase: 'selecting', rect: null };
  await assert.rejects(pending, /화면 크기나 스크롤 위치/);
});
