import { Application, Container, Graphics, TilingSprite, Assets } from 'pixi.js';
import { b2World, b2PolygonShape, b2ContactListener } from '@box2d/core';
import { SCALE } from './constants.js';
import { createTruck } from './truck.js';
import { createObstacleSystem } from './obstacles.js';
import { createAudio } from './audio.js';
import { createUI } from './ui.js';

// --- App ---
const app = new Application();
await app.init({ width: 800, height: 500, background: 0x6cc2d9 });
document.body.appendChild(app.canvas);

// --- Assets ---
const base = import.meta.env.BASE_URL;
const [skyTexture, mountainTexture, carBodyTexture, carWheelTexture] = await Promise.all([
  Assets.load(`${base}assets/sky.png`),
  Assets.load(`${base}assets/mountain.png`),
  Assets.load(`${base}assets/car-body.png`),
  Assets.load(`${base}assets/car-wheel.png`),
]);

// --- Parallax background ---
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

// --- Physics world ---
const world = b2World.Create({ x: 0, y: 10 });

// Static ground body — repositioned each frame to follow the truck (infinite ground trick)
const groundBody = world.CreateBody({ position: { x: 0, y: 470 / SCALE } });
groundBody.CreateFixture({ shape: new b2PolygonShape().SetAsBox(500, 10 / SCALE), friction: 1.0 });
const groundGfx = new Graphics().rect(-500 * SCALE, 460, 500 * SCALE * 2, 40).fill(0x4a7c2f);
scene.addChild(groundGfx);

// --- Tunable parameters (sliders write directly into this object) ---
const params = {
  carBodyYOffset:   -25,  // px — shifts body sprite so wheel arches align with physics wheels
  driveSpeed:         4,  // rad/s (reverse is always half)
  maxTorque:        250,  // N·m
  suspFreq:           2,  // Hz
  suspDamping:     0.35,
  frWheelGround:    0.8,
  frWheelObstacle:    2,
  frObstacleGround:   2,
};

// --- Game systems ---
const truck     = createTruck(world, scene, { carBodyTexture, carWheelTexture });
const obstacles = createObstacleSystem(world, scene);
const audio     = createAudio();
const ui        = createUI(params, { onSuspChange: () => truck.applySuspension(params) });

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
world.SetContactListener(listener);

// --- Input ---
const keys = { w: false, s: false };
window.addEventListener('keydown', e => {
  if (e.key === 'w') keys.w = true;
  if (e.key === 's') keys.s = true;
  audio.resume(); // browsers require a user gesture before audio starts
});
window.addEventListener('keyup', e => {
  if (e.key === 'w') keys.w = false;
  if (e.key === 's') keys.s = false;
});

const startX = truck.position.x; // chassis x at spawn, used for distance scoring

// --- Game loop ---
app.ticker.add(() => {
  world.Step(1 / 60, { velocityIterations: 8, positionIterations: 3 });

  truck.update(keys, params);

  const cp        = truck.position;
  const camX      = cp.x * SCALE;
  const camLeft   = camX - app.screen.width / 2;
  const camRight  = camX + app.screen.width / 2;
  const distanceM = Math.max(0, cp.x - startX);

  obstacles.update(camLeft, camRight, distanceM);
  audio.update(truck.rpm);
  ui.update({ score: distanceM, spawned: obstacles.total, alive: obstacles.count, rpm: truck.rpm });

  // Keep ground centred on the chassis so it never ends
  groundBody.SetTransformXY(cp.x, 470 / SCALE, 0);
  groundGfx.x = camX;

  // Camera and parallax
  scene.x = app.screen.width / 2 - camX;
  skySprite.tilePosition.x      = scene.x * 0.05;
  mountainSprite.tilePosition.x = scene.x * 0.15;
});
