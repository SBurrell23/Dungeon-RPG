/**
 * Fixed-timestep simulation with a decoupled render pass. Keeping the sim at a
 * constant 60 Hz means host and client integrate movement identically, which
 * is what makes client-side prediction line up with the host.
 */
export const TICK_HZ = 60;
export const TICK_DT = 1 / TICK_HZ;
const MAX_CATCHUP = 5; // never simulate more than this many ticks in one frame

export class GameLoop {
  constructor({ update, render }) {
    this.update = update;
    this.render = render;
    this.accumulator = 0;
    this.last = 0;
    this.running = false;
    this.tick = 0;
    this.fps = 60;
    this._fpsAccum = 0;
    this._fpsFrames = 0;
    this._frame = this._frame.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this._frame);
  }

  stop() { this.running = false; }

  _frame(now) {
    if (!this.running) return;
    requestAnimationFrame(this._frame);

    let elapsed = (now - this.last) / 1000;
    this.last = now;
    if (elapsed > 0.25) elapsed = 0.25; // tab was backgrounded; don't spiral
    this.accumulator += elapsed;

    let steps = 0;
    while (this.accumulator >= TICK_DT && steps < MAX_CATCHUP) {
      this.update(TICK_DT, this.tick++);
      this.accumulator -= TICK_DT;
      steps++;
    }
    if (steps >= MAX_CATCHUP) this.accumulator = 0;

    this._fpsAccum += elapsed;
    this._fpsFrames++;
    if (this._fpsAccum >= 0.5) {
      this.fps = this._fpsFrames / this._fpsAccum;
      this._fpsAccum = 0; this._fpsFrames = 0;
    }

    this.render(this.accumulator / TICK_DT, elapsed);
  }
}
