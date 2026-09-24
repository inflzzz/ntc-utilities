const { app, BrowserWindow, dialog, ipcMain, shell, clipboard, desktopCapturer, globalShortcut, screen, nativeImage, Notification, Tray, Menu, powerMonitor } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { autoUpdater } = require('electron-updater');
const sharp = require('sharp');
const { normalizeQrUrl, normalizeQrOptions, renderQr, saveQrImage } = require('./src/qr.cjs');
const { previewFileRenames, renameFiles } = require('./src/renamer-files.cjs');
const { POOL: rngPool, TIERS: rngTiers, TITLES: rngTitles, SECRETS: rngSecrets, normalizeState: normalizeRngState, luckForState, rollBatch: rollRngBatch, publicCatalog: publicRngCatalog, publicProgress: publicRngProgress, debugGrantTitle, debugRemoveTitle, debugClearTitles, debugGrantTierTitles, debugGrantTotalTitles, debugReadyBonusRoll } = require('./src/rng.cjs');
const { TrustedClock } = require('./src/rng-time.cjs');
const { LIMITED_REWARDS, eventSchedule, activeEvent, joinEvent } = require('./src/rng-events.cjs');

// Evita artefatos visuais que alguns drivers de vídeo exibem apenas no monitor.
// A captura de tela continua normal nesses casos porque ela lê o frame antes da
// composição final da GPU.
app.disableHardwareAcceleration();

if (!app.isPackaged) app.setPath('userData', path.join(__dirname, '.ntc-data'));
const downloadJobs = new Map();
const conversionJobs = new Map();
const videoJobs = new Map();
const videoEditJobs = new Map();
const imageJobs = new Map();
const recordingSessions = new Map();
let mainWindow = null;
let trayIcon = null;
let forceClose = false;
let screenShortcut = null;
let screenshotShortcut = null;
let screenshotShortcutBusy = false;
let quickScreenshotShortcut = null;
let quickScreenshotShortcutBusy = false;
let quickScreenshotFolder = '';
let shortcutRecorderFocused = false;
let launchAtLoginEnabled = true;
let updateState = { status: 'idle' };
let rngGame = normalizeRngState();
let rngAppSessionStartedAt = 0;
let rngAppAccountedAt = 0;
let rngAutoRollStartedAt = 0;
let rngAutoAccountedAt = 0;
let rngNextAutoRollAt = 0;
let rngClock = null;
let rngLastPersistAt = 0;
let rngShutdownSaved = false;
let rngLatestResult = null;
let rngLatestResults = [];
const rngTrustedClock = new TrustedClock();
const rngMonotonicMs = () => Number(process.hrtime.bigint() / 1_000_000n);
let rngSessionRolls = 0;
let rngSessionNewTitles = 0;
let rngSessionBestOdds = 0n;
let rngLastTimeSync = 0;
let rngAppSessionBaselineSeconds = 0;
let rngLastEventWindowId = null;
let rngNextEventCheckAt = 0;
let rngLastHeartbeatAt = 0;
const hosts = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'];
const audioExtensions = ['.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg', '.opus', '.wma'];
const videoExtensions = ['.mp4', '.mkv', '.mov', '.avi', '.webm', '.wmv', '.m4v'];
const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tif', '.tiff'];

