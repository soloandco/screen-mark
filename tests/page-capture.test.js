import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { pageCapture } from '../extension/page-capture.js';

test('page recovery deadline renews on activity and still restores after idle or explicit completion', async () => {
  let now = 0, nextId = 0;
  const timers = new Map();
  const style = () => {
    const values = new Map([['scroll-behavior', ['smooth', '']]]);
    return {
      getPropertyValue: key => values.get(key)?.[0] || '',
      getPropertyPriority: key => values.get(key)?.[1] || '',
      setProperty: (key, value, priority) => values.set(key, [value, priority]),
      removeProperty: key => values.delete(key)
    };
  };
  const root = { style: style(), scrollHeight: 32000, scrollWidth: 1200 };
  const body = { style: style(), scrollHeight: 32000 };
  const fixed = { style: style() };
  const context = vm.createContext({
    document: { documentElement: root, body, querySelectorAll: () => [fixed] },
    innerWidth: 1200, innerHeight: 180, devicePixelRatio: 1, scrollX: 0, scrollY: 42,
    getComputedStyle: () => ({ position: 'fixed' }),
    setTimeout: (callback, delay) => { const id = ++nextId; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id)
  });
  context.window = context;
  context.scrollTo = (x, y) => { context.scrollX = typeof x === 'object' ? x.left : x; context.scrollY = typeof x === 'object' ? x.top : y; };
  const call = vm.runInContext(`(${pageCapture.toString()})`, context);
  const advance = ms => {
    const target = now + ms;
    while (true) {
      const next = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at; timers.delete(next[0]); next[1].callback();
    }
    now = target;
  };
  await call('init');
  advance(89000);
  const scrolling = call('scroll', 180);
  advance(180); await scrolling;
  advance(2000);
  assert.ok(context.__screenMarkSession, 'active capture must survive its original 90-second deadline');
  assert.equal(fixed.style.getPropertyValue('visibility'), 'hidden');
  advance(88000);
  assert.equal(context.__screenMarkSession, undefined);
  assert.equal(context.scrollY, 42);
  assert.equal(root.style.getPropertyValue('scroll-behavior'), 'smooth');
  assert.equal(fixed.style.getPropertyValue('visibility'), '');
  assert.equal(timers.size, 0);
  await call('init');
  await call('restore');
  assert.equal(timers.size, 0);
  assert.equal(context.__screenMarkSession, undefined);
});
