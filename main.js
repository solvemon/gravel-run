import { Application, Container, Graphics, TilingSprite, Assets, Sprite } from 'pixi.js';
import { b2World, b2BodyType, b2PolygonShape, b2CircleShape, b2WheelJointDef, b2LinearStiffness, b2ContactListener } from '@box2d/core';

const app = new Application();
await app.init({ width: 800, height: 500, background: 0x6cc2d9 });
document.body.appendChild(app.canvas);

const [skyTexture, mountainTexture, carBodyTexture, carWheelTexture] = await Promise.all([
  Assets.load('/assets/sky.png'),
  Assets.load('/assets/mountain.png'),
  Assets.load('/assets/car-body.png'),
  Assets.load('/assets/car-wheel.png'),
]);

// --- Parallax layers ---
const skySprite = new TilingSprite({ texture: skyTexture, width: 800, height: skyTexture.height });
skySprite.y = 460 - skyTexture.height; // pin bottom of texture to ground line
app.stage.addChild(skySprite);

const MTN_H = 220;
const mountainSprite = new TilingSprite({ texture: mountainTexture, width: 800, height: MTN_H });
mountainSprite.y = 460 - MTN_H;
app.stage.addChild(mountainSprite);

// --- Scrolling scene ---
const scene = new Container();
app.stage.addChild(scene);

const world = b2World.Create({ x: 0, y: 10 });
const SCALE = 30;

// --- Ground ---
const groundBody = world.CreateBody({ position: { x: 0, y: 470 / SCALE } });
groundBody.CreateFixture({
  shape: new b2PolygonShape().SetAsBox(500, 10 / SCALE),
  friction: 1.0,
});

const groundGfx = new Graphics().rect(-500 * SCALE, 460, 500 * SCALE * 2, 40).fill(0x4a7c2f);
scene.addChild(groundGfx);

// --- Chassis physics ---
const CHASSIS_HW = 120;
const CHASSIS_HH = 20;

const chassisBody = world.CreateBody({
  type: b2BodyType.b2_dynamicBody,
  position: { x: 400 / SCALE, y: 150 / SCALE },
});
chassisBody.CreateFixture({
  shape: new b2PolygonShape().SetAsBox(CHASSIS_HW / SCALE, CHASSIS_HH / SCALE),
  density: 2,
  friction: 0.3,
});

// --- Wheels physics + sprites ---
// (added to scene first so they render behind the car body)
const WHEEL_R = 28;
const WHEEL_SPRITE_SIZE = WHEEL_R * 2; // sprite diameter matches physics diameter

function createWheel(px, py) {
  const body = world.CreateBody({
    type: b2BodyType.b2_dynamicBody,
    position: { x: px / SCALE, y: py / SCALE },
  });
  body.CreateFixture({
    shape: new b2CircleShape(WHEEL_R / SCALE),
    density: 1,
    friction: 1.0,
    restitution: 0.1,
  });

  const jd = new b2WheelJointDef();
  jd.Initialize(chassisBody, body, { x: px / SCALE, y: py / SCALE }, { x: 0, y: 1 });
  jd.enableLimit = true;
  jd.lowerTranslation = -0.5;
  jd.upperTranslation = 0.6;
  jd.enableMotor = true;
  jd.maxMotorTorque = 25;
  jd.motorSpeed = 0;
  b2LinearStiffness(jd, 3, 0.35, chassisBody, body);
  const joint = world.CreateJoint(jd);

  const sprite = new Sprite(carWheelTexture);
  sprite.anchor.set(0.5);
  sprite.width  = WHEEL_SPRITE_SIZE;
  sprite.height = WHEEL_SPRITE_SIZE;
  scene.addChild(sprite);

  return { body, sprite, joint };
}

const frontWheel = createWheel(320, 195);
const rearWheel  = createWheel(480, 195);

// --- Obstacles ---
const GROUND_SURFACE_Y = 460; // px — top of ground

