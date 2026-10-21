import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../extension/model.js';

test('automatic number uses the normalized rectangle corner and stays inside image edges', () => {
  assert.equal(typeof model.numberLabelAtCorner, 'function');
  const bounds = { x: 0, y: 0, width: 800, height: 600 };
  assert.deepEqual(model.numberLabelAtCorner({ x: 0, y: 0 }, 22, bounds), { x: 23, y: 23, radius: 22 });
  assert.deepEqual(model.numberLabelAtCorner({ x: 799, y: 599 }, 22, bounds), { x: 777, y: 577, radius: 22 });
  const rect = model.normalizeRect({ x: 90, y: 80 }, { x: 20, y: 10 });
  assert.deepEqual(model.numberLabelAtCorner(rect, 16, bounds), { x: 20, y: 17, radius: 16 });
});

test('automatic number respects crop coordinates without changing the rectangle', () => {
  assert.equal(typeof model.numberLabelAtCorner, 'function');
  const rect = Object.freeze({ x: 85, y: 105, width: 80, height: 60 });
  const crop = Object.freeze({ x: 80, y: 100, width: 720, height: 500 });
  assert.deepEqual(model.numberLabelAtCorner(rect, 30, crop), { x: 111, y: 131, radius: 30 });
});

test('automatic number reduces its radius when the visible image is smaller than the label', () => {
  assert.equal(typeof model.numberLabelAtCorner, 'function');
  assert.deepEqual(model.numberLabelAtCorner({ x: 10, y: 20 }, 30, { x: 10, y: 20, width: 20, height: 18 }), { x: 19, y: 29, radius: 8 });
});
