import { AdditiveBlending, Group, Sprite, SpriteNodeMaterial, type WebGPURenderer } from 'three/webgpu';
import {
  clamp,
  cos,
  exp,
  Fn,
  hash,
  instanceIndex,
  instancedArray,
  mix,
  select,
  smoothstep,
  step,
  sin,
  uniform,
  uv,
  vec3,
} from 'three/tsl';
import { REFERENCE_STARS } from '../core/tier';
import { defaultGalaxy, generateGalaxy, generateStarfield, type GalaxyParams } from './generate';
import type { Palette } from './palette';

/** Soft gaussian disc so each sprite reads as a point of light, not a square. */
const glow = (sharpness: number) => {
  const d = uv().sub(0.5).length();
  return exp(d.mul(d).mul(-sharpness));
};

const SHOCK_SPEED = 5;

export class Galaxy extends Group {
  readonly params: GalaxyParams;

  readonly sim = {
    time: uniform(0),
    dt: uniform(1 / 60),
    stiffness: uniform(3),
    damping: uniform(3.4),
    turbulence: uniform(0.25),
    shockAge: uniform(1e3),
    shockStrength: uniform(0),
  };

  /** Written every step by the Reactor; all 0 means the calm idle galaxy. */
  readonly drive = {
    /** Pattern rotation angle (radians), integrated outside so it survives rebuilds. */
    spin: uniform(0),
    /** Current rotation rate, rad/s, used as the springs' target velocity. */
    spinRate: uniform(0.045),
    /** Bass: inner disc swells and thickens. */
    breath: uniform(0),
    /** Treble: a subset of stars flare. */
    sparkle: uniform(0),
    /** Overall level: brightness lift. */
    glow: uniform(0),
    /** Beat envelope: warm flash from the core. */
    flash: uniform(0),
    /** Sound colour: -1 warms the galaxy (bassy, dark), +1 cools it (bright, airy). */
    tint: uniform(0),
  };

  private shockStart = -1e3;
  private readonly step;

  constructor(
    private readonly palette: Palette,
    params: Partial<GalaxyParams> = {},
  ) {
    super();
    this.params = { ...defaultGalaxy, ...params };
    const disc = this.buildDisc();
    this.step = disc.step;
    this.add(disc.sprite, this.buildStarfield());
  }

