export function createAudio() {
  const ctx = new AudioContext();

  // Custom harmonic wave: 1/n² rolloff — less buzzy than sawtooth, more combustion-like
  const real = new Float32Array(16);
  const imag = new Float32Array(16);
  for (let n = 1; n < 16; n++) imag[n] = 1 / (n * n);
  const engineWave = ctx.createPeriodicWave(real, imag);

  // Oscillator 1 — fundamental
  const osc1 = ctx.createOscillator();
  osc1.setPeriodicWave(engineWave);

  // Oscillator 2 — detuned octave (2.04×) adds beating/thickness
  const osc2     = ctx.createOscillator();
  const osc2Gain = ctx.createGain();
  osc2.setPeriodicWave(engineWave);
  osc2Gain.gain.value = 0.4;

  // AM oscillator — simulates cylinder firing "chug" (pulses gain 0.4–1.0)
  const amOsc      = ctx.createOscillator();
  const amDepth    = ctx.createGain();
  const amGainNode = ctx.createGain();
  amOsc.type           = 'sine';
  amDepth.gain.value   = 0.3;
  amGainNode.gain.value = 0.7;
  amOsc.connect(amDepth);
  amDepth.connect(amGainNode.gain);

  // Filtered noise — mechanical texture underneath the tones
  const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const noiseData   = noiseBuffer.getChannelData(0);
  for (let i = 0; i < noiseData.length; i++) noiseData[i] = Math.random() * 2 - 1;
  const noiseSource = ctx.createBufferSource();
  const noiseFilter = ctx.createBiquadFilter();
  const noiseGain   = ctx.createGain();
  noiseSource.buffer          = noiseBuffer;
  noiseSource.loop            = true;
  noiseFilter.type            = 'lowpass';
  noiseFilter.frequency.value = 120;
  noiseGain.gain.value        = 0.04;
  noiseSource.connect(noiseFilter);
  noiseFilter.connect(noiseGain);

  // Soft saturation waveshaper — gentle knee, not hard clipping
  const distCurve = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const x = (i * 2) / 256 - 1;
    distCurve[i] = (3 * x) / (1 + 2 * Math.abs(x));
  }
  const waveshaper = ctx.createWaveShaper();
  waveshaper.curve = distCurve;

  // Low-pass filter — opens up at higher RPM
  const engineFilter = ctx.createBiquadFilter();
  engineFilter.type    = 'lowpass';
  engineFilter.Q.value = 1.2;

  // Master gain
  const engineGain = ctx.createGain();
  engineGain.gain.value = 0.12;

  // Signal graph:
  // osc1 ────────────────────────────────────────────────────────┐
  // osc2 ──► osc2Gain ──────────────────────────────────────────►├─► amGainNode ─► waveshaper ─► engineFilter ─► engineGain ─► out
  // noise ──► noiseFilter ──► noiseGain ────────────────────────┘
  // amOsc ──► amDepth ──────────────────────────────────────────► amGainNode.gain  (AM modulation)
  osc1.connect(amGainNode);
  osc2.connect(osc2Gain);
  osc2Gain.connect(amGainNode);
  noiseGain.connect(amGainNode);
  amGainNode.connect(waveshaper);
  waveshaper.connect(engineFilter);
  engineFilter.connect(engineGain);
  engineGain.connect(ctx.destination);

  osc1.start();
  osc2.start();
  amOsc.start();
  noiseSource.start();

  return {
    // Must be called on the first user gesture (browsers block audio until then)
    resume() { ctx.resume(); },

    // Called every frame; rpm is 0–1
    update(rpm) {
      const t    = ctx.currentTime;
      const s    = 0.03; // smoothing constant — prevents zipper noise between frames
      const freq = 17 + rpm * 48; // 17 Hz idle → 65 Hz at full rev
      osc1.frequency.setTargetAtTime(freq,              t, s);
      osc2.frequency.setTargetAtTime(freq * 2.04,       t, s); // detuned octave
      amOsc.frequency.setTargetAtTime(freq,             t, s); // chug matches firing rate
      noiseFilter.frequency.setTargetAtTime(80  + rpm * 200, t, s);
      engineFilter.frequency.setTargetAtTime(220 + rpm * 650, t, s);
      engineGain.gain.setTargetAtTime(0.08 + rpm * 0.07,  t, s);
    },
  };
}
