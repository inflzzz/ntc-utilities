const path = require('node:path');
const { Worker } = require('node:worker_threads');

const rootPath = process.argv[2];
if (!rootPath) throw new Error('Passe o caminho da pasta ou volume como argumento.');

const workerFile = path.join(__dirname, '..', 'src', 'storage-analyzer-worker.cjs');
const options = process.argv.slice(3);
const helperOverride = options.find(option => option.startsWith('--helper='));
const helperPath = helperOverride ? path.resolve(helperOverride.slice('--helper='.length)) : options.includes('--native') ? path.join(__dirname, '..', 'resources', 'bin', 'storage-scan-fast.exe') : '';
const verifyNative = options.includes('--verify-native');
const cancelBuffer = new SharedArrayBuffer(4);
const cpuStart = process.cpuUsage();
const wallStart = process.hrtime.bigint();
let peakRss = process.memoryUsage().rss;
const rssTimer = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 50);

const worker = new Worker(workerFile);
let finished = false;
const timeout = setTimeout(() => fail(), 30 * 60 * 1000);
const fail = () => { if (finished) return; finished = true; clearTimeout(timeout); clearInterval(rssTimer); console.error('Scanner benchmark failed; no paths or file names were recorded.'); process.exitCode = 1; worker.terminate(); };
worker.on('error', fail);
worker.on('exit', () => { if (!finished) fail(); });
worker.on('message', message => {
  if (message.type === 'ready') worker.postMessage({ type: 'scan', rootPath, cancelBuffer, profile: true, helperPath, verifyNative });
  if (message.type === 'failure') fail();
  if (message.type !== 'complete') return;
  finished = true;
  clearTimeout(timeout);
  clearInterval(rssTimer);
  const elapsedMs = Number(process.hrtime.bigint() - wallStart) / 1e6;
  const cpu = process.cpuUsage(cpuStart);
  const payload = message.payload;
  console.log(JSON.stringify({
    dataset: 'local-real-read-only',
    files: payload.files,
    folders: payload.folders,
    links: Math.max(0, payload.entries - payload.files - payload.folders - 1),
    entries: payload.entries,
    logicalBytes: payload.logical,
    allocatedBytes: payload.allocated,
    errors: payload.errors,
    elapsedMs: +elapsedMs.toFixed(2),
    entriesPerSecond: Math.round(payload.entries / (elapsedMs / 1000)),
    cpuUserMs: +(cpu.user / 1000).toFixed(2),
    cpuSystemMs: +(cpu.system / 1000).toFixed(2),
    cpuPercentOfOneCore: +(((cpu.user + cpu.system) / 1000) / elapsedMs * 100).toFixed(1),
    workerModelBytes: payload.memoryBytes,
    processPeakRssBytes: peakRss,
    ...payload.profile
  }, null, 2));
  worker.terminate();
});
