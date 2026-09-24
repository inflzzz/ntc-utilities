'use strict';

(() => {
  const startButton = document.querySelector('#colorPickerStart');
  if (!startButton) return;

  const status = document.querySelector('#colorPickerStatus');
  const swatch = document.querySelector('#colorPickerSwatch');
  const headline = document.querySelector('#colorPickerHexHeadline');
  const fields = {
    hex: document.querySelector('#colorPickerHex'),
    rgb: document.querySelector('#colorPickerRgb'),
    hsl: document.querySelector('#colorPickerHsl')
  };
  const copyButtons = [...document.querySelectorAll('[data-copy-color]')];
  const historyList = document.querySelector('#colorPickerHistory');
  const storageKey = 'ntc-color-picker-last';
  const historyStorageKey = 'ntc-color-picker-history';
  let color = null;
  let history = [];

  function isColorSample(sample) {
    if (!sample || !/^#[\da-f]{6}$/i.test(sample.hex) || !Number.isInteger(sample.r) || !Number.isInteger(sample.g) || !Number.isInteger(sample.b) || [sample.r, sample.g, sample.b].some(value => value < 0 || value > 255) || typeof sample.hsl !== 'string' || !/^hsl\(\d{1,3}, \d{1,3}%, \d{1,3}%\)$/.test(sample.hsl)) return false;
    const expectedHex = `#${[sample.r, sample.g, sample.b].map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
    return sample.hex.toUpperCase() === expectedHex;
  }

  function setColor(sample) {
    if (!isColorSample(sample)) return false;
    color = { hex: sample.hex.toUpperCase(), rgb: `rgb(${sample.r}, ${sample.g}, ${sample.b})`, hsl: sample.hsl };
    swatch.style.backgroundColor = color.hex;
    swatch.setAttribute('aria-label', color.hex);
    headline.textContent = color.hex;
    fields.hex.textContent = color.hex;
    fields.rgb.textContent = color.rgb;
    fields.hsl.textContent = color.hsl;
    copyButtons.forEach(button => { button.disabled = false; });
    return true;
  }

  function sampleFromColor(item) {
    return isColorSample(item) ? item : null;
  }

  function renderHistory() {
    if (!history.length) {
      historyList.innerHTML = '<p class="color-picker-history-empty">As cores que você selecionar aparecerão aqui.</p>';
      return;
    }
    historyList.innerHTML = history.map((item, index) => `<button class="color-picker-history-item" type="button" data-history-index="${index}" aria-label="Usar cor ${item.hex}" title="${item.hex}"><span class="color-picker-history-swatch" style="background-color:${item.hex}"></span><span>${item.hex}</span></button>`).join('');
  }

  function rememberColor(sample) {
    history = [sample, ...history.filter(item => item.hex !== sample.hex)].slice(0, 5);
    localStorage.setItem(historyStorageKey, JSON.stringify(history));
    renderHistory();
  }

  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (setColor(saved)) status.textContent = 'Última cor selecionada restaurada.';
  } catch { /* Ignore a damaged local color sample. */ }
  try {
    const savedHistory = JSON.parse(localStorage.getItem(historyStorageKey) || '[]');
    if (Array.isArray(savedHistory)) history = savedHistory.map(sampleFromColor).filter(Boolean).filter((item, index, list) => list.findIndex(other => other.hex === item.hex) === index).slice(0, 5);
  } catch { /* Ignore a damaged local color history. */ }
  renderHistory();

  startButton.addEventListener('click', async () => {
    startButton.disabled = true;
    startButton.textContent = 'Preparando seleção…';
    status.textContent = 'A tela será congelada enquanto você escolhe a cor.';
    try {
      const sample = await window.ntc.pickScreenColor();
      if (sample && setColor(sample)) {
        localStorage.setItem(storageKey, JSON.stringify(sample));
        rememberColor(sample);
        status.textContent = 'Cor capturada. Você pode copiar qualquer formato.';
      } else {
        status.textContent = 'Seleção cancelada.';
      }
    } catch (error) {
      status.textContent = error?.message || 'Não foi possível iniciar o seletor de cor.';
    } finally {
      startButton.disabled = false;
      startButton.textContent = 'Selecionar cor na tela';
    }
  });

  copyButtons.forEach(button => button.addEventListener('click', async () => {
    if (!color) return;
    const value = color[button.dataset.copyColor];
    if (!value) return;
    try {
      await window.ntc.copyText(value);
      status.textContent = `${button.dataset.copyColor.toUpperCase()} copiado: ${value}`;
    } catch {
      status.textContent = 'Não foi possível copiar o código.';
    }
  }));

  historyList.addEventListener('click', event => {
    const button = event.target.closest('[data-history-index]');
    if (!button) return;
    const sample = history[Number(button.dataset.historyIndex)];
    if (setColor(sample)) {
      localStorage.setItem(storageKey, JSON.stringify(sample));
      status.textContent = `Cor ${color.hex} recuperada do histórico.`;
    }
  });
})();
