import { decodeInput, seqNewer, type AnomalyKind, type InputPacket, type NetConfig } from "@rc/shared";

export interface InputVerdict {
  accepted: boolean;
  anomaly?: AnomalyKind;
  detail?: string;
}

/**
 * First line of defence for client traffic: strict decoding, replay
 * protection, rate limiting and a bounded queue. The simulation consumes at
 * most one input per tick, so sending inputs faster than the tick rate
 * ("speed hack by input flooding") gains nothing.
 */
export class InputGuard {
  private readonly queue: InputPacket[] = [];
  private tokens: number;
  private lastRefillMs: number;
  private lastSeq: number | null = null;
  private lastPacketMs: number | null = null;
  private readonly violationTimes: number[] = [];
  private readonly lastAnomalyMs = new Map<AnomalyKind, number>();

  /** Sequence number of the input most recently handed to the simulation. */
  lastAppliedSeq = 0;
  received = 0;
  dropped = 0;
  rejected = 0;
  private intervalMean = 0;
  private intervalM2 = 0;
  private intervalCount = 0;

  constructor(private readonly net: NetConfig, nowMs: number, private readonly antiCheatWindowSeconds = 10) {
    this.tokens = net.inputBurst;
    this.lastRefillMs = nowMs;
  }

  /** Validates one INPUT message. Never throws on hostile payloads. */
  receive(payload: unknown, nowMs: number): InputVerdict {
    this.refill(nowMs);
    const decoded = decodeInput(payload);
    if (!decoded.ok) {
      this.rejected++;
      this.recordViolation(nowMs);
      return this.anomaly("malformed_packet", decoded.reason, nowMs);
    }
    if (this.tokens < 1) {
      this.dropped++;
      return this.anomaly("input_flood", "rate limit exceeded", nowMs);
    }
    this.tokens -= 1;
    const { seq } = decoded.value;
    if (this.lastSeq !== null && !seqNewer(seq, this.lastSeq)) {
      this.rejected++;
      return this.anomaly("replayed_input", `seq ${seq} not newer than ${this.lastSeq}`, nowMs);
    }
    this.lastSeq = seq;
    this.received++;
    this.trackInterval(nowMs);
    this.queue.push(decoded.value);
    while (this.queue.length > this.net.inputBufferSize) {
      this.queue.shift();
      this.dropped++;
    }
    return { accepted: true };
  }

  /** Next input for this tick, or null if the client sent nothing new. */
  take(): InputPacket | null {
    const next = this.queue.shift() ?? null;
    if (next) this.lastAppliedSeq = next.seq;
    return next;
  }

  /** Counts a protocol violation (unknown message type etc.). */
  recordViolation(nowMs: number): void {
    this.violationTimes.push(nowMs);
    const cutoff = nowMs - this.antiCheatWindowSeconds * 1000;
    while (this.violationTimes.length > 0 && this.violationTimes[0]! < cutoff) this.violationTimes.shift();
  }

  violationsInWindow(): number {
    return this.violationTimes.length;
  }

  /** Clears queued inputs (used on reconnect so stale inputs are not replayed). */
  resetQueue(): void {
    this.queue.length = 0;
    this.lastSeq = null;
  }

  packetIntervalStats(): { meanMs: number; jitterMs: number } {
    return {
      meanMs: this.intervalMean,
      jitterMs: this.intervalCount > 1 ? Math.sqrt(this.intervalM2 / (this.intervalCount - 1)) : 0,
    };
  }

  private refill(nowMs: number): void {
    const elapsed = Math.max(0, nowMs - this.lastRefillMs) / 1000;
    this.lastRefillMs = nowMs;
    const rate = this.net.tickRate * this.net.inputRateMultiplier;
    this.tokens = Math.min(this.net.inputBurst, this.tokens + elapsed * rate);
  }

  private trackInterval(nowMs: number): void {
    if (this.lastPacketMs !== null) {
      const interval = nowMs - this.lastPacketMs;
      this.intervalCount++;
      const delta = interval - this.intervalMean;
      this.intervalMean += delta / this.intervalCount;
      this.intervalM2 += delta * (interval - this.intervalMean);
    }
    this.lastPacketMs = nowMs;
  }

  /** Reports each anomaly kind at most once per second; the rest is counted silently. */
  private anomaly(kind: AnomalyKind, detail: string, nowMs: number): InputVerdict {
    const last = this.lastAnomalyMs.get(kind);
    if (last !== undefined && nowMs - last < 1000) return { accepted: false };
    this.lastAnomalyMs.set(kind, nowMs);
    return { accepted: false, anomaly: kind, detail };
  }
}
