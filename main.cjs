const { app, BrowserWindow, dialog, ipcMain, shell, clipboard, desktopCapturer, globalShortcut, screen, nativeImage, Notification, Tray, Menu, powerMonitor, safeStorage } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { autoUpdater } = require('electron-updater');
const sharp = require('sharp');
const { normalizeQrUrl, normalizeQrOptions, renderQr, saveQrImage } = require('./src/qr.cjs');
const { previewFileRenames, renameFiles } = require('./src/renamer-files.cjs');
const mediaProject = require('./src/media-project.js');
const videoProject = require('./src/video-project.js');
const { buildRenderPlan: buildVideoProjectRenderPlan } = require('./src/video-project-render.cjs');
const { writeTextPng } = require('./src/video-project-text.cjs');
const { POOL: rngPool, TIERS: rngTiers, TITLES: rngTitles, CATALOG_VERSION: rngCatalogVersion, collectionCatalogCount, SECRETS: rngSecrets, RNG_RELIC_REMOVAL_VERSION, RNG_SAVE_SCHEMA_VERSION, RNG_MANUAL_TIME_ACHIEVEMENT_SECONDS, RNG_AUTO_TIME_ACHIEVEMENT_SECONDS, normalizeState: normalizeRngState, validateProfileDisplayName, migrateRemovedMisfortuneRelics, achievementLuckRewardBps, luckForState, rollBatch: rollRngBatch, publicCatalog: publicRngCatalog, publicProgress: publicRngProgress, publicRelicState, purchasePermanentUpgrade, purchaseConsumable, activateConsumable, purchaseRelic, equipRelic, unequipRelic, advanceTimedBoost, debugGrantTitle, debugRemoveTitle, debugClearTitles, debugGrantTierTitles, debugGrantTotalTitles, debugReadyBonusRoll } = require('./src/rng.cjs');
const { createRngRollRouter } = require('./src/rng-engine-router.cjs');
const { grantAccountXp, getAccountProgress, countProcessedRolls } = require('./src/rng-account-level.cjs');
const { isFragmentRecyclingUnlocked, isAutoRollUnlocked, normalizeAcknowledgedSystemUnlocks, pendingAccountSystemUnlock, canAcknowledgeAccountSystemUnlock } = require('./src/rng-account-unlocks.cjs');
const { FRAGMENT_RECYCLING_VERSION, applyFragmentRecycling, migrateLegacyFragmentSave } = require('./src/rng-fragments.cjs');
const { normalizeRngAccountProgress, enhancedRecyclingSummary, purchaseEnhancedRecycling } = require('./src/rng-fragment-upgrades.cjs');
const { createManualRollCycleGate } = require('./src/rng-manual-roll-gate.cjs');
const { createInitialRngAccount, persistInitialRngAccount } = require('./src/rng-account-reset.cjs');
const selectedRngRollBatch = createRngRollRouter({ legacyRollBatch: rollRngBatch });
const { runLegacyRollWithShadow } = require('./src/rng-shadow-bridge.cjs');
const { createRngShadowService, isShadowEnabled, isShadowLoggingEnabled } = require('./src/rng-shadow-service.cjs');
const { buildPlayerProfileData } = require('./src/rng-profile.cjs');
const { createRngOnlineService, readOnlineConfig } = require('./src/rng-online.cjs');
const { TrustedClock } = require('./src/rng-time.cjs');
const { LIMITED_REWARDS, eventSchedule, activeEvent, joinEvent } = require('./src/rng-events.cjs');
const { initializeAutoClicker } = require('./src/autoclicker-main.cjs');
const { initializeColorPicker } = require('./src/color-picker-main.cjs');
const { initializeClipboardHistory } = require('./src/clipboard-main.cjs');
const { createSecurityService } = require('./src/security.cjs');
const { initializeDocumentsService } = require('./src/documents-main.cjs');
const { createStudyService } = require('./src/study-main.cjs');
const { initializeCatalogService } = require('./src/catalog-main.cjs');
const { AUDIO_EXTENSIONS, normalizeMusicFolders, normalizeMusicFiles, scanMusicFolders, scanMusicFiles, deriveMusicSearchCandidates, findMusicReleaseCandidates } = require('./src/music-library.cjs');
const { registerMusicService } = require('./src/music-service.cjs');
const { MusicSearchCache } = require('./src/music-search-cache.cjs');
const { AmbientPackService } = require('./src/ambient-packs.cjs');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (!app.isPackaged) app.setPath('userData', path.join(__dirname, '.ntc-data'));
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (hasSingleInstanceLock) {
  app.on('second-instance', () => {
    if (!showMainWindow() && app.isReady()) createWindow();
  });
}
const downloadJobs = new Map();
const videoJobs = new Map();
const imageJobs = new Map();
const mediaProjectJobs = new Map();
const videoProjectPreviewCache = new Map();
const videoProjectPreviewJobs = new Map();
const videoProjectFilmstripCache = new Map();
let videoProjectFile = '';
let videoProjectRecoveryQueue = Promise.resolve();
let videoEditorWindowState = null;
const recordingSessions = new Map();
let mainWindow = null;
let profileCardWindow = null;
let rngOnlineService = null;
let rngShadowService = null;
let rngOnlineQuitReady = false;
let rngOnlineQuitStarted = false;
let trayIcon = null;
let musicMiniWindow = null;
let musicControlState = { title: '', artist: '', album: '', cover: '', coverFit: 'contain', playing: false, time: 0, duration: 0, volume: .8, muted: false, alwaysOnTop: false };
let musicLibraryService = null;
let ambientPackService = null;
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
let rngAccountProgress = normalizeRngAccountProgress();
let rngAccountSystemUnlocksAcknowledged = [];
const rngManualRollGate = createManualRollCycleGate();
let rngAppSessionStartedAt = 0;
let rngAppAccountedAt = 0;
let rngAutoRollStartedAt = 0;
let rngAutoAccountedAt = 0;
let rngNextAutoRollAt = 0;
let rngClock = null;
let rngLastPersistAt = 0;
let rngLastBoostBroadcastAt = 0;
let rngShutdownSaved = false;
let rngLatestResult = null;
let rngLatestResults = [];
let rngLatestUnlocks = [];
let rngLatestBatchSize = 0;
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
let autoClickerService = null;
let colorPickerService = null;
let clipboardHistoryService = null;
let musicBrainzQueue = Promise.resolve();
let musicBrainzLastRequestAt = 0;
const musicOnlineSearchCache = new MusicSearchCache({ maxEntries: 32, maxBytes: 20 * 1024 * 1024, ttlMs: 30 * 60 * 1000 });
const hosts = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'];
const audioExtensions = ['.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg', '.opus', '.wma'];
const videoExtensions = ['.mp4', '.mkv', '.mov', '.avi', '.webm', '.wmv', '.m4v'];
const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tif', '.tiff', '.avif', '.heic', '.heif'];

