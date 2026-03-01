// ?url tells Vite to treat this as a static asset and return its served URL —
// exactly what audioWorklet.addModule() needs (a URL, not a bundled module).
import workletUrl from './engine_sound_generator_worklet.js?url';

export async function createAudio() {
  const ctx = new AudioContext();

  // Load the processor into the AudioWorklet thread
  await ctx.audioWorklet.addModule(workletUrl);

  // The worklet produces 3 independent output channels:
  //   0 — intake noise
  //   1 — engine block vibrations
  //   2 — outlet / exhaust
  const worklet = new AudioWorkletNode(ctx, 'engine-sound-processor', {
    numberOfInputs:  0,
    numberOfOutputs: 3,
    processorOptions: {
      // 4-cylinder inline (Hilux 22R)
      cylinders: 4,

      intakeWaveguideLength:  100,
      exhaustWaveguideLength: 100,
      extractorWaveguideLength: 100,

      intakeOpenReflectionFactor:   0.01,
      intakeClosedReflectionFactor: 0.95,

      exhaustOpenReflectionFactor:   0.01,
      exhaustClosedReflectionFactor: 0.95,

      ignitionTime: 0.016,

      straightPipeWaveguideLength:  128,
      straightPipeReflectionFactor: 0.01,

      mufflerElementsLength: [10, 15, 20, 25],
      action: 0.1,

      outletWaveguideLength:  5,
      outletReflectionFactor: 0.01,
    },
  });

  // Per-channel gain — tune these to blend the three sound sources
  const gainIntake = ctx.createGain();
  gainIntake.gain.value = 0.4;       // subtle intake hiss

  const gainBlock = ctx.createGain();
  gainBlock.gain.value = 0.7;        // mechanical knock / block vibration

  const gainOutlet = ctx.createGain();
  gainOutlet.gain.value = 0.6;       // exhaust — dominant character

  const masterGain = ctx.createGain();
  masterGain.gain.value = 0.05;

  worklet.connect(gainIntake,  0);
  worklet.connect(gainBlock,   1);
  worklet.connect(gainOutlet,  2);
  gainIntake.connect(masterGain);
  gainBlock.connect(masterGain);
  gainOutlet.connect(masterGain);
  masterGain.connect(ctx.destination);

  const rpmParam      = worklet.parameters.get('rpm');
  const throttleParam = worklet.parameters.get('throttle');
  let lastMasterGain  = masterGain.gain.value; // updated by applyGains; used by setMuted

  return {
    // Must be called on the first user gesture (browsers block audio until then)
    resume() { ctx.resume(); },

    // Called every frame; rpm is 0–1 (our normalised game value)
    update(rpm) {
      // Map to realistic RPM range for a 4-cylinder truck (idle ~700, redline ~4500)
      rpmParam.value      = 900 + rpm * 3800;
      throttleParam.value = rpm;
    },

    // Called whenever the audio gain sliders change
    applyGains(params) {
      gainIntake.gain.value  = params.gainIntake;
      gainBlock.gain.value   = params.gainBlock;
      gainOutlet.gain.value  = params.gainOutlet;
      lastMasterGain         = params.masterGain;
      masterGain.gain.value  = params.masterGain;
    },

    setMuted(muted) {
      masterGain.gain.value = muted ? 0 : lastMasterGain;
    },
  };
}
