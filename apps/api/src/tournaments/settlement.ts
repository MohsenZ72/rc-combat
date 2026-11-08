import type { MatchOutcome, MatchResult, SettlementInstruction, Tournament } from "@rc/shared";

export const PRIZE_SETTLEMENT = Symbol("PRIZE_SETTLEMENT");

/**
 * Port between verified match results and money. The MVP binds the free
 * implementation; a future escrow/on-chain adapter implements the same
 * interface (see docs/system-design/web3.md). Blockchain is never the
 * authority for gameplay — it only receives what this port produces.
 */
export interface PrizeSettlementPort {
  settle(outcome: MatchOutcome): Promise<SettlementInstruction[]>;
}

/** Free matches: results are recorded, nothing is paid. */
export class FreeMatchSettlement implements PrizeSettlementPort {
  async settle(): Promise<SettlementInstruction[]> {
    return [];
  }
}

/**
 * Pure payout plan for a paid tournament, in integer minor units (e.g. USDC
 * 6-decimals → micro-USDC). Only verified results are eligible; an
 * unverified rank's share is withheld for manual review rather than
 * redistributed, so a cheater can never shift money by being disqualified
 * late. Rounding dust stays with the house.
 */
export function planPayouts(tournament: Tournament, results: MatchResult[], matchId: string): SettlementInstruction[] {
  if (!Number.isInteger(tournament.prizePool) || tournament.prizePool < 0) throw new Error("prizePool must be a non-negative integer in minor units");
  const tiersTotal = tournament.payoutBps.reduce((a, b) => a + b, 0);
  if (tiersTotal + tournament.rakeBps > 10_000) throw new Error("payout tiers + rake exceed 100%");
  const byRank = new Map<number, MatchResult>();
  for (const r of results) {
    if (byRank.has(r.rank)) throw new Error(`duplicate rank ${r.rank}`);
    byRank.set(r.rank, r);
  }
  const out: SettlementInstruction[] = [];
  tournament.payoutBps.forEach((bps, i) => {
    const r = byRank.get(i + 1);
    if (!r || !r.verified) return;
    const amount = Math.floor((tournament.prizePool * bps) / 10_000);
    if (amount > 0) out.push({ matchId, playerId: r.playerId, rank: r.rank, amount, currency: tournament.currency });
  });
  return out;
}
