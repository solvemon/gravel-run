import { Sprite } from 'pixi.js';
import { b2BodyType, b2PolygonShape } from '@box2d/core';
import { SCALE } from './constants.js';

// Squares smaller than this (half-size px) use a stone texture; larger ones get a crate.
const CRATE_THRESHOLD = 8;

// Returns a regular hexagon b2PolygonShape with circumradius r (metres).
function makeHexagon(r) {
  const verts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    verts.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
  }
  const shape = new b2PolygonShape();
  shape.Set(verts);
  return shape;
}

// Log texture definitions: [texture key, width, height] — used to derive physics aspect ratio.
// Physics halfH is chosen randomly; halfW is derived from the native aspect ratio.
const LOG_DEFS = [
  { key: 'log1Texture', w: 75,  h: 25 },  // 3 : 1
  { key: 'log2Texture', w: 80,  h: 31 },  // ~2.6 : 1
  { key: 'log3Texture', w: 200, h: 24 },  // ~8.3 : 1  (long thin log)
];

export function createObstacleSystem(world, scene, {
  stoneTexture, stone2Texture, crateTexture,
  log1Texture, log2Texture, log3Texture,
  groundY = 460,
}) {
  let GROUND_Y = groundY;

  const texMap = { log1Texture, log2Texture, log3Texture };

  const obstacles  = [];
  const bodies     = new Set();
  let lastSpawnX   = 800;
  let totalSpawned = 0;

  // ── helpers ──────────────────────────────────────────────────────────────

  function makeBody(px, py) {
    return world.CreateBody({
      type: b2BodyType.b2_dynamicBody,
      position: { x: px / SCALE, y: py / SCALE },
    });
  }

  function makeSprite(texture, w, h) {
    const s = new Sprite(texture);
    s.anchor.set(0.5);
    s.width  = w;
    s.height = h;
    scene.addChild(s);
    return s;
  }

  // ── obstacle spawners ─────────────────────────────────────────────────────

  // Round rock — hexagon physics, stone.png
  function spawnRock(px) {
    const r      = 5 + Math.random() * 17;          // circumradius px
    const spawnY = GROUND_Y - r - Math.random() * 100;
    const body   = makeBody(px, spawnY);
    body.CreateFixture({ shape: makeHexagon(r / SCALE), density: 1.2, friction: 0.7, restitution: 0.15 });
    body.SetAngularDamping(1.5);
    return { body, sprite: makeSprite(stoneTexture, r * 2, r * 2) };
  }

  // Flat rock — wide box ~3:1, stone2.png
  function spawnFlatRock(px) {
    const hw     = 12 + Math.random() * 22;          // half-width px
    const hh     = Math.max(4, Math.round(hw / 3));  // half-height px
    const spawnY = GROUND_Y - hh - Math.random() * 80;
    const body   = makeBody(px, spawnY);
    body.CreateFixture({ shape: new b2PolygonShape().SetAsBox(hw / SCALE, hh / SCALE), density: 1.5, friction: 0.8, restitution: 0.1 });
    body.SetAngularDamping(0.8);
    return { body, sprite: makeSprite(stone2Texture, hw * 2, hh * 2) };
  }

  // Log — wide box matching the texture's native aspect ratio.
  // We fix the cross-section halfH and derive halfW from the aspect ratio.
  function spawnLog(px) {
    const def    = LOG_DEFS[Math.floor(Math.random() * LOG_DEFS.length)];
    const aspect = def.w / def.h;                    // native width ÷ height
    const hh     = 7 + Math.random() * 8;            // half-height px (cross section)
    const hw     = hh * aspect;                      // half-width px
    const spawnY = GROUND_Y - hh - Math.random() * 120;
    const body   = makeBody(px, spawnY);
    body.CreateFixture({ shape: new b2PolygonShape().SetAsBox(hw / SCALE, hh / SCALE), density: 0.7, friction: 0.5, restitution: 0.08 });
    body.SetAngularDamping(0.4);
    return { body, sprite: makeSprite(texMap[def.key], hw * 2, hh * 2) };
  }

  // Box / crate — square; small boxes use stone, large use crate
  function spawnBox(px) {
    const hs     = 4 + Math.random() * 18;           // half-size px
    const spawnY = GROUND_Y - hs - Math.random() * 120;
    const body   = makeBody(px, spawnY);
    body.CreateFixture({ shape: new b2PolygonShape().SetAsBox(hs / SCALE, hs / SCALE), density: 1, friction: 0.5, restitution: 0.2 });
    const tex    = hs < CRATE_THRESHOLD ? stoneTexture : crateTexture;
    return { body, sprite: makeSprite(tex, hs * 2, hs * 2) };
  }

  // ── main create ───────────────────────────────────────────────────────────

  function createObstacle(px) {
    const r  = Math.random();
    let ob;
    if      (r < 0.20) ob = spawnRock(px);
    else if (r < 0.35) ob = spawnFlatRock(px);
    else if (r < 0.65) ob = spawnLog(px);
    else               ob = spawnBox(px);
    return ob;
  }

  function spawnCluster(centerX) {
    const count = 1 + Math.floor(Math.random() * 5);
    for (let i = 0; i < count; i++) {
      const ob = createObstacle(centerX + (Math.random() - 0.5) * 140);
      obstacles.push(ob);
      bodies.add(ob.body);
      totalSpawned++;
    }
  }

  // ── public API ─────────────────────────────────────────────────────────────

  return {
    bodies,
    get count() { return obstacles.length; },
    get total() { return totalSpawned; },
    setGroundY(y) { GROUND_Y = y; },

    // Wipe all live obstacles and restart spawning from camRight
    reset(camRight) {
      for (const ob of obstacles) {
        bodies.delete(ob.body);
        world.DestroyBody(ob.body);
        ob.sprite.destroy();
      }
      obstacles.length = 0;
      totalSpawned = 0;
      lastSpawnX = camRight;
    },

    update(camLeft, camRight, distanceM) {
      const difficulty = 1 / (1 + distanceM / 200);
      while (lastSpawnX < camRight + 600) {
        lastSpawnX += 25 + Math.random() ** 0.5 * 400 * difficulty;
        spawnCluster(lastSpawnX);
      }

      for (let i = obstacles.length - 1; i >= 0; i--) {
        const ob = obstacles[i];
        const op = ob.body.GetPosition();
        ob.sprite.x        = op.x * SCALE;
        ob.sprite.y        = op.y * SCALE;
        ob.sprite.rotation = ob.body.GetAngle();

        if (op.x * SCALE < camLeft - 400) {
          bodies.delete(ob.body);
          world.DestroyBody(ob.body);
          ob.sprite.destroy();
          obstacles.splice(i, 1);
        }
      }
    },
  };
}
