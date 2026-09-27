import { AdditiveBlending, Color, Sprite, SpriteNodeMaterial, Vector3, type Camera } from 'three/webgpu';
import { cos, exp, float, instancedArray, mix, sin, uniform, uniformArray, uv, varying } from 'three/tsl';
import { SPECTRUM_BANDS } from '../audio/analysis';
import { createRng } from '../core/rng';

const PER_BAR = 24;
/** Mirrored left/right: lows meet at the top (over dark sky), highs at the bottom. */
const BARS = SPECTRUM_BANDS * 2;
const RADIUS = 1.05;
const LENGTH = 1.7;

/**
 * Circular spectrum around the galactic core: 128 bars of light radiating
 * outward, each stretching with its frequency band. The ring always faces the
 * camera, so it reads as a halo from any orbit angle, and starts just outside
 * the bulge glow so the bars land on dark sky.
 */
export class SpectrumRing extends Sprite {
  readonly bands: number[] = new Array(SPECTRUM_BANDS).fill(0);
  /** Fades the whole ring in while sound is playing. */
  readonly presence = uniform(0);
  readonly lowColor = uniform(new Color('#ffb870'));
  readonly highColor = uniform(new Color('#a9c8ff'));
  private readonly screenRight = uniform(new Vector3(1, 0, 0));
  private readonly screenUp = uniform(new Vector3(0, 1, 0));

  constructor() {
    const material = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
    super(material);

    // Per-instance data: [band, position along the bar, angle, width jitter].
    // It must be an instanced attribute: that is what makes the sprite draw
    // `count` copies rather than one.
    const count = BARS * PER_BAR;
    const data = new Float32Array(count * 4);
    const rng = createRng(4242);
    for (let i = 0; i < count; i++) {
      const bar = Math.floor(i / PER_BAR);
      const band = bar < SPECTRUM_BANDS ? bar : BARS - 1 - bar;
      const along = ((i % PER_BAR) + 0.5) / PER_BAR;
      const angle = Math.PI / 2 + ((bar + (rng.next() - 0.5) * 0.6) / BARS) * Math.PI * 2;
      data.set([band, along, angle, (rng.next() - 0.5) * 0.02], i * 4);
    }
    const instance = instancedArray(data, 'vec4').toAttribute();
    const band = instance.x;
    const along = instance.y;
    const jitter = instance.w;

    const spectrum = uniformArray<'float'>(this.bands, 'float');
    // A gentle curve so mid-level bands still rise clearly.
    const amp = spectrum.element(band.toUint()).pow(0.6);

    const angle = instance.z;
    const r = along.mul(amp.mul(LENGTH).add(0.05)).add(RADIUS);
    // Bar direction in the camera's screen plane, plus a hair of sideways jitter.
    const x = cos(angle).mul(r).sub(sin(angle).mul(jitter));
    const y = sin(angle).mul(r).add(cos(angle).mul(jitter));
    material.positionNode = this.screenRight.mul(x).add(this.screenUp.mul(y));
    material.scaleNode = float(0.075).mul(amp.mul(0.7).add(0.5));

    // Array reads stay in the vertex stage; the fragment gets plain varyings.
    const bandFrac = varying(band.div(SPECTRUM_BANDS - 1));
    const ampV = varying(amp);
    const tip = varying(exp(along.sub(1).mul(4))); // brighter toward the bar's outer end
    material.colorNode = mix(this.lowColor, this.highColor, bandFrac)
      .mul(ampV.mul(1.4).add(0.25))
      .mul(tip.mul(0.6).add(0.4))
      .mul(this.presence)
      .mul(2.2);
    const d = uv().sub(0.5).length();
    material.opacityNode = exp(d.mul(d).mul(-34));

    this.count = count;
    this.frustumCulled = false;
  }

  /** Keep the ring facing the camera: call once per frame after the camera moves. */
  orient(camera: Camera) {
    camera.updateMatrixWorld();
    this.screenRight.value.setFromMatrixColumn(camera.matrixWorld, 0);
    this.screenUp.value.setFromMatrixColumn(camera.matrixWorld, 1);
  }
}
