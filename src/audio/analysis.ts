/** Audio features, all normalized to 0..1 regardless of source loudness. */
export interface AudioFeatures {
  bass: number;
  mid: number;
  treble: number;
  level: number;
  /** True on the single step a beat is detected. */
  beat: boolean;
  /** How far the beat cleared the threshold, 0..1. */
  beatStrength: number;
  /** False while the input is silent or absent. */
  active: boolean;
}

const BANDS = {
  bass: [30, 160],
  mid: [160, 2000],
  treble: [2000, 11000],
} as const;

const SILENCE_DB = -72;

/**
 * Peak-following automatic gain: tracks the recent maximum of a signal and
 * divides by it, so a quiet mic and a loud file both span 0..1. The peak decays
 * slowly so quiet passages regain range after a few seconds.
 */
class AutoGain {
  private peak: number;
  constructor(
    private readonly floor: number,
    private readonly decay = 0.9985,
  ) {
    this.peak = floor;
  }
  apply(x: number) {
    this.peak = Math.max(x, this.peak * this.decay, this.floor);
    return Math.min(x / this.peak, 1);
  }
}

/** Fast attack, slower release: punchy on hits, no flicker on the way down. */
const follow = (current: number, target: number, attack: number, release: number) =>
  current + (target - current) * (target > current ? attack : release);

/**
 * Turns raw FFT frames into stable features. Runs once per fixed 60Hz step so
 * the same audio yields the same features on any display.
 */
export class AudioAnalysis {
  private readonly db: Float32Array<ArrayBuffer>;
  private readonly amp: Float32Array;
  private readonly prevAmp: Float32Array;
  private readonly ranges: Record<keyof typeof BANDS, [number, number]>;
  private readonly fluxEnd: number;

  private readonly gain = {
    bass: new AutoGain(2e-3),
    mid: new AutoGain(1e-3),
    treble: new AutoGain(4e-4),
    level: new AutoGain(1e-3),
    flux: new AutoGain(1e-3, 0.999),
  };

  private readonly fluxHistory: number[] = [];
  private readonly historySize = 50; // ~0.8s at 60Hz
  private sinceBeat = Infinity;
  private readonly refractory = 0.22; // seconds; faster than any real tempo's beat spacing

  readonly features: AudioFeatures = {
    bass: 0,
    mid: 0,
    treble: 0,
    level: 0,
    beat: false,
    beatStrength: 0,
    active: false,
  };

  constructor(fftSize: number, sampleRate: number) {
    const bins = fftSize / 2;
    this.db = new Float32Array(bins);
    this.amp = new Float32Array(bins);
    this.prevAmp = new Float32Array(bins);
    const hz = sampleRate / fftSize;
    const toBins = ([lo, hi]: readonly [number, number]): [number, number] => [
      Math.max(1, Math.floor(lo / hz)),
      Math.min(bins - 1, Math.ceil(hi / hz)),
    ];
    this.ranges = { bass: toBins(BANDS.bass), mid: toBins(BANDS.mid), treble: toBins(BANDS.treble) };
    this.fluxEnd = Math.ceil(220 / hz);
  }

  step(analyser: AnalyserNode | null, dt: number): AudioFeatures {
    const f = this.features;
    f.beat = false;
    f.beatStrength = 0;
    this.sinceBeat += dt;

    if (!analyser) return this.decayToSilence();

    analyser.getFloatFrequencyData(this.db);
    let peakDb = -Infinity;
    for (let i = 0; i < this.db.length; i++) {
      const d = this.db[i];
      if (d > peakDb) peakDb = d;
      this.amp[i] = d === -Infinity ? 0 : Math.pow(10, d / 20);
    }
    if (peakDb < SILENCE_DB) {
      this.prevAmp.set(this.amp);
      return this.decayToSilence();
    }
    f.active = true;

    const mean = ([a, b]: [number, number]) => {
      let s = 0;
      for (let i = a; i <= b; i++) s += this.amp[i];
      return s / (b - a + 1);
    };
    const bass = this.gain.bass.apply(mean(this.ranges.bass));
    const mid = this.gain.mid.apply(mean(this.ranges.mid));
    const treble = this.gain.treble.apply(mean(this.ranges.treble));
    const level = this.gain.level.apply(mean([1, this.ranges.treble[1]]));

    f.bass = follow(f.bass, bass, 0.6, 0.12);
    f.mid = follow(f.mid, mid, 0.45, 0.1);
    f.treble = follow(f.treble, treble, 0.55, 0.14);
    f.level = follow(f.level, level, 0.4, 0.06);

    // Onset detection: positive spectral flux in the low end (kicks, bass hits),
    // compared against the mean + spread of the last ~0.8s.
    let flux = 0;
    for (let i = 1; i <= this.fluxEnd; i++) flux += Math.max(0, this.amp[i] - this.prevAmp[i]);
    this.prevAmp.set(this.amp);
    const nFlux = this.gain.flux.apply(flux);

    const h = this.fluxHistory;
    if (h.length >= 10) {
      const avg = h.reduce((a, b) => a + b, 0) / h.length;
      const sd = Math.sqrt(h.reduce((a, b) => a + (b - avg) ** 2, 0) / h.length);
      const threshold = Math.max(avg + 1.6 * sd, 0.22);
      if (nFlux > threshold && this.sinceBeat >= this.refractory) {
        f.beat = true;
        f.beatStrength = Math.min((nFlux - threshold) / (1 - threshold + 1e-6), 1);
        this.sinceBeat = 0;
      }
    }
    h.push(nFlux);
    if (h.length > this.historySize) h.shift();

    return f;
  }

  private decayToSilence() {
    const f = this.features;
    f.active = false;
    f.bass = follow(f.bass, 0, 0, 0.08);
    f.mid = follow(f.mid, 0, 0, 0.08);
    f.treble = follow(f.treble, 0, 0, 0.08);
    f.level = follow(f.level, 0, 0, 0.06);
    return f;
  }
}
