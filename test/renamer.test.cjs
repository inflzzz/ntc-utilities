const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRenamePlan, validateRenamePlan } = require('../src/renamer.js');
const { expandRenamePaths, previewFileRenames, renameFiles } = require('../src/renamer-files.cjs');

test('prefix, find/replace, and suffix change only the base name and keep its extension', () => {
  const file = path.join(os.tmpdir(), 'holiday draft.png');
  const [item] = createRenamePlan([file], { prefix: 'trip-', find: 'draft', replacement: 'final', suffix: '-2026' });
  assert.equal(item.newName, 'trip-holiday final-2026.png');
  assert.equal(item.destination, path.join(os.tmpdir(), item.newName));
});

test('numbering supports a zero start, padding, and position', () => {
  const files = ['one.jpg', 'two.jpg'].map(name => path.join(os.tmpdir(), name));
  const plan = createRenamePlan(files, { numbering: true, numberStart: '0', numberDigits: '4', numberPosition: 'prefix', numberSeparator: '_' });
  assert.deepEqual(plan.map(item => item.newName), ['0000_one.jpg', '0001_two.jpg']);
});

test('preview flags duplicate destinations and existing files instead of overwriting', () => {
  const folder = os.tmpdir();
  const duplicate = createRenamePlan([path.join(folder, 'photo copy.txt'), path.join(folder, 'photo copy copy.txt')], { find: ' copy', replacement: '' });
  const duplicateResult = validateRenamePlan(duplicate);
  assert.equal(duplicateResult.valid, false);
  assert.ok(duplicateResult.items.every(item => item.status === 'duplicate'));

  const occupied = createRenamePlan([path.join(folder, 'source.txt')], { prefix: 'taken-' });
  const occupiedResult = validateRenamePlan(occupied, file => file === path.join(folder, 'taken-source.txt'));
  assert.equal(occupiedResult.items[0].status, 'exists');
});

test('preview rejects invalid Windows names and files beyond the supported limit', () => {
  const invalid = createRenamePlan([path.join(os.tmpdir(), 'valid.txt')], { prefix: '?' });
  assert.equal(validateRenamePlan(invalid).items[0].status, 'invalid');
  assert.throws(() => createRenamePlan(Array(1001).fill(path.join(os.tmpdir(), 'file.txt'))), /no máximo 1000/);
});

test('file preview and rename preserve content and never replace an occupied destination', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ntc-renamer-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const first = path.join(folder, 'report one.txt');
  const second = path.join(folder, 'report two.txt');
  fs.writeFileSync(first, 'first');
  fs.writeFileSync(second, 'second');

  const preview = previewFileRenames([first, second], { prefix: 'archived-' });
  assert.equal(preview.valid, true);
  assert.equal(preview.changedCount, 2);
  const result = renameFiles([first, second], { prefix: 'archived-' });
  assert.equal(result.renamedCount, 2);
  assert.equal(fs.readFileSync(path.join(folder, 'archived-report one.txt'), 'utf8'), 'first');
  assert.equal(fs.readFileSync(path.join(folder, 'archived-report two.txt'), 'utf8'), 'second');

  const source = path.join(folder, 'notes.txt');
  const occupied = path.join(folder, 'new-notes.txt');
  fs.writeFileSync(source, 'original source');
  fs.writeFileSync(occupied, 'keep this');
  assert.equal(previewFileRenames([source], { prefix: 'new-' }).valid, false);
  assert.throws(() => renameFiles([source], { prefix: 'new-' }), /Já existe/);
  assert.equal(fs.readFileSync(source, 'utf8'), 'original source');
  assert.equal(fs.readFileSync(occupied, 'utf8'), 'keep this');
});

test('dropping a folder recursively previews and renames its files in deterministic order', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ntc-renamer-folder-'));
  const nested = path.join(folder, 'subfolder');
  fs.mkdirSync(nested);
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  fs.writeFileSync(path.join(folder, 'b.txt'), 'B');
  fs.writeFileSync(path.join(folder, 'a.txt'), 'A');
  fs.writeFileSync(path.join(nested, 'c.txt'), 'C');

  const expanded = expandRenamePaths([folder, path.join(folder, 'a.txt')]);
  assert.deepEqual(expanded.files.map(file => path.basename(file)), ['a.txt', 'b.txt', 'c.txt']);
  const preview = previewFileRenames([folder], { numbering: true, numberStart: 1, numberDigits: 2 });
  assert.equal(preview.valid, true);
  assert.equal(preview.items.length, 3);
  assert.deepEqual(preview.items.map(item => item.newName), ['a-01.txt', 'b-02.txt', 'c-03.txt']);

  const result = renameFiles([folder], { numbering: true, numberStart: 1, numberDigits: 2 });
  assert.equal(result.renamedCount, 3);
  assert.equal(fs.readFileSync(path.join(folder, 'a-01.txt'), 'utf8'), 'A');
  assert.equal(fs.readFileSync(path.join(folder, 'b-02.txt'), 'utf8'), 'B');
  assert.equal(fs.readFileSync(path.join(nested, 'c-03.txt'), 'utf8'), 'C');
});

test('the renamer is an independent navigable tool with dedicated preload APIs', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.cjs'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8');
  const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'renamer-ui.js'), 'utf8');
  assert.match(html, /data-view="renamer"/);
  assert.match(html, /data-open-tool="renamer"/);
  assert.match(html, /id="renamerView"/);
  assert.match(html, /id="renamePreviewList"/);
  assert.match(preload, /chooseRenameFiles/);
  assert.match(preload, /previewFileRenames/);
  assert.match(preload, /renameFiles/);
  assert.match(main, /preview-file-renames/);
  assert.match(main, /rename-files/);
  assert.match(ui, /hasCompletedResults = true/);
  assert.match(ui, /disabled = \(!selectedFiles\.length && !hasCompletedResults\) \|\| working/);
  assert.match(ui, /hasCompletedResults = false;[\s\S]*schedulePreview\(\)/);
});
