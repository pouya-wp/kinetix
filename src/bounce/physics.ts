import type { BallObj } from '../core/state';

export interface Contact { t: number; x: number; y: number; nx: number; ny: number; speed: number }
export interface PhysTrack {
  dt: number;
  duration: number;
  x: Float32Array;
  y: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  rot: Float32Array;
  contacts: Contact[];
}

const HZ = 240;

/** Fixed-step 2D circle simulation with floor/walls/ceiling and custom line colliders. */
export function simulate(o: BallObj, W: number, H: number): PhysTrack {
  const p = o.phys;
  const dt = 1 / HZ;
  const n = Math.max(2, Math.round(p.duration * HZ) + 1);
  const X = new Float32Array(n), Y = new Float32Array(n), VX = new Float32Array(n), VY = new Float32Array(n), R = new Float32Array(n);
  const contacts: Contact[] = [];
  const r = o.radius;
  let x = o.start?.[0] ?? W * 0.2, y = o.start?.[1] ?? H * 0.3;
  let vx = p.vx, vy = p.vy, ang = 0;
  const e = p.restitution, fr = p.friction;
  let lastContact = -1;

  const resolve = (nx: number, ny: number, pen: number, t: number) => {
    x += nx * pen;
    y += ny * pen;
    const vn = vx * nx + vy * ny;
    if (vn < 0) {
      const tx = -ny, ty = nx;
      let vt = vx * tx + vy * ty;
      const impact = -vn;
      const newVn = impact < 25 ? 0 : impact * e;
      vt *= 1 - fr;
      vx = nx * newVn + tx * vt;
      vy = ny * newVn + ty * vt;
      if (impact > 40 && t - lastContact > 0.03) {
        contacts.push({ t, x: x - nx * r, y: y - ny * r, nx, ny, speed: impact });
        // store centre for convenience
        contacts[contacts.length - 1].x = x;
        contacts[contacts.length - 1].y = y;
        lastContact = t;
      }
    }
  };

  for (let i = 0; i < n; i++) {
    const t = i * dt;
    X[i] = x; Y[i] = y; VX[i] = vx; VY[i] = vy; R[i] = ang;
    // integrate (semi-implicit Euler)
    vy += p.gravity * dt;
    const damp = Math.max(0, 1 - p.drag * dt);
    vx *= damp; vy *= damp;
    const px = x;
    x += vx * dt;
    y += vy * dt;

    if (p.floor && y + r > H) resolve(0, -1, y + r - H, t);
    if (p.ceiling && y - r < 0) resolve(0, 1, r - y, t);
    if (p.walls) {
      if (x - r < 0) resolve(1, 0, r - x, t);
      if (x + r > W) resolve(-1, 0, x + r - W, t);
    }
    for (const c of o.colliders) {
      const ax = c.a[0], ay = c.a[1], bx = c.b[0], by = c.b[1];
      const dx = bx - ax, dy = by - ay;
      const L2 = dx * dx + dy * dy || 1;
      const u = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
      const cx = ax + dx * u, cy = ay + dy * u;
      let ox = x - cx, oy = y - cy;
      const d = Math.hypot(ox, oy);
      if (d < r && d > 1e-6) {
        ox /= d; oy /= d;
        resolve(ox, oy, r - d, t);
      }
    }
    // rolling: rotation follows travelled distance on contact, keeps spinning in air
    ang += ((x - px) / r) * (180 / Math.PI);
  }
  return { dt, duration: (n - 1) * dt, x: X, y: Y, vx: VX, vy: VY, rot: R, contacts };
}
