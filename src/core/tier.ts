/** Star count every brightness/size compensation is measured against. */
export const REFERENCE_STARS = 500_000;

/** Budgets the governor steps down through, largest first. */
const TIERS = [500_000, 350_000, 250_000, 180_000, 120_000, 80_000];
const MIN_STARS = TIERS[TIERS.length - 1];
const STORAGE_KEY = 'music-galaxy:stars';

function forcedCount(): number | null {
  const n = Number(new URLSearchParams(location.search).get('stars'));
  return Number.isFinite(n) && n > 0 ? Math.round(Math.min(Math.max(n, 10_000), 2_000_000)) : null;
}

function storageKey(isWebGPU: boolean) {
  return `${STORAGE_KEY}:${isWebGPU ? 'webgpu' : 'webgl'}`;
}

/**
 * Starting particle budget: a saved result from a previous visit, else a guess
 * from the device class. `?stars=N` overrides everything for testing.
 */
export function pickStarCount(isWebGPU: boolean): number {
  const forced = forcedCount();
  if (forced) return forced;
  try {
    const saved = Number(localStorage.getItem(storageKey(isWebGPU)));
    if (TIERS.includes(saved)) return saved;
  } catch {
    // Storage can be unavailable (private mode); the governor still adapts.
  }
  if (matchMedia('(pointer: coarse)').matches) return 180_000;
  return isWebGPU ? REFERENCE_STARS : 250_000;
}

/**
 * Watches real frame rate after startup and asks for a smaller budget until the
 * device holds ~55fps. Only ever steps down, and at most a few times, so the
 * scene settles quickly instead of oscillating.
 */
export class QualityGovernor {
  private readonly warmup = 1.2;
  private readonly window = 2;
  private readonly target = 55;
  private readonly enabled: boolean;
  private elapsed = 0;
  private frames = 0;
  private sampleTime = 0;
  private last = performance.now();

  constructor(
    private readonly isWebGPU: boolean,
    private count: number,
    private readonly onChange: (count: number) => void,
  ) {
    this.enabled = forcedCount() === null;
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

    if (fps >= this.target || this.count <= MIN_STARS) {
      this.save();
      this.elapsed = -Infinity; // settled: stop measuring
      return;
    }

    // Cost scales roughly with star count, so jump straight to the tier that fits.
    const wanted = this.count * (fps / 60);
    const next = TIERS.find((t) => t <= wanted && t < this.count) ?? MIN_STARS;
    this.count = next;
    this.elapsed = 0;
    this.onChange(next);
  }

  private save() {
    try {
      localStorage.setItem(storageKey(this.isWebGPU), String(this.count));
    } catch {
      // Non-essential: without storage we simply re-measure next visit.
    }
  }
}
