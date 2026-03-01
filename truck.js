import { Sprite } from 'pixi.js';
import { b2BodyType, b2PolygonShape, b2CircleShape, b2WheelJointDef, b2LinearStiffness } from '@box2d/core';
import { SCALE } from './constants.js';

const CHASSIS_HW = 120; // px half-width
const CHASSIS_HH = 20;  // px half-height
const WHEEL_R    = 28;  // px radius

export function createTruck(world, scene, { carBodyTexture, carWheelTexture }) {
  // --- Chassis ---
  const chassisBody = world.CreateBody({
    type: b2BodyType.b2_dynamicBody,
    position: { x: 400 / SCALE, y: 150 / SCALE },
  });
  chassisBody.CreateFixture({
    shape: new b2PolygonShape().SetAsBox(CHASSIS_HW / SCALE, CHASSIS_HH / SCALE),
    density: 2,
    friction: 0.3,
  });

  // --- Wheels (added to scene first so they render behind the car body) ---
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
    scene.addChild(sprite);

    return { body, sprite, joint };
  }

  const frontWheel = makeWheel(320, 195);
  const rearWheel  = makeWheel(480, 195);

  // --- Car body sprite (rendered on top of wheels) ---
  // Scaled to match physics chassis width (691×194 px source image)
  const chassisSprite = new Sprite(carBodyTexture);
  chassisSprite.anchor.set(0.5);
  chassisSprite.scale.set((CHASSIS_HW * 2) / carBodyTexture.width);
  scene.addChild(chassisSprite);

  let rpm = 0;

  return {
    wheelBodies: new Set([frontWheel.body, rearWheel.body]),
    get position() { return chassisBody.GetPosition(); },
    get rpm()      { return rpm; },

    // Called every frame — advances RPM simulation, drives motors, syncs sprites
    update(keys, params) {
      // RPM inertia: exponential approach up, flywheel coast, brake drop
      if (keys.w)      rpm += (1 - rpm) * 0.015;
      else if (keys.s) rpm *= 0.92;
      else             rpm *= 0.988;

      const motorSpeed = keys.s ? -params.driveSpeed * 0.5 : params.driveSpeed * rpm;
      for (const { joint } of [frontWheel, rearWheel]) {
        joint.SetMotorSpeed(motorSpeed);
        joint.SetMaxMotorTorque(params.maxTorque);
      }

      const cp = chassisBody.GetPosition();
      chassisSprite.x        = cp.x * SCALE;
      chassisSprite.y        = cp.y * SCALE + params.carBodyYOffset;
      chassisSprite.rotation = chassisBody.GetAngle();

      for (const { body, sprite } of [frontWheel, rearWheel]) {
        const wp    = body.GetPosition();
        sprite.x        = wp.x * SCALE;
        sprite.y        = wp.y * SCALE;
        sprite.rotation = body.GetAngle();
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
