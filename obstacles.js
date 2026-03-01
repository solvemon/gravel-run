import { Sprite } from 'pixi.js';
import { b2BodyType, b2PolygonShape } from '@box2d/core';
import { SCALE } from './constants.js';

const GROUND_Y = 460; // px — top of the ground plane

// Squares smaller than this (half-size px) use the stone texture; larger ones get a crate.
const CRATE_THRESHOLD = 8;

// Returns a regular hexagon b2PolygonShape with circumradius r (metres).
// Six flat-ish sides give natural rolling resistance without being a boring circle.
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

export function createObstacleSystem(world, scene, { stoneTexture, crateTexture }) {
  const obstacles  = [];
  const bodies     = new Set(); // exposed so main.js can set up the contact listener
  let lastSpawnX   = 800;      // px — rightmost spawned position
  let totalSpawned = 0;

  function createObstacle(px, py, halfSize) {
    const size    = halfSize ?? (3 + Math.random() * 20);
    const spawnY  = py ?? (GROUND_Y - size - Math.random() * 120);
    const isRock  = Math.random() < 0.35;

    const body = world.CreateBody({
      type: b2BodyType.b2_dynamicBody,
      position: { x: px / SCALE, y: spawnY / SCALE },
    });

    if (isRock) {
      body.CreateFixture({
        shape: makeHexagon(size / SCALE),
        density: 1, friction: 0.7, restitution: 0.15,
      });
      body.SetAngularDamping(1.5); // rocks settle rather than spinning forever
    } else {
      body.CreateFixture({
        shape: new b2PolygonShape().SetAsBox(size / SCALE, size / SCALE),
        density: 1, friction: 0.5, restitution: 0.2,
      });
    }

    // Rocks and very small boxes → stone texture; larger boxes → crate
    const texture = (isRock || size < CRATE_THRESHOLD) ? stoneTexture : crateTexture;
    const sprite  = new Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.width = sprite.height = size * 2;
    scene.addChild(sprite);

    return { body, sprite };
  }

  function spawnCluster(centerX) {
    const count = 1 + Math.floor(Math.random() * 5); // 1–5 pieces
    for (let i = 0; i < count; i++) {
      const ob = createObstacle(centerX + (Math.random() - 0.5) * 140);
      obstacles.push(ob);
      bodies.add(ob.body);
      totalSpawned++;
    }
  }

  return {
    bodies,
    get count() { return obstacles.length; },
    get total() { return totalSpawned; },

    // Called every frame — spawns ahead and despawns behind the camera
    update(camLeft, camRight, distanceM) {
      // Gap between clusters shrinks forever as distance grows
      const difficulty = 1 / (1 + distanceM / 200);
      while (lastSpawnX < camRight + 600) {
        lastSpawnX += 25 + Math.random() ** 0.5 * 400 * difficulty;
        spawnCluster(lastSpawnX);
      }

      // Sync sprites and remove obstacles that have scrolled off the left
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
