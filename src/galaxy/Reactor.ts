import type { PerspectiveCamera } from 'three/webgpu';
import type { AudioFeatures } from '../audio/analysis';
import type { Galaxy } from './Galaxy';

export const SILENT: AudioFeatures = {
  bass: 0,
  mid: 0,
  treble: 0,
  level: 0,
  beat: false,
  beatStrength: 0,
  active: false,
};

const IDLE_SPIN = 0.045;
const BASE_BLOOM = 0.9;

/**
 * Maps audio features onto the galaxy, bloom and camera. Runs once per fixed
 * step and owns every piece of state that must survive a galaxy rebuild.
 */
export class Reactor {
  private spin = 0;
  private spinRate = IDLE_SPIN;
  private flash = 0;
  private punch = 0;
  private readonly motion = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.3 : 1;

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly baseFov: number,
    private readonly bloom: { strength: { value: number } },
  ) {}

  step(f: AudioFeatures, galaxy: Galaxy, dt: number) {
    // Mids speed the rotation up; heavily smoothed so tempo changes feel like
    // momentum rather than a gear change.
    const targetRate = IDLE_SPIN + 0.2 * f.mid * this.motion;
    this.spinRate += (targetRate - this.spinRate) * (1 - Math.exp(-dt * 0.8));
    this.spin += this.spinRate * dt;

    const decay = (v: number, rate: number) => v * Math.exp(-dt * rate);
    this.flash = decay(this.flash, 5);
    this.punch = decay(this.punch, 7);
    if (f.beat) {
      this.flash = Math.max(this.flash, 0.45 + 0.55 * f.beatStrength);
      this.punch = Math.max(this.punch, 0.4 + 0.6 * f.beatStrength);
      galaxy.pulse((6 + 12 * f.beatStrength) * this.motion);
    }

    const d = galaxy.drive;
    d.spin.value = this.spin;
    d.spinRate.value = this.spinRate;
    // Curves add contrast: small movements stay calm, peaks read clearly.
    d.breath.value = Math.pow(f.bass, 1.5) * this.motion;
    d.sparkle.value = f.treble * f.treble;
    d.glow.value = f.level;
    d.flash.value = this.flash;
    galaxy.sim.turbulence.value = 0.25 + 0.45 * f.mid * this.motion;

    this.bloom.strength.value = BASE_BLOOM + 0.15 * f.level + 0.35 * this.flash;

    const fov = this.baseFov - 1.8 * this.punch * this.motion;
    if (Math.abs(fov - this.camera.fov) > 1e-3) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