  private buildDisc() {
    const p = this.params;
    const { time, dt, stiffness, damping, turbulence, shockAge, shockStrength } = this.sim;
    const { spin, spinRate, breath, sparkle, glow: level, flash, tint } = this.drive;
    const data = generateGalaxy(p);

    // `home` is each star's rest slot in the galaxy frame; the sim keeps
    // pulling stars back to it, so any disturbance heals on its own.
    const home = instancedArray(data.positions, 'vec3');
    const position = instancedArray(data.positions.slice(), 'vec3');
    const velocity = instancedArray(p.count, 'vec3');
    // Colour comes from the live palette per star population, so palette
    // switches crossfade on the GPU without regenerating anything.
    const tone = instancedArray(data.tones, 'vec4').toAttribute();
    const pc = this.palette.colors;
    const kind = tone.x;
    const ramp = tone.y;
    const color = select(
      kind.lessThan(0.5),
      mix(pc.core, pc.inner, ramp).mul(0.75),
      select(
        kind.lessThan(1.5),
        pc.halo.mul(0.5),
        select(kind.lessThan(2.5), mix(pc.inner, pc.arm, ramp), pc.dust.mul(tone.z.mul(0.35).add(0.45))),
      ),
    );
    const size = instancedArray(data.sizes, 'float').toAttribute();

    const stepNode = Fn(() => {
      const h = home.element(instanceIndex);
      const pos = position.element(instanceIndex);
      const vel = velocity.element(instanceIndex);

      // Whole-disc rotation plus a bounded differential sway: alive, but the
      // arms never wind themselves up over a long session.
      const r = h.xz.length();
      const phase = time.mul(0.25).add(r.mul(0.7));
      const angle = spin.add(sin(phase).mul(0.035));
      const omega = cos(phase).mul(0.035 * 0.25).add(spinRate);
      const c = cos(angle);
      const s = sin(angle);

      // Bass breath: the inner disc swells outward and puffs up; the rim barely moves.
      const swell = breath.mul(exp(r.mul(-0.35)));
      const radial = swell.mul(0.16).add(1);
      const puff = swell.mul(1.1).add(1);
      const target = vec3(h.x.mul(c).sub(h.z.mul(s)).mul(radial), h.y.mul(puff), h.x.mul(s).add(h.z.mul(c)).mul(radial));
      const targetVel = vec3(target.z.negate(), 0, target.x).mul(omega);

      // Cheap swirling flow field (a few sines) instead of 3D noise: runs for
      // every star every step, so it has to stay light on integrated GPUs.
      const q = pos.mul(0.6);
      const flow = vec3(
        sin(q.z.add(time.mul(0.31))).add(sin(q.y.mul(1.7).add(time.mul(0.23)))),
        sin(q.x.mul(1.3).sub(time.mul(0.27))).mul(0.5),
        sin(q.x.add(time.mul(0.19))).sub(sin(q.y.mul(1.9).sub(time.mul(0.29)))),
      ).mul(turbulence);

      // Spherical shock front pushing each star along its own direction from
      // the core: the flat disc stays flat and swells, instead of the front
      // turning into a vertical wall.
      const pr = pos.length().add(1e-3);
      const ring = pr.sub(shockAge.mul(SHOCK_SPEED));
      // Faded in away from the core so the dense bulge doesn't spray upward.
      const shock = exp(ring.mul(ring).mul(-3))
        .mul(exp(shockAge.mul(-1.3)))
        .mul(smoothstep(0.3, 1.6, pr))
        .mul(shockStrength);
      const outward = pos.div(pr);

      const accel = target
        .sub(pos)
        .mul(stiffness)
        .add(targetVel.sub(vel).mul(damping))
        .add(flow)
        .add(outward.mul(shock));

      vel.addAssign(accel.mul(dt));
      pos.addAssign(vel.mul(dt));
    })().compute(p.count);

    const material = new SpriteNodeMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    material.positionNode = position.toAttribute();

    // Keep total emitted light constant across star budgets:
    // per-star light ~ color * size^2, so size ~ k^0.25 and color ~ k^0.5.
    const k = REFERENCE_STARS / p.count;
    const seed = hash(instanceIndex);
    const twinkle = sin(time.mul(seed.mul(3).add(1)).add(seed.mul(100))).mul(0.2).add(0.9);
    // Treble flares roughly one star in five, each on its own flicker.
    const flicker = sin(time.mul(seed.mul(9).add(14)).add(seed.mul(40))).mul(0.5).add(0.5);
    const flare = step(0.8, seed).mul(flicker).mul(sparkle).mul(1.4).add(1);
    material.scaleNode = size.mul(0.0334 * Math.pow(k, 0.25)).mul(twinkle).mul(flare);

    // Stars knocked loose run hotter until they settle back into the arm.
    const speed = velocity.toAttribute().length();
    const heat = clamp(speed.mul(0.3), 0, 1);
    const warm = pc.core;
    // Beat flash radiates from the core, fading with each star's home radius.
    const coreFlash = flash.mul(exp(home.toAttribute().xz.length().mul(-0.7)));
    const tintColor = mix(vec3(1.22, 0.96, 0.78), vec3(0.8, 0.98, 1.25), tint.mul(0.5).add(0.5));
    const tinted = color.mul(mix(vec3(1), tintColor, tint.abs().mul(0.45)));
    material.colorNode = mix(tinted, warm, clamp(heat.add(coreFlash.mul(0.5)), 0, 1))
      .mul(level.mul(0.22).add(coreFlash.mul(0.55)).add(1))
      .mul(0.246 * Math.sqrt(k));
    material.opacityNode = glow(38);

    const sprite = new Sprite(material);
    sprite.count = p.count;
    sprite.frustumCulled = false;
    return { sprite, step: stepNode };
  }

  private buildStarfield() {
    const count = 5000;
    const data = generateStarfield(this.params.seed + 1, count, 90);
    const position = instancedArray(data.positions, 'vec3').toAttribute();
    const size = instancedArray(data.sizes, 'float').toAttribute();

    const material = new SpriteNodeMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    material.positionNode = position;
    material.scaleNode = size.mul(0.28);
    material.colorNode = vec3(0.72, 0.8, 1).mul(0.6);
    material.opacityNode = glow(30);

    const sprite = new Sprite(material);
    sprite.count = count;
    sprite.frustumCulled = false;
    return sprite;
  }

  /** Sends an expanding shockwave through the disc. */
  pulse(strength = 22) {
    // Don't let a weak beat cut short a stronger wave that is still travelling.
    const age = this.sim.time.value - this.shockStart;
    const remaining = this.sim.shockStrength.value * Math.exp(-1.3 * age);
    if (strength < remaining) return;
    this.shockStart = this.sim.time.value;
    this.sim.shockStrength.value = strength;
  }

  dispose() {
    for (const child of this.children) {
      if (child instanceof Sprite) child.material.dispose();
    }
    this.step.dispose();
  }

  /** Advances the simulation by exactly one fixed step. */
  simulate(renderer: WebGPURenderer, simTime: number, dt: number) {
    this.sim.time.value = simTime;
    this.sim.dt.value = dt;
    this.sim.shockAge.value = simTime - this.shockStart;
    renderer.compute(this.step);
  }
}
