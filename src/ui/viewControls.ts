import { PALETTES, type Palette } from '../galaxy/palette';

const icons = {
  expand:
    '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 7.5v-4h4M16.5 7.5v-4h-4M3.5 12.5v4h4M16.5 12.5v4h-4" /></svg>',
  collapse:
    '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7.5 3.5v4h-4M12.5 3.5v4h4M7.5 16.5v-4h-4M12.5 16.5v-4h4" /></svg>',
};

/** Palette swatches and fullscreen: bottom-right on desktop, top-right on phones. */
export class ViewControls {
  private swatches: HTMLButtonElement[];
  private fullscreen: HTMLButtonElement | null;

  constructor(host: HTMLElement, palette: Palette) {
    const canFullscreen = document.fullscreenEnabled === true;
    host.innerHTML = `
      <div class="view-controls">
        <div class="swatches" role="radiogroup" aria-label="Colour palette">
          ${PALETTES.map(
            (p, i) => `<button class="swatch" type="button" role="radio" data-index="${i}"
              aria-label="${p.name} palette" title="${p.name} (P)"
              style="--a:${p.core};--b:${p.arm}"></button>`,
          ).join('')}
        </div>
        ${canFullscreen ? `<button class="view-btn fullscreen" type="button" aria-label="Enter fullscreen" title="Fullscreen (F)">${icons.expand}</button>` : ''}
      </div>`;

    this.swatches = [...host.querySelectorAll<HTMLButtonElement>('.swatch')];
    this.fullscreen = host.querySelector('.fullscreen');

    host.querySelector('.swatches')!.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('.swatch');
      if (el) palette.set(Number(el.dataset.index));
    });
    // Arrow keys move within the radio group, as users of radio groups expect.
    host.querySelector('.swatches')!.addEventListener('keydown', (e) => {
      const key = (e as KeyboardEvent).key;
      if (key !== 'ArrowRight' && key !== 'ArrowLeft') return;
      e.preventDefault();
      palette.set(palette.index + (key === 'ArrowRight' ? 1 : -1));
      this.swatches[palette.index].focus();
    });
    this.fullscreen?.addEventListener('click', () => this.toggleFullscreen());
    document.addEventListener('fullscreenchange', () => this.renderFullscreen());

    addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key.toLowerCase() === 'p') palette.cycle();
      if (e.key.toLowerCase() === 'f' && canFullscreen) this.toggleFullscreen();
    });

    palette.onChange((def) => {
      this.swatches.forEach((s, i) => {
        s.setAttribute('aria-checked', String(i === palette.index));
        s.tabIndex = i === palette.index ? 0 : -1;
      });
      document.documentElement.style.setProperty('--core', def.accent);
    });
  }

  private toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => {});
  }

  private renderFullscreen() {
    if (!this.fullscreen) return;
    const on = !!document.fullscreenElement;
    this.fullscreen.innerHTML = on ? icons.collapse : icons.expand;
    this.fullscreen.setAttribute('aria-label', on ? 'Exit fullscreen' : 'Enter fullscreen');
  }
}
