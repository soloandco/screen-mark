import test from 'node:test';
import assert from 'node:assert/strict';
import * as rendering from '../extension/render.js';

test('pointer redraw requests share one frame and cancellation prevents stale work', () => {
  assert.equal(typeof rendering.createFrameDraw, 'function');
  const frames = new Map(); let next = 0; let draws = 0;
  const scheduler = rendering.createFrameDraw(() => draws++, callback => {
    frames.set(++next, callback); return next;
  }, id => frames.delete(id));
  for (let i = 0; i < 120; i++) scheduler.request();
  assert.equal(frames.size, 1);
  const callback = [...frames.values()][0]; frames.clear(); callback();
  assert.equal(draws, 1);
  scheduler.request(); scheduler.cancel();
  assert.equal(frames.size, 0);
  scheduler.request();
  [...frames.values()][0]();
  assert.equal(draws, 2);
});

test('PNG export shares pending work and reuses the completed result', async () => {
  assert.equal(typeof rendering.createPngCache, 'function');
  let calls = 0; let finish;
  const cache = rendering.createPngCache(() => { calls++; return new Promise(resolve => { finish = resolve; }); });
  const first = cache.get(); const second = cache.get();
  assert.equal(first, second); assert.equal(calls, 1);
  const png = new Blob(['png'], { type: 'image/png' }); finish(png);
  assert.equal(await first, png); assert.equal(await cache.get(), png); assert.equal(calls, 1);
});

test('an edit invalidates PNG results even when the previous encoding is still pending', async () => {
  assert.equal(typeof rendering.createPngCache, 'function');
  const pending = [];
  const cache = rendering.createPngCache(() => new Promise(resolve => pending.push(resolve)));
  const old = cache.get(); cache.invalidate(); const updated = cache.get();
  const newer = new Blob(['new']); const older = new Blob(['old']);
  pending[1](newer); await updated; pending[0](older); await old;
  assert.equal(await cache.get(), newer);
});

test('large PNGs are shared while pending but are not retained', async () => {
  assert.equal(typeof rendering.createPngCache, 'function');
  let calls = 0;
  const cache = rendering.createPngCache(() => { calls++; return Promise.resolve(new Blob(['12345'])); }, 4);
  const first = cache.get(); assert.equal(cache.get(), first); await first;
  await cache.get(); assert.equal(calls, 2);
});

test('PNG export retries after synchronous and asynchronous errors', async () => {
  assert.equal(typeof rendering.createPngCache, 'function');
  let calls = 0;
  const cache = rendering.createPngCache(() => {
    calls++;
    if (calls === 1) throw new Error('sync');
    if (calls === 2) return Promise.reject(new Error('async'));
    return Promise.resolve(new Blob(['ok']));
  });
  await assert.rejects(cache.get(), /sync/);
  await assert.rejects(cache.get(), /async/);
  assert.equal((await cache.get()).size, 2);
});