function isSupportedUrl(value) { try { return hosts.includes(new URL(value).hostname); } catch { return false; } }
function send(sender, channel, payload) { if (!sender.isDestroyed()) sender.send(channel, payload); }
function rngStatePath() { return path.join(app.getPath('userData'), 'ntc-rng-state.json'); }
function rngBackupPath() { return path.join(app.getPath('userData'), 'ntc-rng-state.backup.json'); }
function loadRngGame() {
  try {
    rngGame = normalizeRngState(JSON.parse(fs.readFileSync(rngStatePath(), 'utf8')));
  } catch {
    try {
      rngGame = normalizeRngState(JSON.parse(fs.readFileSync(rngBackupPath(), 'utf8')));
      fs.mkdirSync(path.dirname(rngStatePath()), { recursive: true });
      fs.copyFileSync(rngBackupPath(), rngStatePath());
    } catch { rngGame = normalizeRngState(); }
  }
}
function accountRngTime(now = rngMonotonicMs()) {
  if (rngAppAccountedAt) { const elapsed = Math.floor((now - rngAppAccountedAt) / 1000); if (elapsed > 0) { rngGame.totalAppSeconds += elapsed; rngAppAccountedAt += elapsed * 1000; } }
  if (rngAutoRollStartedAt && rngAutoAccountedAt) { const elapsed = Math.floor((now - rngAutoAccountedAt) / 1000); if (elapsed > 0) { rngGame.totalAutoRollSeconds += elapsed; rngAutoAccountedAt += elapsed * 1000; rngGame.lastAutoRollSessionSeconds = Math.floor((now - rngAutoRollStartedAt) / 1000); } }
}
function persistRngGame() {
  try {
    const file = rngStatePath(); const temporary = `${file}.tmp`; const backup = rngBackupPath(); const backupTemporary = `${backup}.tmp`; const serialized = JSON.stringify(rngGame);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temporary, serialized);
    if (fs.existsSync(file)) {
      fs.copyFileSync(file, backupTemporary);
      fs.renameSync(backupTemporary, backup);
    }
    fs.renameSync(temporary, file);
    if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
    rngLastPersistAt = rngMonotonicMs();
  } catch {
    try { if (fs.existsSync(`${rngStatePath()}.tmp`)) fs.unlinkSync(`${rngStatePath()}.tmp`); } catch { /* Keep the previous durable save. */ }
    try { if (fs.existsSync(`${rngBackupPath()}.tmp`)) fs.unlinkSync(`${rngBackupPath()}.tmp`); } catch { /* Keep the previous backup. */ }
  }
}
function makeRngAchievement(id, category, name, description, value, goal) {
  return { id, category, name, description, unlocked: value >= goal, progress: Math.min(value, goal), goal };
}
function buildRngAchievements() {
  const collected = new Set(rngGame.collectedIds);
  const hasTier = tierId => rngTitles.some(title => title.tier === tierId && collected.has(title.id));
  const achievements = [
    makeRngAchievement('rolls-1', 'Rolagens', 'A primeira de muitas', 'Faça sua primeira rolagem', rngGame.totalRolls, 1),
    makeRngAchievement('rolls-100', 'Rolagens', 'Aquecimento', 'Faça 100 rolagens', rngGame.totalRolls, 100),
    makeRngAchievement('rolls-1000', 'Rolagens', 'Persistência', 'Faça 1.000 rolagens', rngGame.totalRolls, 1_000),
    makeRngAchievement('rolls-10000', 'Rolagens', 'Dez mil destinos', 'Faça 10.000 rolagens', rngGame.totalRolls, 10_000),
    makeRngAchievement('rolls-100000', 'Rolagens', 'Lenda incansável', 'Faça 100.000 rolagens', rngGame.totalRolls, 100_000),
    makeRngAchievement('manual-rolls-1000', 'Rolagens manuais', 'Mil cliques', 'Clique em Rolar 1.000 vezes', rngGame.manualRolls, 1_000),
    makeRngAchievement('manual-rolls-10000', 'Rolagens manuais', 'Dez mil cliques', 'Clique em Rolar 10.000 vezes', rngGame.manualRolls, 10_000),
    makeRngAchievement('manual-rolls-100000', 'Rolagens manuais', 'Dedicação manual', 'Clique em Rolar 100.000 vezes', rngGame.manualRolls, 100_000),
    makeRngAchievement('manual-rolls-1000000', 'Rolagens manuais', 'Um milhão de cliques', 'Clique em Rolar 1.000.000 de vezes', rngGame.manualRolls, 1_000_000),
    makeRngAchievement('unique-10', 'Coleção', 'Começando a coleção', 'Descubra 10 títulos diferentes', collected.size, 10),
    makeRngAchievement('unique-50', 'Coleção', 'Colecionador', 'Descubra 50 títulos diferentes', collected.size, 50),
    makeRngAchievement('unique-100', 'Coleção', 'Metade do caminho', 'Descubra 100 títulos diferentes', collected.size, 100),
    makeRngAchievement('unique-200', 'Coleção', 'Coleção completa', 'Descubra todos os 200 títulos', collected.size, 200)
  ];
  for (const tier of rngTiers) {
    if (tier.id === 'basic') continue;
    const unlocked = hasTier(tier.id);
    achievements.push(makeRngAchievement('tier-' + tier.id, 'Raridades', 'Primeiro ' + tier.label, 'Encontre um título ' + tier.label, unlocked ? 1 : 0, 1));
  }
  achievements.push(
    makeRngAchievement('streak-repeat-7', 'Marcos de sorte', 'Disco riscado', 'Consiga o mesmo título 7 vezes seguidas', rngGame.longestSameTitleStreak, 7),
    makeRngAchievement('drought-1000', 'Marcos de sorte', 'A maré vira', 'Passe 1.000 rolagens sem obter Singular+', rngGame.longestSingularDrought, 1_000),
    makeRngAchievement('multiplier-100', 'Marcos de sorte', 'Sorte astronômica', 'Alcance um multiplicador de ×100', rngGame.maxMultiplier, 100),
    makeRngAchievement('events-1', 'Eventos', 'Na hora certa', 'Participe de um evento', rngGame.eventsParticipated, 1),
    makeRngAchievement('events-10', 'Eventos', 'Presença constante', 'Participe de 10 eventos', rngGame.eventsParticipated, 10),
    makeRngAchievement('limited-title', 'Eventos', 'Edição especial', 'Obtenha um título limitado de evento', rngGame.limitedTitles.length, 1)
  );
  return achievements;
}
function rngSnapshot(now = rngMonotonicMs()) {
  accountRngTime(now);
  const luck = luckForState(rngGame);
  const trustedUtc = rngTrustedClock.now();
  const participation = activeEvent(trustedUtc, rngGame.participation);
  const achievements = buildRngAchievements();
  return {
    tiers: rngTiers,
    catalog: publicRngCatalog(rngGame),
    debugCatalog: app.isPackaged ? undefined : rngTitles.map(title => ({ id: title.id, name: title.name, tier: title.tier })),
    collectedIds: rngGame.collectedIds,
    recentDiscoveries: rngGame.recentDiscoveries,
    titleHistory: rngGame.titleHistory,
    achievements,
    secrets: rngSecrets.filter(secret => rngGame.unlockedSecrets.includes(secret.id)),
    limitedTitles: LIMITED_REWARDS.filter(reward => rngGame.limitedTitles.includes(reward.titleId)),
    statistics: { measuredRolls: rngGame.trackedRolls, tierRolls: rngGame.tierRolls, duplicates: rngGame.duplicateRolls, uniqueTitles: rngGame.collectedIds.length, averageLuck: rngGame.luckBpsSamples ? rngGame.luckBpsSum / rngGame.luckBpsSamples / 10_000 : null, maxMultiplier: rngGame.maxMultiplier, sinceSingular: rngGame.sinceSingular, longestSingularDrought: rngGame.longestSingularDrought, longestSameTitleStreak: rngGame.longestSameTitleStreak, rarestTitle: rngTitles.find(title => title.id === rngGame.rarestTitleId)?.name || null, rarestOdds: rngGame.rarestOdds, luckiestOdds: rngGame.luckiestOdds, luckiestRoll: rngGame.luckiestRoll, bestSession: rngGame.sessionBest },
    session: { rolls: rngSessionRolls, newTitles: rngSessionNewTitles, bestOdds: String(rngSessionBestOdds) },
    timeVerification: rngTrustedClock.status(),
    eventSchedule: trustedUtc === null ? [] : eventSchedule(trustedUtc),
    activeEvent: participation,
    eventRollProgress: rngGame.eventRollProgress,
    ...publicRngProgress(rngGame),
    lastTitleId: rngGame.lastTitleId,
    totalRolls: rngGame.totalRolls,
    totalTitles: rngTitles.length,
    totalAppSeconds: rngGame.totalAppSeconds,
    appSessionStartedAt: rngAppSessionStartedAt,
    appSessionSeconds: rngGame.totalAppSeconds - rngAppSessionBaselineSeconds,
    totalAutoRollSeconds: rngGame.totalAutoRollSeconds,
    autoRollStartedAt: rngAutoRollStartedAt || 0,
    autoRollSessionSeconds: rngAutoRollStartedAt ? Math.floor((now - rngAutoRollStartedAt) / 1000) : rngGame.lastAutoRollSessionSeconds,
    autoRollActive: Boolean(rngAutoRollStartedAt),
    latestResult: rngLatestResult,
    latestResults: rngLatestResults,
    passiveLuckBps: luck.passiveBps,
    totalLuckBps: luck.totalBps,
    rollsPerCycle: luck.rollsPerCycle,
    bonusMultiplier: luck.bonusMultiplier,
    bonusRollEvery: luck.bonusRollEvery,
    snapshotAt: now
  };
}
function sendRngState() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('rng-state', rngSnapshot());
}
function performRngRoll({ manual = false } = {}) {
  const rolledAt = rngTrustedClock.now();
  const participation = activeEvent(rolledAt, rngGame.participation);
  const autoRollSeconds = rngAutoRollStartedAt ? Math.floor((rngMonotonicMs() - rngAutoRollStartedAt) / 1000) : 0;
  const outcome = rollRngBatch(rngGame, undefined, { rolledAt, event: participation, autoRollSeconds });
  rngGame = outcome.state;
  rngSessionRolls += outcome.results.length;
  rngSessionNewTitles += outcome.results.filter(result => result.isNew).length;
  for (const result of outcome.results) {
    const resultTitle = rngTitles.find(title => title.id === result.title.id);
    const denominator = resultTitle?.denominator || (resultTitle?.baseWeight ? rngPool / resultTitle.baseWeight : 0n);
    if (denominator > rngSessionBestOdds) rngSessionBestOdds = denominator;
  }
  if (rngSessionRolls > rngGame.sessionBest.rolls) rngGame.sessionBest = { rolls: rngSessionRolls, newTitles: rngSessionNewTitles, bestOdds: String(rngSessionBestOdds) };
  rngLatestResults = outcome.results.map(result => ({
    title: { id: result.title.id, name: result.title.name, tier: result.title.tier, tierLabel: result.title.tierLabel },
    isNew: result.isNew,
    currentOdds: result.currentOdds,
    roll: result.roll,
    isBonusRoll: result.isBonusRoll,
    rollBonusMultiplier: result.rollBonusMultiplier,
    isEqualHourBonus: result.isEqualHourBonus,
    equalHourMultiplier: result.equalHourMultiplier,
    equalHourTime: result.equalHourTime,
    isThousandRollBonus: result.isThousandRollBonus,
    thousandRollMultiplier: result.thousandRollMultiplier,
    isTenThousandRollBonus: result.isTenThousandRollBonus,
    tenThousandRollMultiplier: result.tenThousandRollMultiplier,
    rolledAt: result.rolledAt,
    eventName: result.eventName,
    eventMultiplier: result.eventMultiplier,
    eventFocusTierLabel: result.eventFocusTierLabel,
    eventFocusMultiplier: result.eventFocusMultiplier,
    specialUnlocks: result.specialUnlocks
  }));
  rngLatestResult = rngLatestResults[rngLatestResults.length - 1] || null;
  if (manual) rngGame.manualRolls++;
  persistRngGame();
  sendRngState();
  return rngLatestResults;
}
function startRngClock() {
  const now = rngMonotonicMs(); rngAppSessionStartedAt = now; rngAppAccountedAt = now; rngLastPersistAt = now; rngAppSessionBaselineSeconds = rngGame.totalAppSeconds; rngLastHeartbeatAt = now;
  rngAutoRollStartedAt = 0; rngAutoAccountedAt = 0; rngNextAutoRollAt = 0;
  if (rngClock) clearInterval(rngClock);
  rngClock = setInterval(() => {
    const tick = rngMonotonicMs();
    if (tick - rngLastHeartbeatAt > 10_000) {
      rngTrustedClock.invalidate();
      if (rngAutoRollStartedAt) rngGame.lastAutoRollSessionSeconds = Math.max(0, Math.floor((rngLastHeartbeatAt - rngAutoRollStartedAt) / 1000));
      rngAppAccountedAt = tick;
      rngAutoRollStartedAt = 0; rngAutoAccountedAt = 0; rngNextAutoRollAt = 0;
      rngLastTimeSync = tick;
      persistRngGame(); sendRngState(); updateTrayStatus();
      void rngTrustedClock.sync().then(sendRngState);
    }
    rngLastHeartbeatAt = tick;
    if (tick - rngLastTimeSync >= 60_000) { rngLastTimeSync = tick; void rngTrustedClock.sync().then(sendRngState); }
    if (tick >= rngNextEventCheckAt) {
      rngNextEventCheckAt = tick + 1000;
      const utc = rngTrustedClock.now();
      const currentWindow = utc === null ? null : eventSchedule(utc, 0).find(window => window.startUtc <= utc && utc < window.endUtc)?.id || null;
      if (currentWindow !== rngLastEventWindowId) { rngLastEventWindowId = currentWindow; sendRngState(); }
    }
    if (rngAutoRollStartedAt && tick >= rngNextAutoRollAt) { rngNextAutoRollAt = tick + 1000; performRngRoll(); }
    if (tick - rngLastPersistAt >= 5000) { accountRngTime(tick); persistRngGame(); }
  }, 200);
}
function startRngAutoRoll() {
  if (rngAutoRollStartedAt) return false;
  const now = rngMonotonicMs();
  rngAutoRollStartedAt = now; rngAutoAccountedAt = now; rngNextAutoRollAt = now + 1000; rngGame.lastAutoRollSessionSeconds = 0;
  updateTrayStatus(); sendRngState();
  return true;
}
function loginAtStartupPath() { return path.join(app.getPath('userData'), 'ntc-launch-at-login.json'); }
function loginAtStartupOptions(enabled) { return app.isPackaged ? { openAtLogin: Boolean(enabled) } : { openAtLogin: Boolean(enabled), path: process.execPath, args: [app.getAppPath()] }; }
function initializeLoginAtStartup() {
  if (process.platform !== 'win32') return;
  try {
    const saved = JSON.parse(fs.readFileSync(loginAtStartupPath(), 'utf8'));
    if (typeof saved.enabled === 'boolean') launchAtLoginEnabled = saved.enabled;
  } catch {}
  try { app.setLoginItemSettings(loginAtStartupOptions(launchAtLoginEnabled)); }
  catch (error) { console.error('Não foi possível configurar a inicialização com o Windows:', error); }
}
function setLoginAtStartup(enabled) {
  if (process.platform !== 'win32') return { ok: false, message: 'A inicialização automática está disponível no Windows.' };
  try {
    app.setLoginItemSettings(loginAtStartupOptions(enabled));
    fs.mkdirSync(path.dirname(loginAtStartupPath()), { recursive: true });
    fs.writeFileSync(loginAtStartupPath(), JSON.stringify({ enabled: Boolean(enabled) }));
    launchAtLoginEnabled = Boolean(enabled);
    return { ok: true, enabled: launchAtLoginEnabled };
  } catch (error) { return { ok: false, message: error.message || 'Não foi possível alterar a inicialização do Windows.' }; }
}
function sendUpdate(payload) {
  updateState = payload;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update-event', payload);
}
function releaseNotes(value) {
  if (Array.isArray(value)) return value.map(note => note.note || note).join('\n');
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\\n/g, '\n').trim();
}
function configureUpdater() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('checking-for-update', () => sendUpdate({ status: 'checking' }));
  autoUpdater.on('update-available', info => sendUpdate({ status: 'available', version: info.version, notes: releaseNotes(info.releaseNotes) }));
  autoUpdater.on('update-not-available', () => sendUpdate({ status: 'current', version: app.getVersion() }));
  autoUpdater.on('download-progress', progress => sendUpdate({ status: 'downloading', percent: Math.round(progress.percent || 0) }));
  autoUpdater.on('update-downloaded', info => sendUpdate({ status: 'downloaded', version: info.version, notes: releaseNotes(info.releaseNotes) }));
  autoUpdater.on('error', error => sendUpdate({ status: 'error', message: 'Não foi possível verificar ou baixar a atualização. Tente novamente mais tarde.' }));
}
function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  return true;
}
function showScreenshotWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isMaximized()) mainWindow.maximize();
  mainWindow.show();
  mainWindow.focus();
  return true;
}
function ensureTray() {
  if (trayIcon || process.platform !== 'win32') return;
  let icon = nativeImage.createFromPath(path.join(__dirname, 'build', 'ntc-logo.png'));
  if (icon.isEmpty()) icon = nativeImage.createFromDataURL('data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="7" fill="#dedede"/><text x="16" y="21" text-anchor="middle" font-family="Arial" font-size="13" font-weight="700" fill="#111">NTC</text></svg>'));
  trayIcon = new Tray(icon.resize({ width: 16, height: 16 }));
  updateTrayStatus();
  trayIcon.on('click', showMainWindow);
  trayIcon.on('double-click', showMainWindow);
}
function updateTrayStatus() {
  if (!trayIcon) return;
  const active = Boolean(rngAutoRollStartedAt);
  trayIcon.setToolTip(`NTC Utilities — Auto-roll ${active ? 'ativo' : 'pausado'}`);
  trayIcon.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir NTC Utilities', click: showMainWindow },
    { label: `Auto-roll ${active ? 'ativo em segundo plano' : 'pausado'}`, enabled: false },
    { type: 'separator' },
    { label: 'Sair do NTC Utilities', click: requestExitFromTray }
  ]));
}
function requestExitFromTray() {
  if (recordingSessions.size && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('screen-close-request');
    showMainWindow();
    return;
  }
  forceClose = true;
  app.quit();
}
function binaryDirectory() { return app.isPackaged ? path.join(process.resourcesPath, 'bin') : path.join(__dirname, 'resources', 'bin'); }
function binary(name) { const bundled = path.join(binaryDirectory(), `${name}.exe`); return fs.existsSync(bundled) ? bundled : name; }
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary(command), args, { windowsHide: true }); let out = ''; let err = '';
    child.stdout.on('data', data => { out += data.toString(); }); child.stderr.on('data', data => { err += data.toString(); });
    child.on('error', reject); child.on('close', code => code === 0 ? resolve(out) : reject(new Error(err || `Processo terminou com código ${code}`)));
  });
}
function runBuffer(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary(command), args, { windowsHide: true }); const chunks = []; let error = '';
    child.stdout.on('data', data => chunks.push(data)); child.stderr.on('data', data => { error += data.toString(); });
    child.on('error', reject); child.on('close', code => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(error || `Processo terminou com código ${code}`)));
  });
}
function buildArgs(item) {
  const quality = item.quality || (item.type === 'audio' ? 'original' : 'best');
  const outputName = item.filename ? path.basename(item.filename, path.extname(item.filename)) : '%(title).180B';
  const output = path.join(item.folder, `${outputName}.%(ext)s`);
  const args = ['--no-playlist', '--newline', '--no-warnings', '--ffmpeg-location', binaryDirectory(), '--progress-template', 'download:PROGRESS|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s', '--print', 'before_dl:TITLE|%(title)s', '--print', 'after_move:FILE|%(filepath)s', '--output', output];
  if (item.duplicate === 'overwrite') args.push('--force-overwrites'); else args.push('--no-overwrites');
  if (item.speedLimit) args.push('--limit-rate', item.speedLimit);
  if (item.type === 'audio') { if (item.format === 'original') args.push('--format', 'bestaudio/best'); else args.push('--extract-audio', '--audio-format', item.format, '--audio-quality', quality === 'original' ? '0' : `${quality}K`); }
  else if (item.type === 'thumbnail') args.push('--skip-download', '--write-thumbnail', '--convert-thumbnails', item.format === 'png' ? 'png' : 'jpg');
  else { const height = quality === 'best' ? '' : `[height<=${quality}]`; const format = item.format === 'webm' ? 'webm' : 'mp4'; const compatibleMp4 = `bv*${height}[vcodec^=avc1][ext=mp4]+ba[acodec^=mp4a][ext=m4a]/b${height}[vcodec^=avc1][ext=mp4]/bv*${height}[vcodec^=avc1]+ba[acodec^=mp4a]/b${height}[vcodec^=avc1]`; args.push('--format', format === 'mp4' ? compatibleMp4 : `bv*${height}+ba/b${height}`, '--merge-output-format', format); }
  args.push(item.url); return args;
}
function availableFilename(folder, filename, duplicate) {
  if (duplicate === 'overwrite' || !filename) return filename;
  const ext = path.extname(filename); const stem = path.basename(filename, ext); let candidate = filename; let n = 1;
  while (fs.existsSync(path.join(folder, candidate))) candidate = `${stem} (${n++})${ext}`;
  return candidate;
}
async function captureDesktopScreenshot() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const width = Math.max(1, Math.min(16_384, Math.round(display.size.width * display.scaleFactor)));
  const height = Math.max(1, Math.min(16_384, Math.round(display.size.height * display.scaleFactor)));
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height }, fetchWindowIcons: false });
  const source = sources.find(item => String(item.display_id) === String(display.id)) || sources[0];
  if (!source || source.thumbnail.isEmpty()) throw new Error('Não foi possível capturar esta tela.');
  const size = source.thumbnail.getSize();
  return { dataUrl: source.thumbnail.toDataURL(), width: size.width, height: size.height };
}
async function inspectScreenshotBuffer(value) {
  const data = Buffer.from(value || []);
  if (!data.length || data.length > 150 * 1024 * 1024) throw new Error('A imagem capturada está vazia ou excede o limite de tamanho.');
  const metadata = await sharp(data, { limitInputPixels: 268_402_689 }).metadata();
  if (metadata.format !== 'png' || !metadata.width || !metadata.height) throw new Error('A captura precisa ser uma imagem PNG válida.');
  return { data, metadata };
}
function screenshotTimestamp() {
  const now = new Date();
  const pad = value => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}
