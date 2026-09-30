import { SoundTouchNode, FormantCorrectionNode } from './voice-vendor.mjs';

const clamp = (value, low, high) => Math.max(low, Math.min(high, Number.isFinite(value) ? value : low));
const smooth = (param, value, context, seconds = 0.018) => {
  param.cancelScheduledValues(context.currentTime);
  param.setTargetAtTime(value, context.currentTime, seconds);
};

export async function prepareVoiceContext(context) {
  await Promise.all([
    SoundTouchNode.register(context, new URL('./voice-vendor/soundtouch-processor.js', import.meta.url).href),
    FormantCorrectionNode.register(context, new URL('./voice-vendor/formant-correction-processor.js', import.meta.url).href),
    context.audioWorklet.addModule(new URL('./voice-effects-processor.js', import.meta.url).href)
  ]);
}

function impulse(context, seconds) {
  const length = Math.min(Math.ceil(context.sampleRate * seconds), context.sampleRate * 5);
  const buffer = context.createBuffer(2, length, context.sampleRate);
  let seed = 0x74165;
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      data[i] = ((seed >>> 0) / 2147483648 - 1) * Math.pow(1 - i / length, 2.2);
    }
  }
  return buffer;
}

function createModule(context, effect) {
  const nodes = [], timers = [];
  const add = node => { nodes.push(node); return node; };
  const input = add(context.createGain()), output = add(context.createGain());
  const p = effect.params;
  const split = (processor, mix = 1) => {
    const dry = add(context.createGain()), wet = add(context.createGain());
    dry.gain.value = 1 - mix; wet.gain.value = mix;
    input.connect(dry).connect(output);
    input.connect(processor); processor.connect(wet).connect(output);
  };
  switch (effect.type) {
    case 'gate': {
      const node = add(new AudioWorkletNode(context, 'ntc-voice-gate'));
      for (const key of ['threshold', 'attack', 'release']) node.parameters.get(key).value = p[key];
      input.connect(node).connect(output);
      break;
    }
    case 'pitch': {
      if (p.semitones === 0) { input.connect(output); break; }
      const node = add(new FormantCorrectionNode({ context }));
      node.setStretchParameters({ sequenceMs: 40, seekWindowMs: 12, overlapMs: 8 });
      node.pitchSemitones.value = p.semitones;
      node.formantStrength.value = 1;
      input.connect(node).connect(output);
      break;
    }
    case 'formant': {
      if (p.semitones === 0) { input.connect(output); break; }
      // Raw transposition moves pitch + vocal tract envelope together. A second,
      // LPC-corrected inverse transpose restores F0 while retaining that envelope.
      const raw = add(new SoundTouchNode({ context }));
      const restore = add(new FormantCorrectionNode({ context }));
      // With LPC correction the perceptual envelope moves opposite to the
      // first transposition, so invert the requested direction here.
      raw.pitchSemitones.value = -p.semitones;
      restore.pitchSemitones.value = p.semitones;
      restore.formantStrength.value = 1;
      input.connect(raw).connect(restore).connect(output);
      break;
    }
    case 'eq': {
      let previous = input;
      for (const [type, frequency, gain] of [['lowshelf', 180, p.bass], ['peaking', 1200, p.mid], ['highshelf', 4300, p.treble]]) {
        const filter = add(context.createBiquadFilter()); filter.type = type; filter.frequency.value = frequency; filter.gain.value = gain;
        if (type === 'peaking') filter.Q.value = 0.7;
        previous.connect(filter); previous = filter;
      }
      previous.connect(output);
      break;
    }
    case 'compressor': {
      const compressor = add(context.createDynamicsCompressor()), makeup = add(context.createGain());
      compressor.threshold.value = p.threshold; compressor.ratio.value = p.ratio;
      compressor.attack.value = p.attack / 1000; compressor.release.value = p.release / 1000;
      makeup.gain.value = Math.pow(10, p.makeup / 20);
      input.connect(compressor).connect(makeup).connect(output);
      break;
    }
    case 'reverb': {
      const convolver = add(context.createConvolver()); convolver.buffer = impulse(context, p.decay);
      split(convolver, p.mix / 100);
      break;
    }
    case 'delay': {
      const delay = add(context.createDelay(1)), feedback = add(context.createGain());
      delay.delayTime.value = p.time / 1000; feedback.gain.value = p.feedback / 100;
      delay.connect(feedback).connect(delay);
      split(delay, p.mix / 100);
      break;
    }
    case 'distortion': {
      const shaper = add(context.createWaveShaper()); shaper.oversample = '2x';
      const curve = new Float32Array(1024), drive = 1 + p.drive / 7;
      for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(((i / (curve.length - 1)) * 2 - 1) * drive) / Math.tanh(drive);
      shaper.curve = curve; split(shaper, p.mix / 100);
      break;
    }
    case 'chorus':
    case 'flanger': {
      const delay = add(context.createDelay(0.1)), oscillator = add(context.createOscillator()), depth = add(context.createGain());
      delay.delayTime.value = effect.type === 'chorus' ? 0.023 : 0.004;
      depth.gain.value = p.depth / 1000;
      oscillator.frequency.value = p.rate;
      oscillator.connect(depth).connect(delay.delayTime);
      oscillator.start(); timers.push(() => oscillator.stop());
      if (effect.type === 'flanger') { const feedback = add(context.createGain()); feedback.gain.value = p.feedback / 100; delay.connect(feedback).connect(delay); }
      split(delay, p.mix / 100);
      break;
    }
    case 'robot': {
      const gain = add(context.createGain()), oscillator = add(context.createOscillator());
      oscillator.type = 'sine'; oscillator.frequency.value = p.frequency; gain.gain.value = 0;
      oscillator.connect(gain.gain); oscillator.start(); timers.push(() => oscillator.stop());
      split(gain, p.mix / 100);
      break;
    }
    case 'telephone': {
      const high = add(context.createBiquadFilter()), low = add(context.createBiquadFilter()), shaper = add(context.createWaveShaper());
      high.type = 'highpass'; high.frequency.value = p.low;
      low.type = 'lowpass'; low.frequency.value = Math.max(p.low + 200, p.high);
      const curve = new Float32Array(1024), drive = 1 + p.drive / 15;
      for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(((i / 1023) * 2 - 1) * drive) / Math.tanh(drive);
      shaper.curve = curve;
      input.connect(high).connect(low).connect(shaper).connect(output);
      break;
    }
    default: input.connect(output);
  }
  return { input, output, dispose() { for (const stop of timers) { try { stop(); } catch {} } for (const node of nodes) { try { node.disconnect(); } catch {} } } };
}

