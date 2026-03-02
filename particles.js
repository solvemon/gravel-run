import { Graphics } from 'pixi.js';

const POOL_SIZE     = 120;
const COLORS        = [0xC8A86A, 0xB89858, 0xA88040, 0xD0B870, 0x909080];
const IMPACT_COLORS = [0x8B7355, 0x6B5545, 0x7B7B7B, 0x9B8B6B, 0x555555];

export function createDustSystem(scene) {
  // Pre-allocate all particle Graphics so we never allocate mid-game
  const pool = Array.from({ length: POOL_SIZE }, () => {
    const gfx = new Graphics();
    gfx.visible = false;
    scene.addChild(gfx);
    return { gfx, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, size: 2, color: COLORS[0] };
  });
  let head = 0;

  function spawn(x, y, vx, vy, maxLife, colors) {
    const p     = pool[head];
    head        = (head + 1) % POOL_SIZE;
    p.x         = x;
    p.y         = y;
    p.vx        = vx;
    p.vy        = vy;
    p.maxLife   = maxLife;
    p.life      = maxLife;
    p.size      = 1.5 + Math.random() * 2.5;
    p.color     = colors[Math.floor(Math.random() * colors.length)];
    p.gfx.visible = true;
  }

  return {
    // dt   — ticker.deltaTime (1 at 60 fps)
    // rpm  — normalised 0–1
    // wheelBottoms — [{x, y}] world-pixel positions of wheel contact points
    // velX — chassis horizontal velocity in px/frame
    update(dt, rpm, wheelBottoms, velX) {
      // --- Advance existing particles ---
      for (const p of pool) {
        if (p.life <= 0) continue;
        p.life -= dt;
        if (p.life <= 0) { p.gfx.visible = false; continue; }

        p.x  += p.vx * dt;
        p.y  += p.vy * dt;
        p.vy += 0.12 * dt; // gentle gravity

        const t = p.life / p.maxLife; // 1 → 0
        p.gfx.x = p.x;
        p.gfx.y = p.y;
        p.gfx.clear()
          .circle(0, 0, p.size * t)
          .fill({ color: p.color, alpha: t * 0.75 });
      }

        // --- Emit ground dust ---
      // velX is in m/s; multiply by 0.2 to get a gentle px/frame backward push
      if (rpm >= 0.06 && wheelBottoms.length > 0) {
        for (const { x, y } of wheelBottoms) {
          if (Math.random() < rpm) {
            spawn(
              x + (Math.random() - 0.5) * 10,
              y - Math.random() * 3,
              -velX * 0.2 + (Math.random() - 0.5) * 1.2,
              -(0.3 + Math.random() * rpm * 2.5),
              20 + Math.random() * 20,
              COLORS,
            );
          }
          if (Math.random() < rpm * 0.45) {
            spawn(
              x + (Math.random() - 0.5) * 14,
              y - Math.random() * 4,
              -velX * 0.2 + (Math.random() - 0.5) * 1.8,
              -(0.2 + Math.random() * rpm * 2.0),
              20 + Math.random() * 20,
              COLORS,
            );
          }
        }
      }
    },

    // Emit a small scatter of debris at a wheel/obstacle contact point.
    // Call each frame while the contact is active (rate-limited by rpm).
    emitImpact(x, y, rpm) {
      if (rpm < 0.05) return;
      const count = Math.random() < rpm ? 2 : 1;
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 0.2 + Math.random() * 0.6;
        spawn(
          x + (Math.random() - 0.5) * 10,
          y + (Math.random() - 0.5) * 10,
          Math.cos(angle) * speed,
          Math.sin(angle) * speed,
          8 + Math.random() * 10, // short lifetime — just a flash of debris
          IMPACT_COLORS,
        );
      }
    },
  };
}
