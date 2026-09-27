import type { PerspectiveCamera } from 'three/webgpu';
import { SPECTRUM_BANDS, type AudioFeatures } from '../audio/analysis';
import type { Galaxy } from './Galaxy';
import type { SpectrumRing } from './SpectrumRing';

/** Post-processing controls the reactor drives. */
export interface Effects {
  bloom: { strength: { value: number } };
  /** Afterimage persistence, 0 = no trails. */
  trail: { value: number };
  /** Chromatic aberration strength. */
  aberration: { value: number };
  /** Additive white flash for drops. */
  whiteout: { value: number };
}

export const SILENT: AudioFeatures = {
  bass: 0,
  mid: 0,
  treble: 0,
  level: 0,
  beat: false,
  beatStrength: 0,
  active: false,
  spectrum: new Float32Array(SPECTRUM_BANDS),
  drop: false,
  tint: 0,
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
  /** Beat envelope, 0..1; also read by the black hole's photon ring. */
  flash = 0;
  private punch = 0;
  private shake = 0;
  private presence = 0;
  private trail = 0;
  /** True while the user drags the camera: trails would smear the whole frame. */
  interacting = false;
  private readonly motion = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.3 : 1;

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly baseFov: number,
    private readonly fx: Effects,
    private readonly ring: SpectrumRing,
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
    this.shake = decay(this.shake, 3.2);
    this.fx.whiteout.value = decay(this.fx.whiteout.value, 4);
    if (f.beat) {
      this.flash = Math.max(this.flash, 0.45 + 0.55 * f.beatStrength);
      this.punch = Math.max(this.punch, 0.4 + 0.6 * f.beatStrength);
      galaxy.pulse((6 + 12 * f.beatStrength) * this.motion);
    }
    // Drop: the music slams back in after a lull. Everything at once, bigger.
    if (f.drop) {
      this.flash = 1.4;
      this.punch = 1.6;
      this.shake = 1;
      this.fx.whiteout.value = 0.22 * this.motion;
      galaxy.pulse(40 * this.motion);
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

    d.tint.value = f.tint;
    this.fx.bloom.strength.value = BASE_BLOOM + 0.15 * f.level + 0.35 * this.flash;
    this.fx.aberration.value = (0.45 * this.flash + 0.5 * this.shake) * this.motion;

    // Light trails build up in loud, busy passages and vanish when quiet or dragging.
    const trailTarget = this.interacting ? 0 : Math.max(0, f.level - 0.35) * 1.25 * this.motion;
    this.trail += (trailTarget - this.trail) * (1 - Math.exp(-dt * 2));
    this.fx.trail.value = Math.min(this.trail, 0.82);

    // Spectrum ring fades in with sound.
    this.presence += ((f.active ? 1 : 0) - this.presence) * (1 - Math.exp(-dt * 1.5));
    this.ring.presence.value = this.presence;
    for (let b = 0; b < f.spectrum.length; b++) this.ring.bands[b] = f.spectrum[b];

    const fov = this.baseFov - 1.8 * this.punch * this.motion;
    if (Math.abs(fov - this.camera.fov) > 1e-3) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /**
   * Camera roll shake for drops. Applied after OrbitControls.update(), which
   * re-aims the camera every frame, so the roll never accumulates.
   */
  applyShake(time: number) {
    if (this.shake < 1e-3) return;
    const a = this.shake * 0.018 * this.motion;
    this.camera.rotateZ(Math.sin(time * 53) * a + Math.sin(time * 31) * a * 0.6);
  }
}
