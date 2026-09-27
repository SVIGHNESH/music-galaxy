import { float, Fn, screenUV, vec3, vec4 } from 'three/tsl';
import type { Node, TextureNode } from 'three/webgpu';

/**
 * Final composite in one full-screen pass (the main cost on integrated GPUs
 * is the number of passes): scene + bloom, drop flash, and a colour split that
 * scales red outward and blue inward from the centre.
 */
export function finalPass(scene: TextureNode, bloom: TextureNode, aberration: Node<'float'>, whiteout: Node<'float'>) {
  return Fn(() => {
    const split = aberration.mul(0.022);
    const uvR = screenUV.sub(0.5).mul(split.add(1)).add(0.5);
    const uvB = screenUV.sub(0.5).mul(float(1).sub(split)).add(0.5);
    const color = vec3(
      scene.sample(uvR).r.add(bloom.sample(uvR).r),
      scene.sample(screenUV).g.add(bloom.sample(screenUV).g),
      scene.sample(uvB).b.add(bloom.sample(uvB).b),
    );
    return vec4(color.add(whiteout), 1);
  })();
}
