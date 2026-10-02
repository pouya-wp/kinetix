// Global playhead shared by all studios.

type Fn = () => void;

class Clock {
  t = 0;
  playing = false;
  loop = true;
  fps = 30;
  duration = 1;
  private listeners = new Set<Fn>();
  private last = 0;
  private raf = 0;

  on(fn: Fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit() { for (const f of this.listeners) f(); }

  get frame() { return Math.round(this.t * this.fps); }
  get frames() { return Math.max(1, Math.round(this.duration * this.fps)); }

  seek(t: number) {
    this.t = Math.min(Math.max(0, t), this.duration);
    this.emit();
  }
  seekFrame(f: number) { this.seek(f / this.fps); }
  step(df: number) { this.pause(); this.seekFrame(Math.min(this.frames, Math.max(0, this.frame + df))); }

  play() {
    if (this.playing) return;
    if (this.t >= this.duration - 1e-6) this.t = 0;
    this.playing = true;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.playing) return;
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      let t = this.t + dt;
      if (t >= this.duration) {
        if (this.loop) t = t % Math.max(1e-3, this.duration);
        else { t = this.duration; this.playing = false; }
      }
      this.t = t;
      this.emit();
      if (this.playing) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
    this.emit();
  }
  pause() {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    // land on a whole frame so the preview matches what AE will show
    this.t = Math.round(this.t * this.fps) / this.fps;
    this.emit();
  }
  toggle() { this.playing ? this.pause() : this.play(); }
  setDuration(d: number) {
    this.duration = Math.max(1 / this.fps, d);
    if (this.t > this.duration) this.t = this.duration;
  }
}

export const clock = new Clock();
if (typeof window !== 'undefined') (window as any).__kxclock = clock;
