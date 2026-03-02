import { Application, Container, Graphics, TilingSprite, Sprite, Assets, ColorMatrixFilter, Texture } from 'pixi.js';
import { b2World, b2PolygonShape, b2ContactListener, b2WorldManifold } from '@box2d/core';
import { SCALE } from './constants.js';
import { createTruck } from './truck.js';
import { createObstacleSystem } from './obstacles.js';
import { createAudio } from './audio.js';
import { createUI, createTouchControls } from './ui.js';
import { createDustSystem } from './particles.js';

// --- App ---
const app = new Application();
await app.init({ width: window.innerWidth, height: window.innerHeight, background: 0x6cc2d9 });
document.body.appendChild(app.canvas);
app.canvas.style.touchAction = 'none'; // prevent browser scroll/zoom while playing

// --- Assets ---
const base = import.meta.env.BASE_URL;
const [
  skyTexture, mountainTexture, carBodyTexture, carWheelTexture,
  stoneTexture, stone2Texture, crateTexture,
  log1Texture, log2Texture, log3Texture,
  groundTileTexture,
] = await Promise.all([
  Assets.load(`${base}assets/sky.png`),
  Assets.load(`${base}assets/mountain.png`),
  Assets.load(`${base}assets/car-body.png`),
  Assets.load(`${base}assets/car-wheel.png`),
  Assets.load(`${base}assets/stone.png`),
  Assets.load(`${base}assets/stone2.png`),
  Assets.load(`${base}assets/crate.png`),
  Assets.load(`${base}assets/log1.png`),
  Assets.load(`${base}assets/log2.png`),
  Assets.load(`${base}assets/log3.png`),
  Assets.load(`${base}assets/Tileset_ground.png`),
]);

// Ground level — 92 % down the screen; everything is derived from this.
let GROUND_Y = Math.round(app.screen.height * 0.92);

// --- Parallax background ---
const skySprite = new TilingSprite({ texture: skyTexture, width: app.screen.width, height: skyTexture.height });
skySprite.y = GROUND_Y - skyTexture.height; // pin bottom of texture to ground line
app.stage.addChild(skySprite);

const MTN_H = 220;
const mountainSprite = new TilingSprite({ texture: mountainTexture, width: app.screen.width, height: MTN_H });
mountainSprite.y = GROUND_Y - MTN_H;
app.stage.addChild(mountainSprite);

// --- Scrolling scene ---
const scene = new Container();
app.stage.addChild(scene);

// --- Physics world ---
const world = b2World.Create({ x: 0, y: 10 });

// Static ground body — repositioned each frame to follow the truck (infinite ground trick).
// Body centre sits 10 px below GROUND_Y so the top surface aligns exactly with GROUND_Y.
const groundBody = world.CreateBody({ position: { x: 0, y: (GROUND_Y + 10) / SCALE } });
groundBody.CreateFixture({ shape: new b2PolygonShape().SetAsBox(500, 10 / SCALE), friction: 1.0 });
const groundGfx = new Graphics().rect(-500 * SCALE, 0, 500 * SCALE * 2, 2000).fill(0x4a7c2f);
groundGfx.y = GROUND_Y;
scene.addChild(groundGfx);

// Ground tile strip — individual sprites placed with real overlap so each tile's
// left edge draws on top of the previous tile's rough right edge.
const TILE_OVERLAP = 20;
const TILE_W       = groundTileTexture.width;        // 124 px
const TILE_STEP    = TILE_W - TILE_OVERLAP;           // 104 px between tile origins
// Enough sprites to fill the widest expected screen plus one tile of buffer each side.
const NUM_TILES    = Math.ceil(2000 / TILE_STEP) + 4;
const tileSprites  = Array.from({ length: NUM_TILES }, () => {
  const s = new Sprite(groundTileTexture);
  s.y = GROUND_Y;
  scene.addChild(s);
  return s;
});

// --- Tunable parameters (sliders write directly into this object) ---
const params = {
  carBodyYOffset:   -37,  // px — shifts body sprite so wheel arches align with physics wheels
  wheelRadius:       29,  // px — visual only; physics radius is fixed at 29 px (0.60 m)
  driveSpeed:        14,  // rad/s (reverse is always half)
  maxTorque:        260,  // N·m
  suspFreq:         3.7,  // Hz
  suspDamping:      0.5,
  rollResistance:    15,  // N·m — motor torque limit while coasting (low = rolls freely)
  frWheelGround:      2,
  frWheelObstacle:    2,
  frObstacleGround:   2,
  // Audio mix
  gainIntake:       0.2,
  gainBlock:        0.7,
  gainOutlet:       0.2,
  masterGain:       0.05,
};

