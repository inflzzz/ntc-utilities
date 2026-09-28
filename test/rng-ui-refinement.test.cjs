'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');

test('active-luck block is hidden in the roll UI while existing values remain calculated', () => {
  assert.match(html, /class="rng-luck-line"[^>]*hidden/);
  assert.match(html, /class="rng-luck-total"><span>SORTE ATIVA<\/span><strong id="rngLuckValue"/);
  for (const [label, id] of [
    ['Coleção', 'rngCollectionLuck'], ['Conquistas', 'rngAchievementLuck'],
    ['Segredos', 'rngSecretLuck'], ['Loja', 'rngUpgradeLuck'], ['Relíquias', 'rngRelicLuck']
  ]) assert.match(html, new RegExp(`<span>${label}<\\/span><strong id="${id}"`));
  assert.match(app, /rngLuckValue'\)\.textContent = `\+\$\{formatRngExactPercent\(exactLuckBonus\)\}`/);
  assert.match(app, /rngRelicLuck'\)\.textContent = formatRngRelicLuck\(state\.relicLuckMultiplierBps\)/);
  assert.match(styles, /\.rng-luck-line\[hidden\] \{ display: none !important; \}/);
  assert.match(styles, /\.rng-luck-total > strong \{[^}]*font-size: 22px/);
  assert.match(styles, /\.rng-luck-source > strong \{[^}]*font-size: 12px/);
});


test('profile telemetry is summarized visually with accessible technical tooltips', () => {
  assert.match(html, /id="rngProfileLuckProgress"/);
  assert.match(html, /id="rngProfileMilestones"/);
  assert.match(html, /id="rngProfileOutlierOdds"/);
  assert.match(html, /role="tooltip"/);
  assert.match(styles, /\.rng-context-tip:focus-within/);
  assert.match(styles, /\.rng-profile-tier-rows \{[^}]*repeat\(5/);
});

test('profile progression responds to its usable content width', () => {
  assert.match(styles, /\.rng-player-profile \{[^}]*container-type: inline-size/);
  assert.match(styles, /@container \(max-width: 640px\)[\s\S]*\.rng-profile-tier-rows/);
});

test('profile and store layouts respond to their usable content width', () => {
  assert.match(styles, /@container \(max-width: 1000px\)[\s\S]*\.rng-player-record \{[^}]*grid-column: 1 \/ -1/);
  assert.match(styles, /\.rng-shop-section \{[^}]*container-type: inline-size/);
  assert.match(styles, /@container \(max-width: 900px\)[\s\S]*\.rng-shop-grid, \.rng-relic-grid/);
});
