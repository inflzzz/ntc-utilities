/* Small realtime processors unavailable as native Web Audio nodes. */
class VoiceGateProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [
    { name: 'threshold', defaultValue: -42, minValue: -70, maxValue: -12, automationRate: 'k-rate' },
    { name: 'attack', defaultValue: 8, minValue: 1, maxValue: 100, automationRate: 'k-rate' },
    { name: 'release', defaultValue: 140, minValue: 20, maxValue: 600, automationRate: 'k-rate' }
  ]; }
  constructor() { super(); this.envelope = 0; this.gain = 0; }
  process(inputs, outputs, params) {
    const input = inputs[0], output = outputs[0];
    if (!output?.length) return true;
    const threshold = Math.pow(10, params.threshold[0] / 20);
    const attack = Math.exp(-1 / (sampleRate * params.attack[0] / 1000));
    const release = Math.exp(-1 / (sampleRate * params.release[0] / 1000));
    for (let i = 0; i < output[0].length; i++) {
      let amplitude = 0;
      for (let ch = 0; ch < output.length; ch++) amplitude = Math.max(amplitude, Math.abs(input[ch]?.[i] || 0));
      this.envelope = amplitude > this.envelope ? attack * this.envelope + (1 - attack) * amplitude : release * this.envelope + (1 - release) * amplitude;
      const target = this.envelope >= threshold ? 1 : 0;
      this.gain = target > this.gain ? attack * this.gain + (1 - attack) : release * this.gain;
      for (let ch = 0; ch < output.length; ch++) output[ch][i] = (input[ch]?.[i] || 0) * this.gain;
    }
    return true;
  }
}
registerProcessor('ntc-voice-gate', VoiceGateProcessor);
