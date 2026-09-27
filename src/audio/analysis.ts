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
  /** Log-spaced spectrum, low to high, each 0..1. */
  spectrum: Float32Array;
  /** True on the step a drop lands: energy surging back after a quieter stretch. */
  drop: boolean;
  /** Sound colour relative to the song so far: -1 dark/bassy .. +1 bright/airy. */
  tint: number;
}

export const SPECTRUM_BANDS = 64;
const SPECTRUM_RANGE = [40, 14000] as const;

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

  // Spectrum: one shared gain keeps the shape of the spectrum honest; a
  // gentle tilt lifts the highs so they aren't dwarfed by bass.
  private readonly spectrumBins: [number, number][] = [];
  private readonly spectrumTilt = new Float32Array(SPECTRUM_BANDS);
  private readonly spectrumGain = new AutoGain(1e-3);
  private readonly spectrumScratch = new Float32Array(SPECTRUM_BANDS);

  // Drop detection compares a fast energy envelope with a slow one.
  private energyFast = 0;
  private energySlow = 0;
  private sinceDrop = Infinity;
  /** Seconds of continuous signal; the slow envelope is meaningless before it fills. */
  private heard = 0;

  private centroidMean = 0.5;
  private centroidSeeded = false;

  readonly features: AudioFeatures = {
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

    const [lo, hi] = SPECTRUM_RANGE;
    for (let b = 0; b < SPECTRUM_BANDS; b++) {
      const f0 = lo * Math.pow(hi / lo, b / SPECTRUM_BANDS);
      const f1 = lo * Math.pow(hi / lo, (b + 1) / SPECTRUM_BANDS);
      const a = Math.max(1, Math.floor(f0 / hz));
      this.spectrumBins.push([a, Math.max(a, Math.min(bins - 1, Math.floor(f1 / hz)))]);
      this.spectrumTilt[b] = Math.pow((f0 + f1) / 2 / 1000, 0.35);
    }
  }

  step(analyser: AnalyserNode | null, dt: number): AudioFeatures {
    const f = this.features;
    f.beat = false;
    f.beatStrength = 0;
    f.drop = false;
    this.sinceBeat += dt;
    this.sinceDrop += dt;

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

    this.stepSpectrum(f);
    this.stepDrop(f, mean([1, this.ranges.treble[1]]), dt);
    this.stepTint(f, dt);
    return f;
  }

  private stepSpectrum(f: AudioFeatures) {
    let loudest = 0;
    const bands = f.spectrum;
    const next = this.spectrumScratch;
    for (let b = 0; b < SPECTRUM_BANDS; b++) {
      const [a, z] = this.spectrumBins[b];
      let peak = 0;
      for (let i = a; i <= z; i++) peak = Math.max(peak, this.amp[i]);
      next[b] = peak * this.spectrumTilt[b];
      loudest = Math.max(loudest, next[b]);
    }
    const gain = this.spectrumGain.apply(loudest) / Math.max(loudest, 1e-9);
    for (let b = 0; b < SPECTRUM_BANDS; b++) {
      bands[b] = follow(bands[b], Math.min(next[b] * gain, 1), 0.55, 0.14);
    }
  }

  /**
   * A drop is a beat that lands while short-term energy has jumped well above
   * the recent average, i.e. the music has come back hard after a lull.
   */
  private stepDrop(f: AudioFeatures, energy: number, dt: number) {
    this.heard += dt;
    this.energyFast += (energy - this.energyFast) * (1 - Math.exp(-dt / 0.25));
    this.energySlow += (energy - this.energySlow) * (1 - Math.exp(-dt / 4));
    const surge = this.energyFast / Math.max(this.energySlow, 1e-6);
    if (f.beat && this.heard > 4 && surge > 1.5 && this.sinceDrop > 8) {
      f.drop = true;
      this.sinceDrop = 0;
    }
  }

  /** Spectral centroid on a log scale, compared with the song's own running mean. */
  private stepTint(f: AudioFeatures, dt: number) {
    let weighted = 0;
    let total = 0;
    for (let b = 0; b < SPECTRUM_BANDS; b++) {
      weighted += b * f.spectrum[b];
      total += f.spectrum[b];
    }
    if (total < 1e-4) return;
    const centroid = weighted / total / (SPECTRUM_BANDS - 1);
    if (!this.centroidSeeded) {
      this.centroidMean = centroid;
      this.centroidSeeded = true;
    }
    this.centroidMean += (centroid - this.centroidMean) * (1 - Math.exp(-dt / 10));
    const target = Math.max(-1, Math.min(1, (centroid - this.centroidMean) * 6));
    f.tint += (target - f.tint) * (1 - Math.exp(-dt / 0.8));
  }

  private decayToSilence() {
    const f = this.features;
    f.active = false;
    this.heard = 0;
    this.energyFast = 0;
    this.energySlow = 0;
    f.bass = follow(f.bass, 0, 0, 0.08);
    f.mid = follow(f.mid, 0, 0, 0.08);
    f.treble = follow(f.treble, 0, 0, 0.08);
    f.level = follow(f.level, 0, 0, 0.06);
    for (let b = 0; b < SPECTRUM_BANDS; b++) f.spectrum[b] = follow(f.spectrum[b], 0, 0, 0.1);
    f.tint = follow(f.tint, 0, 0, 0.02);
    return f;
  }
}
