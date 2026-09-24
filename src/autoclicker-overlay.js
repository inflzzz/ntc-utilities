'use strict';

(() => {
  const canvas = document.querySelector('#preview');
  const ctx = canvas.getContext('2d');
  let state = { mode: 'hidden' };
  let ratio = 1;

  function resize() {
    ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(window.innerWidth * ratio));
    canvas.height = Math.max(1, Math.round(window.innerHeight * ratio));
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    draw();
  }

  function label(text, x, y, color) {
    ctx.save();
    ctx.font = '600 13px "Segoe UI", sans-serif';
    const width = ctx.measureText(text).width + 18;
    const left = Math.max(7, Math.min(window.innerWidth - width - 7, x));
    const top = Math.max(7, Math.min(window.innerHeight - 31, y));
    ctx.shadowColor = '#0009';
    ctx.shadowBlur = 12;
    ctx.fillStyle = '#111e';
    ctx.beginPath();
    ctx.roundRect(left, top, width, 25, 7);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.fillText(text, left + 9, top + 17);
    ctx.restore();
  }

  function drawZone(zone, index, highlighted) {
    const palette = {
      stop: { stroke: '#ff6b67', fill: '#ff4d4330', title: 'Parar' },
      pause: { stroke: '#ffc857', fill: '#ffc85730', title: 'Pausar' },
      start: { stroke: '#63dc9a', fill: '#63dc9a30', title: 'Retomar' }
    };
    const color = palette[zone.action] || palette.stop;
    ctx.save();
    ctx.fillStyle = highlighted ? color.fill.replace('30', '48') : color.fill;
    ctx.fillRect(zone.x, zone.y, zone.width, zone.height);
    ctx.strokeStyle = color.stroke;
    ctx.lineWidth = highlighted ? 3 : 2;
    ctx.setLineDash(highlighted ? [] : [8, 5]);
    ctx.strokeRect(zone.x, zone.y, zone.width, zone.height);
    ctx.restore();
    label(`Zona ${index + 1} · ${color.title}`, zone.x + 8, zone.y + 8, color.stroke);
  }

  function drawPoint(point, index, highlighted) {
    const color = highlighted ? '#fff27a' : '#73c7ff';
    ctx.save();
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 8;
    if (point.radius > 0) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, point.radius, 0, Math.PI * 2);
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = `${color}cc`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(point.x, point.y, highlighted ? 13 : 11, 0, Math.PI * 2);
    ctx.fillStyle = '#10151de8';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
    label(`Ponto ${index + 1}`, point.x + 15, point.y - 12, color);
  }

  function drawCursor(point, kind, drawing) {
    if (!point) return;
    const color = kind === 'zone' ? '#89f0bb' : '#8bd0ff';
    ctx.save();
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 5;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 12, 0, Math.PI * 2);
    ctx.moveTo(point.x - 20, point.y); ctx.lineTo(point.x + 20, point.y);
    ctx.moveTo(point.x, point.y - 20); ctx.lineTo(point.x, point.y + 20);
    ctx.stroke();
    ctx.restore();
    if (kind === 'zone' && drawing) return;
    label(kind === 'zone' ? 'Arraste com o botão direito · Esc cancela' : 'Direito marca · Segure Shift + direito para continuar · Ctrl + direito apaga', point.x + 20, point.y + 15, color);
  }

  function draw() {
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    if (!state || state.mode === 'hidden') return;

    (state.zones || []).forEach((zone, index) => drawZone(zone, index, false));
    (state.points || []).forEach((point, index) => drawPoint(point, index, false));

    if (state.highlightZone) drawZone(state.highlightZone, Math.max(0, (state.zones || []).length - 1), true);
    if (state.highlightPoint) drawPoint(state.highlightPoint, (state.points || []).length - 1, true);

    if (state.mode === 'picker' && state.kind === 'zone' && state.drawing && state.start && state.cursor) {
      const left = Math.min(state.start.x, state.cursor.x);
      const top = Math.min(state.start.y, state.cursor.y);
      const width = Math.abs(state.start.x - state.cursor.x);
      const height = Math.abs(state.start.y - state.cursor.y);
      ctx.fillStyle = '#68d99c35';
      ctx.fillRect(left, top, width, height);
      ctx.strokeStyle = '#8affbc';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 4]);
      ctx.strokeRect(left, top, width, height);
      ctx.setLineDash([]);
      label(`${Math.round(width)} × ${Math.round(height)} px`, left + 7, top - 31, '#8affbc');
    }

    if (state.mode === 'picker') drawCursor(state.cursor, state.kind, state.drawing);
  }

  window.addEventListener('resize', resize);
  window.ntcOverlay.onState(next => { state = next || { mode: 'hidden' }; draw(); });
  resize();
})();