async function saveRawScreenshot(folder, value) {
  const destination = path.resolve(String(folder || ''));
  if (!destination || !fs.existsSync(destination) || !fs.statSync(destination).isDirectory()) throw new Error('Escolha uma pasta válida para salvar as capturas.');
  const { data, metadata } = await inspectScreenshotBuffer(value);
  const filename = availableFilename(destination, `Captura de tela ${screenshotTimestamp()}.png`, 'rename');
  const file = path.join(destination, filename);
  await sharp(data).png().toFile(file);
  const stat = fs.statSync(file);
  return { file, filename, size: stat.size, width: metadata.width, height: metadata.height };
}
function appShortcutConflictMessage(value) {
  const shortcut = String(value || '').replace(/CommandOrControl/gi, 'Ctrl').replace(/PrintScreen/gi, 'Print Screen').replaceAll('+', ' + ');
  return /(?:^|\+)PrintScreen$/i.test(String(value || ''))
    ? `${shortcut} já está em uso pelo Windows ou por outro programa (por exemplo, o ShareX). Desative esse mesmo atalho no outro programa e tente novamente.`
    : 'Esta tecla já está sendo usada pelo sistema ou por outro atalho.';
}
function registerAppShortcut(value, activeShortcut, otherShortcuts, callback, restoreCallback) {
  if (!value) return { ok: false, message: 'Escolha uma tecla para o atalho.' };
  if ((Array.isArray(otherShortcuts) ? otherShortcuts : [otherShortcuts]).includes(value)) return { ok: false, message: 'Esse atalho já está configurado para outra função do NTC.' };
  if (value === activeShortcut) return { ok: true, accelerator: value };
  try {
    if (globalShortcut.isRegistered(value)) return { ok: false, message: appShortcutConflictMessage(value) };
    if (activeShortcut) globalShortcut.unregister(activeShortcut);
    if (!globalShortcut.register(value, callback)) throw new Error(appShortcutConflictMessage(value));
    return { ok: true, accelerator: value };
  } catch (error) {
    if (activeShortcut && restoreCallback) { try { globalShortcut.register(activeShortcut, restoreCallback); } catch {} }
    return { ok: false, message: /PrintScreen/i.test(value) ? appShortcutConflictMessage(value) : 'Essa tecla não pode ser usada como atalho global.' };
  }
}
function findDownloadedFile(item, reportedFile) {
  if (reportedFile && fs.existsSync(reportedFile)) return reportedFile;
  const base = path.basename(item.filename || '', path.extname(item.filename || '')); const extension = item.type === 'audio' ? item.format : item.format;
  const expected = base && extension ? path.join(item.folder, `${base}.${extension}`) : '';
  if (expected && fs.existsSync(expected)) return expected;
  try {
    return fs.readdirSync(item.folder, { withFileTypes: true }).filter(entry => entry.isFile() && (!base || entry.name.startsWith(base)) && (!extension || path.extname(entry.name).toLowerCase() === `.${extension}`)).map(entry => path.join(item.folder, entry.name)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || '';
  } catch { return ''; }
}
function downloadErrorMessage(log) {
  const useful = String(log || '').split(/\r?\n/).map(line => line.trim()).filter(line => /(?:ERROR|WARNING):/i.test(line)).pop();
  if (!useful) return 'O arquivo não foi criado. Verifique o link, a qualidade, a pasta ou a conexão.';
  if (/sign in|confirm.*age|bot/i.test(useful)) return 'O YouTube pediu confirmação de acesso para este conteúdo. Tente novamente mais tarde ou use outro vídeo.';
  return useful.replace(/^.*?(?:ERROR|WARNING):\s*/i, '') || 'Não foi possível concluir o download.';
}
function safeName(value) { return String(value || 'conversão').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/[. ]+$/, '').slice(0, 150) || 'conversão'; }
function parseTime(value) {
  if (value === undefined || value === null || value === '') return null;
  if (/^\d+(?:\.\d+)?$/.test(String(value))) return Number(value);
  const parts = String(value).trim().split(':').map(Number);
  if (!parts.length || parts.length > 3 || parts.some(part => !Number.isFinite(part) || part < 0)) return NaN;
  return parts.reduce((total, part) => total * 60 + part, 0);
}
function outputExtension(format) { return format === 'm4a' ? 'm4a' : format; }
function codecArgs(format, quality) {
  const bitrate = ['128', '192', '256', '320'].includes(String(quality)) ? `${quality}k` : '192k';
  if (format === 'mp3') return ['-c:a', 'libmp3lame', '-b:a', bitrate];
  if (format === 'm4a') return ['-c:a', 'aac', '-b:a', bitrate];
  if (format === 'aac') return ['-c:a', 'aac', '-b:a', bitrate];
  if (format === 'ogg') return ['-c:a', 'libvorbis', '-b:a', bitrate];
  if (format === 'opus') return ['-c:a', 'libopus', '-b:a', bitrate];
  if (format === 'wav') return ['-c:a', 'pcm_s16le'];
  if (format === 'flac') return ['-c:a', 'flac'];
  if (format === 'aiff') return ['-c:a', 'pcm_s16be'];
  if (format === 'wma') return ['-c:a', 'wmav2', '-b:a', bitrate];
  if (format === 'ac3') return ['-c:a', 'ac3', '-b:a', bitrate];
  throw new Error('Formato de saída inválido.');
}
function estimateEta(seconds, percent) {
  if (!percent || percent <= 0 || !seconds) return '—';
  const remaining = Math.max(0, Math.round(seconds * (100 - percent) / percent));
  return remaining < 60 ? `${remaining}s` : `${Math.floor(remaining / 60)}m ${remaining % 60}s`;
}
async function inspectMedia(file) {
  if (!file || !fs.existsSync(file)) throw new Error('Arquivo não encontrado.');
  const data = JSON.parse(await run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file]));
  const audio = (data.streams || []).find(stream => stream.codec_type === 'audio');
  const cover = (data.streams || []).find(stream => stream.codec_type === 'video' && stream.disposition?.attached_pic);
  if (!audio) throw new Error('Este arquivo não possui uma faixa de áudio.');
  const tags = data.format?.tags || {};
  const duration = Number(data.format?.duration || audio.duration || 0);
  return {
    path: file, name: path.basename(file), baseName: path.basename(file, path.extname(file)), duration: Number.isFinite(duration) ? duration : 0,
    durationLabel: Number.isFinite(duration) && duration > 0 ? new Date(duration * 1000).toISOString().slice(11, 19) : '—',
    type: videoExtensions.includes(path.extname(file).toLowerCase()) ? 'Vídeo' : 'Áudio', format: data.format?.format_name || path.extname(file).slice(1),
    coverStreamIndex: Number.isInteger(cover?.index) ? cover.index : null,
    metadata: { title: tags.title || '', artist: tags.artist || tags.album_artist || '', album: tags.album || '', year: tags.date || tags.year || '', genre: tags.genre || '' }
  };
}
async function inspectVideo(file) {
  if (!file || !fs.existsSync(file)) throw new Error('Vídeo não encontrado.');
  const data = JSON.parse(await run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file]));
  const video = (data.streams || []).find(stream => stream.codec_type === 'video');
  if (!video) throw new Error('Este arquivo não possui vídeo.');
  const duration = Number(data.format?.duration || video.duration || 0);
  return { path: file, name: path.basename(file), baseName: path.basename(file, path.extname(file)), duration: Number.isFinite(duration) ? duration : 0, durationLabel: duration ? new Date(duration * 1000).toISOString().slice(11, 19) : '—', width: video.width || 0, height: video.height || 0, hasAudio: (data.streams || []).some(stream => stream.codec_type === 'audio'), format: path.extname(file).slice(1) };
}
function normalizedCuts(cuts, duration) {
  const sorted = (Array.isArray(cuts) ? cuts : []).map(cut => ({ start: Math.max(0, Math.min(duration, Number(cut.start) || 0)), end: Math.max(0, Math.min(duration, Number(cut.end) || 0)) })).filter(cut => cut.end - cut.start > .05).sort((a, b) => a.start - b.start);
  return sorted.reduce((result, cut) => { const previous = result.at(-1); if (previous && cut.start <= previous.end + .05) previous.end = Math.max(previous.end, cut.end); else result.push(cut); return result; }, []);
}
function keptVideoSegments(cuts, duration) {
  const segments = []; let cursor = 0; normalizedCuts(cuts, duration).forEach(cut => { if (cut.start > cursor + .05) segments.push({ start: cursor, end: cut.start }); cursor = Math.max(cursor, cut.end); }); if (duration > cursor + .05) segments.push({ start: cursor, end: duration }); return segments;
}
async function inspectImage(file) {
  if (!file || !fs.existsSync(file)) throw new Error('Imagem não encontrada.');
  const data = await sharp(file).metadata();
  if (!data.width || !data.height) throw new Error('Não foi possível ler esta imagem.');
  return { path: file, name: path.basename(file), baseName: path.basename(file, path.extname(file)), width: data.width, height: data.height, format: data.format || path.extname(file).slice(1), hasAlpha: Boolean(data.hasAlpha), size: fs.statSync(file).size };
}
function imageDimensions(metadata, item) {
  const scale = Math.max(1, Math.min(10000, Number(item.scale) || 100)) / 100; const sourceWidth = Number(metadata.width || 0); const sourceHeight = Number(metadata.height || 0); let width = Number(item.width) || Math.round(sourceWidth * scale) || null; let height = Number(item.height) || Math.round(sourceHeight * scale) || null;
  if (item.keepRatio !== false && sourceWidth && sourceHeight) { if (Number(item.width) && !Number(item.height)) height = Math.round(width * sourceHeight / sourceWidth); if (Number(item.height) && !Number(item.width)) width = Math.round(height * sourceWidth / sourceHeight); }
  return { width, height };
}
function applyLowQualityPixelation(pipeline, width, height, quality) {
  if (quality > 15 || !width || !height) return pipeline; const factor = Math.max(.015, quality / 100); return pipeline.resize(Math.max(1, Math.round(width * factor)), Math.max(1, Math.round(height * factor)), { fit: 'fill', kernel: 'nearest' }).resize(width, height, { fit: 'fill', kernel: 'nearest' });
}
function startFfmpegJob(event, map, id, args, output, duration, channel) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary('ffmpeg'), args, { windowsHide: true }); let cancelled = false; let buffer = ''; const started = Date.now();
    map.set(id, { cancel: () => { cancelled = true; child.kill(); } });
    const line = raw => { const [key, ...rest] = raw.trim().split('='); if (key !== 'out_time_ms') return; const seconds = Number(rest.join('=')) / 1000000; const percent = duration ? Math.min(99, seconds / duration * 100) : 0; send(event.sender, channel, { id, status: 'converting', percent, eta: estimateEta((Date.now() - started) / 1000, percent) }); };
    const data = chunk => { buffer += chunk.toString(); const lines = buffer.split(/\r?\n/); buffer = lines.pop() || ''; lines.forEach(line); };
    child.stdout.on('data', data); child.stderr.on('data', data); child.on('error', error => { map.delete(id); reject(error); }); child.on('close', code => { map.delete(id); if (cancelled) { if (fs.existsSync(output)) fs.unlinkSync(output); return reject(new Error('Operação cancelada.')); } if (code !== 0 || !fs.existsSync(output)) return reject(new Error('A conversão falhou. Verifique o arquivo, as opções ou o espaço disponível.')); const stat = fs.statSync(output); send(event.sender, channel, { id, status: 'complete', file: output, size: stat.size, filename: path.basename(output) }); resolve({ file: output, size: stat.size, filename: path.basename(output) }); });
  });
}
function recordingOutputName(folder) { const stamp = new Date().toISOString().replace(/[T:]/g, '-').replace(/\..+/, ''); return availableFilename(folder, `Gravação ${stamp}.mp4`, 'rename'); }
async function finalizeScreenRecording(session) {
  await new Promise((resolve, reject) => { session.stream.end(error => error ? reject(error) : resolve()); });
  const crf = { alta: '18', equilibrada: '23', economica: '30' }[session.quality] || '23'; const args = ['-hide_banner', '-y', '-i', session.temp]; if (session.resolution && session.resolution !== 'original') args.push('-vf', `scale=-2:${Number(session.resolution)}`); args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', crf, '-pix_fmt', 'yuv420p');
  if (session.withAudio) args.push('-c:a', 'aac', '-b:a', '128k'); else args.push('-an');
  args.push('-movflags', '+faststart', session.output);
  try { await run('ffmpeg', args); } finally { if (fs.existsSync(session.temp)) fs.unlinkSync(session.temp); }
  const stat = fs.statSync(session.output); return { file: session.output, size: stat.size, filename: path.basename(session.output) };
}
async function createWaveform(file) {
  if (!file || !fs.existsSync(file)) throw new Error('Arquivo não encontrado.');
  const pcm = await runBuffer('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a:0', '-ac', '1', '-ar', '200', '-f', 'f32le', 'pipe:1']);
  const sampleCount = Math.floor(pcm.length / 4); const points = 720; const values = new Array(points).fill(0);
  if (!sampleCount) return values;
  for (let index = 0; index < sampleCount; index++) { const point = Math.min(points - 1, Math.floor(index * points / sampleCount)); const amplitude = Math.abs(pcm.readFloatLE(index * 4)); if (Number.isFinite(amplitude) && amplitude > values[point]) values[point] = amplitude; }
  const peak = Math.max(...values, 0.0001); return values.map(value => Math.min(1, value / peak));
}
function createWindow() {
  mainWindow = new BrowserWindow({ width: 1160, height: 760, minWidth: 930, minHeight: 640, icon: path.join(__dirname, 'build', 'ntc-logo.png'), backgroundColor: '#090909', frame: false, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false } });
  mainWindow.webContents.on('before-input-event', (event, input) => {
    // Windows does not emit a keyDown for Print Screen; ShareX captures this key on keyUp.
    if (!shortcutRecorderFocused || input.type !== 'keyUp') return;
    const printScreenKeys = ['PrintScreen', 'Print', 'Snapshot', 'PrtSc', 'PrtScn', 'SysReq'];
    const isPrintScreen = ['PrintScreen', 'Snapshot'].includes(input.code) || printScreenKeys.includes(input.key) || (input.key === 'Cancel' && (input.control || input.meta));
    if (!isPrintScreen) return;
    event.preventDefault();
    mainWindow.webContents.send('shortcut-recorder-input', {
      key: 'PrintScreen',
      code: 'PrintScreen',
      ctrlKey: Boolean(input.control),
      metaKey: Boolean(input.meta),
      altKey: Boolean(input.alt),
      shiftKey: Boolean(input.shift)
    });
  });
  mainWindow.on('close', event => {
    if (forceClose || process.platform !== 'win32') return;
    event.preventDefault(); ensureTray(); mainWindow.hide();
  });
  mainWindow.on('maximize', () => { if (!mainWindow.isDestroyed()) mainWindow.webContents.send('window-maximized', true); });
  mainWindow.on('unmaximize', () => { if (!mainWindow.isDestroyed()) mainWindow.webContents.send('window-maximized', false); });
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.ntccorporation.utilities');
  initializeLoginAtStartup();
  loadRngGame(); startRngClock();
  void rngTrustedClock.sync().then(sendRngState);
  powerMonitor.on('suspend', () => { accountRngTime(); rngAutoRollStartedAt = 0; rngAutoAccountedAt = 0; rngNextAutoRollAt = 0; rngTrustedClock.invalidate(); persistRngGame(); sendRngState(); updateTrayStatus(); });
  powerMonitor.on('resume', () => { rngTrustedClock.invalidate(); rngAppAccountedAt = rngMonotonicMs(); rngLastHeartbeatAt = rngMonotonicMs(); rngLastTimeSync = rngMonotonicMs(); void rngTrustedClock.sync().then(sendRngState); });
  ipcMain.handle('get-app-version', () => app.getVersion());
  ipcMain.on('shortcut-recorder-focus', (event, focused) => {
    if (mainWindow && event.sender === mainWindow.webContents) shortcutRecorderFocused = Boolean(focused);
  });
  ipcMain.handle('get-launch-at-login', () => ({ enabled: launchAtLoginEnabled, supported: process.platform === 'win32' }));
  ipcMain.handle('set-launch-at-login', (_event, enabled) => setLoginAtStartup(enabled));
  ipcMain.handle('is-development-build', () => !app.isPackaged);
  ipcMain.handle('get-rng-state', () => rngSnapshot());
  ipcMain.handle('join-rng-event', (_event, eventId) => { const joined = joinEvent(rngTrustedClock.now(), eventId); if (rngGame.participation !== joined) rngGame.eventsParticipated++; rngGame.participation = joined; persistRngGame(); sendRngState(); return rngSnapshot(); });
  ipcMain.handle('app-entered', event => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return false;
    return startRngAutoRoll();
  });
  ipcMain.handle('roll-rng', () => {
    if (rngAutoRollStartedAt) throw new Error('Pause o Auto-roll para fazer uma rolagem manual.');
    return performRngRoll({ manual: true });
  });
  ipcMain.handle('set-rng-auto-roll', (_event, active) => {
    const now = rngMonotonicMs();
    if (active && !rngAutoRollStartedAt) {
      rngAutoRollStartedAt = now; rngAutoAccountedAt = now; rngNextAutoRollAt = now + 1000; rngGame.lastAutoRollSessionSeconds = 0;
      const result = performRngRoll();
      updateTrayStatus();
      return { active: true, result, state: rngSnapshot(now) };
    }
    if (!active && rngAutoRollStartedAt) {
      accountRngTime(now); rngGame.lastAutoRollSessionSeconds = Math.floor((now - rngAutoRollStartedAt) / 1000);
      rngAutoRollStartedAt = 0; rngAutoAccountedAt = 0; rngNextAutoRollAt = 0; persistRngGame(); sendRngState();
      updateTrayStatus();
    }
    return { active: Boolean(rngAutoRollStartedAt), state: rngSnapshot(now) };
  });
  if (!app.isPackaged) {
    ipcMain.handle('debug-rng-add-title', (_event, titleId) => {
      const oddsBeforeAdd = publicRngCatalog(rngGame).find(title => title.id === titleId)?.currentOdds;
      const result = debugGrantTitle(rngGame, titleId);
      rngGame = result.state; persistRngGame(); sendRngState();
      return {
        added: result.added,
        title: { id: result.title.id, name: result.title.name, tier: result.title.tier, tierLabel: result.title.tierLabel },
        currentOdds: oddsBeforeAdd,
        state: rngSnapshot()
      };
    });
    ipcMain.handle('debug-rng-remove-title', (_event, titleId) => {
      const result = debugRemoveTitle(rngGame, titleId);
      rngGame = result.state; persistRngGame(); sendRngState();
      return { removed: result.removed, state: rngSnapshot() };
    });
    ipcMain.handle('debug-rng-clear-titles', () => {
      const result = debugClearTitles(rngGame);
      rngGame = result.state; persistRngGame(); sendRngState();
      return { removedCount: result.removedCount, state: rngSnapshot() };
    });
    ipcMain.handle('debug-rng-grant-tier', (_event, tierId, count) => {
      const result = debugGrantTierTitles(rngGame, tierId, count);
      rngGame = result.state; persistRngGame(); sendRngState();
      return { granted: result.granted, tierId: result.tierId, state: rngSnapshot() };
    });
    ipcMain.handle('debug-rng-grant-total', (_event, count) => {
      const result = debugGrantTotalTitles(rngGame, count);
      rngGame = result.state; persistRngGame(); sendRngState();
      return { granted: result.granted, target: result.target, state: rngSnapshot() };
    });
    ipcMain.handle('debug-rng-ready-bonus-roll', () => {
      rngGame = debugReadyBonusRoll(rngGame); persistRngGame(); sendRngState();
      return rngSnapshot();
    });
  }
  ipcMain.handle('get-default-download-folder', () => app.getPath('downloads'));
  ipcMain.handle('get-free-space', (_event, folder) => { try { const stat = fs.statfsSync(folder || app.getPath('downloads')); return Number(stat.bavail) * Number(stat.bsize); } catch { return null; } });
  ipcMain.handle('window-minimize', event => { const window = BrowserWindow.fromWebContents(event.sender); if (!window) return false; window.minimize(); return true; });
  ipcMain.handle('window-toggle-maximize', event => { const window = BrowserWindow.fromWebContents(event.sender); if (!window) return false; if (window.isMaximized()) window.unmaximize(); else window.maximize(); return window.isMaximized(); });
  ipcMain.handle('window-close', event => BrowserWindow.fromWebContents(event.sender)?.close());
  ipcMain.handle('window-force-close', event => { forceClose = true; BrowserWindow.fromWebContents(event.sender)?.close(); });
  ipcMain.handle('window-is-maximized', event => BrowserWindow.fromWebContents(event.sender)?.isMaximized() || false);
  ipcMain.handle('window-is-minimized-or-hidden', event => { const window = BrowserWindow.fromWebContents(event.sender); return Boolean(window && window === mainWindow && (window.isMinimized() || !window.isVisible())); });
  ipcMain.handle('choose-download-folder', async () => { const result = await dialog.showOpenDialog({ title: 'Escolha a pasta de destino', properties: ['openDirectory', 'createDirectory'] }); return result.canceled ? null : result.filePaths[0]; });
  ipcMain.handle('choose-media-files', async () => {
    const result = await dialog.showOpenDialog({ title: 'Escolha arquivos de áudio ou vídeo', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Mídia', extensions: [...audioExtensions, ...videoExtensions].map(extension => extension.slice(1)) }] });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle('choose-video-files', async () => { const result = await dialog.showOpenDialog({ title: 'Escolha vídeos', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Vídeos', extensions: videoExtensions.map(extension => extension.slice(1)) }] }); return result.canceled ? [] : result.filePaths; });
  ipcMain.handle('choose-image-files', async () => { const result = await dialog.showOpenDialog({ title: 'Escolha imagens', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Imagens', extensions: imageExtensions.map(extension => extension.slice(1)) }] }); return result.canceled ? [] : result.filePaths; });
  ipcMain.handle('choose-compressor-files', async () => { const result = await dialog.showOpenDialog({ title: 'Escolha arquivos para comprimir', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Mídias e imagens', extensions: [...audioExtensions, ...videoExtensions, ...imageExtensions].map(extension => extension.slice(1)) }] }); return result.canceled ? [] : result.filePaths; });
  ipcMain.handle('choose-rename-files', async () => { const result = await dialog.showOpenDialog({ title: 'Escolha arquivos para renomear', properties: ['openFile', 'multiSelections'] }); return result.canceled ? [] : result.filePaths; });
  ipcMain.handle('preview-file-renames', (_event, payload) => previewFileRenames(payload?.files, payload?.options));
  ipcMain.handle('rename-files', (_event, payload) => renameFiles(payload?.files, payload?.options));
  ipcMain.handle('choose-cover-file', async () => { const result = await dialog.showOpenDialog({ title: 'Escolha uma capa', properties: ['openFile'], filters: [{ name: 'Imagens', extensions: ['jpg', 'jpeg', 'png'] }] }); return result.canceled ? null : result.filePaths[0]; });
  ipcMain.handle('inspect-media', (_event, file) => inspectMedia(file));
  ipcMain.handle('inspect-video', (_event, file) => inspectVideo(file));
  ipcMain.handle('inspect-image', (_event, file) => inspectImage(file));
  ipcMain.handle('preview-image', async (_event, item) => {
    if (!item?.source || !fs.existsSync(item.source)) throw new Error('Imagem não encontrada.');
    const metadata = await sharp(item.source).metadata(); const { width, height } = imageDimensions(metadata, item);
    const quality = Math.max(1, Math.min(100, Number(item.quality) || 85)); const format = ['jpg', 'png', 'webp'].includes(item.format) ? item.format : 'jpg'; let pipeline = sharp(item.source).rotate().resize(width, height, { fit: item.keepRatio === false ? 'fill' : 'inside', withoutEnlargement: false }); pipeline = applyLowQualityPixelation(pipeline, width, height, quality).resize({ width: 1100, height: 700, fit: 'inside', withoutEnlargement: true }); if (format === 'jpg') pipeline = pipeline.flatten({ background: '#ffffff' }).jpeg({ quality }); if (format === 'png') pipeline = pipeline.png({ palette: true, quality, compressionLevel: 9 }); if (format === 'webp') pipeline = pipeline.webp({ quality }); const output = await pipeline.toBuffer(); const mime = format === 'jpg' ? 'image/jpeg' : `image/${format}`; return { dataUrl: `data:${mime};base64,${output.toString('base64')}`, width, height };
  });
  ipcMain.handle('preview-qr', async (_event, item) => {
    const result = await renderQr(item?.url, item);
    return { dataUrl: result.dataUrl, url: result.text, format: result.format, size: result.size };
  });
  ipcMain.handle('generate-qr', async (event, item) => {
    if (!item?.id) throw new Error('Identificador de QR Code inválido.');
    send(event.sender, 'qr-event', { id: item.id, status: 'generating' });
    try {
      const saved = await saveQrImage({ ...item, folder: item.folder || app.getPath('downloads') });
      send(event.sender, 'qr-event', { ...saved, status: 'complete' });
      return saved;
    } catch (error) {
      send(event.sender, 'qr-event', { id: item.id, status: 'failed', error: error.message });
      throw error;
    }
  });
  ipcMain.handle('get-waveform', (_event, file) => createWaveform(file));
  ipcMain.handle('open-folder', (_event, folder) => folder ? shell.openPath(folder) : '');
  ipcMain.handle('open-file', (_event, file) => file ? shell.openPath(file) : '');
  ipcMain.handle('open-file-folder', (_event, file) => file ? shell.openPath(path.dirname(file)) : '');
  ipcMain.handle('copy-path', (_event, file) => { if (file) clipboard.writeText(file); return file || ''; });
  ipcMain.handle('copy-text', (_event, text) => { clipboard.writeText(String(text || '')); return true; });
  ipcMain.handle('tool-versions', async () => { try { const ytdlp = (await run('yt-dlp', ['--version'])).trim(); const ffmpeg = (await run('ffmpeg', ['-version'])).split(/\r?\n/)[0]; const ffprobe = (await run('ffprobe', ['-version'])).split(/\r?\n/)[0]; return { ytdlp, ffmpeg, ffprobe }; } catch (error) { return { error: error.message }; } });
  ipcMain.handle('check-for-updates', async () => {
    if (!app.isPackaged) return { status: 'unavailable', message: 'A verificação de atualização funciona na versão instalada.' };
    try { await autoUpdater.checkForUpdates(); return updateState; } catch { return { status: 'error', message: 'Não foi possível verificar atualizações agora.' }; }
  });
  ipcMain.handle('download-update', async () => {
    if (!app.isPackaged || updateState.status !== 'available') return { status: 'unavailable' };
    try { await autoUpdater.downloadUpdate(); return updateState; } catch { return { status: 'error', message: 'Não foi possível baixar a atualização.' }; }
  });
  ipcMain.handle('install-update', () => {
    if (app.isPackaged && updateState.status === 'downloaded') autoUpdater.quitAndInstall(false, true);
  });
  ipcMain.handle('preview-url', async (_event, url) => { if (!isSupportedUrl(url)) throw new Error('Cole um link válido do YouTube.'); const data = JSON.parse(await run('yt-dlp', ['--dump-single-json', '--skip-download', '--no-playlist', '--no-warnings', url])); const sizes = [data.filesize, data.filesize_approx, ...(data.formats || []).map(format => format.filesize || format.filesize_approx || 0)]; const estimatedSize = Math.max(0, ...sizes.map(value => Number(value) || 0)); return { id: data.id, title: data.title || 'Sem título', channel: data.channel || data.uploader || 'Canal desconhecido', duration: data.duration_string || '—', thumbnail: data.thumbnail || '', estimatedSize, webpageUrl: data.webpage_url || url }; });
  ipcMain.handle('playlist-preview', async (_event, url) => { if (!isSupportedUrl(url)) throw new Error('Link inválido.'); const data = JSON.parse(await run('yt-dlp', ['--flat-playlist', '--dump-single-json', '--skip-download', '--no-warnings', url])); const entries = (data.entries || []).filter(Boolean).map(entry => ({ id: entry.id, title: entry.title || 'Sem título', channel: entry.channel || entry.uploader || '', duration: entry.duration_string || '—', thumbnail: entry.thumbnail || `https://i.ytimg.com/vi/${entry.id}/mqdefault.jpg`, webpageUrl: entry.webpage_url || `https://www.youtube.com/watch?v=${entry.id}` })); return { isPlaylist: data._type === 'playlist' || entries.length > 1, title: data.title || 'Playlist', thumbnail: data.thumbnail || '', entries }; });
  ipcMain.handle('start-download', async (event, item) => {
    if (!item?.downloadId || !isSupportedUrl(item.url)) throw new Error('Link inválido.'); if (!item.folder || !['audio', 'video', 'thumbnail'].includes(item.type)) throw new Error('Dados de download inválidos.');
    return new Promise((resolve, reject) => {
      item = { ...item, filename: availableFilename(item.folder, item.filename, item.duplicate) }; const child = spawn(binary('yt-dlp'), buildArgs(item), { windowsHide: true }); let title = item.title || 'Arquivo de mídia'; let file = ''; let cancelled = false; let buffer = ''; let errorLog = '';
      downloadJobs.set(item.downloadId, { cancel: () => { cancelled = true; child.kill(); } }); send(event.sender, 'download-event', { downloadId: item.downloadId, status: 'starting' });
      const line = value => { const s = value.trim(); if (s.startsWith('TITLE|')) title = s.slice(6) || title; if (s.startsWith('FILE|')) file = s.slice(5); if (s.startsWith('PROGRESS|')) { const [, p, speed, eta] = s.split('|'); const percent = Number.parseFloat((p || '').replace('%', '')); send(event.sender, 'download-event', { downloadId: item.downloadId, status: 'downloading', title, percent: Number.isFinite(percent) ? percent : 0, speed: (speed || '—').trim(), eta: (eta || '—').trim() }); } };
      const data = chunk => { buffer += chunk.toString(); const lines = buffer.split(/\r?\n/); buffer = lines.pop() || ''; lines.forEach(line); };
      child.stdout.on('data', data); child.stderr.on('data', chunk => { errorLog += chunk.toString(); data(chunk); }); child.on('error', error => { downloadJobs.delete(item.downloadId); reject(error); }); child.on('close', code => { downloadJobs.delete(item.downloadId); if (cancelled) return reject(new Error('Download cancelado.')); const finalFile = findDownloadedFile(item, file); if (code !== 0) return reject(new Error(downloadErrorMessage(errorLog))); if (!finalFile) return reject(new Error('O download terminou, mas o arquivo final não foi encontrado na pasta escolhida.')); const stat = fs.statSync(finalFile); send(event.sender, 'download-event', { downloadId: item.downloadId, status: 'complete', title, file: finalFile, size: stat.size }); resolve({ title, file: finalFile, size: stat.size }); });
    });
  });
  ipcMain.handle('cancel-download', (_event, downloadId) => downloadJobs.get(downloadId)?.cancel?.());
  ipcMain.handle('start-conversion', async (event, item) => {
    if (!item?.conversionId || !item.source || !item.folder || !fs.existsSync(item.source)) throw new Error('Dados da conversão inválidos.');
    const start = parseTime(item.trimStart); const end = parseTime(item.trimEnd); const duration = Number(item.duration || 0);
    if (Number.isNaN(start) || Number.isNaN(end) || (start !== null && end !== null && end <= start) || (duration && ((start !== null && start >= duration) || (end !== null && end > duration)))) throw new Error('O corte informado é inválido.');
    const supportsCover = ['mp3', 'm4a', 'flac'].includes(item.format); const preservedCover = !item.cover && Number.isInteger(item.coverStreamIndex) && supportsCover;
    if (item.cover && !supportsCover) throw new Error('Capa é compatível com MP3, M4A e FLAC.');
    const baseName = safeName(item.outputName || path.basename(item.source, path.extname(item.source))); const extension = outputExtension(item.format); let filename = availableFilename(item.folder, `${baseName}.${extension}`, item.duplicate);
    if (path.resolve(item.folder, filename).toLowerCase() === path.resolve(item.source).toLowerCase()) filename = availableFilename(item.folder, `${baseName} (editado).${extension}`, 'rename');
    const output = path.join(item.folder, filename); const args = ['-hide_banner', '-y']; const trimDuration = end !== null ? end - (start || 0) : null;
    if (start !== null) args.push('-ss', String(start)); args.push('-i', item.source); if (item.cover) args.push('-i', item.cover); if (trimDuration !== null) args.push('-t', String(trimDuration));
    args.push('-map', '0:a:0', '-map_metadata', '0');
    if (item.cover) args.push('-map', '1:v:0', '-c:v', 'mjpeg', '-disposition:v', 'attached_pic');
    else if (preservedCover) args.push('-map', `0:${item.coverStreamIndex}`, '-c:v', 'mjpeg', '-disposition:v', 'attached_pic');
    const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0; const filters = []; if (item.normalize) filters.push('loudnorm=I=-16:TP=-1.5:LRA=11'); if (finite(item.gain)) filters.push(`volume=${finite(item.gain)}dB`); if (finite(item.eqBass)) filters.push(`equalizer=f=100:t=q:w=1:g=${finite(item.eqBass)}`); if (finite(item.eqMid)) filters.push(`equalizer=f=1000:t=q:w=1:g=${finite(item.eqMid)}`); if (finite(item.eqTreble)) filters.push(`equalizer=f=6000:t=q:w=1:g=${finite(item.eqTreble)}`); if (item.removeSilence) filters.push('silenceremove=start_periods=1:start_duration=0.25:start_threshold=-45dB:stop_periods=-1:stop_duration=0.25:stop_threshold=-45dB'); if (filters.length) args.push('-af', filters.join(','));
    ['title', 'artist', 'album', 'year', 'genre'].forEach(key => { if (item.metadata?.[key]) args.push('-metadata', `${key === 'year' ? 'date' : key}=${item.metadata[key]}`); });
    args.push(...codecArgs(item.format, item.quality), '-progress', 'pipe:1', '-nostats', output);
    return new Promise((resolve, reject) => {
      const child = spawn(binary('ffmpeg'), args, { windowsHide: true }); let cancelled = false; let buffer = ''; let lastSeconds = 0; const started = Date.now();
      conversionJobs.set(item.conversionId, { cancel: () => { cancelled = true; child.kill(); } }); send(event.sender, 'conversion-event', { conversionId: item.conversionId, status: 'starting' });
      const line = raw => { const [key, ...rest] = raw.trim().split('='); const value = rest.join('='); if (key === 'out_time_ms') { lastSeconds = Number(value) / 1000000; const usableDuration = end !== null ? end - (start || 0) : duration; const percent = usableDuration ? Math.min(99, (lastSeconds / usableDuration) * 100) : 0; const elapsed = (Date.now() - started) / 1000; send(event.sender, 'conversion-event', { conversionId: item.conversionId, status: 'converting', percent, eta: estimateEta(elapsed, percent) }); } };
      const data = chunk => { buffer += chunk.toString(); const lines = buffer.split(/\r?\n/); buffer = lines.pop() || ''; lines.forEach(line); };
      child.stdout.on('data', data); child.stderr.on('data', data); child.on('error', error => { conversionJobs.delete(item.conversionId); reject(error); }); child.on('close', code => { conversionJobs.delete(item.conversionId); if (cancelled) { if (fs.existsSync(output)) fs.unlinkSync(output); return reject(new Error('Conversão cancelada.')); } if (code !== 0 || !fs.existsSync(output)) return reject(new Error('A conversão falhou. Verifique o arquivo, o corte ou o espaço disponível.')); const stat = fs.statSync(output); send(event.sender, 'conversion-event', { conversionId: item.conversionId, status: 'complete', file: output, size: stat.size, filename }); resolve({ file: output, size: stat.size, filename }); });
    });
  });
  ipcMain.handle('cancel-conversion', (_event, conversionId) => conversionJobs.get(conversionId)?.cancel?.());
  ipcMain.handle('start-video-conversion', async (event, item) => {
    if (!item?.id || !item.source || !item.folder || !fs.existsSync(item.source)) throw new Error('Dados do vídeo inválidos.');
    const extension = ['mp4', 'mkv', 'webm'].includes(item.format) ? item.format : 'mp4'; const filename = availableFilename(item.folder, `${safeName(item.outputName || path.basename(item.source, path.extname(item.source)))}.${extension}`, item.duplicate); const output = path.join(item.folder, filename); const args = ['-hide_banner', '-y', '-i', item.source];
    if (item.resolution && item.resolution !== 'original') args.push('-vf', `scale=-2:${Number(item.resolution)}`); if (item.audioMode === 'mute') args.push('-an'); else args.push('-map', '0:a?'); args.push('-map', '0:v:0');
    const crf = { alta: '20', equilibrada: '25', economica: '30' }[item.quality] || '25'; if (extension === 'webm') args.push('-c:v', 'libvpx-vp9', '-crf', crf, '-b:v', '0', '-c:a', 'libopus'); else args.push('-c:v', item.codec === 'h265' ? 'libx265' : 'libx264', '-crf', crf, '-preset', 'medium', '-c:a', 'aac'); args.push('-progress', 'pipe:1', '-nostats', output);
    return startFfmpegJob(event, videoJobs, item.id, args, output, Number(item.duration || 0), 'video-event');
  });
  ipcMain.handle('cancel-video-conversion', (_event, id) => videoJobs.get(id)?.cancel?.());
  ipcMain.handle('choose-video-editor-file', async () => { const result = await dialog.showOpenDialog({ title: 'Escolha um vídeo para editar', properties: ['openFile'], filters: [{ name: 'Vídeos', extensions: videoExtensions.map(extension => extension.slice(1)) }] }); return result.canceled ? null : result.filePaths[0]; });
  ipcMain.handle('choose-video-editor-audio', async () => { const result = await dialog.showOpenDialog({ title: 'Adicionar áudios à timeline', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Áudios', extensions: audioExtensions.map(extension => extension.slice(1)) }] }); return result.canceled ? [] : result.filePaths; });
  ipcMain.handle('start-video-edit', async (event, item) => {
    if (!item?.id || !item.source || !item.folder || !fs.existsSync(item.source)) throw new Error('Escolha um vídeo e uma pasta de destino antes de exportar.');
    const duration = Math.max(0, Number(item.duration) || 0); if (!duration) throw new Error('Não foi possível identificar a duração do vídeo.');
    const segments = keptVideoSegments(item.cuts, duration); if (!segments.length) throw new Error('Os cortes removem o vídeo inteiro. Desfaça ao menos um trecho.');
    const finalDuration = segments.reduce((total, segment) => total + segment.end - segment.start, 0); const outputName = safeName(item.outputName || `${path.basename(item.source, path.extname(item.source))} editado`); const filename = availableFilename(item.folder, `${outputName}.mp4`, item.duplicate || 'rename'); const output = path.join(item.folder, filename);
    const tracks = (Array.isArray(item.audioTracks) ? item.audioTracks : []).filter(track => track?.source && fs.existsSync(track.source)); const args = ['-hide_banner', '-y', '-i', item.source]; tracks.forEach(track => { if (track.loop) args.push('-stream_loop', '-1'); args.push('-i', track.source); });
    const filters = []; const hasOriginalAudio = Boolean(item.hasAudio); const videoParts = []; const audioParts = [];
    segments.forEach((segment, index) => { filters.push(`[0:v:0]trim=start=${segment.start}:end=${segment.end},setpts=PTS-STARTPTS[v${index}]`); videoParts.push(`[v${index}]`); if (hasOriginalAudio) { filters.push(`[0:a:0]atrim=start=${segment.start}:end=${segment.end},asetpts=PTS-STARTPTS[a${index}]`); audioParts.push(`[a${index}]`); } });
    filters.push(`${videoParts.join('')}concat=n=${segments.length}:v=1:a=0[vbase]`);
    if (hasOriginalAudio) { filters.push(`${audioParts.join('')}concat=n=${segments.length}:v=0:a=1[abase]`); const originalVolume = item.muteOriginal ? 0 : Math.max(0, Math.min(300, Number(item.originalVolume) || 100)); filters.push(`[abase]volume=${originalVolume / 100},atrim=duration=${finalDuration}[amaster]`); }
    const mixInputs = hasOriginalAudio ? ['[amaster]'] : [];
    tracks.forEach((track, index) => { const inputIndex = index + 1; const position = Math.max(0, Math.min(finalDuration, Number(track.position) || 0)); const trimStart = Math.max(0, Number(track.trimStart) || 0); const requestedDuration = Math.max(.05, Number(track.duration) || finalDuration); const usableDuration = Math.max(.05, Math.min(requestedDuration, finalDuration - position)); const volume = Math.max(0, Math.min(300, Number(track.volume) || 100)); filters.push(`[${inputIndex}:a:0]atrim=start=${trimStart}:duration=${usableDuration},asetpts=PTS-STARTPTS,volume=${volume / 100},adelay=${Math.round(position * 1000)}:all=1[aext${index}]`); mixInputs.push(`[aext${index}]`); });
    if (mixInputs.length) filters.push(`${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=longest:dropout_transition=0,atrim=duration=${finalDuration}[aout]`);
    args.push('-filter_complex', filters.join(';'), '-map', '[vbase]'); if (mixInputs.length) args.push('-map', '[aout]'); else args.push('-an'); args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p'); if (mixInputs.length) args.push('-c:a', 'aac', '-b:a', '192k'); args.push('-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', output);
    return startFfmpegJob(event, videoEditJobs, item.id, args, output, finalDuration, 'video-editor-event');
  });
  ipcMain.handle('cancel-video-edit', (_event, id) => videoEditJobs.get(id)?.cancel?.());
  ipcMain.handle('start-image-conversion', async (event, item) => {
    if (!item?.id || !item.source || !item.folder || !fs.existsSync(item.source)) throw new Error('Dados da imagem inválidos.'); const format = ['jpg', 'png', 'webp'].includes(item.format) ? item.format : 'jpg'; const filename = availableFilename(item.folder, `${safeName(item.outputName || path.basename(item.source, path.extname(item.source)))}.${format}`, item.duplicate); const output = path.join(item.folder, filename); let cancelled = false; imageJobs.set(item.id, { cancel: () => { cancelled = true; } }); send(event.sender, 'image-event', { id: item.id, status: 'converting', percent: 10 });
    try { let pipeline = sharp(item.source).rotate(); const metadata = await sharp(item.source).metadata(); const { width, height } = imageDimensions(metadata, item); const quality = Math.max(1, Math.min(100, Number(item.quality) || 85)); if (width || height) pipeline = pipeline.resize(width, height, { fit: item.keepRatio === false ? 'fill' : 'inside', withoutEnlargement: false }); pipeline = applyLowQualityPixelation(pipeline, width, height, quality); if (format === 'jpg') pipeline = pipeline.flatten({ background: '#ffffff' }).jpeg({ quality }); if (format === 'png') pipeline = pipeline.png({ palette: true, quality, compressionLevel: 9 }); if (format === 'webp') pipeline = pipeline.webp({ quality }); await pipeline.toFile(output); imageJobs.delete(item.id); if (cancelled) { if (fs.existsSync(output)) fs.unlinkSync(output); throw new Error('Operação cancelada.'); } const stat = fs.statSync(output); send(event.sender, 'image-event', { id: item.id, status: 'complete', file: output, size: stat.size, filename }); return { file: output, size: stat.size, filename }; } catch (error) { imageJobs.delete(item.id); throw error; }
  });
  ipcMain.handle('cancel-image-conversion', (_event, id) => imageJobs.get(id)?.cancel?.());
  ipcMain.handle('start-compression', async (_event, item) => {
    if (!item?.source || !item?.folder || !fs.existsSync(item.source)) throw new Error('Arquivo ou pasta de destino inválidos.'); const ext = path.extname(item.source).toLowerCase(); const base = safeName(path.basename(item.source, ext));
    if (imageExtensions.includes(ext)) { const output = path.join(item.folder, availableFilename(item.folder, `${base} comprimido.jpg`, item.duplicate)); const quality = Math.max(1, Math.min(100, Number(item.imageQuality) || 60)); const scale = Math.max(.01, Number(item.imageScale || 100) / 100); const meta = await sharp(item.source).metadata(); await sharp(item.source).rotate().resize(Math.max(1, Math.round((meta.width || 1) * scale)), Math.max(1, Math.round((meta.height || 1) * scale))).jpeg({ quality }).toFile(output); const stat = fs.statSync(output); return { file: output, size: stat.size, kind: 'image' }; }
    const probe = JSON.parse(await run('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', item.source])); const isVideo = (probe.streams || []).some(stream => stream.codec_type === 'video'); const audioFormat = item.audioFormat === 'opus' ? 'opus' : 'mp3'; const output = path.join(item.folder, availableFilename(item.folder, `${base} comprimido.${isVideo ? 'mp4' : audioFormat}`, item.duplicate)); const args = ['-hide_banner', '-y', '-i', item.source];
    if (isVideo) { if (item.resolution && item.resolution !== 'original') args.push('-vf', `scale=-2:${Number(item.resolution)}`); if (item.fps) args.push('-r', String(Math.max(1, Number(item.fps)))); args.push('-c:v', 'libx264', '-crf', String(Math.max(0, Number(item.crf) || 30)), '-preset', 'veryfast', '-c:a', 'aac', '-b:a', `${Math.max(8, Number(item.audioBitrate) || 64)}k`); } else { args.push('-ac', item.mono ? '1' : '2', '-ar', String(Math.max(8000, Number(item.sampleRate) || 22050)), '-c:a', audioFormat === 'opus' ? 'libopus' : 'libmp3lame', '-b:a', `${Math.max(8, Number(item.audioBitrate) || 64)}k`); }
    args.push(output); await run('ffmpeg', args); const stat = fs.statSync(output); return { file: output, size: stat.size, kind: isVideo ? 'video' : 'audio' };
  });
  ipcMain.handle('screen-sources', async () => (await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } })).map(source => ({ id: source.id, name: source.name })));
  ipcMain.handle('screen-capture-save', (_event, folder, buffer) => saveRawScreenshot(folder, buffer));
  ipcMain.handle('screen-capture-copy', async (_event, buffer) => {
    const { data } = await inspectScreenshotBuffer(buffer);
    const image = nativeImage.createFromBuffer(data);
    if (image.isEmpty()) throw new Error('A imagem não pôde ser copiada.');
    clipboard.writeImage(image);
    return true;
  });
  ipcMain.handle('screen-capture-show-window', () => {
    return showScreenshotWindow();
  });
  ipcMain.handle('screen-recording-start', async (_event, options) => {
    if (!options?.folder) throw new Error('Escolha uma pasta para salvar a gravação.');
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`; const temp = path.join(app.getPath('temp'), `ntc-recording-${id}.webm`); const output = path.join(options.folder, recordingOutputName(options.folder));
    const stream = fs.createWriteStream(temp); recordingSessions.set(id, { id, temp, output, folder: options.folder, withAudio: Boolean(options.withAudio), quality: options.quality || 'equilibrada', resolution: options.resolution || 'original', stream }); return { id };
  });
  ipcMain.handle('screen-recording-chunk', (_event, id, chunk) => { const session = recordingSessions.get(id); if (!session || !chunk) throw new Error('Gravação não encontrada.'); return session.stream.write(Buffer.from(chunk)); });
  ipcMain.handle('screen-recording-stop', async (_event, id) => { const session = recordingSessions.get(id); if (!session) throw new Error('Gravação não encontrada.'); recordingSessions.delete(id); try { return await finalizeScreenRecording(session); } catch (error) { if (fs.existsSync(session.temp)) fs.unlinkSync(session.temp); throw new Error(`Não foi possível finalizar a gravação: ${error.message}`); } });
  ipcMain.handle('screen-recording-cancel', (_event, id) => { const session = recordingSessions.get(id); if (!session) return false; recordingSessions.delete(id); session.stream.destroy(); if (fs.existsSync(session.temp)) fs.unlinkSync(session.temp); return true; });
  ipcMain.handle('register-screen-shortcut', (_event, accelerator) => {
    const value = String(accelerator || '').trim();
    const restore = () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('screen-hotkey'); };
    const result = registerAppShortcut(value, screenShortcut, [screenshotShortcut, quickScreenshotShortcut], restore, restore);
    if (result.ok) screenShortcut = value;
    return result;
  });
  ipcMain.handle('unregister-screen-shortcut', () => { if (screenShortcut) globalShortcut.unregister(screenShortcut); screenShortcut = null; return true; });
  ipcMain.handle('register-screenshot-shortcut', (_event, accelerator) => {
    const value = String(accelerator || '').trim();
    const capture = async () => {
      if (screenshotShortcutBusy) return;
      screenshotShortcutBusy = true;
      try {
        const result = await captureDesktopScreenshot();
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('screenshot-hotkey-capture', result);
      } catch (error) {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('screenshot-hotkey-error', error.message || String(error));
      } finally { screenshotShortcutBusy = false; }
    };
    const restore = () => { void capture(); };
    const result = registerAppShortcut(value, screenshotShortcut, [screenShortcut, quickScreenshotShortcut], restore, restore);
    if (result.ok) screenshotShortcut = value;
    return result;
  });
  ipcMain.handle('unregister-screenshot-shortcut', () => { if (screenshotShortcut) globalShortcut.unregister(screenshotShortcut); screenshotShortcut = null; return true; });
  ipcMain.handle('register-quick-screenshot-shortcut', (_event, accelerator, folder) => {
    const value = String(accelerator || '').trim();
    if (!value) return { ok: false, message: 'Escolha uma tecla para o atalho.' };
    const destination = path.resolve(String(folder || app.getPath('downloads')));
    if (!fs.existsSync(destination) || !fs.statSync(destination).isDirectory()) return { ok: false, message: 'Escolha uma pasta válida para as capturas.' };
    const capture = async () => {
      if (quickScreenshotShortcutBusy) return;
      quickScreenshotShortcutBusy = true;
      try {
        const screenshot = await captureDesktopScreenshot();
        const match = /^data:image\/png;base64,([\s\S]+)$/.exec(screenshot.dataUrl || '');
        if (!match) throw new Error('A captura rápida não gerou uma imagem PNG válida.');
        const saved = await saveRawScreenshot(quickScreenshotFolder || destination, Buffer.from(match[1], 'base64'));
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('quick-screenshot-saved', saved);
        if ((!mainWindow || !mainWindow.isVisible()) && Notification.isSupported()) new Notification({ title: 'Captura rápida salva', body: saved.filename }).show();
      } catch (error) {
        const message = error.message || String(error);
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('quick-screenshot-error', message);
        if ((!mainWindow || !mainWindow.isVisible()) && Notification.isSupported()) new Notification({ title: 'Falha na captura rápida', body: message }).show();
      } finally { quickScreenshotShortcutBusy = false; }
    };
    const result = registerAppShortcut(value, quickScreenshotShortcut, [screenShortcut, screenshotShortcut], capture, capture);
    if (result.ok) { quickScreenshotShortcut = value; quickScreenshotFolder = destination; }
    return result;
  });
  ipcMain.handle('unregister-quick-screenshot-shortcut', () => { if (quickScreenshotShortcut) globalShortcut.unregister(quickScreenshotShortcut); quickScreenshotShortcut = null; quickScreenshotFolder = ''; return true; });
  configureUpdater(); createWindow(); if (app.isPackaged) setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 2500); app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('before-quit', () => {
  if (rngShutdownSaved) return;
  rngShutdownSaved = true;
  const now = rngMonotonicMs(); accountRngTime(now);
  if (rngAutoRollStartedAt) rngGame.lastAutoRollSessionSeconds = Math.floor((now - rngAutoRollStartedAt) / 1000);
  rngAutoRollStartedAt = 0; rngAutoAccountedAt = 0; rngNextAutoRollAt = 0;
  if (rngClock) clearInterval(rngClock);
  globalShortcut.unregisterAll();
  if (trayIcon) { trayIcon.destroy(); trayIcon = null; }
  persistRngGame();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
