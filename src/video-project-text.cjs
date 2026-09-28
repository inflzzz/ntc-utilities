'use strict';
const sharp = require('sharp');

function svgForText(input) {
  const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const lines = input.content.split('\n').slice(0, 8);
  const x = input.align === 'left' ? 20 : input.align === 'right' ? 1580 : 800;
  const anchor = input.align === 'left' ? 'start' : input.align === 'right' ? 'end' : 'middle';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="400"><text x="${x}" y="${200 - (lines.length - 1) * input.size * .6}" text-anchor="${anchor}" dominant-baseline="middle" fill="${input.color}" font-family="${escape(input.font)}" font-weight="${input.weight}" font-size="${input.size}">${lines.map((line, index) => `<tspan x="${x}" dy="${index ? input.size * 1.2 : 0}">${escape(line)}</tspan>`).join('')}</text></svg>`;
}

async function writeTextPng(input, file) {
  await sharp(Buffer.from(svgForText(input))).png().toFile(file);
  return file;
}

module.exports = { svgForText, writeTextPng };