// --- Game systems ---
const truck     = createTruck(world, scene, { carBodyTexture, carWheelTexture, groundY: GROUND_Y });
const obstacles = createObstacleSystem(world, scene, {
  stoneTexture, stone2Texture, crateTexture,
  log1Texture, log2Texture, log3Texture,
  groundY: GROUND_Y,
});
const audio     = await createAudio();
const ui        = createUI(params, {
  onSuspChange:  () => truck.applySuspension(params),
  onAudioChange: () => audio.applyGains(params),
  onMuteToggle: (muted) => audio.setMuted(muted),
  onDebugToggle: () => truck.toggleDebug(),
  onReset: () => {
    truck.reset();
    // Compute camRight *after* reset so lastSpawnX is relative to the spawn position.
    const camRight = truck.position.x * SCALE + app.screen.width / 2;
    obstacles.reset(camRight);
    ui.resetBest();
  },
});

// --- Per-pair friction via contact listener ---
const listener = new b2ContactListener();
listener.PreSolve = (contact) => {
  const bodyA = contact.GetFixtureA().GetBody();
  const bodyB = contact.GetFixtureB().GetBody();
  const aWheel    = truck.wheelBodies.has(bodyA),    bWheel    = truck.wheelBodies.has(bodyB);
  const aObstacle = obstacles.bodies.has(bodyA), bObstacle = obstacles.bodies.has(bodyB);
  const aGround   = bodyA === groundBody,        bGround   = bodyB === groundBody;
  if      ((aWheel && bGround)    || (bWheel && aGround))    contact.SetFriction(params.frWheelGround);
  else if ((aWheel && bObstacle)  || (bWheel && aObstacle))  contact.SetFriction(params.frWheelObstacle);
  else if ((aObstacle && bGround) || (bObstacle && aGround)) contact.SetFriction(params.frObstacleGround);
};
// Track wheel–obstacle contacts as contact objects so we can query the exact contact point.
const wheelObstacleContacts = new Set();
const _wm = new b2WorldManifold(); // reused every frame — avoids allocations

listener.BeginContact = (contact) => {
  const bodyA = contact.GetFixtureA().GetBody();
  const bodyB = contact.GetFixtureB().GetBody();
  const aWheel = truck.wheelBodies.has(bodyA), bWheel = truck.wheelBodies.has(bodyB);
  const aObs   = obstacles.bodies.has(bodyA),  bObs   = obstacles.bodies.has(bodyB);
  if ((aWheel && bObs) || (bWheel && aObs)) wheelObstacleContacts.add(contact);
};
listener.EndContact = (contact) => {
  wheelObstacleContacts.delete(contact);
};
world.SetContactListener(listener);

// --- Input ---
const keys = { w: false, s: false };
window.addEventListener('keydown', e => {
  if (e.key === 'w') keys.w = true;
  if (e.key === 's') keys.s = true;
  if (e.key === 'd') truck.toggleDebug();
  audio.resume(); // browsers require a user gesture before audio starts
});
window.addEventListener('keyup', e => {
  if (e.key === 'w') keys.w = false;
  if (e.key === 's') keys.s = false;
});
createTouchControls(keys, { onGesture: () => audio.resume() });

const dust  = createDustSystem(scene);

// --- Screen shake state ---
let shakeMag = 0;
let prevVelY = 0;

const startX = truck.position.x; // chassis x at spawn, used for distance scoring

// ── Visual atmosphere effects ──────────────────────────────────────────────

// Helper: linearly interpolate between two packed RGB hex colours
function lerpColor(a, b, t) {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  return (Math.round(ar + (br - ar) * t) << 16) |
         (Math.round(ag + (bg - ag) * t) << 8) |
          Math.round(ab + (bb - ab) * t);
}

// Distance-based sky tint: day (no tint) → golden hour → dusk
const SKY_STOPS = [
  { dist:   0, skyTint: 0xffffff, mtnTint: 0xffffff },
  { dist: 300, skyTint: 0xffcc88, mtnTint: 0xffaa66 },
  { dist: 700, skyTint: 0xcc99ee, mtnTint: 0x9966bb },
];

function skyTintAt(dist) {
  for (let i = 0; i < SKY_STOPS.length - 1; i++) {
    const a = SKY_STOPS[i], b = SKY_STOPS[i + 1];
    if (dist <= b.dist) {
      const t = (dist - a.dist) / (b.dist - a.dist);
      return { skyTint: lerpColor(a.skyTint, b.skyTint, t), mtnTint: lerpColor(a.mtnTint, b.mtnTint, t) };
    }
  }
  const l = SKY_STOPS[SKY_STOPS.length - 1];
  return { skyTint: l.skyTint, mtnTint: l.mtnTint };
}

// 1. Warm colour grade on the game scene (boost reds, dim blues)
const warmFilter = new ColorMatrixFilter();
warmFilter.matrix = [
  1.08, 0,    0,    0, 0.01,
  0,    0.98, 0,    0, 0,
  0,    0,    0.87, 0, 0,
  0,    0,    0,    1, 0,
];
scene.filters = [warmFilter];

