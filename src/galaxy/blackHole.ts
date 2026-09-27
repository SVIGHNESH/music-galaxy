import { Color, type PerspectiveCamera } from 'three/webgpu';
import { exp, float, Fn, screenUV, smoothstep, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { Node, TextureNode } from 'three/webgpu';

/** Event-horizon radius in world units. */
const HORIZON = 0.36;

type UV = Node<'vec2'>;

/**
 * Screen-space gravitational lens around the galactic core, fused with the
 * final composite (horizon shadow, photon ring, drop flash, colour split) so
 * all of it costs one full-screen pass. The camera always orbits the origin,
 * so the hole sits at the centre of the screen; only its apparent size changes.
 */
export function createBlackHole(scene: TextureNode) {
  const radius = uniform(0.02); // horizon radius in screen-height units
  const aspect = uniform(1);
  const flare = uniform(0);
  const ringColor = uniform(new Color('#ffb870'));

  const offsetOf = (uv: UV) => uv.sub(0.5).mul(vec2(aspect, 1));

  // Thin-lens deflection: a ray passing at r sees light from r - k*rs^2/r,
  // which magnifies the region round the hole into an Einstein ring.
  // Faded out far away so the rest of the frame is untouched.
  const lensAt = (uv: UV) => {
    const d = offsetOf(uv);
    const r = d.length().max(1e-5);
    const bend = radius.mul(radius).mul(1.6).div(r).mul(exp(r.div(radius.mul(9)).negate()));
    return scene.sample(uv.sub(d.div(r).mul(bend).div(vec2(aspect, 1))));
  };

  /** Lensed scene at the current pixel; this is what bloom reads. */
  const lensed = Fn(() => lensAt(screenUV))();

  /**
   * Final pass. Shadow and ring go on after bloom, otherwise the glowing core
   * bleeds over the horizon and it reads as a pale disc instead of true black.
   * Colour split scales red outward and blue inward from the centre.
   */
  const finalize = (bloom: TextureNode, aberration: Node<'float'>, whiteout: Node<'float'>) =>
    Fn(() => {
      const split = aberration.mul(0.022);
      const uvR = screenUV.sub(0.5).mul(split.add(1)).add(0.5);
      const uvB = screenUV.sub(0.5).mul(float(1).sub(split)).add(0.5);
      const color = vec3(
        lensAt(uvR).r.add(bloom.sample(uvR).r),
        lensAt(screenUV).g.add(bloom.sample(screenUV).g),
        lensAt(uvB).b.add(bloom.sample(uvB).b),
      );

      const r = offsetOf(screenUV).length();
      const shadow = smoothstep(radius.mul(0.92), radius.mul(1.06), r);
      const ringOffset = r.sub(radius.mul(1.28)).div(radius.mul(0.09));
      const ring = exp(ringOffset.mul(ringOffset).negate()).mul(flare.mul(0.9).add(0.6));

      return vec4(color.mul(shadow).add(ringColor.mul(ring)).add(whiteout), 1);
    })();

  return {
    lensed,
    finalize,
    ringColor,
    /** Beat envelope, 0..1. */
    flare,
    update(camera: PerspectiveCamera, fovDeg: number) {
      const distance = camera.position.length();
      radius.value = (HORIZON / (distance * Math.tan((fovDeg * Math.PI) / 360))) * 0.5;
      aspect.value = camera.aspect;
    },
  };
}
