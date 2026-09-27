import { Color } from 'three/webgpu';
import { uniform } from 'three/tsl';

export interface PaletteDef {
  id: string;
  name: string;
  /** Galactic core and the low end of the spectrum ring. */
  core: string;
  /** Hot inner stars where the arms begin. */
  inner: string;
  /** Outer arms and the high end of the spectrum ring. */
  arm: string;
  dust: string;
  halo: string;
  /** UI accent (title, buttons); tuned for legibility on the dark UI. */
  accent: string;
}

export const PALETTES: PaletteDef[] = [
  { id: 'ember', name: 'Ember', core: '#ffb870', inner: '#fff1dc', arm: '#a9c8ff', dust: '#d0707a', halo: '#6f7fa8', accent: '#ffb870' },
  { id: 'glacier', name: 'Glacier', core: '#dff4ff', inner: '#ffffff', arm: '#5fa8ff', dust: '#3b62c9', halo: '#50607a', accent: '#9fd8ff' },
  { id: 'solar', name: 'Solar', core: '#ffd27a', inner: '#ffe6bd', arm: '#ff7a3d', dust: '#b8322f', halo: '#7a4a3a', accent: '#ff9a5a' },
  { id: 'aurora', name: 'Aurora', core: '#eaffc8', inner: '#f2fff4', arm: '#46e0b0', dust: '#2a88b0', halo: '#3a6a6a', accent: '#7ff0c4' },
  { id: 'mono', name: 'Mono', core: '#ffffff', inner: '#f2f2f2', arm: '#b3b8c6', dust: '#6a6e7a', halo: '#50555f', accent: '#a9b4c8' },
];

const STORAGE_KEY = 'music-galaxy:palette';
const FADE_SECONDS = 1.2;
const KEYS = ['core', 'inner', 'arm', 'dust', 'halo'] as const;

/**
 * Live palette shared by every material that colours by it. Switching fades
 * the uniforms over ~1s, so a change feels like the galaxy re-lighting rather
 * than a cut. One instance survives galaxy rebuilds.
 */
export class Palette {
  readonly colors = {
    core: uniform(new Color()),
    inner: uniform(new Color()),
    arm: uniform(new Color()),
    dust: uniform(new Color()),
    halo: uniform(new Color()),
  };
  index: number;
  private from: Record<(typeof KEYS)[number], Color>;
  private to: Record<(typeof KEYS)[number], Color>;
  private fade = 1;
  private listeners = new Set<(p: PaletteDef) => void>();

  constructor() {
    this.index = Math.max(0, PALETTES.findIndex((p) => p.id === readSaved()));
    const def = PALETTES[this.index];
    this.from = toColors(def);
    this.to = toColors(def);
    this.apply(1);
  }

  get current() {
    return PALETTES[this.index];
  }

  onChange(fn: (p: PaletteDef) => void) {
    this.listeners.add(fn);
    fn(this.current);
  }

  set(index: number) {
    const next = ((index % PALETTES.length) + PALETTES.length) % PALETTES.length;
    if (next === this.index) return;
    // Start from whatever is on screen now, even mid-fade.
    for (const k of KEYS) this.from[k].copy(this.colors[k].value);
    this.index = next;
    this.to = toColors(PALETTES[next]);
    this.fade = 0;
    try {
      localStorage.setItem(STORAGE_KEY, this.current.id);
    } catch {
      // Remembering the palette is a convenience only.
    }
    this.listeners.forEach((fn) => fn(this.current));
  }

  cycle() {
    this.set(this.index + 1);
  }

  step(dt: number) {
    if (this.fade >= 1) return;
    this.fade = Math.min(1, this.fade + dt / FADE_SECONDS);
    // Smoothstep so the change eases in and settles.
    this.apply(this.fade * this.fade * (3 - 2 * this.fade));
  }

  private apply(t: number) {
    for (const k of KEYS) this.colors[k].value.copy(this.from[k]).lerp(this.to[k], t);
  }
}

function toColors(def: PaletteDef) {
  return {
    core: new Color(def.core),
    inner: new Color(def.inner),
    arm: new Color(def.arm),
    dust: new Color(def.dust),
    halo: new Color(def.halo),
  };
}

function readSaved() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