function createObstacle(px, py, halfSize) {
  const size = halfSize ?? (3 + Math.random() * 20);       // 3–23 px half-extent
  const spawnY = py ?? (GROUND_SURFACE_Y - size - Math.random() * 120); // vary height so pieces pile up
  const isCircle = Math.random() < 0.35;

  const body = world.CreateBody({
    type: b2BodyType.b2_dynamicBody,
    position: { x: px / SCALE, y: spawnY / SCALE },
  });
  body.CreateFixture({
    shape: isCircle
      ? new b2CircleShape(size / SCALE)
      : new b2PolygonShape().SetAsBox(size / SCALE, size / SCALE),
    density: 1,
    friction: 0.5,
    restitution: 0.2,
  });

  const gfx = new Graphics();
  if (isCircle) gfx.circle(0, 0, size).stroke({ width: 2, color: 0xffffff });
  else          gfx.rect(-size, -size, size * 2, size * 2).stroke({ width: 2, color: 0xffffff });
  scene.addChild(gfx);

  return { body, gfx };
}

function spawnCluster(centerX) {
  const count = 1 + Math.floor(Math.random() * 5); // 1–5 pieces per cluster
  for (let i = 0; i < count; i++) {
    const px = centerX + (Math.random() - 0.5) * 140;
    const ob = createObstacle(px);
    obstacles.push(ob);
    obstacleBodies.add(ob.body);
    totalSpawned++;
  }
  updateCounter();
}

const obstacles    = [];
let lastSpawnX     = 800; // px — x position of the last spawned obstacle
let totalSpawned   = 0;
const startX       = 400 / SCALE; // chassis starting x in metres

// --- Friction contact listener ---
const wheelBodies    = new Set([frontWheel.body, rearWheel.body]);
const obstacleBodies = new Set();

const contactListener = new b2ContactListener();
contactListener.PreSolve = (contact) => {
  const bodyA = contact.GetFixtureA().GetBody();
  const bodyB = contact.GetFixtureB().GetBody();
  const aWheel    = wheelBodies.has(bodyA),    bWheel    = wheelBodies.has(bodyB);
  const aObstacle = obstacleBodies.has(bodyA), bObstacle = obstacleBodies.has(bodyB);
  const aGround   = bodyA === groundBody,      bGround   = bodyB === groundBody;

  if      ((aWheel && bGround)    || (bWheel && aGround))    contact.SetFriction(frWheelGround);
  else if ((aWheel && bObstacle)  || (bWheel && aObstacle))  contact.SetFriction(frWheelObstacle);
  else if ((aObstacle && bGround) || (bObstacle && aGround)) contact.SetFriction(frObstacleGround);
};
world.SetContactListener(contactListener);

// --- Car body sprite (on top of wheels) ---
// Scale to match physics width; the sprite is 691×194 px.
// Wheel arches sit ~77 % down the image, which lands 18 px below the sprite centre.
// The actual wheel bodies are 45 px below the chassis centre, so we shift the
// sprite down by (45 − 18) ≈ 27 px to line the arches up with the wheels.
const CAR_BODY_W = CHASSIS_HW * 2; // 240 px — matches physics width
const CAR_BODY_SCALE = CAR_BODY_W / carBodyTexture.width;
const CAR_BODY_Y_OFFSET = -9; // px, shifts sprite so wheel arches align with wheels

const chassisSprite = new Sprite(carBodyTexture);
chassisSprite.anchor.set(0.5);
chassisSprite.scale.set(CAR_BODY_SCALE);
scene.addChild(chassisSprite); // added after wheels → renders on top

// --- Tunable parameters ---
let carBodyYOffset   = -25;  // px
let driveSpeed       = 4;    // rad/s  (reverse is always half)
let maxTorque        = 250;  // N·m
let suspFreq         = 2;    // Hz
let suspDamping      = 0.35; // ratio
let frWheelGround    = 0.8;
let frWheelObstacle  = 2;
let frObstacleGround = 2;

function applySuspension() {
  const tmp = { stiffness: 0, damping: 0 };
  b2LinearStiffness(tmp, suspFreq, suspDamping, chassisBody, frontWheel.body);
  for (const { joint } of [frontWheel, rearWheel]) {
    joint.SetStiffness(tmp.stiffness);
    joint.SetDamping(tmp.damping);
  }
}

