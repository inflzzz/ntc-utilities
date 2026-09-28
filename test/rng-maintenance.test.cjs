'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const availability = require(path.join(root, 'src', 'rng-availability.js'));
const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');

test('NTC RNG navigation is routed to the reversible maintenance view by default', () => {
  assert.equal(availability.mode, 'maintenance');
  assert.equal(availability.gameUiEnabled, false);
  assert.equal(availability.resolveView('rng'), 'rngMaintenance');
  for (const view of ['home', 'downloader', 'converter', 'settings', 'history']) {
    assert.equal(availability.resolveView(view), view);
  }
  assert.match(app, /const viewTarget = window\.NTCRngAvailability\?\.resolveView\(target\) \|\| \(target === 'rng' \? 'rngMaintenance' : target\)/);
  assert.match(app, /view\.id === `\$\{viewTarget\}View`/);
  assert.match(app, /button\.onclick = \(\) => navigateToView\(button\.dataset\.view\)/);
  assert.match(app, /button\.onclick = \(\) => navigateToView\(button\.dataset\.openTool\)/);
  assert.match(app, /if \(!window\.NTCRngAvailability\?\.gameUiEnabled\) \{[\s\S]*?if \(notice\.open\) notice\.close\(\);[\s\S]*?notice\.hidden = true/);
});

test('NTC RNG remains in navigation and launcher, while maintenance content is separate from the game UI', () => {
  assert.match(html, /class="nav-item rng-nav-item" data-view="rng"[^>]*>[^<]*<span class="nav-icon">✧<\/span> NTC RNG/);
  assert.match(html, /class="home-game-card"[^>]*data-open-tool="rng"/);
  const maintenanceView = html.match(/<section class="view rng-maintenance-view" id="rngMaintenanceView"[\s\S]*?<\/section>/)?.[0];
  assert.ok(maintenanceView);
  assert.match(maintenanceView, /NTC RNG[\s\S]*?Em manutenção[\s\S]*?Estamos preparando uma nova versão do NTC RNG\.[\s\S]*?O jogo ficará temporariamente indisponível/);
  assert.match(maintenanceView, /transform="translate\(1\.75 0\)"/);
  assert.doesNotMatch(maintenanceView, /rng-roll|rng-profile|rng-shop|rng-online|rng-collection/i);
  assert.match(html, /id="rngView"/);
  assert.match(html, /src="\.\/rng-availability\.js"/);
  assert.match(app, /rngRollExperience\?\.setVisible\(viewTarget === 'rng' && !document\.hidden\)/);
});
