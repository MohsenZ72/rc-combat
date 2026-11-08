/** Process-wide counters exposed on GET /metrics for load tests and ops. */
class Metrics {
  private tickSamples: number[] = [];
  private bytesOut = 0;
  private bytesIn = 0;
  private windowStart = Date.now();
  rooms = 0;
  activeMatches = 0;
  players = 0;
  matchesFinished = 0;
  kicks = 0;

  recordTick(ms: number): void {
    this.tickSamples.push(ms);
    if (this.tickSamples.length > 20000) this.tickSamples.splice(0, 10000);
  }

  recordOut(bytes: number): void {
    this.bytesOut += bytes;
  }

  recordIn(bytes: number): void {
    this.bytesIn += bytes;
  }

  /** Snapshot and reset the rolling window. */
  report() {
    const now = Date.now();
    const seconds = Math.max(0.001, (now - this.windowStart) / 1000);
    const sorted = [...this.tickSamples].sort((a, b) => a - b);
    const pct = (p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]! : 0);
    const out = {
      windowSeconds: Math.round(seconds * 10) / 10,
      rooms: this.rooms,
      activeMatches: this.activeMatches,
      players: this.players,
      matchesFinished: this.matchesFinished,
      kicks: this.kicks,
      tickMs: {
        count: sorted.length,
        avg: sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0,
        p50: pct(0.5),
        p99: pct(0.99),
        max: sorted.at(-1) ?? 0,
      },
      kbOutPerSec: this.bytesOut / 1024 / seconds,
      kbInPerSec: this.bytesIn / 1024 / seconds,
      memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      cpu: process.cpuUsage(),
    };
    this.tickSamples = [];
    this.bytesOut = 0;
    this.bytesIn = 0;
    this.windowStart = now;
    return out;
  }
}

export const metrics = new Metrics();