// --- Debug panel ---
const panel = Object.assign(document.createElement('div'), {
  style: 'position:fixed;top:12px;left:12px;background:rgba(0,0,0,.6);color:#fff;'
       + 'padding:10px 14px;border-radius:8px;font:12px monospace;'
       + 'display:flex;flex-direction:column;gap:6px;z-index:10;min-width:300px',
});
document.body.appendChild(panel);

function addSlider(label, min, max, step, init, fmt, onChange) {
  const row = Object.assign(document.createElement('div'), { style: 'display:flex;align-items:center;gap:8px' });
  const lbl = Object.assign(document.createElement('span'), { textContent: label, style: 'width:150px;flex-shrink:0' });
  const slider = Object.assign(document.createElement('input'), { type: 'range', min, max, step, value: init, style: 'flex:1' });
  const val = Object.assign(document.createElement('span'), { textContent: fmt(init), style: 'width:70px;text-align:right' });
  slider.addEventListener('input', () => { const v = Number(slider.value); val.textContent = fmt(v); onChange(v); });
  row.append(lbl, slider, val);
  panel.appendChild(row);
}

const scoreEl = Object.assign(document.createElement('div'), {
  style: 'position:fixed;top:12px;left:50%;transform:translateX(-50%);'
       + 'background:rgba(0,0,0,.6);color:#fff;padding:8px 24px;border-radius:8px;'
       + 'font:bold 22px monospace;z-index:10;text-align:center;line-height:1.5',
  innerHTML: '<div style="font-size:11px;opacity:.7;letter-spacing:1px">DISTANCE</div><div id="scoreVal">0 m</div>',
});
document.body.appendChild(scoreEl);
const scoreVal = scoreEl.querySelector('#scoreVal');

const counterEl = Object.assign(document.createElement('div'), {
  style: 'position:fixed;top:12px;right:12px;background:rgba(0,0,0,.6);color:#fff;'
       + 'padding:8px 12px;border-radius:8px;font:12px monospace;z-index:10;line-height:1.6',
});
document.body.appendChild(counterEl);
function updateCounter() {
  counterEl.innerHTML = `Spawned: ${totalSpawned}<br>Alive: ${obstacles.length}`;
}
updateCounter();

addSlider('Ride height',           -100, 100,  1,    carBodyYOffset,   v => `${v} px`,    v => { carBodyYOffset   = v; });
addSlider('Spring freq',            0.5,  12,  0.1,  suspFreq,         v => `${v} Hz`,    v => { suspFreq        = v; applySuspension(); });
addSlider('Damping ratio',         0.05, 1.5,  0.05, suspDamping,      v => `${v}`,       v => { suspDamping     = v; applySuspension(); });
addSlider('Motor torque',             5, 500,  5,    maxTorque,        v => `${v} N·m`,   v => { maxTorque       = v; });
addSlider('Max speed',                1,  40,  1,    driveSpeed,       v => `${v} rad/s`, v => { driveSpeed      = v; });
addSlider('Friction wheel/ground',  0, 2, 0.05, frWheelGround,    v => `${v}`,       v => { frWheelGround    = v; });
addSlider('Friction wheel/obstacle',0, 2, 0.05, frWheelObstacle,  v => `${v}`,       v => { frWheelObstacle  = v; });
addSlider('Friction obstacle/ground',0,2, 0.05, frObstacleGround, v => `${v}`,       v => { frObstacleGround = v; });

// --- Input ---
const keys = { w: false, s: false };
window.addEventListener('keydown', e => {
  if (e.key === 'w') keys.w = true;
  if (e.key === 's') keys.s = true;
  audioCtx.resume(); // browsers require a user gesture before audio plays
});
window.addEventListener('keyup', e => {
  if (e.key === 'w') keys.w = false;
  if (e.key === 's') keys.s = false;
});

// --- Engine audio (Web Audio API) ---
const audioCtx = new AudioContext();

// Custom periodic wave — softer harmonic rolloff (1/n² vs sawtooth's 1/n)
// Sounds less buzzy/electronic, more like a real combustion cycle
const numH = 16;
const real = new Float32Array(numH);
const imag = new Float32Array(numH);
for (let n = 1; n < numH; n++) imag[n] = 1 / (n * n);
const engineWave = audioCtx.createPeriodicWave(real, imag);