function isSupportedUrl(value) { try { return hosts.includes(new URL(value).hostname); } catch { return false; } }
function send(sender, channel, payload) { if (!sender.isDestroyed()) sender.send(channel, payload); }
function assertMainWindowSender(event) { if (!mainWindow || mainWindow.isDestroyed() || event?.sender !== mainWindow.webContents) throw new Error('Solicitação de projeto de mídia inválida.'); }
function rngStatePath() { return path.join(app.getPath('userData'), 'ntc-rng-state.json'); }
function rngBackupPath() { return path.join(app.getPath('userData'), 'ntc-rng-state.backup.json'); }
function musicFoldersPath() { return path.join(app.getPath('userData'), 'ntc-music-folders.json'); }
function musicFilesPath() { return path.join(app.getPath('userData'), 'ntc-music-files.json'); }
function removedMusicFilesPath() { return path.join(app.getPath('userData'), 'ntc-music-removed-files.json'); }
function worldClockSettingsPath() { return path.join(app.getPath('userData'), 'ntc-world-clock-settings.json'); }
function normalizeWorldClockSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const cities = (Array.isArray(value.cities) ? value.cities : []).slice(0, 12).flatMap(city => {
    if (!city || typeof city !== 'object') return [];
    const latitude = Number(city.latitude); const longitude = Number(city.longitude);
    if (typeof city.name !== 'string' || !city.name.trim() || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return [];
    return [{ id: String(city.id || `${latitude},${longitude}`).slice(0, 100), name: city.name.trim().slice(0, 100), country: String(city.country || '').slice(0, 100), latitude, longitude, timezone: String(city.timezone || 'UTC').slice(0, 100) }];
  });
  const alarms = (Array.isArray(value.alarms) ? value.alarms : []).slice(0, 100).flatMap(alarm => {
    if (!alarm || typeof alarm !== 'object' || typeof alarm.time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(alarm.time)) return [];
    const weekdays = [...new Set((Array.isArray(alarm.weekdays) ? alarm.weekdays : []).map(Number).filter(day => Number.isInteger(day) && day >= 0 && day <= 6))];
    return [{ id: String(alarm.id || `${Date.now()}-${Math.random()}`).slice(0, 100), time: alarm.time, label: String(alarm.label || 'Alarme').slice(0, 48), weekdays, enabled: Boolean(alarm.enabled), lastTriggered: String(alarm.lastTriggered || '').slice(0, 10) }];
  });
  const timer = value.timer && typeof value.timer === 'object' ? value.timer : {};
  const stopwatch = value.stopwatch && typeof value.stopwatch === 'object' ? value.stopwatch : {};
  const numberInRange = (candidate, max) => Number.isFinite(Number(candidate)) ? Math.max(0, Math.min(max, Number(candidate))) : 0;
  return {
    version: 1,
    cities,
    alarms,
    timer: { remainingMs: numberInRange(timer.remainingMs, 3_600_000_000), endAt: numberInRange(timer.endAt, 9_999_999_999_999), running: Boolean(timer.running), paused: Boolean(timer.paused) },
    stopwatch: { elapsed: numberInRange(stopwatch.elapsed, Number.MAX_SAFE_INTEGER), startedAt: numberInRange(stopwatch.startedAt, 9_999_999_999_999), running: Boolean(stopwatch.running), laps: (Array.isArray(stopwatch.laps) ? stopwatch.laps : []).slice(0, 100).map(lap => numberInRange(lap, Number.MAX_SAFE_INTEGER)) },
    activeTab: ['world', 'alarms', 'timer', 'stopwatch'].includes(value.activeTab) ? value.activeTab : 'world'
  };
}
function readWorldClockSettings() {
  try { return normalizeWorldClockSettings(JSON.parse(fs.readFileSync(worldClockSettingsPath(), 'utf8'))); }
  catch { return null; }
}
function saveWorldClockSettings(value) {
  const normalized = normalizeWorldClockSettings(value);
  if (!normalized) throw new Error('Preferências de relógios inválidas.');
  const file = worldClockSettingsPath(); const temporary = `${file}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(temporary, JSON.stringify(normalized));
  fs.renameSync(temporary, file);
  return true;
}
function musicPathKey(file) { const resolved = path.resolve(file); return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved; }
function readRemovedMusicFiles() {
  try { return normalizeMusicFiles(JSON.parse(fs.readFileSync(removedMusicFilesPath(), 'utf8'))); }
  catch { return []; }
}
function saveRemovedMusicFiles(files) {
  const file = removedMusicFilesPath();
  const temporary = `${file}.tmp`;
  const normalized = normalizeMusicFiles(files);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(temporary, JSON.stringify(normalized));
  fs.renameSync(temporary, file);
  return normalized;
}
function readMusicFolders() {
  try { return normalizeMusicFolders(JSON.parse(fs.readFileSync(musicFoldersPath(), 'utf8'))); }
  catch { return []; }
}
function readMusicFiles() {
  try { return normalizeMusicFiles(JSON.parse(fs.readFileSync(musicFilesPath(), 'utf8'))); }
  catch { return []; }
}
function saveMusicFolders(folders) {
  const file = musicFoldersPath();
  const temporary = `${file}.tmp`;
  const normalized = normalizeMusicFolders(folders);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(temporary, JSON.stringify(normalized));
  fs.renameSync(temporary, file);
  return normalized;
}
function saveMusicFiles(files) {
  const file = musicFilesPath();
  const temporary = `${file}.tmp`;
  const normalized = normalizeMusicFiles(files);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(temporary, JSON.stringify(normalized));
  fs.renameSync(temporary, file);
  return normalized;
}
function addMusicFiles(files) {
  const incoming = normalizeMusicFiles(files);
  const available = [];
  for (const file of incoming) {
    try {
      const realFile = fs.realpathSync(file);
      if (!fs.statSync(realFile).isFile() || !AUDIO_EXTENSIONS.has(path.extname(realFile).toLowerCase())) continue;
      available.push(realFile);
    } catch { /* Ignore dropped paths that disappeared before import. */ }
  }
  if (!available.length) throw new Error('Solte ou selecione arquivos de áudio compatíveis que ainda existam no PC.');
  const saved = saveMusicFiles([...readMusicFiles(), ...available]);
  const restored = new Set(available.map(musicPathKey));
  saveRemovedMusicFiles(readRemovedMusicFiles().filter(file => !restored.has(musicPathKey(file))));
  return saved;
}
function removeMusicTrack(filePath) {
  if (typeof filePath !== 'string' || !AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase())) throw new Error('Faixa inválida.');
  const resolved = path.resolve(filePath);
  const key = musicPathKey(resolved);
  saveRemovedMusicFiles([...readRemovedMusicFiles(), resolved]);
  saveMusicFiles(readMusicFiles().filter(file => musicPathKey(file) !== key));
  return true;
}
function loadRngGame() {
  let savedState = null;
  let backupState = null;
  try { backupState = JSON.parse(fs.readFileSync(rngBackupPath(), 'utf8')); } catch { backupState = null; }
  try {
    savedState = JSON.parse(fs.readFileSync(rngStatePath(), 'utf8'));
  } catch {
    try {
      savedState = backupState || JSON.parse(fs.readFileSync(rngBackupPath(), 'utf8'));
      fs.mkdirSync(path.dirname(rngStatePath()), { recursive: true });
      fs.copyFileSync(rngBackupPath(), rngStatePath());
    } catch { savedState = null; }
  }
  const savedAccountProgress = savedState?.accountProgress
    || (savedState && Object.hasOwn(savedState, 'lifetimeAccountXp') ? savedState : null)
    || backupState?.accountProgress
    || (backupState && Object.hasOwn(backupState, 'lifetimeAccountXp') ? backupState : null);
  rngAccountProgress = normalizeRngAccountProgress(savedAccountProgress || {});
  rngAccountSystemUnlocksAcknowledged = normalizeAcknowledgedSystemUnlocks(savedState?.accountSystemUnlocksAcknowledged ?? backupState?.accountSystemUnlocksAcknowledged);
  const migrateEmbeddedAccountProgress = Boolean(savedState && !savedState.accountProgress && Object.hasOwn(savedState, 'lifetimeAccountXp'));
  const savedRelicVersion = Math.max(Number(savedState?.relicRemovalVersion) || 0, Number(savedState?.droughtRelicProgressVersion) || 0);
  const savedSchemaVersion = Number(savedState?.schemaVersion) || 0;
  const relicMigratedState = savedState ? migrateRemovedMisfortuneRelics(savedState, backupState) : null;
  const fragmentMigration = savedState ? migrateLegacyFragmentSave(relicMigratedState || {}) : { state: relicMigratedState, migrated: false };
  rngGame = normalizeRngState(fragmentMigration.state || {});
  if (savedState && (savedRelicVersion < RNG_RELIC_REMOVAL_VERSION || savedSchemaVersion < RNG_SAVE_SCHEMA_VERSION || migrateEmbeddedAccountProgress || fragmentMigration.migrated)) persistRngGame();
}
function accountRngTime(now = rngMonotonicMs()) {
  if (rngAppAccountedAt) { const elapsed = Math.floor((now - rngAppAccountedAt) / 1000); if (elapsed > 0) { rngGame.totalAppSeconds += elapsed; rngGame = advanceTimedBoost(rngGame, elapsed); rngAppAccountedAt += elapsed * 1000; } }
  if (rngAutoRollStartedAt && rngAutoAccountedAt) { const elapsed = Math.floor((now - rngAutoAccountedAt) / 1000); if (elapsed > 0) { rngGame.totalAutoRollSeconds += elapsed; rngAutoAccountedAt += elapsed * 1000; rngGame.lastAutoRollSessionSeconds = Math.floor((now - rngAutoRollStartedAt) / 1000); } }
}
function pauseRngAutoRoll(now = rngMonotonicMs()) {
  if (!rngAutoRollStartedAt) return false;
  accountRngTime(now);
  rngGame.lastAutoRollSessionSeconds = Math.max(0, Math.floor((now - rngAutoRollStartedAt) / 1000));
  rngAutoRollStartedAt = 0; rngAutoAccountedAt = 0; rngNextAutoRollAt = 0;
  return true;
}
function persistRngGame() {
  try {
    const file = rngStatePath(); const temporary = `${file}.tmp`; const backup = rngBackupPath(); const backupTemporary = `${backup}.tmp`; const serialized = JSON.stringify({ ...rngGame, fragmentRecyclingVersion: FRAGMENT_RECYCLING_VERSION, accountProgress: { schemaVersion: 1, ...rngAccountProgress }, accountSystemUnlocksAcknowledged: rngAccountSystemUnlocksAcknowledged });
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
function resetRngAccountState() {
  const initial = createInitialRngAccount();
  persistInitialRngAccount({ statePath: rngStatePath(), backupPath: rngBackupPath(), ...initial });

  rngManualRollGate.cancel();
  const now = rngMonotonicMs();
  rngGame = initial.rngGame;
  rngAccountProgress = initial.accountProgress;
  rngAccountSystemUnlocksAcknowledged = [];
  rngAppSessionStartedAt = now; rngAppAccountedAt = now; rngAppSessionBaselineSeconds = 0;
  rngAutoRollStartedAt = 0; rngAutoAccountedAt = 0; rngNextAutoRollAt = 0;
  rngSessionRolls = 0; rngSessionNewTitles = 0; rngSessionBestOdds = 0n;
  rngLatestResult = null; rngLatestResults = []; rngLatestUnlocks = []; rngLatestBatchSize = 0;
  rngLastEventWindowId = null; rngNextEventCheckAt = 0;
  rngLastTimeSync = now; rngLastHeartbeatAt = now; rngLastBoostBroadcastAt = 0; rngLastPersistAt = now;

  sendRngState();
  updateTrayStatus();
  return rngSnapshot(now);
}
function makeRngAchievement(id, category, name, description, value, goal, rewardText = '') {
  return { id, category, name, description, unlocked: value >= goal, progress: Math.min(value, goal), goal, rewardText, luckBonusBps: achievementLuckRewardBps(id) };
}
function buildRngAchievements() {
  const collected = new Set(rngGame.collectedIds);
  const hasTier = tierId => rngTitles.some(title => title.tier === tierId && collected.has(title.id));
  const achievements = [
    makeRngAchievement('rolls-1', 'Rolagens', 'A primeira de muitas', 'Faça sua primeira rolagem', rngGame.totalRolls, 1),
    makeRngAchievement('rolls-100', 'Rolagens', 'Aquecimento', 'Faça 100 rolagens', rngGame.totalRolls, 100),
    makeRngAchievement('rolls-1000', 'Rolagens', 'Persistência', 'Faça 1.000 rolagens', rngGame.totalRolls, 1_000),
    makeRngAchievement('rolls-10000', 'Rolagens', 'Dez mil destinos', 'Faça 10.000 rolagens', rngGame.totalRolls, 10_000),
    makeRngAchievement('rolls-50000', 'Rolagens', 'Cinco dígitos', 'Faça 50.000 rolagens', rngGame.totalRolls, 50_000),
    makeRngAchievement('rolls-100000', 'Rolagens', 'Lenda incansável', 'Faça 100.000 rolagens', rngGame.totalRolls, 100_000),
    makeRngAchievement('rolls-500000', 'Rolagens', 'Meio milhão de destinos', 'Faça 500.000 rolagens', rngGame.totalRolls, 500_000),
    makeRngAchievement('rolls-1000000', 'Rolagens', 'Um milhão de destinos', 'Faça 1.000.000 de rolagens', rngGame.totalRolls, 1_000_000),
    makeRngAchievement('rolls-5000000', 'Rolagens', 'Cinco milhões de destinos', 'Faça 5.000.000 de rolagens', rngGame.totalRolls, 5_000_000),
    makeRngAchievement('rolls-10000000', 'Rolagens', 'Dez milhões de destinos', 'Faça 10.000.000 de rolagens', rngGame.totalRolls, 10_000_000),
    makeRngAchievement('manual-rolls-1000', 'Rolagens manuais', 'Mil cliques', 'Clique em Rolar 1.000 vezes', rngGame.manualRolls, 1_000),
    makeRngAchievement('manual-rolls-10000', 'Rolagens manuais', 'Dez mil cliques', 'Clique em Rolar 10.000 vezes', rngGame.manualRolls, 10_000),
    makeRngAchievement('manual-rolls-50000', 'Rolagens manuais', 'Mão firme', 'Clique em Rolar 50.000 vezes', rngGame.manualRolls, 50_000),
    makeRngAchievement('manual-rolls-100000', 'Rolagens manuais', 'Dedicação manual', 'Clique em Rolar 100.000 vezes', rngGame.manualRolls, 100_000),
    makeRngAchievement('manual-rolls-250000', 'Rolagens manuais', 'Um quarto de milhão de cliques', 'Clique em Rolar 250.000 vezes', rngGame.manualRolls, 250_000),
    makeRngAchievement('manual-rolls-1000000', 'Rolagens manuais', 'Um milhão de cliques', 'Clique em Rolar 1.000.000 de vezes', rngGame.manualRolls, 1_000_000),
    makeRngAchievement('unique-10', 'Coleção', 'Começando a coleção', 'Descubra 10 títulos diferentes', collected.size, 10),
    makeRngAchievement('unique-25', 'Coleção', 'Coleção em expansão', 'Descubra 25 títulos diferentes', collected.size, 25),
    makeRngAchievement('unique-50', 'Coleção', 'Colecionador', 'Descubra 50 títulos diferentes', collected.size, 50, 'Desbloqueia 2 rolagens por clique e a Medalha do Cartógrafo'),
    makeRngAchievement('unique-75', 'Coleção', 'Caçador de títulos', 'Descubra 75 títulos diferentes', collected.size, 75),
    makeRngAchievement('unique-100', 'Coleção', 'Metade do caminho', 'Descubra 100 títulos diferentes', collected.size, 100, 'Desbloqueia 3 rolagens por clique'),
    makeRngAchievement('unique-125', 'Coleção', 'Coleção avançada', 'Descubra 125 títulos diferentes', collected.size, 125),
    makeRngAchievement('unique-150', 'Coleção', 'Quase lendário', 'Descubra 150 títulos diferentes', collected.size, 150),
    makeRngAchievement('unique-200', 'Coleção', 'Marco de 200 títulos', 'Descubra 200 títulos diferentes', collected.size, 200, 'Receba o Atlas das Possibilidades')
  ];
  for (const tier of rngTiers) {
    if (tier.id === 'basic') continue;
    const unlocked = hasTier(tier.id);
    achievements.push(makeRngAchievement('tier-' + tier.id, 'Raridades', 'Primeiro ' + tier.label, 'Encontre um título ' + tier.label, unlocked ? 1 : 0, 1));
  }
  achievements.push(
    makeRngAchievement('streak-repeat-7', 'Marcos de sorte', 'Disco riscado', 'Consiga o mesmo título 7 vezes seguidas', rngGame.longestSameTitleStreak, 7),
    makeRngAchievement('drought-10000', 'Marcos de sorte', 'A maré vira', 'Passe 10.000 rolagens sem obter Singular+', rngGame.longestSingularDrought, 10_000),
    makeRngAchievement('multiplier-100', 'Marcos de sorte', 'Sorte improvável', 'Alcance um multiplicador de ×100', rngGame.maxMultiplier, 100),
    makeRngAchievement('events-1', 'Eventos', 'Na hora certa', 'Participe de um evento', rngGame.eventsParticipated, 1),
    makeRngAchievement('events-5', 'Eventos', 'Presença frequente', 'Participe de 5 eventos', rngGame.eventsParticipated, 5),
    makeRngAchievement('events-10', 'Eventos', 'Presença constante', 'Participe de 10 eventos', rngGame.eventsParticipated, 10),
    makeRngAchievement('events-25', 'Eventos', 'Figura conhecida', 'Participe de 25 eventos', rngGame.eventsParticipated, 25),
    makeRngAchievement('limited-title', 'Eventos', 'Edição especial', 'Obtenha um título limitado de evento', rngGame.limitedTitles.length, 1)
  );
  const manualSeconds = Math.max(0, rngGame.totalAppSeconds - rngGame.totalAutoRollSeconds);
  const timeSecrets = [
    makeRngAchievement('time-manual-100h', 'Segredos', 'Guardião da Vigília', 'Mantenha o NTC aberto por 100 horas sem a rolagem automática', Math.floor(manualSeconds / 3600), 100),
    makeRngAchievement('time-auto-1000h', 'Segredos', 'Autômato Eterno', 'Acumule 1.000 horas com a rolagem automática ativa', Math.floor(rngGame.totalAutoRollSeconds / 3600), 1_000)
  ].filter(achievement => achievement.unlocked);
  achievements.push(...timeSecrets);
  const completedAchievements = achievements.filter(achievement => achievement.unlocked).length;
  achievements.push(
    makeRngAchievement('achievement-count-10', 'Conquistas', 'Primeiros marcos', 'Conclua 10 outras conquistas do RNG', completedAchievements, 10),
    makeRngAchievement('achievement-count-25', 'Conquistas', 'Caçador de conquistas', 'Conclua 25 outras conquistas do RNG', completedAchievements, 25),
    makeRngAchievement('achievement-count-40', 'Conquistas', 'Mestre dos desafios', 'Conclua 40 outras conquistas do RNG', completedAchievements, 40)
  );
  return achievements;
}
function rngSnapshot(now = rngMonotonicMs()) {
  accountRngTime(now);
  const localHour = new Date().getHours();
  const luck = luckForState(rngGame, { localHour });
  const trustedUtc = rngTrustedClock.now();
  const participation = activeEvent(trustedUtc, rngGame.participation);
  const achievements = buildRngAchievements();
  const snapshot = {
    tiers: rngTiers,
    catalog: publicRngCatalog(rngGame, { localHour }),
    debugCatalog: app.isPackaged ? undefined : rngTitles.map(title => ({ id: title.id, name: title.name, tier: title.tier })),
    collectedIds: rngGame.collectedIds,
    recentDiscoveries: rngGame.recentDiscoveries,
    titleHistory: rngGame.titleHistory,
    achievements,
    achievementsTotal: achievements.length + 2,
    secrets: rngSecrets.filter(secret => rngGame.unlockedSecrets.includes(secret.id)),
    limitedTitles: LIMITED_REWARDS.filter(reward => rngGame.limitedTitles.includes(reward.titleId)),
    fragments: isFragmentRecyclingUnlocked(rngAccountProgress.accountLevel) ? rngGame.fragmentBalance : '0',
    fragmentRecyclingUnlocked: isFragmentRecyclingUnlocked(rngAccountProgress.accountLevel),
    permanentUpgradeLevels: rngGame.permanentUpgradeLevels,
    permanentLuckBps: luck.permanentLuckBps,
    nextPermanentUpgradeCost: rngGame.nextPermanentUpgradeCost,
    consumableInventory: rngGame.consumableInventory,
    activeBoost: rngGame.activeBoost,
    parallelBoost: rngGame.parallelBoost,
    boostQueue: rngGame.boostQueue,
    relics: publicRelicState(rngGame, { localHour }),
    statistics: { measuredRolls: rngGame.trackedRolls, tierRolls: rngGame.tierRolls, duplicates: rngGame.duplicateRolls, uniqueTitles: rngGame.collectedIds.length, averageLuck: rngGame.luckBpsSamples ? rngGame.luckBpsSum / rngGame.luckBpsSamples / 10_000 : null, maxMultiplier: rngGame.maxMultiplier, sinceSingular: rngGame.sinceSingular, longestSingularDrought: rngGame.longestSingularDrought, longestSameTitleStreak: rngGame.longestSameTitleStreak, rarestTitle: rngTitles.find(title => title.id === rngGame.rarestTitleId)?.name || null, rarestTitleId: rngGame.rarestTitleId, rarestOdds: rngGame.rarestOdds, luckiestOdds: rngGame.luckiestOdds, luckiestRoll: rngGame.luckiestRoll, bestSession: rngGame.sessionBest },
    session: { rolls: rngSessionRolls, newTitles: rngSessionNewTitles, bestOdds: String(rngSessionBestOdds) },
    timeVerification: rngTrustedClock.status(),
    eventSchedule: trustedUtc === null ? [] : eventSchedule(trustedUtc),
    activeEvent: participation,
    eventRollProgress: rngGame.eventRollProgress,
    ...publicRngProgress(rngGame, { localHour }),
    profile: rngGame.profile,
    eventsParticipated: rngGame.eventsParticipated,
    lastTitleId: rngGame.lastTitleId,
    totalRolls: rngGame.totalRolls,
    accountProgress: { ...getAccountProgress(rngAccountProgress), enhancedRecyclingLevel: rngAccountProgress.enhancedRecyclingLevel },
    enhancedRecycling: enhancedRecyclingSummary(rngAccountProgress.enhancedRecyclingLevel, rngAccountProgress.accountLevel),
    accountSystemUnlocksAcknowledged: [...rngAccountSystemUnlocksAcknowledged],
    pendingAccountSystemUnlock: pendingAccountSystemUnlock(rngAccountProgress.accountLevel, rngAccountSystemUnlocksAcknowledged)?.id || null,
    autoRollUnlocked: isAutoRollUnlocked(rngAccountProgress.accountLevel),
    totalTitles: collectionCatalogCount(rngGame),
    catalogVersion: rngCatalogVersion,
    totalAppSeconds: rngGame.totalAppSeconds,
    appSessionStartedAt: rngAppSessionStartedAt,
    appSessionSeconds: rngGame.totalAppSeconds - rngAppSessionBaselineSeconds,
    totalAutoRollSeconds: rngGame.totalAutoRollSeconds,
    autoRollStartedAt: rngAutoRollStartedAt || 0,
    autoRollSessionSeconds: rngAutoRollStartedAt ? Math.floor((now - rngAutoRollStartedAt) / 1000) : rngGame.lastAutoRollSessionSeconds,
    autoRollActive: Boolean(rngAutoRollStartedAt),
    latestResult: rngLatestResult,
    latestResults: rngLatestResults,
    latestUnlocks: rngLatestUnlocks,
    latestBatchSize: rngLatestBatchSize,
    passiveLuckBps: luck.passiveBps,
    achievementLuckBps: luck.achievementBonusBps,
    secretLuckBps: luck.secretBonusBps,
    relicLuckMultiplierBps: luck.relicLuckMultiplierBps,
    totalLuckBps: luck.totalBps,
    totalLuckBpsExact: luck.exactTotalBps,
    rollsPerCycle: publicRngProgress(rngGame, { localHour }).rollsPerCycle,
    bonusMultiplier: luck.bonusMultiplier,
    bonusRollEvery: luck.bonusRollEvery,
    snapshotAt: now
  };
  snapshot.playerProfile = buildPlayerProfileData({ ...snapshot, luckMetrics: rngGame.luckMetrics });
  return snapshot;
}
const RNG_PROFILE_CARD_FORMATS = Object.freeze({ landscape: { width: 1920, height: 1080 }, portrait: { width: 1080, height: 1350 } });
async function renderRngProfileCard(format) {
  const dimensions = RNG_PROFILE_CARD_FORMATS[format];
  if (!dimensions) throw new Error('Formato de ficha inválido.');
  if (profileCardWindow && !profileCardWindow.isDestroyed()) profileCardWindow.destroy();
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const renderScale = Math.min(1, Math.max(0.5, Math.min((workArea.width - 48) / dimensions.width, (workArea.height - 48) / dimensions.height)));
  const renderWidth = Math.round(dimensions.width * renderScale);
  const renderHeight = Math.round(dimensions.height * renderScale);
  const cardWindow = new BrowserWindow({
    show: false,
    width: renderWidth,
    height: renderHeight,
    useContentSize: true,
    frame: false,
    resizable: false,
    backgroundColor: '#090809',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
  });
  profileCardWindow = cardWindow;
  try {
    await cardWindow.loadFile(path.join(__dirname, 'src', 'rng-profile-card.html'));
    const profileData = buildPlayerProfileData({ ...rngSnapshot(), luckMetrics: rngGame.luckMetrics });
    const payload = JSON.stringify(profileData).replace(/</g, '\\u003c');
    const ready = await cardWindow.webContents.executeJavaScript(`window.renderRngProfileCard(${payload}, ${JSON.stringify(format)}, ${renderScale})`, true);
    if (!ready) throw new Error('A ficha não terminou de renderizar.');
    cardWindow.webContents.invalidate();
    await new Promise(resolve => setTimeout(resolve, 120));
    const image = await cardWindow.webContents.capturePage(undefined, { stayHidden: true });
    if (image.isEmpty()) throw new Error('Não foi possível capturar a ficha renderizada.');
    const png = await sharp(image.toPNG()).resize(dimensions.width, dimensions.height, { fit: 'fill', kernel: sharp.kernel.lanczos3 }).png({ compressionLevel: 9 }).toBuffer();
    return { png: new Uint8Array(png), width: dimensions.width, height: dimensions.height };
  } finally {
    if (!cardWindow.isDestroyed()) cardWindow.destroy();
    if (profileCardWindow === cardWindow) profileCardWindow = null;
  }
}
async function validateRngProfileCard(value) {
  if (!(Buffer.isBuffer(value) || value instanceof Uint8Array) || value.byteLength < 64 || value.byteLength > 30 * 1024 * 1024) throw new Error('Imagem da ficha inválida.');
  const buffer = Buffer.from(value);
  const metadata = await sharp(buffer, { limitInputPixels: 5_000_000 }).metadata();
  const dimensions = Object.values(RNG_PROFILE_CARD_FORMATS).some(size => size.width === metadata.width && size.height === metadata.height);
  if (metadata.format !== 'png' || !dimensions) throw new Error('A ficha precisa ser um PNG válido em uma das dimensões suportadas.');
  return buffer;
}
function sendRngState() {
  const snapshot = rngSnapshot();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('rng-state', snapshot);
  rngOnlineService?.observe(snapshot);
}
function performRngRoll({ manual = false } = {}) {
  if (pendingAccountSystemUnlock(rngAccountProgress.accountLevel, rngAccountSystemUnlocksAcknowledged)) {
    if (pauseRngAutoRoll()) { persistRngGame(); sendRngState(); updateTrayStatus(); }
    return [];
  }
  const rolledAt = rngTrustedClock.now();
  const participation = activeEvent(rolledAt, rngGame.participation);
  const autoRollSeconds = rngAutoRollStartedAt ? Math.floor((rngMonotonicMs() - rngAutoRollStartedAt) / 1000) : 0;
  const rawOutcome = runLegacyRollWithShadow({
    legacyRoll: () => selectedRngRollBatch(rngGame, undefined, { rolledAt, event: participation, autoRollSeconds, localHour: new Date().getHours() }),
    manual,
    shadowService: rngShadowService
  });
  const outcome = applyFragmentRecycling({
    startingState: rngGame,
    outcome: rawOutcome,
    lifetimeXp: rngAccountProgress.lifetimeAccountXp,
    pool: rngPool,
    enhancedRecyclingLevel: rngAccountProgress.enhancedRecyclingLevel,
    enhancedRecyclingRemainderBps: rngAccountProgress.enhancedRecyclingRemainderBps
  });
  rngAccountProgress.enhancedRecyclingRemainderBps = outcome.enhancedRecyclingRemainderBps;
  const processedRollCount = countProcessedRolls(rngGame.totalRolls, outcome.state.totalRolls);
  const processedRollCountForSession = Number(processedRollCount);
  if (!Number.isSafeInteger(processedRollCountForSession)) throw new RangeError('Session roll count exceeds the safe integer limit.');
  rngAccountProgress = grantAccountXp(rngAccountProgress, processedRollCount);
  rngGame = outcome.state;
  const autoPausedForUnlock = Boolean(rngAutoRollStartedAt && pendingAccountSystemUnlock(rngAccountProgress.accountLevel, rngAccountSystemUnlocksAcknowledged) && pauseRngAutoRoll());
  rngSessionRolls += processedRollCountForSession;
  rngSessionNewTitles += outcome.results.filter(result => result.isNew).length;
  for (const result of outcome.results) {
    const resultTitle = rngTitles.find(title => title.id === result.title.id);
    const denominator = resultTitle?.denominator || (resultTitle?.baseWeight ? rngPool / resultTitle.baseWeight : 0n);
    if (denominator > rngSessionBestOdds) rngSessionBestOdds = denominator;
  }
  if (rngSessionRolls > rngGame.sessionBest.rolls) rngGame.sessionBest = { rolls: rngSessionRolls, newTitles: rngSessionNewTitles, bestOdds: String(rngSessionBestOdds) };
  const publicResults = outcome.results.map(result => ({
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
    consumableMultiplier: result.consumableMultiplier,
    rolledAt: result.rolledAt,
    eventName: result.eventName,
    eventMultiplier: result.eventMultiplier,
    eventFocusTierLabel: result.eventFocusTierLabel,
    eventFocusMultiplier: result.eventFocusMultiplier,
    specialUnlocks: result.specialUnlocks,
    fragmentReward: result.fragmentReward,
    consumableBoostType: result.consumableBoostType,
    consumableBoostTypes: result.consumableBoostTypes,
    consumableBoostMultiplier: result.consumableBoostMultiplier
  }));
  rngLatestBatchSize = publicResults.length;
  rngLatestUnlocks = publicResults.filter(result => result.isNew || result.specialUnlocks?.length).map(result => ({ ...result, specialUnlocks: result.specialUnlocks || [] }));
  rngLatestResults = publicResults.slice(-12);
  rngLatestResult = rngLatestResults[rngLatestResults.length - 1] || null;
  if (manual) rngGame.manualRolls++;
  persistRngGame();
  sendRngState();
  if (autoPausedForUnlock) updateTrayStatus();
  return rngLatestResults;
}
function startRngClock() {
  const now = rngMonotonicMs(); rngAppSessionStartedAt = now; rngAppAccountedAt = now; rngLastPersistAt = now; rngLastBoostBroadcastAt = now; rngAppSessionBaselineSeconds = rngGame.totalAppSeconds; rngLastHeartbeatAt = now;
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
    if ((rngGame.activeBoost?.type === 'time' || rngGame.parallelBoost?.type === 'time') && tick - rngLastBoostBroadcastAt >= 1000) { accountRngTime(tick); rngLastBoostBroadcastAt = tick; sendRngState(); }
    if (rngAutoRollStartedAt && tick >= rngNextAutoRollAt) { rngNextAutoRollAt = tick + 1000; performRngRoll(); }
    if (tick - rngLastPersistAt >= 5000) {
      const manualSecondsBeforeAccounting = Math.max(0, rngGame.totalAppSeconds - rngGame.totalAutoRollSeconds);
      const autoSecondsBeforeAccounting = rngGame.totalAutoRollSeconds;
      accountRngTime(tick);
      const manualSecretJustUnlocked = manualSecondsBeforeAccounting < RNG_MANUAL_TIME_ACHIEVEMENT_SECONDS && Math.max(0, rngGame.totalAppSeconds - rngGame.totalAutoRollSeconds) >= RNG_MANUAL_TIME_ACHIEVEMENT_SECONDS;
      const autoSecretJustUnlocked = autoSecondsBeforeAccounting < RNG_AUTO_TIME_ACHIEVEMENT_SECONDS && rngGame.totalAutoRollSeconds >= RNG_AUTO_TIME_ACHIEVEMENT_SECONDS;
      persistRngGame();
      if (manualSecretJustUnlocked || autoSecretJustUnlocked) sendRngState();
    }
  }, 200);
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
  trayIcon.setToolTip(musicControlState.title ? `NTC Utilities — ${musicControlState.title.slice(0, 80)}` : `NTC Utilities — rolagem automática ${active ? 'ativa' : 'pausada'}`);
  const items = [
    { label: 'Abrir NTC Utilities', click: showMainWindow },
    ...(musicControlState.title ? [
      { label: musicControlState.playing ? 'Pausar música' : 'Reproduzir música', click: () => mainWindow?.webContents.send('music2-control', 'toggle') },
      { label: 'Faixa anterior', click: () => mainWindow?.webContents.send('music2-control', 'previous') },
      { label: 'Próxima faixa', click: () => mainWindow?.webContents.send('music2-control', 'next') }
    ] : []),
    { label: `Rolagem automática ${active ? 'ativa em segundo plano' : 'pausada'}`, enabled: false },
    { type: 'separator' },
    { label: 'Sair do NTC Utilities', click: requestExitFromTray }
  ];
  trayIcon.setContextMenu(Menu.buildFromTemplate(items));
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
  const tags = { ...(audio.tags || {}), ...(data.format?.tags || {}) };
  const readTag = (...names) => {
    for (const name of names) {
      const entry = Object.entries(tags).find(([key]) => key.toLocaleLowerCase('en-US') === name.toLocaleLowerCase('en-US'));
      if (entry?.[1]) return String(entry[1]);
    }
    return '';
  };
  const duration = Number(data.format?.duration || audio.duration || 0);
  return {
    path: file, name: path.basename(file), baseName: path.basename(file, path.extname(file)), duration: Number.isFinite(duration) ? duration : 0,
    durationLabel: Number.isFinite(duration) && duration > 0 ? new Date(duration * 1000).toISOString().slice(11, 19) : '—',
    type: videoExtensions.includes(path.extname(file).toLowerCase()) ? 'Vídeo' : 'Áudio', format: data.format?.format_name || path.extname(file).slice(1),
    coverStreamIndex: Number.isInteger(cover?.index) ? cover.index : null,
    metadata: { title: readTag('title'), artist: readTag('artist', 'album_artist'), album: readTag('album'), year: readTag('date', 'year'), genre: readTag('genre') }
  };
}
function resolveAllowedMusicTrack(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim() || !audioExtensions.includes(path.extname(filePath).toLowerCase())) throw new Error('Arquivo de áudio inválido.');
  let realFile;
  try { realFile = fs.realpathSync(path.resolve(filePath)); } catch { throw new Error('Arquivo de áudio não encontrado.'); }
  if (!fs.statSync(realFile).isFile()) throw new Error('O caminho não é um arquivo de áudio.');
  const activeInMusicLibrary = musicLibraryService?.store.hasActivePath(realFile);
  if (!activeInMusicLibrary && readRemovedMusicFiles().some(file => musicPathKey(file) === musicPathKey(realFile))) throw new Error('Esta faixa foi removida da biblioteca. Adicione o arquivo novamente para restaurá-la.');
  const insideFolder = readMusicFolders().some(folder => {
    try {
      const realFolder = fs.realpathSync(folder);
      const relative = path.relative(realFolder, realFile);
      return Boolean(relative) && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
    } catch { return false; }
  });
  const individuallyAdded = readMusicFiles().some(file => {
    try { return fs.realpathSync(file) === realFile; } catch { return false; }
  });
  if (!insideFolder && !individuallyAdded && !activeInMusicLibrary) throw new Error('A faixa não pertence à biblioteca selecionada.');
  return realFile;
}
async function fetchMusicMetadataUrl(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timeout); }
}
function musicBrainzRequest(url) {
  const request = musicBrainzQueue.then(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const elapsed = Number(process.hrtime.bigint() / 1_000_000n) - musicBrainzLastRequestAt;
      if (elapsed < 1000) await new Promise(resolve => setTimeout(resolve, 1000 - elapsed));
      musicBrainzLastRequestAt = Number(process.hrtime.bigint() / 1_000_000n);
      let response;
      try { response = await fetchMusicMetadataUrl(url, { headers: { Accept: 'application/json', 'User-Agent': `NTC Utilities/${app.getVersion()} (https://github.com/inflzzz/ntc-utilities)` } }); }
      catch { throw new Error('Não foi possível conectar ao serviço de músicas. Verifique a internet e tente novamente.'); }
      if (response.ok) return response.json();
      if (![429, 502, 503, 504].includes(response.status)) throw new Error('O serviço de músicas não conseguiu responder a esta busca. Tente novamente mais tarde.');
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1500 * (attempt + 1)));
    }
    throw new Error('O serviço de músicas está temporariamente ocupado. Tente buscar a capa novamente em alguns instantes.');
  });
  musicBrainzQueue = request.catch(() => {});
  return request;
}
function lucenePhrase(value) {
  const escaped = String(value).trim().slice(0, 180).replace(/[+\-!(){}\[\]^"~*?:\\/|&]/g, character => `\\${character}`);
  return `"${escaped}"`;
}
async function getMusicTrackMetadata(filePath) {
  const file = resolveAllowedMusicTrack(filePath);
  const media = await inspectMedia(file);
  let coverDataUrl = null;
  if (media.coverStreamIndex !== null) {
    try {
      const image = await runBuffer('ffmpeg', ['-v', 'error', '-i', file, '-map', `0:${media.coverStreamIndex}`, '-frames:v', '1', '-vf', 'scale=600:600:force_original_aspect_ratio=decrease', '-c:v', 'mjpeg', '-q:v', '5', '-f', 'image2pipe', 'pipe:1']);
      if (image.length > 0 && image.length <= 4 * 1024 * 1024) coverDataUrl = `data:image/jpeg;base64,${image.toString('base64')}`;
    } catch { /* Keep the player usable when a file has malformed embedded artwork. */ }
  }
  return { metadata: media.metadata, coverDataUrl };
}
async function getMusicTrackTags(filePath) {
  const file = resolveAllowedMusicTrack(filePath);
  const media = await inspectMedia(file);
  return { metadata: media.metadata };
}
async function searchOnlineMusicMetadata(filePath, artistOverride = '') {
  const file = resolveAllowedMusicTrack(filePath);
  const media = await inspectMedia(file);
  const baseName = path.basename(file, path.extname(file)).trim();
  const searchCandidates = deriveMusicSearchCandidates(media.metadata, baseName, artistOverride);
  if (!searchCandidates.length) throw new Error('Não encontrei um título para pesquisar nesta faixa.');
  const albumHint = String(media.metadata.album || '').trim();
  const cacheKey = `${albumHint}\u0002${searchCandidates.map(({ title, artist }) => `${title}\u0000${artist}`).join('\u0001')}`.toLocaleLowerCase('pt-BR');
  const cached = musicOnlineSearchCache.get(cacheKey);
  if (cached) return cached;
  const matches = new Map();
  for (const { title: searchTitle, artist } of searchCandidates) {
    const baseQuery = `recording:${lucenePhrase(searchTitle)}${artist ? ` AND artist:${lucenePhrase(artist)}` : ''}`;
    const queries = albumHint && artist ? [`${baseQuery} AND release:${lucenePhrase(albumHint)}`, baseQuery] : [baseQuery];
    for (const query of queries) {
      const matchesBeforeQuery = matches.size;
      const searchUrl = new URL('https://musicbrainz.org/ws/2/recording/');
      searchUrl.searchParams.set('query', query); searchUrl.searchParams.set('fmt', 'json'); searchUrl.searchParams.set('limit', '5');
      const data = await musicBrainzRequest(searchUrl.href);
      for (const item of findMusicReleaseCandidates(data.recordings, searchTitle, artist)) {
        const key = `${item.releaseId || item.trackTitle}\u0000${item.artist}`;
        if (!matches.has(key)) matches.set(key, item);
      }
      if (matches.size > matchesBeforeQuery) break;
    }
  }
  const candidates = [...matches.values()].slice(0, 5);
  const results = await Promise.all(candidates.slice(0, 5).map(async item => {
    let coverDataUrl = null;
    if (item.releaseId) {
      const coverUrl = `https://coverartarchive.org/release/${item.releaseId}/front-250`;
      try {
        const response = await fetchMusicMetadataUrl(coverUrl, { headers: { Accept: 'image/jpeg,image/*;q=0.8' } });
        const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (response.ok && contentType.startsWith('image/')) {
          const image = Buffer.from(await response.arrayBuffer());
          if (image.length > 0 && image.length <= 2 * 1024 * 1024) coverDataUrl = `data:${contentType};base64,${image.toString('base64')}`;
        }
      } catch { /* Release details remain useful even when no cover is available. */ }
    }
    return { id: item.releaseId || item.trackTitle, title: item.title, album: item.album, trackTitle: item.trackTitle, artist: item.artist, year: item.year, coverDataUrl, source: 'Cover Art Archive / MusicBrainz' };
  }));
  const available = results.filter(Boolean).slice(0, 5);
  musicOnlineSearchCache.set(cacheKey, available);
  return available;
}
async function inspectVideo(file) {
  if (!file || !fs.existsSync(file)) throw new Error('Vídeo não encontrado.');
  const data = JSON.parse(await run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file]));
  const video = (data.streams || []).find(stream => stream.codec_type === 'video');
  if (!video) throw new Error('Este arquivo não possui vídeo.');
  const duration = Number(data.format?.duration || video.duration || 0);
  return { path: file, name: path.basename(file), baseName: path.basename(file, path.extname(file)), duration: Number.isFinite(duration) ? duration : 0, durationLabel: duration ? new Date(duration * 1000).toISOString().slice(11, 19) : '—', width: video.width || 0, height: video.height || 0, hasAudio: (data.streams || []).some(stream => stream.codec_type === 'audio'), format: path.extname(file).slice(1) };
}
async function inspectImage(file) {
  if (!file || !fs.existsSync(file)) throw new Error('Imagem não encontrada.');
  const prepared = await prepareImageInput(file);
  try {
    const data = await sharp(prepared.file).metadata();
    if (!data.width || !data.height) throw new Error('Não foi possível ler esta imagem.');
    return { path: file, name: path.basename(file), baseName: path.basename(file, path.extname(file)), width: data.width, height: data.height, format: path.extname(file).slice(1), hasAlpha: Boolean(data.hasAlpha), size: fs.statSync(file).size };
  } finally { await prepared.cleanup(); }
}
async function prepareImageInput(file) {
  if (!/\.hei[cf]$/i.test(file)) return { file, cleanup: async () => {} };
  const temporary = path.join(app.getPath('temp'), `ntc-heic-${require('node:crypto').randomUUID()}.png`);
  try { await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-frames:v', '1', temporary]); }
  catch (error) { throw new Error(`Não foi possível abrir esta imagem HEIC: ${error.message}`); }
  return { file: temporary, cleanup: () => fs.promises.unlink(temporary).catch(() => {}) };
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
  mainWindow.maximize();
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
  mainWindow.on('unmaximize', () => {
    if (videoEditorWindowState?.active) videoEditorWindowState.userOverride = true;
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('window-maximized', false);
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
}

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) { app.exit(0); return; }
  ambientPackService = new AmbientPackService({ root: app.getPath('userData'), catalogFile: path.join(__dirname,'content','ambient-packs.json'), ffprobe: binary('ffprobe'), onProgress: payload => { if(mainWindow && !mainWindow.isDestroyed())mainWindow.webContents.send('ambient-pack-progress',payload); } });
  void ambientPackService.initialize();
  ipcMain.handle('ambient-state', event => { assertMainWindowSender(event); return ambientPackService.state(); });
  ipcMain.handle('ambient-refresh', event => { assertMainWindowSender(event); return ambientPackService.refresh(); });
  ipcMain.handle('ambient-download', (event,id) => { assertMainWindowSender(event); return ambientPackService.download(id); });
  ipcMain.handle('ambient-cancel', (event,id) => { assertMainWindowSender(event); return ambientPackService.cancel(id); });
  ipcMain.handle('ambient-remove', (event,id) => { assertMainWindowSender(event); return ambientPackService.remove(id); });
  ipcMain.handle('ambient-audio', (event,id) => { assertMainWindowSender(event); return ambientPackService.audio(id); });
  ipcMain.handle('ambient-custom-choose', async (event,mode) => { assertMainWindowSender(event); const result=await dialog.showOpenDialog(mainWindow,{title:'Adicionar meus sons',properties:['openFile','multiSelections'],filters:[{name:'Áudio',extensions:['wav','mp3','flac','ogg','opus']}]});if(result.canceled)return ambientPackService.state();let state;for(const file of result.filePaths)state=await ambientPackService.addCustom(file,mode);return state||ambientPackService.state(); });
  ipcMain.handle('ambient-custom-drop', (event,files,mode) => { assertMainWindowSender(event); if(!Array.isArray(files)||files.length>20)throw new Error('Arquivos inválidos.'); return Promise.all(files.map(file=>ambientPackService.addCustom(file,mode))).then(()=>ambientPackService.state()); });
  ipcMain.handle('ambient-custom-update', (event,id,patch) => { assertMainWindowSender(event); return ambientPackService.updateCustom(id,patch||{}); });
  ipcMain.handle('ambient-custom-relink', async (event,id) => { assertMainWindowSender(event); const result=await dialog.showOpenDialog(mainWindow,{title:'Localizar áudio',properties:['openFile'],filters:[{name:'Áudio',extensions:['wav','mp3','flac','ogg','opus']}]});return result.canceled?ambientPackService.state():ambientPackService.relink(id,result.filePaths[0]); });
  ipcMain.handle('ambient-custom-remove', (event,id) => { assertMainWindowSender(event); return ambientPackService.removeCustom(id); });
  try { musicLibraryService = registerMusicService({ app, ipcMain, dialog, shell, mainWindow: () => mainWindow, ffprobe: binary('ffprobe'), ffmpeg: binary('ffmpeg'), sharp, onlineLookup: searchOnlineMusicMetadata, legacyFolders: readMusicFolders, legacyFiles: readMusicFiles, legacyRemoved: readRemovedMusicFiles }); }
  catch (error) { console.error('Biblioteca de música indisponível:', error); }
  ipcMain.handle('music2-mini-open', event => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Janela inválida.');
    if (musicMiniWindow && !musicMiniWindow.isDestroyed()) { musicMiniWindow.show(); musicMiniWindow.focus(); return true; }
    const alwaysOnTop = Boolean(musicLibraryService?.store.setting('mini-always-on-top', false));
    musicControlState = { ...musicControlState, alwaysOnTop };
    musicMiniWindow = new BrowserWindow({ width: 620, height: 188, minWidth: 520, minHeight: 164, maxWidth: 900, maxHeight: 250, title: 'NTC Mini Player', icon: path.join(__dirname, 'build', 'ntc-logo.png'), backgroundColor: '#171319', autoHideMenuBar: true, alwaysOnTop, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false } });
    musicMiniWindow.on('closed', () => { musicMiniWindow = null; });
    void musicMiniWindow.loadFile(path.join(__dirname, 'src', 'music-mini.html')).then(() => musicMiniWindow?.webContents.send('music2-mini-state', musicControlState));
    return true;
  });
  ipcMain.handle('music2-mini-on-top', (event, enabled) => {
    if (event.sender !== musicMiniWindow?.webContents) throw new Error('Janela inválida.');
    const value = Boolean(enabled); musicMiniWindow.setAlwaysOnTop(value); musicLibraryService?.store.setSetting('mini-always-on-top', value); musicControlState = { ...musicControlState, alwaysOnTop: value }; musicMiniWindow.webContents.send('music2-mini-state', musicControlState); return musicMiniWindow.isAlwaysOnTop();
  });
  ipcMain.handle('music2-show-main', event => { if (event.sender !== musicMiniWindow?.webContents) throw new Error('Janela inválida.'); return showMainWindow(); });
  ipcMain.handle('music2-control-command', (event, command) => {
    const name = typeof command === 'string' ? command : command?.name;
    if (event.sender !== musicMiniWindow?.webContents || !['toggle', 'previous', 'next', 'seek', 'volume', 'mute'].includes(name)) throw new Error('Comando inválido.');
    mainWindow?.webContents.send('music2-control', command); return true;
  });
  ipcMain.handle('music2-control-state', (event, value) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Janela inválida.');
    const oldMusicState = musicControlState;
    const cover = typeof value?.cover === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value.cover) && value.cover.length <= 500000 ? value.cover : '';
    musicControlState = { title: String(value?.title || '').slice(0, 150), artist: String(value?.artist || '').slice(0, 150), album: String(value?.album || '').slice(0, 150), cover, coverFit: value?.coverFit === 'cover' ? 'cover' : 'contain', playing: Boolean(value?.playing), time: Math.max(0, Number(value?.time) || 0), duration: Math.max(0, Number(value?.duration) || 0), volume: Math.max(0, Math.min(1, Number(value?.volume) || 0)), muted: Boolean(value?.muted), alwaysOnTop: Boolean(musicLibraryService?.store.setting('mini-always-on-top', false)) };
    if (musicMiniWindow && !musicMiniWindow.isDestroyed()) musicMiniWindow.webContents.send('music2-mini-state', musicControlState);
    if (oldMusicState.title !== musicControlState.title || oldMusicState.playing !== musicControlState.playing) updateTrayStatus(); return true;
  });
  app.setAppUserModelId('com.ntccorporation.utilities');
  initializeLoginAtStartup();
  loadRngGame(); startRngClock();
  rngShadowService = createRngShadowService({
    enabled: isShadowEnabled({ env: process.env, packaged: app.isPackaged }),
    logEnabled: isShadowLoggingEnabled({ env: process.env, packaged: app.isPackaged }),
    userDataPath: app.getPath('userData')
  });
  rngOnlineService = createRngOnlineService({
    app,
    safeStorage,
    config: readOnlineConfig({ rootDir: __dirname, packaged: app.isPackaged }),
    getSnapshot: rngSnapshot,
    onState: state => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('rng-online-state', state); }
  });
  void rngOnlineService.start();
  autoClickerService = initializeAutoClicker({ app, ipcMain, BrowserWindow, screen });
  colorPickerService = initializeColorPicker({ ipcMain, BrowserWindow, screen, desktopCapturer, getMainWindow: () => mainWindow });
  clipboardHistoryService = initializeClipboardHistory({ app, ipcMain, getMainWindow: () => mainWindow, clipboard, nativeImage });
  initializeDocumentsService({ app, ipcMain, dialog, getMainWindow: () => mainWindow });
  createStudyService({ app, ipcMain, getMainWindow: () => mainWindow });
  initializeCatalogService({ app, ipcMain, dialog, getMainWindow: () => mainWindow, ffmpegPath: () => binary('ffmpeg') });
  createSecurityService({ ipcMain, getMainWindow: () => mainWindow, dialog, clipboard, sharp, runFfmpeg: args => run('ffmpeg', args), ignoreClipboardText: text => clipboardHistoryService?.ignoreNextText(text) });
  void rngTrustedClock.sync().then(sendRngState);
  powerMonitor.on('suspend', () => { autoClickerService?.suspend(); accountRngTime(); rngAutoRollStartedAt = 0; rngAutoAccountedAt = 0; rngNextAutoRollAt = 0; rngTrustedClock.invalidate(); persistRngGame(); sendRngState(); updateTrayStatus(); });
  powerMonitor.on('resume', () => { rngTrustedClock.invalidate(); rngAppAccountedAt = rngMonotonicMs(); rngLastHeartbeatAt = rngMonotonicMs(); rngLastTimeSync = rngMonotonicMs(); void rngTrustedClock.sync().then(sendRngState); });
  ipcMain.handle('get-app-version', () => app.getVersion());
  ipcMain.on('shortcut-recorder-focus', (event, focused) => {
    if (mainWindow && event.sender === mainWindow.webContents) shortcutRecorderFocused = Boolean(focused);
    autoClickerService?.setShortcutRecorderFocused(Boolean(focused));
  });
  ipcMain.handle('get-launch-at-login', () => ({ enabled: launchAtLoginEnabled, supported: process.platform === 'win32' }));
  ipcMain.handle('set-launch-at-login', (_event, enabled) => setLoginAtStartup(enabled));
  ipcMain.handle('is-development-build', () => !app.isPackaged);
  ipcMain.handle('get-world-clock-settings', event => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return null;
    return readWorldClockSettings();
  });
  ipcMain.handle('save-world-clock-settings', (event, settings) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return false;
    try { return saveWorldClockSettings(settings); } catch { return false; }
  });
  ipcMain.handle('get-rng-state', () => rngSnapshot());
  ipcMain.handle('acknowledge-rng-system-unlock', (event, unlockId) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return { ok: false, reason: 'invalid-sender' };
    if (!canAcknowledgeAccountSystemUnlock(unlockId, rngAccountProgress.accountLevel)) return { ok: false, reason: 'unlock-not-eligible' };
    if (!rngAccountSystemUnlocksAcknowledged.includes(unlockId)) {
      rngAccountSystemUnlocksAcknowledged = normalizeAcknowledgedSystemUnlocks([...rngAccountSystemUnlocksAcknowledged, unlockId]);
      persistRngGame();
    }
    return { ok: true, state: rngSnapshot() };
  });
  ipcMain.handle('get-rng-online-state', event => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return { status: 'error', message: 'Solicitação inválida.', leaderboard: [] };
    return rngOnlineService?.getState() || { status: 'unconfigured', message: 'NTC Online indisponível.', leaderboard: [] };
  });
  ipcMain.handle('retry-rng-online', event => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return { status: 'error', message: 'Solicitação inválida.', leaderboard: [] };
    return rngOnlineService?.retry() || { status: 'unconfigured', message: 'NTC Online indisponível.', leaderboard: [] };
  });
  ipcMain.handle('set-rng-profile', (event, preferences) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return { ok: false, reason: 'invalid-sender' };
    const currentProfile = rngGame.profile || { displayName: '', equippedTitleId: null };
    let displayName = currentProfile.displayName;
    if (Object.prototype.hasOwnProperty.call(preferences || {}, 'displayName')) {
      const validation = validateProfileDisplayName(preferences.displayName);
      if (!validation.ok) return { ok: false, reason: validation.reason };
      if (currentProfile.displayName && validation.value !== currentProfile.displayName) return { ok: false, reason: 'name-locked' };
      displayName = validation.value;
    }
    const equippedTitleId = Object.prototype.hasOwnProperty.call(preferences || {}, 'equippedTitleId')
      ? (preferences.equippedTitleId == null || preferences.equippedTitleId === '' ? null : String(preferences.equippedTitleId))
      : currentProfile.equippedTitleId;
    if (equippedTitleId && !rngGame.collectedIds.includes(equippedTitleId)) return { ok: false, reason: 'title-not-owned' };
    rngGame.profile = { displayName, equippedTitleId };
    rngGame = normalizeRngState(rngGame);
    persistRngGame();
    sendRngState();
    return { ok: true, state: rngSnapshot() };
  });
  ipcMain.handle('render-rng-profile-card', async (event, format) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('Solicitação de renderização inválida.');
    return renderRngProfileCard(format);
  });
  ipcMain.handle('copy-rng-profile-card', async (event, imageBytes) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('Solicitação de cópia inválida.');
    const data = await validateRngProfileCard(imageBytes);
    const image = nativeImage.createFromBuffer(data);
    if (image.isEmpty()) throw new Error('A imagem da ficha não pôde ser copiada.');
    clipboard.writeImage(image);
    return true;
  });
  ipcMain.handle('save-rng-profile-card', async (event, imageBytes) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('Solicitação de salvamento inválida.');
    const data = await validateRngProfileCard(imageBytes);
    const profileName = safeName(rngGame.profile.displayName || 'Viajante');
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Salvar ficha do NTC RNG',
      defaultPath: `NTC_Profile_${profileName}.png`,
      filters: [{ name: 'Imagem PNG', extensions: ['png'] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const outputPath = /\.png$/i.test(result.filePath) ? result.filePath : `${result.filePath}.png`;
    await fs.promises.writeFile(outputPath, data, { flag: 'w' });
    return { canceled: false, filePath: outputPath };
  });
  ipcMain.handle('purchase-rng-upgrade', event => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return { ok: false, reason: 'invalid-sender' };
    accountRngTime();
    const result = purchasePermanentUpgrade(rngGame);
    if (result.ok) { rngGame = result.state; persistRngGame(); sendRngState(); }
    return { ...result, state: rngSnapshot() };
  });
  ipcMain.handle('purchase-rng-enhanced-recycling', event => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return { ok: false, reason: 'invalid-sender' };
    accountRngTime();
    const result = purchaseEnhancedRecycling({
      accountLevel: rngAccountProgress.accountLevel,
      level: rngAccountProgress.enhancedRecyclingLevel,
      fragmentBalance: rngGame.fragmentBalance
    });
    if (result.ok) {
      rngAccountProgress.enhancedRecyclingLevel = result.level;
      rngGame.fragmentBalance = result.fragmentBalance;
      persistRngGame();
      sendRngState();
    }
    return { ...result, state: rngSnapshot() };
  });
  ipcMain.handle('purchase-rng-consumable', (event, type) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return { ok: false, reason: 'invalid-sender' };
    accountRngTime();
    const result = purchaseConsumable(rngGame, type);
    if (result.ok) { rngGame = result.state; persistRngGame(); sendRngState(); }
    return { ...result, state: rngSnapshot() };
  });
  ipcMain.handle('activate-rng-consumable', (event, type) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return { ok: false, reason: 'invalid-sender' };
    accountRngTime();
    const result = activateConsumable(rngGame, type);
    if (result.ok) { rngGame = result.state; persistRngGame(); sendRngState(); }
    return { ...result, state: rngSnapshot() };
  });
  ipcMain.handle('purchase-rng-relic', (event, relicId) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return { ok: false, reason: 'invalid-sender' };
    const result = purchaseRelic(rngGame, relicId);
    if (result.ok) { rngGame = result.state; persistRngGame(); sendRngState(); }
    return { ...result, state: rngSnapshot() };
  });
  ipcMain.handle('equip-rng-relic', (event, relicId) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return { ok: false, reason: 'invalid-sender' };
    const result = equipRelic(rngGame, relicId);
    if (result.ok) { rngGame = result.state; persistRngGame(); sendRngState(); }
    return { ...result, state: rngSnapshot() };
  });
  ipcMain.handle('unequip-rng-relic', (event, relicId) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return { ok: false, reason: 'invalid-sender' };
    const result = unequipRelic(rngGame, relicId);
    if (result.ok) { rngGame = result.state; persistRngGame(); sendRngState(); }
    return { ...result, state: rngSnapshot() };
  });
  ipcMain.handle('join-rng-event', (_event, eventId) => { const joined = joinEvent(rngTrustedClock.now(), eventId); if (rngGame.participation !== joined) rngGame.eventsParticipated++; rngGame.participation = joined; persistRngGame(); sendRngState(); return rngSnapshot(); });
  ipcMain.handle('app-entered', event => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return false;
    // Auto Roll is always opt-in for the current app session; entering the UI never starts it.
    return false;
  });
  ipcMain.handle('roll-rng', event => {
    if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('Origem da rolagem inválida.');
    if (pendingAccountSystemUnlock(rngAccountProgress.accountLevel, rngAccountSystemUnlocksAcknowledged)) return { accepted: false, reason: 'system-unlock-pending' };
    if (rngAutoRollStartedAt) throw new Error('Pause a rolagem automática para fazer uma rolagem manual.');
    const cycleId = rngManualRollGate.begin();
    if (cycleId === null) return { accepted: false, reason: 'manual-roll-in-progress' };
    try {
      const results = performRngRoll({ manual: true });
      return { accepted: true, cycleId, results };
    } catch (error) {
      rngManualRollGate.complete(cycleId);
      throw error;
    }
  });
  ipcMain.handle('complete-manual-rng-roll', (event, cycleId) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return false;
    return rngManualRollGate.complete(cycleId);
  });
  ipcMain.handle('set-rng-auto-roll', (_event, active) => {
    if (active && pendingAccountSystemUnlock(rngAccountProgress.accountLevel, rngAccountSystemUnlocksAcknowledged)) throw new Error('Continue pelo desbloqueio de sistema antes de iniciar as rolagens.');
    if (active && !isAutoRollUnlocked(rngAccountProgress.accountLevel)) throw new Error('A Rolagem Automática é desbloqueada no Account Level 3.');
    const now = rngMonotonicMs();
    if (active && !rngAutoRollStartedAt) {
      rngAutoRollStartedAt = now; rngAutoAccountedAt = now; rngNextAutoRollAt = now + 1000; rngGame.lastAutoRollSessionSeconds = 0;
      const result = performRngRoll();
      updateTrayStatus();
      return { active: Boolean(rngAutoRollStartedAt), result, state: rngSnapshot(now) };
    }
    if (!active && rngAutoRollStartedAt) {
      accountRngTime(now); rngGame.lastAutoRollSessionSeconds = Math.floor((now - rngAutoRollStartedAt) / 1000);
      rngAutoRollStartedAt = 0; rngAutoAccountedAt = 0; rngNextAutoRollAt = 0; persistRngGame(); sendRngState();
      updateTrayStatus();
    }
    return { active: Boolean(rngAutoRollStartedAt), state: rngSnapshot(now) };
  });
  if (!app.isPackaged) {
    ipcMain.handle('debug-rng-reset-account', async event => {
      if (!mainWindow || event.sender !== mainWindow.webContents) return { ok: false, message: 'Solicitação inválida.' };
      let onlineReset = false;
      let onlineResult = null;
      try {
        if (!rngOnlineService) throw new Error('O serviço NTC Online não está disponível.');
        onlineResult = await rngOnlineService.resetOwnProfile();
        onlineReset = onlineResult?.ok === true;
        if (!onlineReset) throw new Error('O Supabase não confirmou a remoção do perfil Online.');
        return { ok: true, state: resetRngAccountState(), online: onlineResult };
      } catch {
        return {
          ok: false,
          remoteReset: onlineReset,
          message: onlineReset
            ? 'O perfil Online foi removido, mas não foi possível gravar o reset local. O progresso local em memória foi preservado; tente novamente.'
            : 'Não foi possível confirmar o reset Online. Nenhum progresso local foi alterado; reconecte ao NTC Online e tente novamente.'
        };
      }
    });
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
  ipcMain.handle('music-library-get-folders', () => readMusicFolders());
  ipcMain.handle('music-library-add-folders', async () => {
    const result = await dialog.showOpenDialog({ title: 'Adicione pastas com músicas', properties: ['openDirectory', 'multiSelections'] });
    if (result.canceled) return readMusicFolders();
    return saveMusicFolders([...readMusicFolders(), ...result.filePaths]);
  });
  ipcMain.handle('music-library-choose-files', async () => {
    const result = await dialog.showOpenDialog({ title: 'Adicione arquivos de áudio', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Arquivos de áudio', extensions: [...AUDIO_EXTENSIONS].map(extension => extension.slice(1)) }] });
    return result.canceled ? [] : addMusicFiles(result.filePaths);
  });
  ipcMain.handle('music-library-add-files', (_event, files) => addMusicFiles(files));
  ipcMain.handle('music-library-remove-track', (_event, filePath) => removeMusicTrack(filePath));
  ipcMain.handle('music-playlist-choose-cover', async () => {
    const result = await dialog.showOpenDialog({ title: 'Escolha a capa da playlist', properties: ['openFile'], filters: [{ name: 'Imagens', extensions: ['jpg', 'jpeg', 'png', 'webp'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    try {
      const image = await sharp(result.filePaths[0]).rotate().resize(512, 512, { fit: 'cover', position: sharp.strategy.attention }).jpeg({ quality: 80 }).toBuffer();
      return `data:image/jpeg;base64,${image.toString('base64')}`;
    } catch { throw new Error('O arquivo escolhido não é uma imagem compatível.'); }
  });
  ipcMain.handle('music-library-remove-folder', (_event, folder) => {
    if (typeof folder !== 'string') return readMusicFolders();
    const key = path.resolve(folder).toLocaleLowerCase('en-US');
    return saveMusicFolders(readMusicFolders().filter(item => path.resolve(item).toLocaleLowerCase('en-US') !== key));
  });
  ipcMain.handle('music-library-scan', async () => {
    const folders = readMusicFolders();
    const folderTracks = await scanMusicFolders(folders);
    const individualTracks = await scanMusicFiles(readMusicFiles());
    const removed = new Set(readRemovedMusicFiles().map(musicPathKey));
    const keys = new Set();
    const tracks = [...folderTracks, ...individualTracks].filter(track => {
      if (removed.has(musicPathKey(track.path))) return false;
      const key = process.platform === 'win32' ? track.id.toLocaleLowerCase('en-US') : track.id;
      if (keys.has(key)) return false;
      keys.add(key);
      return true;
    });
    return tracks.map(track => ({ ...track, src: pathToFileURL(track.path).href }));
  });
  ipcMain.handle('music-track-tags', (_event, filePath) => getMusicTrackTags(filePath));
  ipcMain.handle('music-track-metadata', (_event, filePath) => getMusicTrackMetadata(filePath));
  ipcMain.handle('music-search-online-metadata', (_event, filePath, artistOverride) => searchOnlineMusicMetadata(filePath, artistOverride));
  ipcMain.handle('get-free-space', (_event, folder) => { try { const stat = fs.statfsSync(folder || app.getPath('downloads')); return Number(stat.bavail) * Number(stat.bsize); } catch { return null; } });
  ipcMain.handle('window-minimize', event => { const window = BrowserWindow.fromWebContents(event.sender); if (!window) return false; window.minimize(); return true; });
  ipcMain.handle('window-toggle-maximize', event => { const window = BrowserWindow.fromWebContents(event.sender); if (!window) return false; if (window.isMaximized()) window.unmaximize(); else window.maximize(); return window.isMaximized(); });
  ipcMain.handle('window-close', event => BrowserWindow.fromWebContents(event.sender)?.close());
  ipcMain.handle('window-force-close', event => { forceClose = true; BrowserWindow.fromWebContents(event.sender)?.close(); });
  ipcMain.handle('window-is-maximized', event => BrowserWindow.fromWebContents(event.sender)?.isMaximized() || false);
  ipcMain.handle('window-enter-video-editor', event => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return false;
    if (!videoEditorWindowState?.active) {
      const wasMaximized = window.isMaximized();
      videoEditorWindowState = { active: true, wasMaximized, bounds: window.getBounds(), userOverride: false };
      if (!wasMaximized) window.maximize();
    }
    return window.isMaximized();
  });
  ipcMain.handle('window-leave-video-editor', event => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || !videoEditorWindowState?.active) return window?.isMaximized() || false;
    const previous = videoEditorWindowState;
    videoEditorWindowState = null;
    if (!previous.wasMaximized && !previous.userOverride && window.isMaximized()) {
      window.unmaximize();
      window.setBounds(previous.bounds);
    }
    return window.isMaximized();
  });
  ipcMain.handle('choose-download-folder', async () => { const result = await dialog.showOpenDialog({ title: 'Escolha a pasta de destino', properties: ['openDirectory', 'createDirectory'] }); return result.canceled ? null : result.filePaths[0]; });
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
    const prepared = await prepareImageInput(item.source);
    try {
      const metadata = await sharp(prepared.file).metadata(); const { width, height } = imageDimensions(metadata, item);
      const quality = Math.max(1, Math.min(100, Number(item.quality) || 85)); const format = ['jpg', 'png', 'webp'].includes(item.format) ? item.format : 'jpg'; let pipeline = sharp(prepared.file).rotate().resize(width, height, { fit: item.keepRatio === false ? 'fill' : 'inside', withoutEnlargement: false }); pipeline = applyLowQualityPixelation(pipeline, width, height, quality).resize({ width: 1100, height: 700, fit: 'inside', withoutEnlargement: true }); if (format === 'jpg') pipeline = pipeline.flatten({ background: '#ffffff' }).jpeg({ quality }); if (format === 'png') pipeline = pipeline.png({ palette: true, quality, compressionLevel: 9 }); if (format === 'webp') pipeline = pipeline.webp({ quality }); const output = await pipeline.toBuffer(); const mime = format === 'jpg' ? 'image/jpeg' : `image/${format}`; return { dataUrl: `data:${mime};base64,${output.toString('base64')}`, width, height };
    } finally { await prepared.cleanup(); }
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
  ipcMain.handle('start-video-conversion', async (event, item) => {
    if (!item?.id || !item.source || !item.folder || !fs.existsSync(item.source)) throw new Error('Dados do vídeo inválidos.');
    const extension = ['mp4', 'mkv', 'webm'].includes(item.format) ? item.format : 'mp4'; const filename = availableFilename(item.folder, `${safeName(item.outputName || path.basename(item.source, path.extname(item.source)))}.${extension}`, item.duplicate); const output = path.join(item.folder, filename); const args = ['-hide_banner', '-y', '-i', item.source];
    if (item.resolution && item.resolution !== 'original') args.push('-vf', `scale=-2:${Number(item.resolution)}`); if (item.audioMode === 'mute') args.push('-an'); else args.push('-map', '0:a?'); args.push('-map', '0:v:0');
    const crf = { alta: '20', equilibrada: '25', economica: '30' }[item.quality] || '25'; if (extension === 'webm') args.push('-c:v', 'libvpx-vp9', '-crf', crf, '-b:v', '0', '-c:a', 'libopus'); else args.push('-c:v', item.codec === 'h265' ? 'libx265' : 'libx264', '-crf', crf, '-preset', 'medium', '-c:a', 'aac'); args.push('-progress', 'pipe:1', '-nostats', output);
    return startFfmpegJob(event, videoJobs, item.id, args, output, Number(item.duration || 0), 'video-event');
  });
  ipcMain.handle('cancel-video-conversion', (_event, id) => videoJobs.get(id)?.cancel?.());
  ipcMain.handle('choose-media-project-audio', async event => { assertMainWindowSender(event); const result = await dialog.showOpenDialog({ title: 'Adicionar áudio ou vídeo com áudio ao projeto', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Mídias com áudio', extensions: [...new Set([...audioExtensions, ...videoExtensions].map(extension => extension.slice(1)))] }] }); return result.canceled ? [] : result.filePaths; });
  ipcMain.handle('open-media-project', async event => {
    assertMainWindowSender(event);
    const result = await dialog.showOpenDialog({ title: 'Abrir projeto NTC', properties: ['openFile'], filters: [{ name: 'Projetos NTC', extensions: ['ntcmp'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const stat = fs.statSync(result.filePaths[0]);
    if (stat.size > 5 * 1024 * 1024) throw new Error('O projeto excede o limite seguro de 5 MB.');
    return mediaProject.normalizeProject(JSON.parse(await fs.promises.readFile(result.filePaths[0], 'utf8')));
  });
  ipcMain.handle('save-media-project', async (event, value) => {
    assertMainWindowSender(event);
    const project = mediaProject.normalizeProject(value);
    const result = await dialog.showSaveDialog({ title: 'Salvar projeto NTC', defaultPath: `${safeName(project.name)}.ntcmp`, filters: [{ name: 'Projeto NTC', extensions: ['ntcmp'] }] });
    if (result.canceled || !result.filePath) return null;
    const target = path.extname(result.filePath).toLowerCase() === '.ntcmp' ? result.filePath : `${result.filePath}.ntcmp`;
    const temporary = `${target}.${require('node:crypto').randomUUID()}.tmp`;
    try { await fs.promises.writeFile(temporary, `${JSON.stringify(project, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' }); await fs.promises.rename(temporary, target); }
    catch (error) { await fs.promises.unlink(temporary).catch(() => {}); throw error; }
    return { file: target, name: path.basename(target) };
  });
  ipcMain.handle('start-media-project-render', async (event, item) => {
    assertMainWindowSender(event);
    if (!item?.id || mediaProjectJobs.has(item.id)) throw new Error('Identificador de renderização inválido ou já em uso.');
    if (mediaProjectJobs.size) throw new Error('Já existe uma exportação de projeto em andamento.');
    const project = mediaProject.normalizeProject(item.project);
    if (!item.folder || !fs.existsSync(item.folder) || !fs.statSync(item.folder).isDirectory()) throw new Error('Escolha uma pasta de destino existente.');
    const sourcePaths = new Set();
    const preparedImages = [];
    project.assets = project.assets.map(asset => {
      const extension = path.extname(asset.path).toLowerCase();
      const allowed = asset.kind === 'audio' ? [...audioExtensions, ...videoExtensions] : asset.kind === 'image' ? imageExtensions : [];
      if (!allowed.includes(extension)) throw new Error(`Formato não permitido para ${asset.name || 'a mídia selecionada'}.`);
      let source;
      try { source = fs.realpathSync(path.resolve(asset.path)); } catch { throw new Error(`A mídia “${asset.name || path.basename(asset.path)}” não foi encontrada.`); }
      if (!fs.statSync(source).isFile()) throw new Error('Uma das mídias não é um arquivo.');
      sourcePaths.add(source.toLocaleLowerCase('en-US'));
      return { ...asset, path: source };
    });
    const format = project.kind === 'audio' ? project.output.format : 'mp4';
    if (project.kind === 'audio' && item.format !== format) throw new Error('Formato da exportação não corresponde ao projeto.');
    const outputName = safeName(item.outputName || project.name || (project.kind === 'audio' ? 'Mix NTC' : 'Vídeo NTC'));
    const extension = format;
    let filename = availableFilename(item.folder, `${outputName}.${extension}`, 'rename');
    let output = path.join(item.folder, filename);
    while (sourcePaths.has(path.resolve(output).toLocaleLowerCase('en-US'))) { filename = availableFilename(item.folder, `${outputName} (exportado).${extension}`, 'rename'); output = path.join(item.folder, filename); }
    try {
      if (project.kind === 'video') {
        project.assets = await Promise.all(project.assets.map(async asset => {
          if (asset.kind !== 'image') return asset;
          const prepared = await prepareImageInput(asset.path);
          if (prepared.file !== asset.path) preparedImages.push(prepared);
          return { ...asset, path: prepared.file };
        }));
      }
      let cover = null;
      if (project.kind === 'audio' && ['mp3', 'm4a', 'flac'].includes(format)) {
        if (project.output.coverPath) {
          if (!['.jpg', '.jpeg', '.png'].includes(path.extname(project.output.coverPath).toLowerCase())) throw new Error('Formato de capa não suportado.');
          const coverPath = fs.realpathSync(path.resolve(project.output.coverPath));
          if (!fs.statSync(coverPath).isFile()) throw new Error('Capa não encontrada.');
          cover = { kind: 'file', path: coverPath, streamIndex: 0 };
        } else if (project.output.preserveSourceCover) {
          const asset = project.assets.find(asset => Number.isInteger(asset.coverStreamIndex) && project.tracks.some(track => (!item.trackId || track.id === item.trackId) && track.clips.some(clip => clip.assetId === asset.id)));
          if (asset) cover = { kind: 'source', assetId: asset.id, streamIndex: asset.coverStreamIndex };
        }
      }
      const plan = project.kind === 'audio'
        ? mediaProject.audioRenderPlan(project, output, format, { range: item.range, trackId: item.trackId, cover })
        : mediaProject.videoRenderPlan(project, output, item.resolution);
      return await startFfmpegJob(event, mediaProjectJobs, item.id, plan.args, output, plan.duration, 'media-project-event');
    } catch (error) {
      if (fs.existsSync(output)) await fs.promises.unlink(output).catch(() => {});
      throw error;
    } finally {
      await Promise.all(preparedImages.map(prepared => prepared.cleanup()));
    }
  });
  ipcMain.handle('cancel-media-project-render', (event, id) => { assertMainWindowSender(event); return mediaProjectJobs.get(id)?.cancel?.(); });
  // Editor de vídeo v2: mantém o caminho de projeto sob autoridade do processo principal.
  const checkedVideoAsset = async file => {
    const original = String(file || '');
    const extension = path.extname(original).toLowerCase();
    const kind = imageExtensions.includes(extension) ? 'image' : videoExtensions.includes(extension) ? 'video' : audioExtensions.includes(extension) ? 'audio' : null;
    if (!kind) throw new Error('Formato de mídia não suportado.');
    const resolved = await fs.promises.realpath(path.resolve(original));
    if (!(await fs.promises.stat(resolved)).isFile()) throw new Error('Mídia não é um arquivo.');
    return { resolved, kind };
  };
  const inspectVideoProjectAsset = async file => {
    const { resolved, kind } = await checkedVideoAsset(file);
    if (kind === 'image') {
      const prepared = await prepareImageInput(resolved);
      try {
        const meta = await sharp(prepared.file, { limitInputPixels: 268_402_689 }).metadata();
        if (!meta.width || !meta.height) throw new Error('Imagem inválida.');
        return { path: resolved, kind, name: path.basename(resolved), durationMs: 0, width: meta.width, height: meta.height, fps: 0, hasAudio: false };
      } finally { await prepared.cleanup(); }
    }
    const probe = JSON.parse(await run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', resolved]));
    const streams = probe.streams || [];
    const visual = streams.find(stream => stream.codec_type === 'video' && !stream.disposition?.attached_pic);
    const audio = streams.find(stream => stream.codec_type === 'audio');
    if (kind === 'video' && !visual || kind === 'audio' && !audio) throw new Error('A mídia não contém a faixa esperada.');
    const durationMs = Math.round(Number(probe.format?.duration || visual?.duration || audio?.duration || 0) * 1000);
    if (!Number.isSafeInteger(durationMs) || durationMs < videoProject.MIN_CLIP_MS || durationMs > videoProject.MAX_PROJECT_MS) throw new Error('Duração da mídia inválida.');
    const rate = String(visual?.avg_frame_rate || '0/1').split('/').map(Number);
    return { path: resolved, kind, name: path.basename(resolved), durationMs, width: visual?.width || 0, height: visual?.height || 0, fps: rate[1] ? rate[0] / rate[1] : 0, hasAudio: Boolean(audio) };
  };
  ipcMain.handle('video-project-choose-media', async event => {
    assertMainWindowSender(event);
    const result = await dialog.showOpenDialog({ title: 'Importar mídia', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Imagens, vídeos e áudios', extensions: [...new Set([...imageExtensions, ...videoExtensions, ...audioExtensions].map(ext => ext.slice(1)))] }] });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle('video-project-inspect-media', async (event, file) => { assertMainWindowSender(event); return inspectVideoProjectAsset(file); });
  ipcMain.handle('video-project-thumbnail', async (event, file) => {
    assertMainWindowSender(event);
    const { resolved, kind } = await checkedVideoAsset(file);
    if (kind === 'audio') return '';
    if (kind === 'image') {
      const prepared = await prepareImageInput(resolved);
      try {
        const data = await sharp(prepared.file).rotate().resize(180, 104, { fit: 'contain', background: '#111111' }).jpeg({ quality: 70 }).toBuffer();
        return `data:image/jpeg;base64,${data.toString('base64')}`;
      } finally { await prepared.cleanup(); }
    }
    const data = await runBuffer('ffmpeg', ['-v', 'error', '-ss', '0', '-i', resolved, '-frames:v', '1', '-vf', 'scale=180:104:force_original_aspect_ratio=decrease,pad=180:104:(ow-iw)/2:(oh-ih)/2', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1']);
    return `data:image/jpeg;base64,${data.toString('base64')}`;
  });
  ipcMain.handle('video-project-filmstrip', async (event, value) => {
    assertMainWindowSender(event);
    const count = Math.max(1, Math.min(8, Math.round(Number(value?.count) || 1)));
    const { resolved, kind } = await checkedVideoAsset(value?.file);
    if (kind !== 'video') throw new Error('Filmstrip disponível apenas para vídeo.');
    const stat = await fs.promises.stat(resolved);
    const inspected = await inspectVideoProjectAsset(resolved);
    const durationSeconds = inspected.durationMs / 1000;
    const startSeconds = Math.max(0, Math.min(durationSeconds, Number(value?.startMs) / 1000 || 0));
    const requestedSeconds = Math.max(0.001, Number(value?.durationMs) / 1000 || durationSeconds - startSeconds);
    const spanSeconds = Math.max(0.001, Math.min(requestedSeconds, durationSeconds - startSeconds));
    const key = `${resolved}:${stat.mtimeMs}:${stat.size}:${startSeconds}:${spanSeconds}:${count}`;
    if (videoProjectFilmstripCache.has(key)) return videoProjectFilmstripCache.get(key);
    const frames = [];
    for (let index = 0; index < count; index++) {
      const at = Math.max(0, Math.min(durationSeconds, startSeconds + spanSeconds * (index + 0.5) / count));
      const data = await runBuffer('ffmpeg', ['-v', 'error', '-ss', at.toFixed(3), '-i', resolved, '-frames:v', '1', '-vf', 'scale=184:104:force_original_aspect_ratio=increase,crop=184:104', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1']);
      frames.push(`data:image/jpeg;base64,${data.toString('base64')}`);
    }
    if (videoProjectFilmstripCache.size >= 48) videoProjectFilmstripCache.delete(videoProjectFilmstripCache.keys().next().value);
    videoProjectFilmstripCache.set(key, frames);
    return frames;
  });
  ipcMain.handle('video-project-preview-source', async (event, file) => {
    assertMainWindowSender(event);
    const { resolved, kind } = await checkedVideoAsset(file);
    const convertedImage = kind === 'image' && ['.heic', '.heif', '.tif', '.tiff', '.avif'].includes(path.extname(resolved).toLowerCase());
    const convertedVideo = kind === 'video' && !['.mp4', '.m4v', '.webm'].includes(path.extname(resolved).toLowerCase());
    if (!convertedImage && !convertedVideo) return resolved;
    const stat = await fs.promises.stat(resolved);
    const key = `${resolved}:${stat.mtimeMs}:${stat.size}`;
    if (videoProjectPreviewCache.has(key)) return videoProjectPreviewCache.get(key);
    if (videoProjectPreviewJobs.has(key)) return videoProjectPreviewJobs.get(key);
    const pending = (async () => {
      const digest = require('node:crypto').createHash('sha256').update(key).digest('hex');
      const destination = path.join(app.getPath('temp'), convertedImage ? `ntc-image-preview-${digest}.png` : `ntc-video-preview-${digest}.mp4`);
      if (!fs.existsSync(destination)) {
        const temporary = `${destination}.${require('node:crypto').randomUUID()}${convertedImage ? '.png' : '.mp4'}`;
        try {
          if (convertedImage) {
            const prepared = await prepareImageInput(resolved);
            try { await sharp(prepared.file).rotate().png().toFile(temporary); }
            finally { await prepared.cleanup(); }
          } else await run('ffmpeg', ['-v', 'error', '-y', '-i', resolved, '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '29', '-c:a', 'aac', '-movflags', '+faststart', temporary]);
          await fs.promises.rename(temporary, destination);
        } catch (failure) { await fs.promises.unlink(temporary).catch(() => {}); throw failure; }
      }
      videoProjectPreviewCache.set(key, destination);
      return destination;
    })();
    videoProjectPreviewJobs.set(key, pending);
    try { return await pending; } finally { videoProjectPreviewJobs.delete(key); }
  });
  ipcMain.handle('video-project-new', event => { assertMainWindowSender(event); videoProjectFile = ''; return true; });
  ipcMain.handle('video-project-confirm-changes', async event => {
    assertMainWindowSender(event);
    const result = await dialog.showMessageBox(mainWindow, { type: 'warning', title: 'Alterações não salvas', message: 'Salvar alterações no projeto antes de continuar?', buttons: ['Salvar', 'Descartar', 'Cancelar'], defaultId: 0, cancelId: 2, noLink: true });
    return ['save', 'discard', 'cancel'][result.response] || 'cancel';
  });
  ipcMain.handle('video-project-open', async event => {
    assertMainWindowSender(event);
    const result = await dialog.showOpenDialog({ title: 'Abrir projeto de vídeo', properties: ['openFile'], filters: [{ name: 'Projeto NTC', extensions: ['ntcmp'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const file = result.filePaths[0];
    if ((await fs.promises.stat(file)).size > 5 * 1024 * 1024) throw new Error('Projeto excede o limite seguro de 5 MB.');
    const source = JSON.parse(await fs.promises.readFile(file, 'utf8'));
    const project = videoProject.normalizeProject(source);
    videoProjectFile = file;
    return { project, file, migrated: project.schemaVersion !== source.schemaVersion };
  });
  ipcMain.handle('video-project-save', async (event, value) => {
    assertMainWindowSender(event);
    const project = videoProject.normalizeProject(value.project);
    let target = value.saveAs ? '' : videoProjectFile;
    if (!target) {
      const result = await dialog.showSaveDialog({ title: 'Salvar projeto de vídeo', defaultPath: videoProjectFile || `${safeName(project.name)}.ntcmp`, filters: [{ name: 'Projeto NTC', extensions: ['ntcmp'] }] });
      if (result.canceled || !result.filePath) return null;
      target = path.extname(result.filePath).toLowerCase() === '.ntcmp' ? result.filePath : `${result.filePath}.ntcmp`;
    }
    const temporary = `${target}.${require('node:crypto').randomUUID()}.tmp`;
    try { await fs.promises.writeFile(temporary, `${JSON.stringify(project, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' }); await fs.promises.rename(temporary, target); }
    catch (error) { await fs.promises.unlink(temporary).catch(() => {}); throw error; }
    videoProjectFile = target;
    return { file: target, name: path.basename(target) };
  });
  const recoveryFile = path.join(app.getPath('userData'), 'ntc-video-project-recovery.json');
  const queueRecovery = task => {
    const current = videoProjectRecoveryQueue.then(task);
    videoProjectRecoveryQueue = current.catch(() => {});
    return current;
  };
  ipcMain.handle('video-project-save-recovery', (event, value) => {
    assertMainWindowSender(event);
    const project = videoProject.normalizeProject(value);
    const contents = `${JSON.stringify(project)}\n`;
    if (Buffer.byteLength(contents) > 5 * 1024 * 1024) throw new Error('Projeto excede o limite de recuperação de 5 MB.');
    return queueRecovery(async () => {
      const temporary = `${recoveryFile}.${require('node:crypto').randomUUID()}.tmp`;
      try { await fs.promises.writeFile(temporary, contents, { encoding: 'utf8', flag: 'wx' }); await fs.promises.rename(temporary, recoveryFile); }
      catch (failure) { await fs.promises.unlink(temporary).catch(() => {}); throw failure; }
      return true;
    });
  });
  ipcMain.handle('video-project-clear-recovery', event => { assertMainWindowSender(event); return queueRecovery(async () => { await fs.promises.unlink(recoveryFile).catch(error => { if (error.code !== 'ENOENT') throw error; }); return true; }); });
  ipcMain.handle('video-project-load-recovery', event => {
    assertMainWindowSender(event);
    return queueRecovery(async () => {
      if (!fs.existsSync(recoveryFile)) return null;
      if ((await fs.promises.stat(recoveryFile)).size > 5 * 1024 * 1024) return null;
      let project;
      try { project = videoProject.normalizeProject(JSON.parse(await fs.promises.readFile(recoveryFile, 'utf8'))); }
      catch { return null; }
      const choice = await dialog.showMessageBox(mainWindow, { type: 'question', title: 'Projeto não salvo', message: 'Foi encontrada uma edição não salva do Editor de Vídeo.', detail: 'Restaurar não altera o arquivo .ntcmp original.', buttons: ['Restaurar', 'Descartar recuperação'], defaultId: 0, cancelId: 0, noLink: true });
      if (choice.response === 1) await fs.promises.unlink(recoveryFile).catch(() => {});
      return choice.response === 0 ? project : null;
    });
  });
  ipcMain.handle('video-project-render', async (event, item) => {
    assertMainWindowSender(event);
    if (!item?.id || mediaProjectJobs.has(item.id) || mediaProjectJobs.size) throw new Error('Já existe uma exportação em andamento.');
    const project = videoProject.normalizeProject(item.project);
    const folder = path.resolve(String(item.folder || ''));
    if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) throw new Error('Escolha uma pasta de destino existente.');
    const sourcePaths = new Set();
    const usedAssets = new Set(project.tracks.flatMap(track => track.clips.map(clip => clip.assetId)).filter(Boolean));
    for (const asset of project.assets) {
      if (!usedAssets.has(asset.id)) continue;
      const checked = await checkedVideoAsset(asset.path).catch(() => { throw new Error(`Mídia não encontrada: ${asset.name}`); });
      if (checked.kind !== asset.kind) throw new Error(`Tipo de mídia incorreto: ${asset.name}`);
      asset.path = checked.resolved;
      sourcePaths.add(checked.resolved.toLocaleLowerCase('en-US'));
    }
    const name = safeName(item.outputName || project.name || 'Vídeo NTC');
    let filename = availableFilename(folder, `${name}.mp4`, 'rename');
    let output = path.join(folder, filename);
    if (sourcePaths.has(output.toLocaleLowerCase('en-US'))) { filename = availableFilename(folder, `${name} (exportado).mp4`, 'rename'); output = path.join(folder, filename); }
    const temporaryFiles = [];
    try {
      const textFiles = {};
      for (const track of project.tracks) for (const clip of track.clips) if (clip.type === 'text') {
        const file = path.join(app.getPath('temp'), `ntc-title-${require('node:crypto').randomUUID()}.png`);
        await writeTextPng(clip.text, file);
        temporaryFiles.push(file); textFiles[clip.id] = file;
      }
      for (const asset of project.assets) if (usedAssets.has(asset.id) && asset.kind === 'image' && ['.heic', '.heif', '.avif'].includes(path.extname(asset.path).toLowerCase())) {
        const prepared = await prepareImageInput(asset.path);
        if (prepared.file !== asset.path) { temporaryFiles.push(prepared.file); asset.path = prepared.file; }
      }
      const plan = buildVideoProjectRenderPlan(project, output, { ...item.options, textFiles });
      return await startFfmpegJob(event, mediaProjectJobs, item.id, plan.args, output, plan.duration, 'video-project-event');
    } catch (error) { await fs.promises.unlink(output).catch(() => {}); throw error; }
    finally { await Promise.all(temporaryFiles.map(file => fs.promises.unlink(file).catch(() => {}))); }
  });
  ipcMain.handle('video-project-cancel-render', (event, id) => { assertMainWindowSender(event); return mediaProjectJobs.get(id)?.cancel?.(); });
  ipcMain.handle('start-image-conversion', async (event, item) => {
    if (!item?.id || !item.source || !item.folder || !fs.existsSync(item.source)) throw new Error('Dados da imagem inválidos.'); const format = ['jpg', 'png', 'webp'].includes(item.format) ? item.format : 'jpg'; const filename = availableFilename(item.folder, `${safeName(item.outputName || path.basename(item.source, path.extname(item.source)))}.${format}`, item.duplicate); const output = path.join(item.folder, filename); let cancelled = false; imageJobs.set(item.id, { cancel: () => { cancelled = true; } }); send(event.sender, 'image-event', { id: item.id, status: 'converting', percent: 10 });
    let prepared;
    try { prepared = await prepareImageInput(item.source); let pipeline = sharp(prepared.file).rotate(); const metadata = await sharp(prepared.file).metadata(); const { width, height } = imageDimensions(metadata, item); const quality = Math.max(1, Math.min(100, Number(item.quality) || 85)); if (width || height) pipeline = pipeline.resize(width, height, { fit: item.keepRatio === false ? 'fill' : 'inside', withoutEnlargement: false }); pipeline = applyLowQualityPixelation(pipeline, width, height, quality); if (format === 'jpg') pipeline = pipeline.flatten({ background: '#ffffff' }).jpeg({ quality }); if (format === 'png') pipeline = pipeline.png({ palette: true, quality, compressionLevel: 9 }); if (format === 'webp') pipeline = pipeline.webp({ quality }); await pipeline.toFile(output); imageJobs.delete(item.id); if (cancelled) { if (fs.existsSync(output)) fs.unlinkSync(output); throw new Error('Operação cancelada.'); } const stat = fs.statSync(output); send(event.sender, 'image-event', { id: item.id, status: 'complete', file: output, size: stat.size, filename }); return { file: output, size: stat.size, filename }; } catch (error) { imageJobs.delete(item.id); throw error; } finally { await prepared?.cleanup(); }
  });
  ipcMain.handle('cancel-image-conversion', (_event, id) => imageJobs.get(id)?.cancel?.());
  ipcMain.handle('start-compression', async (_event, item) => {
    if (!item?.source || !item?.folder || !fs.existsSync(item.source)) throw new Error('Arquivo ou pasta de destino inválidos.'); const ext = path.extname(item.source).toLowerCase(); const base = safeName(path.basename(item.source, ext));
    if (imageExtensions.includes(ext)) { const output = path.join(item.folder, availableFilename(item.folder, `${base} comprimido.jpg`, item.duplicate)); const quality = Math.max(1, Math.min(100, Number(item.imageQuality) || 60)); const scale = Math.max(.01, Number(item.imageScale || 100) / 100); const prepared = await prepareImageInput(item.source); try { const meta = await sharp(prepared.file).metadata(); await sharp(prepared.file).rotate().resize(Math.max(1, Math.round((meta.width || 1) * scale)), Math.max(1, Math.round((meta.height || 1) * scale))).jpeg({ quality }).toFile(output); const stat = fs.statSync(output); return { file: output, size: stat.size, kind: 'image' }; } finally { await prepared.cleanup(); } }
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
app.on('before-quit', event => {
  if (!rngOnlineQuitReady && rngOnlineService) {
    event.preventDefault();
    if (rngOnlineQuitStarted) return;
    rngOnlineQuitStarted = true;
    void rngOnlineService.flush(1200).finally(() => {
      rngOnlineService?.dispose();
      rngOnlineQuitReady = true;
      app.quit();
    });
  }
  rngShadowService?.dispose();
  clipboardHistoryService?.dispose();
  autoClickerService?.dispose();
  colorPickerService?.dispose();
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
app.on('will-quit', () => {
  musicLibraryService?.cleanup();
  for (const file of videoProjectPreviewCache.values()) {
    try { if (file.startsWith(app.getPath('temp')) && fs.existsSync(file)) fs.unlinkSync(file); } catch { /* Um player ainda pode manter o proxy aberto no Windows. */ }
  }
  videoProjectPreviewCache.clear();
  videoProjectFilmstripCache.clear();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
