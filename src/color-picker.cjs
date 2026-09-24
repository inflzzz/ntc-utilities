'use strict';

function channel(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new TypeError('A amostra de cor é inválida.');
  return Math.max(0, Math.min(255, Math.round(parsed)));
}

function normalizeSample(sample) {
  if (!sample || typeof sample !== 'object') throw new TypeError('A amostra de cor é inválida.');
  const r = channel(sample.r);
  const g = channel(sample.g);
  const b = channel(sample.b);
  return { r, g, b, hex: `#${[r, g, b].map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase()}` };
}

function rgbToHsl(sample) {
  const { r, g, b } = normalizeSample(sample);
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (delta) {
    s = delta / (1 - Math.abs(2 * l - 1));
    if (max === red) h = ((green - blue) / delta) % 6;
    else if (max === green) h = (blue - red) / delta + 2;
    else h = (red - green) / delta + 4;
    h = Math.round(h * 60);
    if (h < 0) h += 360;
  }
  return `hsl(${h}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
}

module.exports = { normalizeSample, rgbToHsl };