export class VoiceEngine {
  constructor(context, destination = context.destination) {
    this.context = context; this.destination = destination;
    this.input = context.createGain(); this.output = context.createGain();
    this.meterIn = context.createAnalyser(); this.meterOut = context.createAnalyser();
    this.meterIn.fftSize = this.meterOut.fftSize = 1024;
    this.limiter = context.createDynamicsCompressor();
    this.limiter.threshold.value = -3; this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20; this.limiter.attack.value = 0.003; this.limiter.release.value = 0.12;
    this.softClip = context.createWaveShaper();
    const curve = new Float32Array(2048);
    for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(1.25 * (i / 2047 * 2 - 1)) / Math.tanh(1.25);
    this.softClip.curve = curve;
    this.input.connect(this.meterIn);
    this.limiter.connect(this.softClip).connect(this.meterOut).connect(this.output).connect(destination);
    this.current = null;
  }
  setChain(chain) {
    const context = this.context;
    const modules = chain.filter(effect => effect.enabled).map(effect => createModule(context, effect));
    const entrance = context.createGain(), exit = context.createGain();
    exit.gain.value = 0;
    let previous = entrance;
    for (const module of modules) { previous.connect(module.input); previous = module.output; }
    previous.connect(exit).connect(this.limiter);
    this.meterIn.connect(entrance);
    const old = this.current;
    const now = context.currentTime;
    exit.gain.setValueAtTime(0, now); exit.gain.linearRampToValueAtTime(1, now + 0.025);
    if (old) {
      old.exit.gain.setValueAtTime(old.exit.gain.value, now);
      old.exit.gain.linearRampToValueAtTime(0, now + 0.025);
      setTimeout(() => old.dispose(), 75);
    }
    this.current = { exit, dispose: () => { try { this.meterIn.disconnect(entrance); } catch {} try { entrance.disconnect(); exit.disconnect(); } catch {} modules.forEach(module => module.dispose()); } };
  }
  setInputGain(value) { smooth(this.input.gain, clamp(value, 0, 2), this.context); }
  setOutputGain(value) { smooth(this.output.gain, clamp(value, 0, 1), this.context); }
  close() {
    this.current?.dispose(); this.current = null;
    for (const node of [this.input, this.meterIn, this.limiter, this.softClip, this.meterOut, this.output]) { try { node.disconnect(); } catch {} }
  }
}

export function encodeWav(buffer) {
  const channels = Math.min(buffer.numberOfChannels, 2), frames = buffer.length;
  if (!channels || !frames || frames * channels * 2 > 250_000_000) throw new Error('Áudio longo demais para exportar de uma vez.');
  const output = new ArrayBuffer(44 + frames * channels * 2), view = new DataView(output);
  const word = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
  word(0, 'RIFF'); view.setUint32(4, output.byteLength - 8, true); word(8, 'WAVE'); word(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true);
  word(36, 'data'); view.setUint32(40, frames * channels * 2, true);
  const data = Array.from({ length: channels }, (_, index) => buffer.getChannelData(index));
  let offset = 44;
  for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < channels; channel++) {
    const sample = clamp(data[channel][frame], -1, 1);
    view.setInt16(offset, sample < 0 ? sample * 32768 : sample * 32767, true); offset += 2;
  }
  return new Uint8Array(output);
}

export async function renderVoiceFile(buffer, chain, onProgress) {
  const context = new OfflineAudioContext(Math.min(buffer.numberOfChannels, 2), buffer.length, buffer.sampleRate);
  await prepareVoiceContext(context);
  onProgress?.('Processando o áudio localmente…');
  const engine = new VoiceEngine(context);
  engine.setChain(chain);
  // Allow worklet control messages (including WSOLA window settings) to reach
  // the render thread before OfflineAudioContext processes all frames at once.
  await new Promise(resolve => setTimeout(resolve, 20));
  const source = context.createBufferSource(); source.buffer = buffer; source.connect(engine.input); source.start();
  try { return await context.startRendering(); }
  finally { source.disconnect(); engine.close(); }
}
