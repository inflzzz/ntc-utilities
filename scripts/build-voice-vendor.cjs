const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const esbuild = require.resolve('esbuild/bin/esbuild');
execFileSync(process.execPath, [esbuild, path.join(__dirname, 'voice-vendor-entry.mjs'), '--bundle', '--format=esm', '--platform=browser', '--target=chrome130', `--outfile=${path.join(root, 'src', 'voice-vendor.mjs')}`], { stdio: 'inherit' });
const destination = path.join(root, 'src', 'voice-vendor');
fs.mkdirSync(destination, { recursive: true });
for (const [name, file] of [
  ['soundtouch-processor.js', '@soundtouchjs/audio-worklet/processor'],
  ['formant-correction-processor.js', '@soundtouchjs/formant-correction-worklet/processor']
]) fs.copyFileSync(require.resolve(file), path.join(destination, name));
for (const [name, packageName] of [
  ['LICENSE-audio-worklet.txt', '@soundtouchjs/audio-worklet'],
  ['LICENSE-formant-correction-worklet.txt', '@soundtouchjs/formant-correction-worklet']
]) fs.copyFileSync(path.join(path.dirname(require.resolve(`${packageName}/package.json`)), 'LICENSE'), path.join(destination, name));
