'use strict';

(() => {
  const image = document.querySelector('#screen');
  const lens = document.querySelector('#lens');
  const lensCanvas = lens.querySelector('canvas');
  const lensContext = lensCanvas.getContext('2d', { willReadFrequently: true });
  const lensHex = document.querySelector('#lensHex');
  const lensSwatch = document.querySelector('#lensSwatch');
  const targetMark = document.querySelector('#targetMark');
  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = sampleCanvas.height = 1;
  const sampleContext = sampleCanvas.getContext('2d', { willReadFrequently: true });
  let ready = false;

  function coordinates(event) {
    return {
      x: Math.max(0, Math.min(image.naturalWidth - 1, Math.floor(event.clientX / window.innerWidth * image.naturalWidth))),
      y: Math.max(0, Math.min(image.naturalHeight - 1, Math.floor(event.clientY / window.innerHeight * image.naturalHeight)))
    };
  }

  function sampleAt(x, y) {
    sampleContext.drawImage(image, x, y, 1, 1, 0, 0, 1, 1);
    const [r, g, b] = sampleContext.getImageData(0, 0, 1, 1).data;
    return { r, g, b };
  }

  function moveLens(clientX, clientY, x, y) {
    const radius = 6;
    const cropSize = radius * 2 + 1;
    const scaleX = lensCanvas.width / cropSize;
    const scaleY = lensCanvas.height / cropSize;
    const cropX = x - radius;
    const cropY = y - radius;
    const sourceLeft = Math.max(0, cropX);
    const sourceTop = Math.max(0, cropY);
    const width = Math.min(cropSize, image.naturalWidth - sourceLeft);
    const height = Math.min(cropSize, image.naturalHeight - sourceTop);
    const destLeft = (sourceLeft - cropX) * scaleX;
    const destTop = (sourceTop - cropY) * scaleY;
    lensContext.clearRect(0, 0, lensCanvas.width, lensCanvas.height);
    lensContext.imageSmoothingEnabled = false;
    lensContext.drawImage(image, sourceLeft, sourceTop, width, height, destLeft, destTop, width * scaleX, height * scaleY);
    lensContext.strokeStyle = '#fff';
    lensContext.lineWidth = 1;
    lensContext.beginPath();
    lensContext.moveTo(lensCanvas.width / 2, 0); lensContext.lineTo(lensCanvas.width / 2, lensCanvas.height);
    lensContext.moveTo(0, lensCanvas.height / 2); lensContext.lineTo(lensCanvas.width, lensCanvas.height / 2);
    lensContext.stroke();
    lensContext.strokeStyle = '#f5d274';
    lensContext.lineWidth = 2;
    lensContext.strokeRect((lensCanvas.width - scaleX) / 2 + 1, (lensCanvas.height - scaleY) / 2 + 1, scaleX - 2, scaleY - 2);
    const color = sampleAt(x, y);
    const hex = '#' + [color.r, color.g, color.b].map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase();
    lensHex.textContent = hex;
    lensSwatch.style.backgroundColor = hex;
    targetMark.style.left = ((x + 0.5) / image.naturalWidth * window.innerWidth) + 'px';
    targetMark.style.top = ((y + 0.5) / image.naturalHeight * window.innerHeight) + 'px';
    targetMark.style.display = 'block';
    const lensWidth = 150;
    const lensHeight = 180;
    lens.style.left = (clientX + lensWidth + 22 > window.innerWidth ? Math.max(8, clientX - lensWidth - 20) : clientX + 20) + 'px';
    lens.style.top = (clientY + lensHeight + 22 > window.innerHeight ? Math.max(8, clientY - lensHeight - 20) : clientY + 20) + 'px';
    lens.style.display = 'block';
  }

  image.addEventListener('load', () => { ready = image.naturalWidth > 0 && image.naturalHeight > 0; });
  document.addEventListener('pointermove', event => {
    if (!ready) return;
    const { x, y } = coordinates(event);
    moveLens(event.clientX, event.clientY, x, y);
  });
  document.addEventListener('pointerdown', event => {
    if (event.target.closest('.cancel-target')) {
      event.preventDefault();
      window.ntcColorPickerOverlay.cancel();
      return;
    }
    if (!ready || event.button !== 0) return;
    event.preventDefault();
    const { x, y } = coordinates(event);
    window.ntcColorPickerOverlay.choose(sampleAt(x, y));
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    window.ntcColorPickerOverlay.cancel();
  });
  window.ntcColorPickerOverlay.onCapture(capture => { image.src = capture.dataUrl; });
})();