// Oscillator 1 — fundamental
const osc1 = audioCtx.createOscillator();
osc1.setPeriodicWave(engineWave);

// Oscillator 2 — slightly detuned octave up (2.04× not 2.00×) for beating/thickness
const osc2 = audioCtx.createOscillator();
osc2.setPeriodicWave(engineWave);
const osc2Gain = audioCtx.createGain();
osc2Gain.gain.value = 0.4;

// Amplitude modulation at firing frequency — simulates the "chug" of cylinder pulses
// amGainNode.gain = 0.7 (base) + 0.3 * sin(ωt) → pulses between 0.4–1.0
const amOsc = audioCtx.createOscillator();
amOsc.type = 'sine';
const amDepth = audioCtx.createGain();
amDepth.gain.value = 0.3;
const amGainNode = audioCtx.createGain();
amGainNode.gain.value = 0.7;
amOsc.connect(amDepth);
amDepth.connect(amGainNode.gain); // adds to base gain

// Filtered noise — mechanical texture underneath
const noiseBuffer = audioCtx.createBuffer(1, audioCtx.sampleRate, audioCtx.sampleRate);
const noiseData = noiseBuffer.getChannelData(0);
for (let i = 0; i < noiseData.length; i++) noiseData[i] = Math.random() * 2 - 1;
const noiseSource = audioCtx.createBufferSource();
noiseSource.buffer = noiseBuffer;
noiseSource.loop = true;
const noiseFilter = audioCtx.createBiquadFilter();
noiseFilter.type = 'lowpass';
noiseFilter.frequency.value = 120;
const noiseGain = audioCtx.createGain();
noiseGain.gain.value = 0.04;
noiseSource.connect(noiseFilter);
noiseFilter.connect(noiseGain);

// Softer distortion curve — gentle saturation rather than hard clipping
const distCurve = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const x = (i * 2) / 256 - 1;
  distCurve[i] = (3 * x) / (1 + 2 * Math.abs(x)); // soft knee
}
const waveshaper = audioCtx.createWaveShaper();
waveshaper.curve = distCurve;

// Low-pass filter — opens up at higher RPM
const engineFilter = audioCtx.createBiquadFilter();
engineFilter.type = 'lowpass';
engineFilter.Q.value = 1.2;

// Master gain
const engineGain = audioCtx.createGain();
engineGain.gain.value = 0.12;

// Signal graph:
// osc1 ─────────────────────────────────────────────────┐
// osc2 ─► osc2Gain ─────────────────────────────────────┼─► amGainNode ─► waveshaper ─► engineFilter ─► engineGain ─► out
// noiseSource ─► noiseFilter ─► noiseGain ───────────────┘
// amOsc ─► amDepth ──────────────────────────────────────► amGainNode.gain (modulation)
osc1.connect(amGainNode);
osc2.connect(osc2Gain);
osc2Gain.connect(amGainNode);
noiseGain.connect(amGainNode);
amGainNode.connect(waveshaper);
waveshaper.connect(engineFilter);
engineFilter.connect(engineGain);
engineGain.connect(audioCtx.destination);

osc1.start();
osc2.start();
amOsc.start();
noiseSource.start();

// --- Engine RPM simulation ---
let engineRpm = 0; // 0–1

// Rev gauge (HTML — lives outside the scrolling scene)
const gaugeWrap = Object.assign(document.createElement('div'), {
  style: 'position:fixed;bottom:24px;right:24px;z-index:10;'
       + 'background:rgba(0,0,0,.6);padding:8px 12px;border-radius:8px;'
       + 'font:11px monospace;color:#fff;text-align:center;min-width:160px',
  innerHTML: `<div style="letter-spacing:1px;margin-bottom:5px">REV</div>
    <div style="background:#111;border-radius:3px;height:14px;overflow:hidden">
      <div id="rpmBar" style="height:100%;width:0%;background:#44ff44;transition:background .1s"></div>
    </div>`,
});
document.body.appendChild(gaugeWrap);
const rpmBar = gaugeWrap.querySelector('#rpmBar');

