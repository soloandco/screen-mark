export function normalizeRect(start, end) {
  return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
}

export function pixelSelection(start, end, width, height) {
  if (![start.x, start.y, end.x, end.y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  const box = normalizeRect(start, end);
  if (box.width < 3 || box.height < 3) return null;
  const x = Math.max(0, Math.min(width, Math.floor(box.x)));
  const y = Math.max(0, Math.min(height, Math.floor(box.y)));
  const right = Math.max(0, Math.min(width, Math.ceil(box.x + box.width)));
  const bottom = Math.max(0, Math.min(height, Math.ceil(box.y + box.height)));
  return right - x >= 3 && bottom - y >= 3 ? { x, y, width: right - x, height: bottom - y } : null;
}

export function imagePoint(clientX, clientY, bounds, width, height) {
  const clamp = (value, max) => Math.min(max, Math.max(0, value));
  return { x: clamp((clientX - bounds.left) * width / bounds.width, width), y: clamp((clientY - bounds.top) * height / bounds.height, height) };
}

export function nextNumber(shapes, start = 1) {
  return Math.max(start - 1, ...shapes.filter(shape => shape.type === 'number').map(shape => shape.number)) + 1;
}

export function numberLabelAtCorner(rect, radius, bounds) {
  const margin = Math.min(1, bounds.width / 4, bounds.height / 4);
  radius = Math.min(radius, bounds.width / 2 - margin, bounds.height / 2 - margin);
  const inset = radius + margin;
  return {
    x: Math.max(bounds.x + inset, Math.min(rect.x, bounds.x + bounds.width - inset)),
    y: Math.max(bounds.y + inset, Math.min(rect.y, bounds.y + bounds.height - inset)),
    radius
  };
}

export function createHistory(initial) {
  let states = [structuredClone(initial)];
  let index = 0;
  return {
    get current() { return structuredClone(states[index]); },
    get canUndo() { return index > 0; },
    get canRedo() { return index < states.length - 1; },
    commit(state) {
      states = [...states.slice(0, index + 1), structuredClone(state)].slice(-80);
      index = states.length - 1;
      return this.current;
    },
    undo() { index = Math.max(0, index - 1); return this.current; },
    redo() { index = Math.min(states.length - 1, index + 1); return this.current; }
  };
}

export function arrowHead(shape) {
  const angle = Math.atan2(shape.endY - shape.y, shape.endX - shape.x);
  const length = Math.max(14, (shape.stroke || 4) * 4);
  return [
    { x: shape.endX, y: shape.endY },
    { x: shape.endX - length * Math.cos(angle - .45), y: shape.endY - length * Math.sin(angle - .45) },
    { x: shape.endX - length * Math.cos(angle + .45), y: shape.endY - length * Math.sin(angle + .45) }
  ];
}

function segmentDistance(point, start, end) {
  const dx = end.x - start.x, dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared)) : 0;
  return Math.hypot(point.x - start.x - t * dx, point.y - start.y - t * dy);
}

function hitsArrow(shape, point) {
  const head = arrowHead(shape);
  if (segmentDistance(point, shape, head[0]) <= Math.max(6, (shape.stroke || 4) / 2)) return true;
  const sides = head.map((start, index) => {
    const end = head[(index + 1) % 3];
    return (end.x - start.x) * (point.y - start.y) - (end.y - start.y) * (point.x - start.x);
  });
  if (sides.every(side => side >= 0) || sides.every(side => side <= 0)) return true;
  return head.some((start, index) => segmentDistance(point, start, head[(index + 1) % 3]) <= 6);
}

export function shapeBounds(shape) {
  if (shape.type === 'number') return { x: shape.x - shape.radius, y: shape.y - shape.radius, width: shape.radius * 2, height: shape.radius * 2 };
  if (shape.type === 'arrow') {
    const points = [shape, ...arrowHead(shape)];
    const x = Math.min(...points.map(point => point.x)), y = Math.min(...points.map(point => point.y));
    return { x, y, width: Math.max(...points.map(point => point.x)) - x, height: Math.max(...points.map(point => point.y)) - y };
  }
  return { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
}

export function hitTest(shapes, point) {
  return [...shapes].reverse().find(shape => {
    if (shape.type === 'number') return Math.hypot(point.x - shape.x, point.y - shape.y) <= shape.radius + 5;
    if (shape.type === 'arrow') return hitsArrow(shape, point);
    const bounds = shapeBounds(shape);
    return point.x >= bounds.x - 6 && point.x <= bounds.x + bounds.width + 6 && point.y >= bounds.y - 6 && point.y <= bounds.y + bounds.height + 6;
  }) || null;
}

export function translateShape(shape, dx, dy) {
  return { ...shape, x: shape.x + dx, y: shape.y + dy, ...(shape.type === 'arrow' ? { endX: shape.endX + dx, endY: shape.endY + dy } : {}) };
}

export function cropDocument(document, rect, width, height) {
  const x = Math.max(0, rect.x);
  const y = Math.max(0, rect.y);
  return { ...document, crop: { x, y, width: Math.max(1, Math.min(width, rect.x + rect.width) - x), height: Math.max(1, Math.min(height, rect.y + rect.height) - y) } };
}

export function capturePlan(width, height, viewportHeight, scale = 1) {
  const pixelWidth = Math.round(width * scale);
  const pixelHeight = Math.round(height * scale);
  if (![width, height, viewportHeight, scale].every(value => Number.isFinite(value) && value > 0)) throw new Error('페이지 크기를 확인할 수 없음.');
  if (pixelWidth > 32760 || pixelHeight > 32760 || pixelWidth * pixelHeight > 48_000_000) throw new Error('페이지가 너무 큼. 현재 화면 캡처를 이용해 주세요.');
  const positions = [];
  for (let y = 0; y < height; y += viewportHeight) {
    const position = Math.min(y, Math.max(0, height - viewportHeight));
    if (positions.at(-1) !== position) positions.push(position);
  }
  return { pixelWidth, pixelHeight, positions };
}

// Pixel coordinates: retain earlier captures and append only the uncovered strip.
export function captureSlice(top, height, coveredHeight, totalHeight) {
  const destinationY = Math.max(top, coveredHeight);
  const sourceY = destinationY - top;
  return { sourceY, destinationY, height: Math.max(0, Math.min(height - sourceY, totalHeight - destinationY)) };
}
