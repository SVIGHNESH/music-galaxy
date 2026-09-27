import type { AudioFeatures } from '../audio/analysis';

const ROWS: { key: 'bass' | 'mid' | 'treble' | 'level'; color: string }[] = [
  { key: 'bass', color: '#ffb870' },
  { key: 'mid', color: '#f4ecdf' },
  { key: 'treble', color: '#a9c8ff' },
  { key: 'level', color: '#d0707a' },
];

/** Feature bars and a beat lamp for tuning. Toggle with D, or open with ?debug. */
export class DebugMeter {
  private el: HTMLElement;
  private bars = new Map<string, HTMLElement>();
  private lamp: HTMLElement;
  private beats: HTMLElement;
  private beatCount = 0;
  private dropCount = 0;
  private lampUntil = 0;

  constructor(host: HTMLElement) {
    host.insertAdjacentHTML(
      'beforeend',
      `<section class="meter" aria-label="Audio analysis" hidden>
        ${ROWS.map((r) => `<div class="meter-row"><span>${r.key}</span><i><b data-k="${r.key}" style="background:${r.color}"></b></i></div>`).join('')}
        <div class="meter-row meter-beat"><span>beat</span><em class="lamp"></em><output>0</output></div>
      </section>`,
    );
    this.el = host.querySelector('.meter')!;
    ROWS.forEach((r) => this.bars.set(r.key, this.el.querySelector(`[data-k="${r.key}"]`)!));
    this.lamp = this.el.querySelector('.lamp')!;
    this.beats = this.el.querySelector('output')!;

    this.setVisible(new URLSearchParams(location.search).has('debug'));
    addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() === 'd' && !e.metaKey && !e.ctrlKey && !(e.target instanceof HTMLInputElement)) {
        this.setVisible(this.el.hidden === true);
      }
    });
  }

  private setVisible(visible: boolean) {
    this.el.hidden = !visible;
    document.body.classList.toggle('is-debug', visible);
  }

  /** Called per fixed step so beat flags (true for one step) are never missed. */
  step(f: AudioFeatures, simTime: number) {
    if (f.drop) this.dropCount++;
    if (f.beat) {
      this.beatCount++;
      this.lampUntil = simTime + 0.1;
    }
    if (this.el.hidden) return;
    for (const { key } of ROWS) this.bars.get(key)!.style.transform = `scaleX(${f[key].toFixed(3)})`;
    this.lamp.classList.toggle('on', simTime < this.lampUntil);
    this.beats.textContent = this.dropCount ? `${this.beatCount} · ${this.dropCount} drop` : String(this.beatCount);
  }
}
