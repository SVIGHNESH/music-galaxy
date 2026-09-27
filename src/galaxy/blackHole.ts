import { Color, type PerspectiveCamera } from 'three/webgpu';
import { exp, Fn, screenUV, smoothstep, uniform, vec2, vec4 } from 'three/tsl';
import type { Node, TextureNode } from 'three/webgpu';

/** Event-horizon radius in world units. */
const HORIZON = 0.36;

/**
 * Screen-space gravitational lens around the galactic core. The camera always
 * orbits the origin, so the hole sits at the centre of the screen and only its
 * apparent size changes with zoom.
 */
export function createBlackHole(scene: TextureNode) {
  const radius = uniform(0.02); // horizon radius in screen-height units
  const aspect = uniform(1);
  const flare = uniform(0);
  const ringColor = uniform(new Color('#ffb870'));

  const offset = () => screenUV.sub(0.5).mul(vec2(aspect, 1));

  // Thin-lens deflection: a ray passing at r sees light from r - k*rs^2/r,
  // which magnifies the region round the hole into an Einstein ring.
  // Faded out far away so the rest of the frame is untouched.
  const lensed = Fn(() => {
    const d = offset();
    const r = d.length().max(1e-5);
    const bend = radius.mul(radius).mul(1.6).div(r).mul(exp(r.div(radius.mul(9)).negate()));
    return scene.sample(screenUV.sub(d.div(r).mul(bend).div(vec2(aspect, 1))));
  })();

  /**
   * Applied after bloom: otherwise the glowing core bleeds back over the
   * shadow and the hole reads as a pale disc instead of true black.
   */
  const composite = (color: Node<'vec4'>) =>
    Fn(() => {
      const r = offset().length();
      const shadow = smoothstep(radius.mul(0.92), radius.mul(1.06), r);
      const ringOffset = r.sub(radius.mul(1.28)).div(radius.mul(0.09));
      const ring = exp(ringOffset.mul(ringOffset).negate()).mul(flare.mul(0.9).add(0.6));
      return vec4(color.rgb.mul(shadow).add(ringColor.mul(ring)), 1);
    })();

  return {
    lensed,
    composite,
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