// --- Game loop ---
app.ticker.add(() => {
  world.Step(1 / 60, { velocityIterations: 8, positionIterations: 3 });

  // Engine inertia — ramp up fast, decay slowly (flywheel), brake faster
  if (keys.w) {
    engineRpm += (1 - engineRpm) * 0.015; // exponential approach to full rev
  } else if (keys.s) {
    engineRpm *= 0.92;                     // brake — quicker drop
  } else {
    engineRpm *= 0.988;                    // flywheel coast — slow decay
  }

  const motorSpeed = keys.s ? -driveSpeed * 0.5 : driveSpeed * engineRpm;
  for (const { joint } of [frontWheel, rearWheel]) {
    joint.SetMotorSpeed(motorSpeed);
    joint.SetMaxMotorTorque(maxTorque);
  }

  // Rev gauge
  rpmBar.style.width = `${engineRpm * 100}%`;
  rpmBar.style.background = engineRpm < 0.6 ? '#44ff44' : engineRpm < 0.85 ? '#ffdd00' : '#ff3333';

  // Engine audio — engineRpm 0→1 maps to 17→65 Hz fundamental
  const t = audioCtx.currentTime;
  const smoothing = 0.03; // seconds — prevents zipper noise between frames
  const freq = 17 + engineRpm * 48;
  osc1.frequency.setTargetAtTime(freq,        t, smoothing);
  osc2.frequency.setTargetAtTime(freq * 2.04, t, smoothing); // slightly detuned octave
  amOsc.frequency.setTargetAtTime(freq,       t, smoothing); // chug matches firing rate
  noiseFilter.frequency.setTargetAtTime(80 + engineRpm * 200, t, smoothing); // texture opens up
  engineFilter.frequency.setTargetAtTime(220 + engineRpm * 650, t, smoothing);
  engineGain.gain.setTargetAtTime(0.08 + engineRpm * 0.07, t, smoothing);

  const cp = chassisBody.GetPosition();
  chassisSprite.x = cp.x * SCALE;
  chassisSprite.y = cp.y * SCALE + carBodyYOffset;
  chassisSprite.rotation = chassisBody.GetAngle();

  for (const { body, sprite } of [frontWheel, rearWheel]) {
    const wp = body.GetPosition();
    sprite.x = wp.x * SCALE;
    sprite.y = wp.y * SCALE;
    sprite.rotation = body.GetAngle();
  }

  const distanceM = Math.max(0, cp.x - startX);
  scoreVal.textContent = `${Math.floor(distanceM)} m`;

  const camRight = cp.x * SCALE + app.screen.width / 2;
  const camLeft  = cp.x * SCALE - app.screen.width / 2;

  // Spawn clusters ahead — gap shrinks forever as distance grows
  const difficulty = 1 / (1 + distanceM / 200);
  while (lastSpawnX < camRight + 600) {
    lastSpawnX += 25 + Math.random() ** 0.5 * 400 * difficulty;
    spawnCluster(lastSpawnX);
  }

  // Update + despawn obstacles that have scrolled off the left
  for (let i = obstacles.length - 1; i >= 0; i--) {
    const ob = obstacles[i];
    const op = ob.body.GetPosition();
    ob.gfx.x = op.x * SCALE;
    ob.gfx.y = op.y * SCALE;
    ob.gfx.rotation = ob.body.GetAngle();

    if (op.x * SCALE < camLeft - 400) {
      obstacleBodies.delete(ob.body);
      world.DestroyBody(ob.body);
      ob.gfx.destroy();
      obstacles.splice(i, 1);
      updateCounter();
    }
  }

  // Keep ground centred on the chassis so it never ends
  groundBody.SetTransformXY(cp.x, 470 / SCALE, 0);
  groundGfx.x = cp.x * SCALE;

  // Camera
  scene.x = app.screen.width / 2 - cp.x * SCALE;

  // Parallax
  const scroll = scene.x;
  skySprite.tilePosition.x      = scroll * 0.05;
  mountainSprite.tilePosition.x = scroll * 0.15;
});
