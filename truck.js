import { Sprite, Container } from 'pixi.js';
import { b2BodyType, b2PolygonShape, b2CircleShape, b2WheelJointDef, b2LinearStiffness } from '@box2d/core';
import { SCALE } from './constants.js';

const CHASSIS_HW = 120; // px half-width
const CHASSIS_HH = 20;  // px half-height
const WHEEL_R    = 29;  // px radius — 29/48 ≈ 0.60 m → ~1.2 m diameter

export function createTruck(world, scene, { carBodyTexture, carWheelTexture, groundY = 460 }) {
  // --- Chassis ---
  const chassisBody = world.CreateBody({
    type: b2BodyType.b2_dynamicBody,
    position: { x: 400 / SCALE, y: (groundY - 310) / SCALE },
  });
  chassisBody.CreateFixture({
    shape: new b2PolygonShape().SetAsBox(CHASSIS_HW / SCALE, CHASSIS_HH / SCALE),
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

  const frontWheel = makeWheel(320, groundY - 265);
  const rearWheel  = makeWheel(480, groundY - 265);

  // --- Car body sprite (added after wheels so it renders on top) ---
  const chassisSprite = new Sprite(carBodyTexture);
  chassisSprite.anchor.set(0.5);
  chassisSprite.scale.set((CHASSIS_HW * 2) / carBodyTexture.width);
  pivot.addChild(chassisSprite);

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
    },

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
