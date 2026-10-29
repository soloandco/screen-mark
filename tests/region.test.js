import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../extension/model.js';

test('region normalizes reverse drag and rounds out to whole image pixels', () => {
  assert.deepEqual(model.pixelSelection({ x: 400.2, y: 300.6 }, { x: 100.7, y: 90.4 }, 1000, 700), { x: 100, y: 90, width: 301, height: 211 });
});

test('region clamps to image bounds and ignores tiny or invalid selections', () => {
  assert.deepEqual(model.pixelSelection({ x: -10, y: -20 }, { x: 2000, y: 1000 }, 1000, 700), { x: 0, y: 0, width: 1000, height: 700 });
  assert.equal(model.pixelSelection({ x: 10, y: 10 }, { x: 11, y: 20 }, 1000, 700), null);
  assert.equal(model.pixelSelection({ x: NaN, y: 10 }, { x: 50, y: 20 }, 1000, 700), null);
});

test('region uses original pixels when a high-DPI image is displayed at a smaller size', () => {
  const bounds = { left: 40, top: 80, width: 600, height: 450 };
  const start = model.imagePoint(90, 130, bounds, 2400, 1800);
  const end = model.imagePoint(240, 230, bounds, 2400, 1800);
  assert.deepEqual(model.pixelSelection(start, end, 2400, 1800), { x: 200, y: 200, width: 600, height: 400 });
});
