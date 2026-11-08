import { describe, expect, it } from "vitest";
import { planPayouts } from "../src/tournaments/settlement.js";

const t = { id: "t1", entryFee: 2_000_000, currency: "USDC", prizePool: 18_000_000, payoutBps: [5000, 3000, 2000], rakeBps: 0 };
const r = (rank: number, verified = true) => ({ matchId: "m", playerId: `p${rank}`, rank, verified });

describe("planPayouts", () => {
  it("pays verified ranks by tier in integer minor units", () => {
    const out = planPayouts(t, [r(1), r(2), r(3), r(4)], "m");
    expect(out.map((o) => o.amount)).toEqual([9_000_000, 5_400_000, 3_600_000]);
  });

  it("withholds unverified ranks instead of redistributing", () => {
    const out = planPayouts(t, [r(1, false), r(2), r(3)], "m");
    expect(out.map((o) => o.rank)).toEqual([2, 3]);
    expect(out.reduce((a, o) => a + o.amount, 0)).toBeLessThan(t.prizePool);
  });

  it("refuses tiers + rake above 100% and duplicate ranks", () => {
    expect(() => planPayouts({ ...t, rakeBps: 1000, payoutBps: [10000] }, [r(1)], "m")).toThrow();
    expect(() => planPayouts(t, [r(1), r(1)], "m")).toThrow();
  });
});
