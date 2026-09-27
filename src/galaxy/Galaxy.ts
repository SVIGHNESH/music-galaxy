import { AdditiveBlending, Group, Sprite, SpriteNodeMaterial } from 'three/webgpu';
import {
  cos,
  exp,
  float,
  hash,
  instanceIndex,
  instancedArray,
  sin,
  uniform,
  uv,
  vec3,
} from 'three/tsl';
import { defaultGalaxy, generateGalaxy, generateStarfield, type GalaxyParams } from './generate';

/** Soft gaussian disc so each sprite reads as a point of light, not a square. */
const glow = (sharpness: number) => {
  const d = uv().sub(0.5).length();
  return exp(d.mul(d).mul(-sharpness));
};

export class Galaxy extends Group {
  readonly time = uniform(0);
  readonly params: GalaxyParams;

  constructor(params: Partial<GalaxyParams> = {}) {
    super();
    this.params = { ...defaultGalaxy, ...params };
    this.add(this.buildDisc(), this.buildStarfield());
  }

  private buildDisc() {
    const p = this.params;
    const data = generateGalaxy(p);
    const position = instancedArray(data.positions, 'vec3').toAttribute();
    const color = instancedArray(data.colors, 'vec3').toAttribute();
    const size = instancedArray(data.sizes, 'float').toAttribute();

    // Whole-disc rotation plus a bounded differential sway: it feels alive
    // without the arms winding themselves up over a long session.
    const r = position.xz.length();
    const angle = this.time.mul(0.045).add(sin(this.time.mul(0.25).add(r.mul(0.7))).mul(0.035));
    const c = cos(angle);
    const s = sin(angle);

    const material = new SpriteNodeMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    material.positionNode = vec3(
      position.x.mul(c).sub(position.z.mul(s)),
      position.y,
      position.x.mul(s).add(position.z.mul(c)),
    );

    const seed = hash(instanceIndex);
    const twinkle = sin(this.time.mul(seed.mul(3).add(1)).add(seed.mul(100))).mul(0.2).add(0.9);
    material.scaleNode = size.mul(0.05).mul(twinkle);

    // Fewer stars on weaker GPUs will be compensated by this scale later.
    const density = float(100_000 / p.count).sqrt();
    material.colorNode = color.mul(0.55).mul(density);
    material.opacityNode = glow(38);

    const sprite = new Sprite(material);
    sprite.count = p.count;
    sprite.frustumCulled = false;
    return sprite;
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

  update(simTime: number) {
    this.time.value = simTime;
  }
}
