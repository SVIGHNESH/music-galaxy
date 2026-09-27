import { createRng } from '../core/rng';

export interface GalaxyParams {
  seed: number;
  count: number;
  radius: number;
  arms: number;
  /** How tightly the arms wind around the core. */
  twist: number;
  /** Fraction of stars in the central bulge. */
  bulge: number;
  /** Fraction of stars scattered as a faint halo. */
  halo: number;
}

export const defaultGalaxy: GalaxyParams = {
  seed: 1337,
  count: 500_000,
  radius: 6,
  arms: 3,
  twist: 4.6,
  bulge: 0.16,
  halo: 0.06,
};

/** Star populations; the shader colours each from the live palette. */
export const enum StarKind {
  Bulge = 0,
  Halo = 1,
  Arm = 2,
  Dust = 3,
}

export interface GalaxyData {
  positions: Float32Array; // vec3
  /** vec4 per star: [kind, t, rnd, 0]; t is the kind's colour-ramp position. */
  tones: Float32Array;
  sizes: Float32Array; // float
}

export function generateGalaxy(p: GalaxyParams): GalaxyData {
  const rng = createRng(p.seed);
  const positions = new Float32Array(p.count * 3);
  const tones = new Float32Array(p.count * 4);
  const sizes = new Float32Array(p.count);

  for (let i = 0; i < p.count; i++) {
    const roll = rng.next();
    let x: number, y: number, z: number;
    let kind: StarKind;
    let t: number;
    let rnd = 0;

    if (roll < p.bulge) {
      // Flattened gaussian bulge, hot and dense.
      const r = Math.abs(rng.gaussian()) * p.radius * 0.09;
      const theta = rng.range(0, Math.PI * 2);
      const phi = Math.acos(rng.range(-1, 1));
      x = r * Math.sin(phi) * Math.cos(theta);
      y = r * Math.cos(phi) * 0.55;
      z = r * Math.sin(phi) * Math.sin(theta);
      kind = StarKind.Bulge;
      t = Math.min(r / (p.radius * 0.18), 1) * rng.next();
      sizes[i] = rng.range(0.6, 1.4);
    } else if (roll < p.bulge + p.halo) {
      // Sparse spherical halo that gives the disc depth from oblique angles.
      const r = p.radius * Math.pow(rng.next(), 0.6) * 1.3;
      const theta = rng.range(0, Math.PI * 2);
      const phi = Math.acos(rng.range(-1, 1));
      x = r * Math.sin(phi) * Math.cos(theta);
      y = r * Math.cos(phi) * 0.35;
      z = r * Math.sin(phi) * Math.sin(theta);
      kind = StarKind.Halo;
      t = 0;
      sizes[i] = rng.range(0.4, 0.9);
    } else {
      // Logarithmic-ish spiral arms with scatter that grows toward the rim.
      const armT = Math.pow(rng.next(), 1.35);
      const r = p.radius * (0.08 + 0.92 * armT);
      const arm = Math.floor(rng.next() * p.arms);
      // Most stars hug the arm ridge; a minority fills the inter-arm gaps.
      const inArm = rng.next() < 0.78;
      const spread = inArm ? 0.07 + 0.1 * armT : 0.5;
      const angle = (arm / p.arms) * Math.PI * 2 + armT * p.twist + rng.gaussian() * spread;
      const jitter = 0.12 * (1 - 0.4 * armT);
      x = Math.cos(angle) * r + rng.gaussian() * jitter;
      z = Math.sin(angle) * r + rng.gaussian() * jitter;
      y = rng.gaussian() * 0.12 * (1 - 0.6 * armT);

      if (rng.next() < 0.14) {
        kind = StarKind.Dust;
        rnd = rng.next();
        sizes[i] = rng.range(1.2, 2.4);
      } else {
        kind = StarKind.Arm;
        sizes[i] = rng.range(0.5, 1.2);
      }
      t = Math.min(armT * 1.6, 1);
    }

    positions.set([x, y, z], i * 3);
    tones.set([kind, t, rnd, 0], i * 4);
  }

  return { positions, tones, sizes };
}

/** Distant background stars on a large shell. */
export function generateStarfield(seed: number, count: number, radius: number) {
  const rng = createRng(seed);
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const theta = rng.range(0, Math.PI * 2);
    const phi = Math.acos(rng.range(-1, 1));
    const r = radius * rng.range(0.85, 1);
    positions.set(
      [r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta)],
      i * 3,
    );
    sizes[i] = Math.pow(rng.next(), 4) * 2.2 + 0.3;
  }
  return { positions, sizes };
}
