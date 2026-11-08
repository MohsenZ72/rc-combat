---
name: rc-web3
description: Implement Garage Rumble Web3 phases - SIWE wallet sign-in, TournamentEscrow contract on Base (USDC), EIP-712 result signing, settlement adapter, payouts. Use only for phase 2-3 work; gameplay must never depend on chain state.
---

# rc-web3

Read `docs/system-design/06-web3.md` first, especially **Legal and compliance**. Keep everything on **Base Sepolia** until a lawyer signs off on real-money play.

## Non-negotiables
* The game server decides results. The chain only escrows fees and pays signed results.
* Pay only `verified` results, from matches with **no bots**, after the dispute window.
* Use `planPayouts()` (integer minor units; withholds unverified ranks). Do not reimplement the split.
* The result-signing key lives in a KMS/HSM, never on game servers or in `.env` in production. Rotation goes through the contract timelock.

## Phase 2: SIWE
* `GET /auth/siwe/nonce` (store the nonce with expiry), `POST /auth/siwe/verify` (EIP-4361 message: domain, chainId, nonce, expiration) → link `players.wallet_address` (already unique-indexed) → the same session/JWT as guests.
* Client: viem + wagmi; Coinbase Smart Wallet for users without a wallet.
* Tests: replayed nonce, wrong domain or chain, expired message, address already linked.

## Phase 3: escrow
* `contracts/` with Foundry. `TournamentEscrow`: createTournament (multisig), deposit (exact fee, one per address, cap 10), postResult (EIP-712: chainId + contract + tournamentId + ranks + amounts), claim (pull), refund after deadline, rake cap.
* Foundry tests: wrong fee, double deposit, forged sig, cross-tournament replay, double claim, refund, re-entrancy, rake bound.
* API: indexer for `Deposit` events → tournament roster; `EscrowSettlement implements PrizeSettlementPort` bound instead of `FreeMatchSettlement` in `matches.module.ts`.
* Independent replay verification (`verifyReplay`) before signing.
