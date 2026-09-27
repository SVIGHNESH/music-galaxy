/** Star count every brightness/size compensation is measured against. */
export const REFERENCE_STARS = 500_000;

export interface QualityLevel {
  stars: number;
  /** Fraction of the device pixel ratio (itself capped at 2) to render at. */
  scale: number;
}

/**
 * Quality ladder, best first. Stars cost vertex work; the post effects cost
 * per pixel, so resolution comes down alongside the star count. Without that,
 * a GPU that is fill-bound (most integrated ones) never reaches the target.
 */
const LEVELS: QualityLevel[] = [
  { stars: 500_000, scale: 1 },
  { stars: 350_000, scale: 1 },
  { stars: 250_000, scale: 0.9 },
  { stars: 180_000, scale: 0.85 },
  { stars: 120_000, scale: 0.75 },
  { stars: 80_000, scale: 0.65 },
];
const STORAGE_KEY = 'music-galaxy:quality';

function forcedStars(): number | null {
  const n = Number(new URLSearchParams(location.search).get('stars'));
  return Number.isFinite(n) && n > 0 ? Math.round(Math.min(Math.max(n, 10_000), 2_000_000)) : null;
}

function storageKey(isWebGPU: boolean) {
  return `${STORAGE_KEY}:${isWebGPU ? 'webgpu' : 'webgl'}`;
}

/**
 * Starting level: a saved result from a previous visit, else a guess from the
 * device class. `?stars=N` pins the star count at full resolution for testing.
 */
export function pickQuality(isWebGPU: boolean): QualityLevel {
  const forced = forcedStars();
  if (forced) return { stars: forced, scale: 1 };
  try {
    const saved = Number(localStorage.getItem(storageKey(isWebGPU)));
    if (Number.isInteger(saved) && LEVELS[saved]) return LEVELS[saved];
  } catch {
    // Storage can be unavailable (private mode); the governor still adapts.
  }
  if (matchMedia('(pointer: coarse)').matches) return LEVELS[3];
  return isWebGPU ? LEVELS[0] : LEVELS[2];
}

/**
 * Watches real frame rate after startup and steps down the quality ladder until
 * the device holds ~55fps, then remembers the level. Only ever steps down, so
 * the scene settles quickly instead of oscillating.
 */
export class QualityGovernor {
  private readonly warmup = 1.2;
  private readonly window = 1.6;
  private readonly target = 55;
  private readonly enabled: boolean;
  private level: number;
  private elapsed = 0;
  private frames = 0;
  private sampleTime = 0;
  private slowStreak = 0;
  private last = performance.now();

  constructor(
    private readonly isWebGPU: boolean,
    start: QualityLevel,
    private readonly onChange: (level: QualityLevel) => void,
  ) {
    this.enabled = forcedStars() === null;
    this.level = Math.max(0, LEVELS.indexOf(start));
  }

  frame() {
    if (!this.enabled) return;
    const now = performance.now();
    const dt = (now - this.last) / 1000;
    this.last = now;
    this.elapsed += dt;
    if (this.elapsed < this.warmup) return;

    this.frames++;
    this.sampleTime += dt;
    if (this.sampleTime < this.window) return;

    const fps = this.frames / this.sampleTime;
    this.frames = 0;
    this.sampleTime = 0;

    const last = LEVELS.length - 1;
    if (fps >= this.target || this.level === last) {
      this.save();
      this.elapsed = -Infinity; // settled: stop measuring
      return;
    }
    // A single slow window can be a hiccup (tab switch, GC, another app);
    // only a second one in a row counts, or noise would ratchet quality down
    // a little further on every visit.
    if (++this.slowStreak < 2) return;
    this.slowStreak = 0;

    // One level at a time, two when far off, so we don't overshoot quality.
    this.level = Math.min(last, this.level + (fps < this.target * 0.6 ? 2 : 1));
    this.elapsed = 0;
    this.onChange(LEVELS[this.level]);
  }

  private save() {
    try {
      localStorage.setItem(storageKey(this.isWebGPU), String(this.level));
    } catch {
      // Non-essential: without storage we simply re-measure next visit.
    }
  }
}
