import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRect, imagePoint, nextNumber, createHistory, hitTest, translateShape, cropDocument, capturePlan, captureSlice, arrowHead, shapeBounds } from '../extension/model.js';

test('reverse drag produces the same rectangle', () => {
  assert.deepEqual(normalizeRect({ x: 90, y: 80 }, { x: 20, y: 10 }), { x: 20, y: 10, width: 70, height: 70 });
});

test('pointer coordinates map to original image and clamp at the edge', () => {
  assert.deepEqual(imagePoint(150, 90, { left: 50, top: 40, width: 400, height: 200 }, 1600, 800), { x: 400, y: 200 });
  assert.deepEqual(imagePoint(-20, 999, { left: 0, top: 0, width: 400, height: 200 }, 1600, 800), { x: 0, y: 800 });
});

test('number labels count independently of other shapes and allow explicit starting numbers', () => {
  assert.equal(nextNumber([], 7), 7);
  assert.equal(nextNumber([{ type: 'rectangle' }, { type: 'number', number: 7 }, { type: 'number', number: 12 }], 7), 13);
});

test('undo restores number availability and a new edit drops redo', () => {
  const history = createHistory({ shapes: [], crop: null });
  history.commit({ shapes: [{ type: 'number', number: 1 }], crop: null });
  history.commit({ shapes: [{ type: 'number', number: 1 }, { type: 'number', number: 2 }], crop: null });
  assert.equal(nextNumber(history.undo().shapes), 2);
  assert.equal(nextNumber(history.redo().shapes), 3);
  history.undo();
  history.commit({ shapes: [{ type: 'rectangle' }], crop: null });
  assert.equal(history.canRedo, false);
  assert.equal(history.undo().shapes.length, 1);
});

test('history isolates old states from accidental mutation', () => {
  const original = { shapes: [], crop: null };
  const history = createHistory(original);
  original.shapes.push({ type: 'number' });
  assert.equal(history.current.shapes.length, 0);
});

test('hit testing picks the topmost number over a rectangle', () => {
  const shapes = [{ id: 'r', type: 'rectangle', x: 10, y: 10, width: 100, height: 100 }, { id: 'n', type: 'number', x: 20, y: 20, radius: 16 }];
  assert.equal(hitTest(shapes, { x: 20, y: 20 })?.id, 'n');
  assert.equal(hitTest(shapes, { x: 80, y: 80 })?.id, 'r');
  assert.equal(hitTest(shapes, { x: 300, y: 300 }), null);
});

test('moving an arrow translates both endpoints without changing the original', () => {
  const arrow = { type: 'arrow', x: 5, y: 10, endX: 60, endY: 80 };
  assert.deepEqual(translateShape(arrow, 10, -5), { type: 'arrow', x: 15, y: 5, endX: 70, endY: 75 });
  assert.equal(arrow.x, 5);
});

test('arrow hit testing leaves empty bounding-box space available to underlying shapes', () => {
  const rectangle = { id: 'under', type: 'rectangle', x: 0, y: 80, width: 20, height: 20 };
  const arrow = { id: 'arrow', type: 'arrow', x: 0, y: 0, endX: 100, endY: 100, stroke: 4 };
  assert.equal(hitTest([arrow], { x: 0, y: 100 }), null);
  assert.equal(hitTest([rectangle, arrow], { x: 10, y: 90 })?.id, 'under');
  assert.equal(hitTest([arrow], { x: 50, y: 53 })?.id, 'arrow');
});

test('arrow hit testing includes thick arrowheads and handles reversed and zero-length shafts', () => {
  const arrow = { id: 'arrow', type: 'arrow', x: 0, y: 100, endX: 200, endY: 100, stroke: 16 };
  assert.equal(hitTest([arrow], { x: 148, y: 80 })?.id, 'arrow');
  assert.equal(hitTest([{ ...arrow, x: 200, endX: 0 }], { x: 52, y: 80 })?.id, 'arrow');
  assert.equal(hitTest([{ ...arrow, endX: 0 }], { x: 0, y: 100 })?.id, 'arrow');
  assert.equal(hitTest([{ ...arrow, endX: 0 }], { x: 100, y: 100 }), null);
});

test('crop keeps image coordinates and clamps to original bounds', () => {
  const doc = { shapes: [{ type: 'number', x: 50, y: 60 }], crop: null };
  const cropped = cropDocument(doc, { x: -20, y: 10, width: 100, height: 999 }, 300, 200);
  assert.deepEqual(cropped.crop, { x: 0, y: 10, width: 80, height: 190 });
  assert.deepEqual(cropped.shapes, doc.shapes);
  assert.equal(doc.crop, null);
});

test('full page plan clamps the last scroll without duplicate positions', () => {
  assert.deepEqual(capturePlan(1200, 2600, 1000, 1.5), { pixelWidth: 1800, pixelHeight: 3900, positions: [0, 1000, 1600] });
  assert.deepEqual(capturePlan(1200, 700, 1000).positions, [0]);
});

test('full page plan rejects oversized and invalid image dimensions', () => {
  assert.throws(() => capturePlan(4000, 16000, 1000), /너무 큼/);
  assert.throws(() => capturePlan(1000, 35000, 1000), /너무 큼/);
  assert.throws(() => capturePlan(0, 100, 100), /크기/);
  assert.throws(() => capturePlan(100, Infinity, 100), /크기/);
});

test('capture slices preserve overlap, append the final strip and clamp to the image height', () => {
  assert.deepEqual(captureSlice(0, 1000, 0, 1020), { sourceY: 0, destinationY: 0, height: 1000 });
  assert.deepEqual(captureSlice(20, 1000, 1000, 1020), { sourceY: 980, destinationY: 1000, height: 20 });
  assert.deepEqual(captureSlice(1600, 1000, 2000, 2600), { sourceY: 400, destinationY: 2000, height: 600 });
  assert.deepEqual(captureSlice(0, 1000, 0, 700), { sourceY: 0, destinationY: 0, height: 700 });
  assert.deepEqual(captureSlice(20, 1000, 1020, 1020), { sourceY: 1000, destinationY: 1020, height: 0 });
  assert.deepEqual(captureSlice(30, 1500, 1500, 1530), { sourceY: 1470, destinationY: 1500, height: 30 });
});

test('arrow selection bounds contain the same arrowhead vertices used by the renderer', () => {
  const arrow = { type: 'arrow', x: 0, y: 100, endX: 200, endY: 100, stroke: 16 };
  const bounds = shapeBounds(arrow);
  for (const point of arrowHead(arrow)) {
    assert.ok(point.x >= bounds.x && point.x <= bounds.x + bounds.width);
    assert.ok(point.y >= bounds.y && point.y <= bounds.y + bounds.height);
  }
  assert.ok(bounds.height > 50);
});
