const https = require('node:https');

const SOURCES = [
  { url: 'https://utctime.app/api/now', parse: body => Number(body.unix_ms) },
  { url: 'https://timeapi.io/api/Time/current/zone?timeZone=UTC', parse: body => Date.UTC(body.year, body.month - 1, body.day, body.hour, body.minute, body.seconds, body.milliSeconds || 0) }
];
const MAX_AGE_MS = 5 * 60_000;

function readJson(url, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { timeout: timeoutMs, headers: { accept: 'application/json', 'cache-control': 'no-cache' } }, response => {
      if (response.statusCode !== 200) { response.resume(); reject(new Error(`HTTP ${response.statusCode}`)); return; }
      let data = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { data += chunk; if (data.length > 16_384) request.destroy(new Error('Resposta de horário grande demais.')); });
      response.on('end', () => { try { resolve(JSON.parse(data)); } catch (error) { reject(error); } });
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('Tempo esgotado ao verificar horário.')));
    request.on('error', reject);
  });
}

class TrustedClock {
  constructor({ request = readJson, monotonic = () => process.hrtime.bigint() } = {}) {
    this.request = request;
    this.monotonic = monotonic;
    this.anchorUtc = null;
    this.anchorMono = null;
    this.source = null;
    this.pending = null;
  }
  invalidate() { this.anchorUtc = null; this.anchorMono = null; this.source = null; }
  now() {
    if (this.anchorMono === null) return null;
    const elapsed = Number((this.monotonic() - this.anchorMono) / 1_000_000n);
    if (elapsed < 0 || elapsed > MAX_AGE_MS) { this.invalidate(); return null; }
    return this.anchorUtc + elapsed;
  }
  status() { return { verified: this.now() !== null, utcMs: this.now(), source: this.source }; }
  async sync() {
    if (this.pending) return this.pending;
    this.pending = (async () => {
      for (const source of SOURCES) {
        try {
          const before = this.monotonic();
          const body = await this.request(source.url);
          const after = this.monotonic();
          const roundTrip = Number((after - before) / 1_000_000n);
          const utc = source.parse(body);
          if (!Number.isFinite(utc) || utc < Date.UTC(2025, 0, 1) || roundTrip < 0 || roundTrip > 10_000) throw new Error('Horário inválido.');
          this.anchorUtc = utc + Math.floor(roundTrip / 2);
          this.anchorMono = after;
          this.source = source.url;
          return this.status();
        } catch { /* Try the independent backup. */ }
      }
      this.invalidate();
      return this.status();
    })();
    try { return await this.pending; } finally { this.pending = null; }
  }
}

module.exports = { TrustedClock, SOURCES, MAX_AGE_MS };
