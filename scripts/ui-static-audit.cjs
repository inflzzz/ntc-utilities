// Isolated, read-only layout capture: no application preload, IPC, or local saves.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const output = path.join(os.tmpdir(), 'ntc-ui-static-audit');
app.setPath('userData', path.join(os.tmpdir(), `ntc-ui-audit-${process.pid}`));
app.commandLine.appendSwitch('disable-background-networking');

app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: /\.m?js(?:\?|$)/i.test(details.url) });
  });
  await fs.mkdir(output, { recursive: true });
  // RNG and the dedicated video editor are intentionally outside this visual
  // refinement. Include the RNG maintenance screen, not the game itself.
  const views = ['homeView', 'documentsView', 'pdfView', 'studyToolsView', 'clipboardHistoryView', 'securityView', 'musicPlayerView', 'timeToolsView', 'rngMaintenanceView', 'compressorView', 'renamerView', 'qrGeneratorView', 'recorderView', 'screenshotView', 'colorPickerView', 'downloaderView', 'converterView', 'videoView', 'ntcvMediaView', 'imageView', 'autoclickerView', 'playlistView', 'settingsView', 'historyView'];
  const sizes = [[1366, 768], [1920, 1080], [2560, 1440]];
  const window = new BrowserWindow({ show: false, width: 1366, height: 768, webPreferences: { sandbox: true, contextIsolation: true } });
  await window.loadFile(path.join(root, 'src', 'index.html'));
  const report = [];
  for (const [width, height] of sizes) {
    window.setContentSize(width, height);
    for (const viewId of views) {
      const metrics = await window.webContents.executeJavaScript(`(() => {
        document.querySelector('.app-shell').classList.add('ready');
        document.querySelector('.splash').classList.add('hidden');
        document.body.classList.add('window-maximized');
        document.querySelectorAll('.view').forEach(view => view.classList.toggle('active', view.id === ${JSON.stringify(viewId)}));
        const scroller = document.querySelector('.content-scroll'); scroller.scrollTop = 0;
        const view = document.getElementById(${JSON.stringify(viewId)});
        return { view: view.id, scrollWidth: scroller.scrollWidth, clientWidth: scroller.clientWidth,
          scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight,
          viewWidth: Math.round(view.getBoundingClientRect().width),
          overflowing: [...view.querySelectorAll('*')].filter(el => el.getBoundingClientRect().right > innerWidth + 2).slice(0, 10).map(el => el.id || el.className) };
      })()`);
      report.push({ width, height, ...metrics });
      await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      const capture = await window.webContents.capturePage();
      await fs.writeFile(path.join(output, `${viewId}-${width}x${height}.png`), capture.toPNG());
    }
    const thumbWidth = 360;
    const thumbHeight = 248;
    const tiles = await Promise.all(views.map(async (viewId, index) => ({
      input: await sharp(path.join(output, `${viewId}-${width}x${height}.png`)).resize(thumbWidth, thumbHeight, { fit: 'fill' }).png().toBuffer(),
      left: (index % 4) * thumbWidth,
      top: Math.floor(index / 4) * thumbHeight
    })));
    await sharp({ create: { width: thumbWidth * 4, height: thumbHeight * Math.ceil(views.length / 4), channels: 4, background: '#101010' } })
      .composite(tiles).png().toFile(path.join(output, `contact-${width}x${height}.png`));
  }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  const overflow = report.filter(entry => entry.scrollWidth > entry.clientWidth + 2);
  console.log(JSON.stringify({ output, captures: report.length, horizontalOverflow: overflow.map(entry => `${entry.view} ${entry.width}x${entry.height}`) }));
  if (overflow.length) process.exitCode = 1;
  window.destroy();
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
