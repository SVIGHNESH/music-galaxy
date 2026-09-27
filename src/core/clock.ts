/**
 * Fixed-step clock: the simulation advances in exact 1/60s steps regardless of
 * display refresh rate, so a 30Hz phone and a 144Hz monitor show the same motion.
 */
export class FixedClock {
  readonly step = 1 / 60;
  /** Upper bound per frame so a slow device degrades to slow-motion, not a spiral of death. */
  readonly maxSteps = 4;
  simTime = 0;
  private accumulator = 0;
  private last = performance.now();

  /** Runs `onStep` once per fixed step that is due this frame. */
  tick(onStep: (simTime: number) => void) {
    const now = performance.now();
    // Clamp long pauses (tab hidden) so we never fast-forward in a burst.
    this.accumulator += Math.min((now - this.last) / 1000, 0.25);
    this.last = now;

    let steps = 0;
    while (this.accumulator >= this.step && steps < this.maxSteps) {
      this.accumulator -= this.step;
      this.simTime += this.step;
      onStep(this.simTime);
      steps++;
    }
    if (steps === this.maxSteps) this.accumulator = 0;
  }
}
