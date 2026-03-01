import { Graphics } from 'pixi.js';
import { b2BodyType, b2PolygonShape, b2CircleShape } from '@box2d/core';
import { SCALE } from './constants.js';

const GROUND_Y = 460; // px — top of the ground plane

export function createObstacleSystem(world, scene) {
  const obstacles  = [];
  const bodies     = new Set(); // exposed so main.js can set up the contact listener
  let lastSpawnX   = 800;      // px — rightmost spawned position
  let totalSpawned = 0;

  function createObstacle(px, py, halfSize) {
    const size     = halfSize ?? (3 + Math.random() * 20);
    const spawnY   = py ?? (GROUND_Y - size - Math.random() * 120);
    const isCircle = Math.random() < 0.35;

    const body = world.CreateBody({
      type: b2BodyType.b2_dynamicBody,
      position: { x: px / SCALE, y: spawnY / SCALE },
    });
    body.CreateFixture({
      shape: isCircle
        ? new b2CircleShape(size / SCALE)
        : new b2PolygonShape().SetAsBox(size / SCALE, size / SCALE),
      density: 1, friction: 0.5, restitution: 0.2,
    });

    const gfx = new Graphics();
    if (isCircle) gfx.circle(0, 0, size).stroke({ width: 2, color: 0xffffff });
    else          gfx.rect(-size, -size, size * 2, size * 2).stroke({ width: 2, color: 0xffffff });
    scene.addChild(gfx);

    return { body, gfx };
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

      // Sync graphics and remove obstacles that have scrolled off the left
      for (let i = obstacles.length - 1; i >= 0; i--) {
        const ob = obstacles[i];
        const op = ob.body.GetPosition();
        ob.gfx.x        = op.x * SCALE;
        ob.gfx.y        = op.y * SCALE;
        ob.gfx.rotation = ob.body.GetAngle();

        if (op.x * SCALE < camLeft - 400) {
          bodies.delete(ob.body);
          world.DestroyBody(ob.body);
          ob.gfx.destroy();
          obstacles.splice(i, 1);
        }
      }
    },
  };
}
