(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NTCVideoProjectTransform = api;
})(globalThis, () => {
  'use strict';

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const wrapAngle = value => {
    let angle = ((Number(value) || 0) + 180) % 360;
    if (angle < 0) angle += 360;
    return angle - 180;
  };

  function contentSize(clip, asset, canvas) {
    if (clip.type === 'text') {
      const text = clip.text?.content || '';
      const fontSize = Number(clip.text?.size) || 64;
      const lines = text.split('\n').slice(0, 8);
      const glyphWidth = Math.min(1580, Math.max(fontSize, ...lines.map(line => line.length * fontSize * .62)));
      const glyphHeight = Math.min(380, Math.max(fontSize, lines.length * fontSize * 1.2));
      const align = clip.text?.align || 'center';
      const offsetX = align === 'left' ? 20 - 800 + glyphWidth / 2 : align === 'right' ? 1580 - 800 - glyphWidth / 2 : 0;
      const sourceWidth = 1600; const sourceHeight = 400;
      const rotation = (Number(clip.transform?.rotation) || 0) * Math.PI / 180;
      const rotatedWidth = Math.abs(sourceWidth * Math.cos(rotation)) + Math.abs(sourceHeight * Math.sin(rotation));
      const rotatedHeight = Math.abs(sourceWidth * Math.sin(rotation)) + Math.abs(sourceHeight * Math.cos(rotation));
      const fitScale = (clip.transform?.fit === 'fill' ? Math.max : Math.min)(canvas.width / rotatedWidth, canvas.height / rotatedHeight);
      return { width: sourceWidth * fitScale, height: sourceHeight * fitScale, cropX: 1, cropY: 1, fitScale, offsetX: offsetX * fitScale, offsetY: 0, visibleWidth: glyphWidth * fitScale, visibleHeight: glyphHeight * fitScale };
    }
    const crop = clip.transform?.crop || {};
    const sourceWidth = Math.max(1, Number(asset?.width) || canvas.width);
    const sourceHeight = Math.max(1, Number(asset?.height) || canvas.height);
    const visibleWidth = sourceWidth * (1 - ((Number(crop.left) || 0) + (Number(crop.right) || 0)) / 100);
    const visibleHeight = sourceHeight * (1 - ((Number(crop.top) || 0) + (Number(crop.bottom) || 0)) / 100);
    const rotation = (Number(clip.transform?.rotation) || 0) * Math.PI / 180;
    const rotatedWidth = Math.abs(visibleWidth * Math.cos(rotation)) + Math.abs(visibleHeight * Math.sin(rotation));
    const rotatedHeight = Math.abs(visibleWidth * Math.sin(rotation)) + Math.abs(visibleHeight * Math.cos(rotation));
    const fitScale = (clip.transform?.fit === 'fill' ? Math.max : Math.min)(canvas.width / rotatedWidth, canvas.height / rotatedHeight);
    return { width: visibleWidth * fitScale, height: visibleHeight * fitScale, cropX: visibleWidth / sourceWidth, cropY: visibleHeight / sourceHeight, fitScale, offsetX: 0, offsetY: 0, visibleWidth: visibleWidth * fitScale, visibleHeight: visibleHeight * fitScale };
  }

  function geometry(clip, asset, canvas) {
    const t = clip.transform || {};
    const size = contentSize(clip, asset, canvas);
    const scale = clamp(Number(t.scale) || 100, 10, 400) / 100;
    const center = { x: canvas.width / 2 + canvas.width * (Number(t.x) || 0) / 100, y: canvas.height / 2 + canvas.height * (Number(t.y) || 0) / 100 };
    const width = size.visibleWidth * scale;
    const height = size.visibleHeight * scale;
    const radians = (Number(t.rotation) || 0) * Math.PI / 180;
    const cos = Math.cos(radians); const sin = Math.sin(radians);
    const visibleCenter = { x: center.x + size.offsetX * scale * cos - size.offsetY * scale * sin, y: center.y + size.offsetX * scale * sin + size.offsetY * scale * cos };
    const corners = [[-width / 2, -height / 2], [width / 2, -height / 2], [width / 2, height / 2], [-width / 2, height / 2]].map(([x, y]) => ({ x: visibleCenter.x + x * cos - y * sin, y: visibleCenter.y + x * sin + y * cos }));
    return { center, visibleCenter, width, height, frameWidth: size.width * scale, frameHeight: size.height * scale, rotation: Number(t.rotation) || 0, corners, size };
  }

  function contains(clip, asset, canvas, point) {
    const g = geometry(clip, asset, canvas);
    const angle = -g.rotation * Math.PI / 180;
    const dx = point.x - g.visibleCenter.x; const dy = point.y - g.visibleCenter.y;
    const x = dx * Math.cos(angle) - dy * Math.sin(angle);
    const y = dx * Math.sin(angle) + dy * Math.cos(angle);
    if (Math.abs(x) > g.width / 2 || Math.abs(y) > g.height / 2) return false;
    return true;
  }

  function scaleFromDrag(initialScale, startDistance, currentDistance, min = 10, max = 400) {
    if (!Number.isFinite(startDistance) || startDistance < 1) return clamp(initialScale, min, max);
    return clamp(Math.round(initialScale * currentDistance / startDistance), min, max);
  }

  function snappedAngle(degrees, tolerance = 3) {
    const angle = wrapAngle(degrees);
    const nearest = Math.round(angle / 45) * 45;
    return Math.abs(angle - nearest) <= tolerance ? wrapAngle(nearest) : angle;
  }

  return Object.freeze({ contentSize, geometry, contains, scaleFromDrag, wrapAngle, snappedAngle });
});