// 2. Film grain (static noise texture with random tilePosition each frame)
function buildGrainTexture(size = 256) {
  const cv  = document.createElement('canvas');
  cv.width  = cv.height = size;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255 | 0;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return Texture.from(cv);
}
const grainSprite = new TilingSprite({
  texture: buildGrainTexture(),
  width:   app.screen.width,
  height:  app.screen.height,
});
grainSprite.alpha     = 0.035;
grainSprite.blendMode = 'screen';
app.stage.addChild(grainSprite);

// 3. Vignette overlay (darkens screen edges)
function buildVignetteTexture(w, h) {
  const cv  = document.createElement('canvas');
  cv.width  = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  const cx  = w / 2, cy = h / 2;
  const grad = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.3, cx, cy, Math.max(w, h) * 0.78);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  return Texture.from(cv);
}
const vignetteSprite = new Sprite(buildVignetteTexture(app.screen.width, app.screen.height));
vignetteSprite.width  = app.screen.width;
vignetteSprite.height = app.screen.height;
app.stage.addChild(vignetteSprite); // on top of grain

// --- Game loop ---
app.ticker.add((ticker) => {
  const dt = ticker.deltaTime; // 1.0 at 60 fps, 2.0 at 30 fps, 0.5 at 120 fps
  world.Step(dt / 60, { velocityIterations: 8, positionIterations: 3 });

  truck.update(keys, params, dt);

  const cp        = truck.position;
  const camX      = cp.x * SCALE;
  const camLeft   = camX - app.screen.width / 2;
  const camRight  = camX + app.screen.width / 2;
  const distanceM = Math.max(0, cp.x - startX);

  obstacles.update(camLeft, camRight, distanceM);
  audio.update(truck.rpm);
  ui.update({ score: distanceM, spawned: obstacles.total, alive: obstacles.count, rpm: truck.rpm });

  // --- Visual atmosphere ---
  const { skyTint, mtnTint } = skyTintAt(distanceM);
  skySprite.tint      = skyTint;
  mountainSprite.tint = mtnTint;
  grainSprite.tilePosition.x = Math.random() * 256;
  grainSprite.tilePosition.y = Math.random() * 256;

  // --- Screen shake: detect sudden vertical velocity change (impacts / landings) ---
  const velY = truck.velocity.y;
  const dvY  = Math.abs(velY - prevVelY);
  prevVelY   = velY;
  if (dvY > 4) shakeMag = Math.min(shakeMag + (dvY - 4) * 0.25, 3);
  shakeMag *= 0.72 ** dt;
  const shakeX = (Math.random() * 2 - 1) * shakeMag;
  const shakeY = (Math.random() * 2 - 1) * shakeMag * 0.6;

  // --- Wheel dust (only when wheels are near the ground) ---
  const velXms     = truck.velocity.x; // m/s — particles.js scales this itself
  const wheelPts   = truck.wheelBottoms;
  const nearGround = wheelPts.filter(w => w.y >= GROUND_Y - 12);
  dust.update(dt, truck.rpm, nearGround, velXms);

  // --- Obstacle contact debris — spawn at the actual contact point ---
  for (const contact of wheelObstacleContacts) {
    if (!contact.IsTouching()) continue;
    contact.GetWorldManifold(_wm);
    const n = contact.GetManifold().pointCount;
    for (let i = 0; i < n; i++) {
      dust.emitImpact(_wm.points[i].x * SCALE, _wm.points[i].y * SCALE, truck.rpm);
    }
  }

  // Keep ground centred on the chassis so it never ends
  groundBody.SetTransformXY(cp.x, (GROUND_Y + 10) / SCALE, 0);
  groundGfx.x = camX;
  // Slide the tile pool so it always covers camLeft..camRight
  const firstTile = Math.floor(camLeft / TILE_STEP);
  for (let i = 0; i < tileSprites.length; i++) {
    tileSprites[i].x = (firstTile + i) * TILE_STEP;
  }

  // Camera and parallax (shake applied to scene only, not background)
  const baseSceneX = app.screen.width / 2 - camX;
  scene.x = baseSceneX + shakeX;
  scene.y = shakeY;
  skySprite.tilePosition.x      = baseSceneX * 0.05;
  mountainSprite.tilePosition.x = baseSceneX * 0.15;
});

// --- Resize handler ---
window.addEventListener('resize', () => {
  app.renderer.resize(window.innerWidth, window.innerHeight);
  GROUND_Y = Math.round(app.screen.height * 0.92);

  skySprite.width      = app.screen.width;
  skySprite.y          = GROUND_Y - skyTexture.height;

  mountainSprite.width = app.screen.width;
  mountainSprite.y     = GROUND_Y - MTN_H;

  groundGfx.y = GROUND_Y;
  for (const s of tileSprites) s.y = GROUND_Y;
  obstacles.setGroundY(GROUND_Y);

  vignetteSprite.texture.destroy(true);
  vignetteSprite.texture = buildVignetteTexture(app.screen.width, app.screen.height);
  vignetteSprite.width  = app.screen.width;
  vignetteSprite.height = app.screen.height;

  grainSprite.width  = app.screen.width;
  grainSprite.height = app.screen.height;
});
