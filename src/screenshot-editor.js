(() => {
  const dialog = document.querySelector('#screenshotEditorDialog');
  const canvas = document.querySelector('#screenshotCanvas');
  const viewport = document.querySelector('#screenshotCanvasViewport');
  const ctx = canvas.getContext('2d');
  const stage = document.createElement('canvas');
  const stageCtx = stage.getContext('2d');
  const tools = [...document.querySelectorAll('[data-shot-tool]')];
  let image = null;
  let crop = null;
  let commands = [];
  let undoStack = [];
  let redoStack = [];
  let activeTool = 'pen';
  let gesture = null;
  let callbacks = {};
  let saving = false;
  let stageDirty = true;
  let pendingOverlayImage = null;
  let selectedCurveArrow = null;
  let selectedImageOverlay = null;
  let activeHandleDrag = null;
  let nextCommandId = 1;

  const colorInput = document.querySelector('#screenshotColor');
  const strokeInput = document.querySelector('#screenshotStroke');
  const arrowSizeInput = document.querySelector('#screenshotArrowSize');
  const overlayImageInput = document.querySelector('#screenshotOverlayImageInput');
  const textInput = document.querySelector('#screenshotText');
  const status = document.querySelector('#screenshotEditorStatus');

  function setStatus(message) { status.textContent = message; }
  function currentState() { return { crop: { ...crop }, commands: commands.map(command => ({ ...command, points: command.points?.map(point => ({ ...point })) })) }; }
  function saveUndoPoint() {
    undoStack.push(currentState());
    if (undoStack.length > 50) undoStack.shift();
    redoStack = [];
    updateHistoryButtons();
  }
  function updateHistoryButtons() {
    document.querySelector('#screenshotUndo').disabled = !undoStack.length || saving;
    document.querySelector('#screenshotRedo').disabled = !redoStack.length || saving;
  }
  function normalizedRect(command) {
    const x = Math.min(command.x1, command.x2); const y = Math.min(command.y1, command.y2);
    return { x, y, width: Math.max(1, Math.abs(command.x2 - command.x1)), height: Math.max(1, Math.abs(command.y2 - command.y1)) };
  }
  function contrastingTextColor(color) {
    const hex = /^#([\da-f]{6})$/i.exec(color || '')?.[1] || 'ffffff';
    const channels = [0, 2, 4].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255);
    const luminance = channels.map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
    return luminance > .52 ? '#111' : '#fff';
  }
  function arrowCap(tipX, tipY, tangentX, tangentY, width, requestedSize, arrowLength) {
    const tangentLength = Math.hypot(tangentX, tangentY);
    if (tangentLength < 1) return null;
    const ux = tangentX / tangentLength; const uy = tangentY / tangentLength;
    const px = -uy; const py = ux;
    const sizeScale = Math.max(.5, Math.min(3, (Number(requestedSize) || 24) / 24));
    let halfWidth = width * 2 * sizeScale;
    let headLength = halfWidth * 3;
    if (arrowLength > 0 && headLength > arrowLength * .72) { headLength = arrowLength * .72; halfWidth = headLength / 3; }
    const baseX = tipX - headLength * ux; const baseY = tipY - headLength * uy;
    return {
      tipX, tipY, ux, uy,
      leftX: baseX + halfWidth * px, leftY: baseY + halfWidth * py,
      rightX: baseX - halfWidth * px, rightY: baseY - halfWidth * py,
      backX: tipX - halfWidth * 2 * ux, backY: tipY - halfWidth * 2 * uy,
      shaftInset: headLength * .82
    };
  }
  function drawArrowHead(target, cap, color) {
    target.save(); target.fillStyle = color; target.beginPath(); target.moveTo(cap.tipX, cap.tipY);
    target.lineTo(cap.leftX, cap.leftY); target.quadraticCurveTo(cap.backX, cap.backY, cap.rightX, cap.rightY);
    target.closePath(); target.fill(); target.restore();
  }
  function drawArrow(target, command, offsetX = 0, offsetY = 0) {
    const x1 = command.x1 - offsetX; const y1 = command.y1 - offsetY;
    const x2 = command.x2 - offsetX; const y2 = command.y2 - offsetY;
    const length = Math.hypot(x2 - x1, y2 - y1);
    const cap = arrowCap(x2, y2, x2 - x1, y2 - y1, command.width, command.arrowSize, length);
    if (!cap) return;
    target.save(); target.lineCap = 'butt'; target.strokeStyle = command.color; target.lineWidth = command.width;
    target.beginPath(); target.moveTo(x1, y1); target.lineTo(x2 - cap.ux * cap.shaftInset, y2 - cap.uy * cap.shaftInset); target.stroke(); target.restore();
    drawArrowHead(target, cap, command.color);
  }
  function quadraticPoint(start, control, end, t) {
    const remaining = 1 - t;
    return { x: remaining * remaining * start.x + 2 * remaining * t * control.x + t * t * end.x, y: remaining * remaining * start.y + 2 * remaining * t * control.y + t * t * end.y };
  }
  function trimQuadraticAtEnd(start, control, end, distance) {
    let previous = end; let traversed = 0;
    for (let index = 63; index >= 0; index--) {
      const point = quadraticPoint(start, control, end, index / 64);
      const segment = Math.hypot(previous.x - point.x, previous.y - point.y);
      if (segment > 0 && traversed + segment >= distance) return (index + 1 - (distance - traversed) / segment) / 64;
      traversed += segment; previous = point;
    }
    return 0;
  }
  function curveControl(command) {
    if (Number.isFinite(command.mx) && Number.isFinite(command.my)) return { x: command.mx, y: command.my };
    const dx = command.x2 - command.x1; const dy = command.y2 - command.y1; const length = Math.hypot(dx, dy) || 1;
    const bend = Math.max(30, length * .22);
    return { x: (command.x1 + command.x2) / 2 - dy / length * bend, y: (command.y1 + command.y2) / 2 + dx / length * bend };
  }
  function drawCurveArrow(target, command, offsetX = 0, offsetY = 0) {
    const control = curveControl(command); const x1 = command.x1 - offsetX; const y1 = command.y1 - offsetY;
    const mx = control.x - offsetX; const my = control.y - offsetY; const x2 = command.x2 - offsetX; const y2 = command.y2 - offsetY;
    const start = { x: x1, y: y1 }; const middle = { x: mx, y: my }; const end = { x: x2, y: y2 };
    const headScale = Math.max(.5, Math.min(3, (Number(command.arrowSize) || 24) / 24));
    const orientationDistance = command.width * 6 * headScale;
    const orientationT = trimQuadraticAtEnd(start, middle, end, orientationDistance);
    const beforeTip = quadraticPoint(start, middle, end, orientationT);
    const cap = arrowCap(x2, y2, x2 - beforeTip.x, y2 - beforeTip.y, command.width, command.arrowSize, Math.hypot(x2 - x1, y2 - y1));
    if (!cap) return;
    const t = trimQuadraticAtEnd(start, middle, end, cap.shaftInset);
    const shaftEnd = quadraticPoint(start, middle, end, t);
    const shaftControl = { x: x1 + (mx - x1) * t, y: y1 + (my - y1) * t };
    target.save(); target.strokeStyle = command.color; target.lineWidth = command.width; target.lineCap = 'butt'; target.lineJoin = 'round';
    target.beginPath(); target.moveTo(x1, y1); target.quadraticCurveTo(shaftControl.x, shaftControl.y, shaftEnd.x, shaftEnd.y); target.stroke(); target.restore();
    drawArrowHead(target, cap, command.color);
  }
  function drawSelectionHandles(command, points) {
    const ratio = canvas.width / Math.max(1, canvas.clientWidth); const radius = 5.5 * ratio;
    ctx.save(); ctx.lineWidth = 2 * ratio; ctx.fillStyle = '#f5f5f5'; ctx.strokeStyle = '#222';
    points.forEach(point => { ctx.beginPath(); ctx.arc(point.x - crop.x, point.y - crop.y, radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); });
    ctx.restore();
  }
  function selectedImageCorners(command) {
    const halfW = (command.width || 0) / 2; const halfH = (command.height || 0) / 2;
    return [
      { x: command.x1 - halfW, y: command.y1 - halfH, corner: 'nw' },
      { x: command.x1 + halfW, y: command.y1 - halfH, corner: 'ne' },
      { x: command.x1 + halfW, y: command.y1 + halfH, corner: 'se' },
      { x: command.x1 - halfW, y: command.y1 + halfH, corner: 'sw' }
    ];
  }
  function hitHandle(point, handle, padding = 12) {
    return Math.hypot(point.x - handle.x, point.y - handle.y) <= Math.max(padding, 10 * (canvas.width / Math.max(1, canvas.clientWidth)));
  }
  function pointToSegmentDistance(point, a, b) {
    const dx = b.x - a.x; const dy = b.y - a.y; const length2 = dx * dx + dy * dy;
    const t = length2 ? Math.max(0, Math.min(1, ((point.x-a.x)*dx + (point.y-a.y)*dy) / length2)) : 0;
    return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
  }
  function hitCurveArrow(point, command) {
    const control = curveControl(command); let previous = { x: command.x1, y: command.y1 };
    for (let index = 1; index <= 24; index++) {
      const t = index / 24; const inverse = 1 - t;
      const next = { x: inverse*inverse*command.x1 + 2*inverse*t*control.x + t*t*command.x2, y: inverse*inverse*command.y1 + 2*inverse*t*control.y + t*t*command.y2 };
      if (pointToSegmentDistance(point, previous, next) <= Math.max(12, command.width * 2)) return true;
      previous = next;
    }
    return false;
  }
  function beginHandleDrag(event, point, type, command, details = {}) {
    saveUndoPoint(); activeHandleDrag = { type, command, pointerId: event.pointerId, ...details };
    canvas.setPointerCapture(event.pointerId); event.preventDefault();
  }
  function drawVector(target, command, offsetX = 0, offsetY = 0) {
    target.save(); target.strokeStyle = command.color; target.fillStyle = command.color;
    target.lineWidth = command.width; target.lineCap = 'round'; target.lineJoin = 'round';
    const x1 = command.x1 - offsetX; const y1 = command.y1 - offsetY;
    const x2 = command.x2 - offsetX; const y2 = command.y2 - offsetY;
    if (command.tool === 'pen') {
      const points = command.points || [];
      if (points.length) { target.beginPath(); target.moveTo(points[0].x - offsetX, points[0].y - offsetY); points.slice(1).forEach(point => target.lineTo(point.x - offsetX, point.y - offsetY)); if (points.length === 1) target.lineTo(x1 + 1, y1 + 1); target.stroke(); }
    } else if (command.tool === 'line') {
      target.beginPath(); target.moveTo(x1, y1); target.lineTo(x2, y2); target.stroke();
    } else if (command.tool === 'arrow') drawArrow(target, command, offsetX, offsetY);
    else if (command.tool === 'curve-arrow') drawCurveArrow(target, command, offsetX, offsetY);
    else if (command.tool === 'rect' || command.tool === 'rect-fill' || command.tool === 'ellipse') {
      const rect = normalizedRect(command); const x = rect.x - offsetX; const y = rect.y - offsetY;
      target.beginPath();
      if (command.tool === 'ellipse') target.ellipse(x + rect.width / 2, y + rect.height / 2, Math.max(1, rect.width / 2), Math.max(1, rect.height / 2), 0, 0, Math.PI * 2);
      else target.rect(x, y, rect.width, rect.height);
      if (command.tool === 'rect-fill') { target.globalAlpha = .35; target.fill(); target.globalAlpha = 1; }
      target.stroke();
    } else if (command.tool === 'highlight') {
      const rect = normalizedRect(command); target.globalAlpha = .34; target.fillRect(rect.x - offsetX, rect.y - offsetY, rect.width, rect.height);
    } else if (command.tool === 'crop' || command.tool === 'blur' || command.tool === 'pixelate') {
      const rect = normalizedRect(command); target.save(); target.strokeStyle = command.tool === 'crop' ? '#ffffff' : command.color; target.lineWidth = Math.max(2, command.width / 2); target.setLineDash([8, 6]); target.strokeRect(rect.x - offsetX, rect.y - offsetY, rect.width, rect.height); target.restore();
    } else if (command.tool === 'text') {
      target.font = `700 ${command.fontSize}px "Segoe UI", Arial, sans-serif`; target.textBaseline = 'top';
      const lines = String(command.text || '').split('\n'); lines.forEach((line, index) => target.fillText(line, x1, y1 + index * command.fontSize * 1.2));
    } else if (command.tool === 'image' && command.overlay?.complete) {
      const width = command.width || command.overlay.naturalWidth; const height = command.height || command.overlay.naturalHeight;
      target.drawImage(command.overlay, x1 - width / 2, y1 - height / 2, width, height);
    } else if (command.tool === 'cursor') {
      const scale = Math.max(.8, command.width / 6); target.save(); target.translate(x1, y1); target.scale(scale, scale); target.beginPath(); target.moveTo(0, 0); target.lineTo(0, 26); target.lineTo(6, 20); target.lineTo(10, 30); target.lineTo(14, 28); target.lineTo(10, 18); target.lineTo(20, 18); target.closePath(); target.fillStyle = '#fff'; target.fill(); target.lineWidth = 2; target.strokeStyle = '#111'; target.stroke(); target.restore();
    } else if (command.tool === 'number') {
      const radius = Math.max(22, command.width * 3.5);
      target.beginPath(); target.arc(x1, y1, radius, 0, Math.PI * 2); target.fillStyle = command.color; target.fill();
      const textColor = contrastingTextColor(command.color);
      target.font = `700 ${Math.round(radius * 1.05)}px "Segoe UI", Arial, sans-serif`; target.textAlign = 'center'; target.textBaseline = 'middle';
      target.lineJoin = 'round'; target.lineWidth = Math.max(2, radius * .14); target.strokeStyle = textColor === '#fff' ? 'rgba(0,0,0,.8)' : 'rgba(255,255,255,.9)'; target.strokeText(String(command.value), x1, y1 + 1);
      target.fillStyle = textColor; target.fillText(String(command.value), x1, y1 + 1);
    }
    target.restore();
  }
  function applyBlur(rect) {
    const pad = Math.max(12, Math.round(Math.min(rect.width, rect.height) * .06));
    const source = document.createElement('canvas'); source.width = rect.width + pad * 2; source.height = rect.height + pad * 2;
    source.getContext('2d').drawImage(stage, rect.x - pad, rect.y - pad, source.width, source.height, 0, 0, source.width, source.height);
    const softened = document.createElement('canvas'); softened.width = source.width; softened.height = source.height;
    const softenedCtx = softened.getContext('2d'); softenedCtx.filter = `blur(${Math.max(7, Math.min(24, rect.width * .035))}px)`; softenedCtx.drawImage(source, 0, 0);
    stageCtx.drawImage(softened, pad, pad, rect.width, rect.height, rect.x, rect.y, rect.width, rect.height);
  }
  function applyPixelation(rect) {
    const block = Math.max(5, Math.round(Math.min(rect.width, rect.height) / 15));
    const small = document.createElement('canvas'); small.width = Math.max(1, Math.ceil(rect.width / block)); small.height = Math.max(1, Math.ceil(rect.height / block));
    const smallCtx = small.getContext('2d'); smallCtx.imageSmoothingEnabled = true; smallCtx.drawImage(stage, rect.x, rect.y, rect.width, rect.height, 0, 0, small.width, small.height);
    stageCtx.save(); stageCtx.imageSmoothingEnabled = false; stageCtx.drawImage(small, 0, 0, small.width, small.height, rect.x, rect.y, rect.width, rect.height); stageCtx.restore();
  }
  function render() {
    if (!image || !crop) return;
    if (stageDirty) {
      stageCtx.clearRect(0, 0, stage.width, stage.height); stageCtx.drawImage(image, 0, 0);
      commands.forEach(command => {
        if (command.tool === 'blur' || command.tool === 'pixelate') {
          const rect = normalizedRect(command);
          if (rect.width < 3 || rect.height < 3) return;
          if (command.tool === 'blur') applyBlur(rect); else applyPixelation(rect);
        } else drawVector(stageCtx, command);
      });
      stageDirty = false;
    }
    const width = Math.max(1, Math.round(crop.width)); const height = Math.max(1, Math.round(crop.height));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    ctx.clearRect(0, 0, width, height); ctx.drawImage(stage, crop.x, crop.y, width, height, 0, 0, width, height);
    fitCanvas();
    if (gesture) drawVector(ctx, gesture, crop.x, crop.y);
    if (activeTool === 'curve-arrow' && selectedCurveArrow && commands.includes(selectedCurveArrow)) {
      const control = curveControl(selectedCurveArrow);
      drawSelectionHandles(selectedCurveArrow, [{ x: selectedCurveArrow.x1, y: selectedCurveArrow.y1 }, control, { x: selectedCurveArrow.x2, y: selectedCurveArrow.y2 }]);
    }
    if (activeTool === 'image' && selectedImageOverlay && commands.includes(selectedImageOverlay)) drawSelectionHandles(selectedImageOverlay, selectedImageCorners(selectedImageOverlay));
  }
  function fitCanvas() {
    if (!crop) return;
    const availableWidth = Math.max(1, viewport.clientWidth - 36); const availableHeight = Math.max(1, viewport.clientHeight - 36);
    const scale = Math.min(availableWidth / crop.width, availableHeight / crop.height, 1);
    canvas.style.width = `${Math.max(1, Math.floor(crop.width * scale))}px`;
    canvas.style.height = `${Math.max(1, Math.floor(crop.height * scale))}px`;
  }
  function imagePoint(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: Math.max(crop.x, Math.min(crop.x + crop.width, crop.x + (event.clientX - rect.left) * crop.width / rect.width)), y: Math.max(crop.y, Math.min(crop.y + crop.height, crop.y + (event.clientY - rect.top) * crop.height / rect.height)) };
  }
  function setTool(tool) {
    activeTool = tool;
    tools.forEach(button => { const active = button.dataset.shotTool === tool; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
    document.querySelector('.screenshot-text-option').classList.toggle('active', tool === 'text');
    document.querySelector('.screenshot-arrow-option').classList.toggle('active', tool === 'arrow' || tool === 'curve-arrow');
    canvas.style.cursor = tool === 'text' ? 'text' : tool === 'eraser' ? 'not-allowed' : 'crosshair';
    if (tool === 'text') textInput.focus();
    if (tool === 'image') { pendingOverlayImage = null; overlayImageInput.value = ''; overlayImageInput.click(); }
    setStatus(`${tools.find(button => button.dataset.shotTool === tool)?.dataset.tooltip || 'Ferramenta'} selecionada.`);
    render();
  }
  function eraseAt(x, y, radius) {
    let index = commands.length - 1;
    for (; index >= 0; index--) {
      const command = commands[index];
      if (command.tool === 'curve-arrow') { if (hitCurveArrow({ x, y }, command) || Math.hypot(x-command.x1, y-command.y1) <= radius || Math.hypot(x-command.x2, y-command.y2) <= radius) break; continue; }
      if (command.tool === 'pen' && command.points?.length) {
        const near = command.points.some(point => Math.hypot(x-point.x, y-point.y) <= radius + command.width);
        if (near) break;
        continue;
      }
      const rect = command.tool === 'image' ? { x: command.x1-command.width/2, y: command.y1-command.height/2, width: command.width, height: command.height } : normalizedRect(command);
      if (x >= rect.x - radius && x <= rect.x + rect.width + radius && y >= rect.y - radius && y <= rect.y + rect.height + radius) break;
    }
    if (index < 0) { setStatus('Nenhum elemento próximo para remover.'); render(); return; }
    saveUndoPoint(); const [removed] = commands.splice(index, 1); if (removed === selectedCurveArrow) selectedCurveArrow = null; if (removed === selectedImageOverlay) selectedImageOverlay = null; stageDirty = true; setStatus('Elemento removido.'); render();
  }
  function finishGesture() {
    if (activeHandleDrag) { const movedImage = activeHandleDrag.type === 'image-move' && activeHandleDrag.moved; activeHandleDrag = null; if (movedImage) setStatus('Imagem movida.'); render(); return; }
    if (!gesture) return;
    const done = gesture; gesture = null;
    if (done.tool === 'crop') {
      const rect = normalizedRect(done);
      if (rect.width < 8 || rect.height < 8) { render(); return; }
      saveUndoPoint(); crop = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      setStatus(`Recorte aplicado · ${Math.round(rect.width)} × ${Math.round(rect.height)} px.`); render(); return;
    }
    if (done.tool === 'eraser') { eraseAt(done.x1, done.y1, Math.max(20, done.width * 4)); return; }
    if (done.tool === 'text') {
      const content = textInput.value.trim(); if (!content) { setStatus('Digite o texto na barra de ferramentas antes de inserir.'); render(); return; }
      done.text = content; done.fontSize = Math.max(18, Math.min(120, Number(strokeInput.value) * 7));
    }
    if (done.tool === 'number') done.value = commands.filter(command => command.tool === 'number').length + 1;
    if (done.tool === 'image' && !done.overlay) { setStatus('Escolha uma imagem antes de inseri-la.'); render(); return; }
    if (done.tool === 'curve-arrow') { done.mx = undefined; done.my = undefined; const control = curveControl(done); done.mx = control.x; done.my = control.y; }
    if (done.tool === 'image') {
      const scale = Math.min(1, 560 / done.overlay.naturalWidth, 400 / done.overlay.naturalHeight);
      done.width = done.overlay.naturalWidth * scale; done.height = done.overlay.naturalHeight * scale;
    }
    if ((done.tool === 'blur' || done.tool === 'pixelate') && (Math.abs(done.x2 - done.x1) < 8 || Math.abs(done.y2 - done.y1) < 8)) { setStatus('Arraste para selecionar a área que deseja ocultar.'); render(); return; }
    done.id = nextCommandId++; saveUndoPoint(); commands = [...commands, done]; stageDirty = true;
    if (done.tool === 'curve-arrow') selectedCurveArrow = done;
    if (done.tool === 'image') selectedImageOverlay = done;
    setStatus(done.tool === 'blur' || done.tool === 'pixelate' ? 'Área ocultada.' : done.tool === 'image' ? 'Imagem inserida. Arraste para mover; use os cantos para redimensionar.' : 'Elemento adicionado.'); render();
  }
  function beginGesture(event) {
    if (event.button !== 0 || !image || saving) return;
    const point = imagePoint(event);
    if (activeTool === 'curve-arrow') {
      if (selectedCurveArrow && commands.includes(selectedCurveArrow)) {
        const control = curveControl(selectedCurveArrow);
        const handles = [{ part: 'start', x: selectedCurveArrow.x1, y: selectedCurveArrow.y1 }, { part: 'mid', ...control }, { part: 'end', x: selectedCurveArrow.x2, y: selectedCurveArrow.y2 }];
        const handle = handles.find(item => hitHandle(point, item));
        if (handle) { beginHandleDrag(event, point, 'curve', selectedCurveArrow, { part: handle.part }); return; }
      }
      const hit = [...commands].reverse().find(command => command.tool === 'curve-arrow' && hitCurveArrow(point, command));
      if (hit) { selectedCurveArrow = hit; render(); event.preventDefault(); return; }
      selectedCurveArrow = null;
    }
    if (activeTool === 'image') {
      if (selectedImageOverlay && commands.includes(selectedImageOverlay)) {
        const corners = selectedImageCorners(selectedImageOverlay); const handle = corners.find(item => hitHandle(point, item));
        if (handle) {
          const oppositeCorner = { nw: 'se', ne: 'sw', se: 'nw', sw: 'ne' }[handle.corner]; const anchor = corners.find(item => item.corner === oppositeCorner);
          beginHandleDrag(event, point, 'image', selectedImageOverlay, { anchorX: anchor.x, anchorY: anchor.y, signX: Math.sign(handle.x-anchor.x), signY: Math.sign(handle.y-anchor.y), ratio: selectedImageOverlay.width / selectedImageOverlay.height }); return;
        }
        const item = selectedImageOverlay; if (point.x >= item.x1-item.width/2 && point.x <= item.x1+item.width/2 && point.y >= item.y1-item.height/2 && point.y <= item.y1+item.height/2) {
          beginHandleDrag(event, point, 'image-move', item, { startX: point.x, startY: point.y, originalX: item.x1, originalY: item.y1 }); return;
        }
      }
      if (!pendingOverlayImage) return;
    }
    gesture = { tool: activeTool, x1: point.x, y1: point.y, x2: point.x, y2: point.y, points: activeTool === 'pen' ? [point] : undefined, overlay: activeTool === 'image' ? pendingOverlayImage : undefined, color: colorInput.value || '#ffffff', width: Number(strokeInput.value) || 6, arrowSize: Number(arrowSizeInput.value) || 24 };
    canvas.setPointerCapture(event.pointerId); event.preventDefault();
    if (['text', 'number', 'image', 'cursor', 'eraser'].includes(activeTool)) finishGesture();
    else render();
  }
  function moveGesture(event) {
    if (!activeHandleDrag && !gesture && activeTool === 'image' && selectedImageOverlay && commands.includes(selectedImageOverlay)) {
      const point = imagePoint(event); const corners = selectedImageCorners(selectedImageOverlay); const handle = corners.find(item => hitHandle(point, item));
      const cursors = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize' };
      const item = selectedImageOverlay;
      canvas.style.cursor = handle ? cursors[handle.corner] : point.x >= item.x1-item.width/2 && point.x <= item.x1+item.width/2 && point.y >= item.y1-item.height/2 && point.y <= item.y1+item.height/2 ? 'move' : 'crosshair';
    }
    if (activeHandleDrag) {
      const point = imagePoint(event); const drag = activeHandleDrag; const command = drag.command;
      if (drag.type === 'curve') {
        if (drag.part === 'start') { command.x1 = point.x; command.y1 = point.y; }
        else if (drag.part === 'end') { command.x2 = point.x; command.y2 = point.y; }
        else { command.mx = point.x; command.my = point.y; }
      } else if (drag.type === 'image-move') {
        drag.moved = true;
        command.x1 = drag.originalX + point.x - drag.startX;
        command.y1 = drag.originalY + point.y - drag.startY;
      } else {
        const dx = (point.x - drag.anchorX) * drag.signX; const dy = (point.y - drag.anchorY) * drag.signY;
        const width = Math.max(24, dx, dy * drag.ratio); command.width = width; command.height = width / drag.ratio;
        command.x1 = drag.anchorX + drag.signX * width / 2; command.y1 = drag.anchorY + drag.signY * command.height / 2;
      }
      stageDirty = true; render(); return;
    }
    if (!gesture) return;
    const point = imagePoint(event); gesture.x2 = point.x; gesture.y2 = point.y;
    if (gesture.tool === 'pen') gesture.points.push(point);
    render();
  }
  function cleanSelection() {
    if (selectedCurveArrow) selectedCurveArrow = commands.find(command => command.id === selectedCurveArrow.id && command.tool === 'curve-arrow') || null;
    if (selectedImageOverlay) selectedImageOverlay = commands.find(command => command.id === selectedImageOverlay.id && command.tool === 'image') || null;
  }
  function undo() {
    if (!undoStack.length) return;
    redoStack.push(currentState()); const state = undoStack.pop(); crop = state.crop; commands = state.commands; cleanSelection(); stageDirty = true; updateHistoryButtons(); render(); setStatus('Última alteração desfeita.');
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(currentState()); const state = redoStack.pop(); crop = state.crop; commands = state.commands; cleanSelection(); stageDirty = true; updateHistoryButtons(); render(); setStatus('Alteração refeita.');
  }
  function setSaving(value) {
    saving = value;
    ['#closeScreenshotEditor', '#discardScreenshotEdits', '#copyScreenshot', '#saveScreenshotEdits'].forEach(selector => { document.querySelector(selector).disabled = value; });
    document.querySelector('#saveScreenshotEdits').textContent = value ? 'Salvando…' : 'Salvar imagem';
    updateHistoryButtons();
  }
  async function canvasBlob() {
    const output = document.createElement('canvas'); output.width = Math.round(crop.width); output.height = Math.round(crop.height);
    output.getContext('2d').drawImage(stage, crop.x, crop.y, output.width, output.height, 0, 0, output.width, output.height);
    return new Promise((resolve, reject) => output.toBlob(blob => blob ? resolve(blob) : reject(new Error('Não foi possível preparar a imagem.')), 'image/png'));
  }
  async function closeEditor() {
    if (saving) return;
    dialog.classList.add('hidden'); gesture = null; callbacks.onClose?.(); callbacks = {}; image = null;
  }
  tools.forEach(button => { button.dataset.tooltip = button.title || button.getAttribute('aria-label') || ''; button.removeAttribute('title'); button.addEventListener('click', () => setTool(button.dataset.shotTool)); });
  overlayImageInput.addEventListener('change', () => {
    const file = overlayImageInput.files?.[0]; if (!file) { setStatus('Inserção de imagem cancelada.'); return; }
    const reader = new FileReader();
    reader.onload = () => { const overlay = new Image(); overlay.onload = () => { pendingOverlayImage = overlay; setStatus('Imagem pronta. Clique na captura para inserir.'); }; overlay.onerror = () => setStatus('Não foi possível carregar esta imagem.'); overlay.src = String(reader.result || ''); };
    reader.onerror = () => setStatus('Não foi possível ler esta imagem.'); reader.readAsDataURL(file);
  });
  canvas.addEventListener('pointerdown', beginGesture);
  canvas.addEventListener('pointermove', moveGesture);
  canvas.addEventListener('pointerup', finishGesture);
  canvas.addEventListener('pointercancel', () => { gesture = null; activeHandleDrag = null; stageDirty = true; render(); });
  document.querySelector('#screenshotUndo').addEventListener('click', undo);
  document.querySelector('#screenshotRedo').addEventListener('click', redo);
  document.querySelector('#closeScreenshotEditor').addEventListener('click', closeEditor);
  document.querySelector('#discardScreenshotEdits').addEventListener('click', closeEditor);
  async function copyScreenshot() {
    let copied = false;
    try { setSaving(true); setStatus('Copiando para a área de transferência…'); await callbacks.onCopy?.(await canvasBlob()); copied = true; setStatus('Imagem copiada.'); }
    catch (error) { setStatus(error.message || 'Não foi possível copiar a imagem.'); }
    finally { setSaving(false); if (copied) closeEditor(); }
  }
  document.querySelector('#copyScreenshot').addEventListener('click', () => copyScreenshot());
  document.querySelector('#saveScreenshotEdits').addEventListener('click', async () => {
    try { setSaving(true); setStatus('Salvando a captura anotada…'); await callbacks.onSave?.(await canvasBlob()); setStatus('Imagem salva.'); dialog.classList.add('hidden'); callbacks.onClose?.(); callbacks = {}; image = null; }
    catch (error) { setStatus(error.message || 'Não foi possível salvar a imagem.'); }
    finally { setSaving(false); }
  });
  document.addEventListener('keydown', event => {
    if (dialog.classList.contains('hidden')) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeEditor(); return; }
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (!['z', 'y', 's', 'c'].includes(key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (key === 'z') { event.shiftKey ? redo() : undo(); return; }
    if (key === 'y') { redo(); return; }
    if (key === 's') { document.querySelector('#saveScreenshotEdits').click(); return; }
    if (key === 'c') void copyScreenshot();
  }, true);
  new ResizeObserver(fitCanvas).observe(viewport);
  window.NTC_ScreenshotEditor = {
    open(options) {
      callbacks = options || {}; commands = []; undoStack = []; redoStack = []; gesture = null; activeHandleDrag = null; selectedCurveArrow = null; selectedImageOverlay = null; nextCommandId = 1; crop = null; stageDirty = true; pendingOverlayImage = null; colorInput.value = '#ffffff';
      const requestedTool = options?.initialTool;
      const initialTool = tools.some(button => button.dataset.shotTool === requestedTool) ? requestedTool : 'pen';
      dialog.classList.remove('hidden'); setTool(initialTool); setSaving(false); updateHistoryButtons();
      image = new Image();
      image.onload = () => { stage.width = image.naturalWidth; stage.height = image.naturalHeight; crop = { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight }; render(); setStatus(`${image.naturalWidth} × ${image.naturalHeight} px · Ctrl+C copia · Esc fecha sem salvar.`); };
      image.onerror = () => setStatus('A captura não pôde ser aberta no editor.');
      image.src = options?.dataUrl || '';
      document.querySelector('#closeScreenshotEditor').focus();
    }
  };
})();
