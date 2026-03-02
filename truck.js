import { Sprite, Container, Graphics } from 'pixi.js';
import { b2BodyType, b2PolygonShape, b2CircleShape, b2WheelJointDef, b2LinearStiffness } from '@box2d/core';
import { SCALE } from './constants.js';

const CHASSIS_HW = 120; // px half-width
const CHASSIS_HH = 20;  // px half-height
const CHASSIS_OY = -25; // px — fixture offset upward relative to body origin
const WHEEL_R    = 29;  // px radius — 29/48 ≈ 0.60 m → ~1.2 m diameter

export function createTruck(world, scene, { carBodyTexture, carWheelTexture, groundY = 460 }) {
  // --- Chassis ---
  const chassisBody = world.CreateBody({
    type: b2BodyType.b2_dynamicBody,
    position: { x: 400 / SCALE, y: (groundY - 310) / SCALE },
  });
  chassisBody.CreateFixture({
    shape: new b2PolygonShape().SetAsBox(
      CHASSIS_HW / SCALE, CHASSIS_HH / SCALE,
      { x: 0, y: CHASSIS_OY / SCALE }, 0),
    density: 2,
    friction: 0.3,
  });

  // Visual pivot — sits at the chassis physics centre and rotates with it.
  // All truck sprites are children so they automatically follow chassis tilt.
  const pivot = new Container();
  scene.addChild(pivot);

  // --- Wheels (added to pivot first so they render behind the car body) ---
  function makeWheel(px, py) {
    const body = world.CreateBody({
      type: b2BodyType.b2_dynamicBody,
      position: { x: px / SCALE, y: py / SCALE },
    });
    body.CreateFixture({
      shape: new b2CircleShape(WHEEL_R / SCALE),
      density: 1, friction: 1.0, restitution: 0.1,
    });

    const jd = new b2WheelJointDef();
    jd.Initialize(chassisBody, body, { x: px / SCALE, y: py / SCALE }, { x: 0, y: 1 });
    jd.enableLimit      = true;
    jd.lowerTranslation = -0.5;
    jd.upperTranslation = 0.6;
    jd.enableMotor      = true;
    jd.maxMotorTorque   = 25;
    jd.motorSpeed       = 0;
    b2LinearStiffness(jd, 3, 0.35, chassisBody, body);
    const joint = world.CreateJoint(jd);

    const sprite = new Sprite(carWheelTexture);
    sprite.anchor.set(0.5);
    sprite.width = sprite.height = WHEEL_R * 2;
    pivot.addChild(sprite); // child of pivot — position expressed in chassis-local coords

    return { body, sprite, joint };
  }

  const SPAWN_CX   = 400;
  const SPAWN_CY   = groundY - 310;
  const SPAWN_WY   = groundY - 265;

  const frontWheel = makeWheel(SPAWN_CX - 80, SPAWN_WY);
  const rearWheel  = makeWheel(SPAWN_CX + 80, SPAWN_WY);

  // --- Car body sprite (added after wheels so it renders on top) ---
  const chassisSprite = new Sprite(carBodyTexture);
  chassisSprite.anchor.set(0.5);
  chassisSprite.scale.set((CHASSIS_HW * 2) / carBodyTexture.width);
  pivot.addChild(chassisSprite);

  // --- Debug hitbox overlay (toggled with D key) ---
  const debugGfx = new Graphics();
  debugGfx.visible = false;
  pivot.addChild(debugGfx); // child of pivot → auto-rotates with chassis

  let rpm = 0;

  return {
    wheelBodies: new Set([frontWheel.body, rearWheel.body]),
    get position() { return chassisBody.GetPosition(); },
    get rpm()      { return rpm; },

    // Called every frame — advances RPM simulation, drives motors, syncs sprites
    update(keys, params, dt = 1) {
      // RPM inertia scaled by dt so behaviour is frame-rate independent.
      // Multiplicative decay uses ** dt (correct for exponential falloff).
      if (keys.w)      rpm += (1 - rpm) * 0.015 * dt;
      else if (keys.s) rpm *= 0.92 ** dt;
      else             rpm *= 0.988 ** dt;

      const motorSpeed = keys.s ? -params.driveSpeed * 0.5 : params.driveSpeed * rpm;
      for (const { joint } of [frontWheel, rearWheel]) {
        joint.SetMotorSpeed(motorSpeed);
        joint.SetMaxMotorTorque(params.maxTorque);
      }

      const cp = chassisBody.GetPosition();
      const ca = chassisBody.GetAngle();

      // Move and rotate the pivot to match chassis physics transform
      pivot.x        = cp.x * SCALE;
      pivot.y        = cp.y * SCALE;
      pivot.rotation = ca;

      // Chassis sprite at pivot centre — only needs the visual ride-height offset
      chassisSprite.x = 0;
      chassisSprite.y = params.carBodyYOffset;

      // Wheel sprites in chassis-local space:
      //   x = lateral anchor position (fixed)
      //   y = anchor y + suspension travel along chassis-local y-axis
      // PixiJS applies the pivot rotation automatically — no manual trig required.
      for (const { body, sprite, joint } of [frontWheel, rearWheel]) {
        const la = joint.GetLocalAnchorA();    // chassis-local anchor (metres)
        const t  = joint.GetJointTranslation(); // suspension travel (metres)
        sprite.x        = la.x * SCALE;
        sprite.y        = (la.y + t) * SCALE;
        sprite.rotation = body.GetAngle() - ca; // wheel spin relative to chassis
        sprite.width = sprite.height = params.wheelRadius * 2; // visual size from slider
      }

      // Debug: redraw physics outlines every frame (only when visible)
      if (debugGfx.visible) {
        debugGfx.clear();
        // Chassis box — red (offset matches the fixture centre)
        debugGfx
          .rect(-CHASSIS_HW, CHASSIS_OY - CHASSIS_HH, CHASSIS_HW * 2, CHASSIS_HH * 2)
          .stroke({ color: 0xff2222, width: 2, alpha: 0.9 });
        // Wheels — green circles at their chassis-local positions (physics radius, not visual)
        for (const { joint } of [frontWheel, rearWheel]) {
          const la = joint.GetLocalAnchorA();
          const t  = joint.GetJointTranslation();
          debugGfx
            .circle(la.x * SCALE, (la.y + t) * SCALE, WHEEL_R)
            .stroke({ color: 0x22ff22, width: 2, alpha: 0.9 });
        }
      }
    },

    // Teleport everything back to spawn and zero all velocities
    reset() {
      rpm = 0;
      const zero = { x: 0, y: 0 };
      chassisBody.SetTransformXY(SPAWN_CX / SCALE, SPAWN_CY / SCALE, 0);
      chassisBody.SetLinearVelocity(zero);
      chassisBody.SetAngularVelocity(0);
      frontWheel.body.SetTransformXY((SPAWN_CX - 80) / SCALE, SPAWN_WY / SCALE, 0);
      frontWheel.body.SetLinearVelocity(zero);
      frontWheel.body.SetAngularVelocity(0);
      rearWheel.body.SetTransformXY((SPAWN_CX + 80) / SCALE, SPAWN_WY / SCALE, 0);
      rearWheel.body.SetLinearVelocity(zero);
      rearWheel.body.SetAngularVelocity(0);
    },

    toggleDebug() { debugGfx.visible = !debugGfx.visible; },

    // Call when suspFreq or suspDamping changes
    applySuspension(params) {
      const tmp = { stiffness: 0, damping: 0 };
      b2LinearStiffness(tmp, params.suspFreq, params.suspDamping, chassisBody, frontWheel.body);
      for (const { joint } of [frontWheel, rearWheel]) {
        joint.SetStiffness(tmp.stiffness);
        joint.SetDamping(tmp.damping);
      }
    },
  };
}
