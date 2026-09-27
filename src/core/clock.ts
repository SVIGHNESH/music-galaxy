/**
 * Fixed-step clock: the simulation advances in exact 1/60s steps regardless of
 * display refresh rate, so a 30Hz phone and a 144Hz monitor show the same motion.
 */
export class FixedClock {
  readonly step = 1 / 60;
  simTime = 0;
  private accumulator = 0;
  private last = performance.now();

  /** Returns the number of fixed steps to run this frame. */
  tick(): number {
    const now = performance.now();
    // Clamp long pauses (tab hidden) so we never fast-forward in a burst.
    const dt = Math.min((now - this.last) / 1000, 0.25);
    this.last = now;
    this.accumulator += dt;

    let steps = 0;
    while (this.accumulator >= this.step) {
      this.accumulator -= this.step;
      this.simTime += this.step;
      steps++;
    }
    return steps;
  }
}
