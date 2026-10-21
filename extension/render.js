import { shapeBounds } from './model.js';

function drawShape(ctx, shape, image) {
  ctx.save();
  ctx.strokeStyle = shape.color;
  ctx.fillStyle = shape.color;
  ctx.lineWidth = shape.stroke || 4;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  if (shape.type === 'rectangle') ctx.strokeRect(shape.x, shape.y, shape.width, shape.height);
  if (shape.type === 'number') {
    ctx.beginPath(); ctx.arc(shape.x, shape.y, shape.radius, 0, Math.PI * 2);
    ctx.fill(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke();
    const digits = String(shape.number).length;
    ctx.font = `700 ${Math.round(shape.radius * (digits > 2 ? .9 : digits > 1 ? 1.05 : 1.2))}px "Malgun Gothic", sans-serif`;
    ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(shape.number), shape.x, shape.y + 1);
  }
  if (shape.type === 'arrow') {
    const angle = Math.atan2(shape.endY - shape.y, shape.endX - shape.x);
    const length = Math.max(14, (shape.stroke || 4) * 4);
    ctx.beginPath(); ctx.moveTo(shape.x, shape.y); ctx.lineTo(shape.endX, shape.endY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(shape.endX, shape.endY);
    ctx.lineTo(shape.endX - length * Math.cos(angle - .45), shape.endY - length * Math.sin(angle - .45));
    ctx.lineTo(shape.endX - length * Math.cos(angle + .45), shape.endY - length * Math.sin(angle + .45)); ctx.closePath(); ctx.fill();
  }
  if (shape.type === 'text') {
    ctx.font = `600 ${shape.fontSize}px "Malgun Gothic", sans-serif`;
    ctx.textBaseline = 'top';
    shape.text.split('\n').forEach((line, index) => ctx.fillText(line, shape.x, shape.y + index * shape.fontSize * 1.35));
  }
  if (shape.type === 'mosaic') {
    const sample = document.createElement('canvas');
    sample.width = Math.max(1, Math.ceil(shape.width / 18)); sample.height = Math.max(1, Math.ceil(shape.height / 18));
    sample.getContext('2d').drawImage(image, shape.x, shape.y, shape.width, shape.height, 0, 0, sample.width, sample.height);
    ctx.imageSmoothingEnabled = false; ctx.drawImage(sample, shape.x, shape.y, shape.width, shape.height);
  }
  ctx.restore();
}

export function renderScene(canvas, image, state, options = {}) {
  const crop = state.crop || { x: 0, y: 0, width: image.width, height: image.height };
  if (canvas.width !== Math.round(crop.width)) canvas.width = Math.round(crop.width);
  if (canvas.height !== Math.round(crop.height)) canvas.height = Math.round(crop.height);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save(); ctx.translate(-crop.x, -crop.y); ctx.drawImage(image, 0, 0);
  state.shapes.forEach(shape => drawShape(ctx, shape, image));
  if (options.preview) {
    if (options.preview.type === 'crop') {
      const box = options.preview;
      ctx.fillStyle = '#245b4625'; ctx.fillRect(box.x, box.y, box.width, box.height);
      ctx.strokeStyle = '#245b46'; ctx.lineWidth = 2; ctx.setLineDash([8, 5]); ctx.strokeRect(box.x, box.y, box.width, box.height); ctx.setLineDash([]);
    } else drawShape(ctx, options.preview, image);
  }
  const selected = state.shapes.find(shape => shape.id === options.selectedId);
  if (selected) {
    const box = shapeBounds(selected);
    ctx.strokeStyle = '#245b46'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
    ctx.strokeRect(box.x - 5, box.y - 5, box.width + 10, box.height + 10);
  }
  ctx.restore();
}

export function exportPng(image, state) {
  const output = document.createElement('canvas');
  renderScene(output, image, state);
  return new Promise((resolve, reject) => {
    output.toBlob(blob => {
      output.width = 0; output.height = 0;
      if (blob) resolve(blob);
      else reject(new Error('PNG를 만들지 못함. 이미지 크기를 줄여 주세요.'));
    }, 'image/png');
  });
}

export function createFrameDraw(draw, request = requestAnimationFrame, cancel = cancelAnimationFrame) {
  let frame = null;
  return {
    request() {
      if (frame !== null) return;
      frame = request(() => { frame = null; draw(); });
    },
    cancel() {
      if (frame !== null) cancel(frame);
      frame = null;
    }
  };
}

// Keep at most one small result; edits detach pending work so stale results cannot return to the cache.
export function createPngCache(encode, maxBytes = 16 * 1024 * 1024) {
  let entry = null;
  return {
    invalidate() { entry = null; },
    get() {
      if (entry) return entry.promise;
      const current = {};
      try {
        current.promise = Promise.resolve(encode()).then(blob => {
          if (entry === current && blob.size > maxBytes) entry = null;
          return blob;
        }, error => {
          if (entry === current) entry = null;
          throw error;
        });
        entry = current;
        return current.promise;
      } catch (error) { return Promise.reject(error); }
    }
  };
}
