/** Quiet instrument readouts around the edges of the viewport. */
export class Hud {
  private fpsEl: HTMLElement;
  private frames = 0;
  private lastSample = performance.now();

  constructor(private root: HTMLElement) {
    root.innerHTML = `
      <header class="hud-title">
        <h1>Music <span>Galaxy</span></h1>
        <p class="hud-credit">by Vighnesh Shukla</p>
        <p class="hud-hint">${(matchMedia('(pointer: coarse)').matches
          ? ['drag to orbit', 'pinch to zoom', 'tap to pulse']
          : ['drag to orbit', 'scroll to zoom', 'click to pulse']
        )
          .map((h) => `<span>${h}</span>`)
          .join('<i aria-hidden="true">·</i>')}</p>
      </header>
      <dl class="hud-stats">
        <div><dt>renderer</dt><dd data-k="backend">-</dd></div>
        <div><dt>stars</dt><dd data-k="stars">-</dd></div>
        <div><dt>fps</dt><dd data-k="fps">-</dd></div>
      </dl>`;
    this.fpsEl = root.querySelector('[data-k="fps"]')!;
  }

  setInfo(info: { backend: string; stars: number }) {
    this.root.querySelector('[data-k="backend"]')!.textContent = info.backend;
    this.root.querySelector('[data-k="stars"]')!.textContent = info.stars.toLocaleString('en-US');
  }

  frame() {
    this.frames++;
    const now = performance.now();
    if (now - this.lastSample >= 500) {
      this.fpsEl.textContent = String(Math.round((this.frames * 1000) / (now - this.lastSample)));
      this.frames = 0;
      this.lastSample = now;
    }
  }

  reveal() {
    this.root.classList.add('is-ready');
  }
}
