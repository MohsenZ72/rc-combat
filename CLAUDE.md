# CLAUDE.md

Follow [AGENTS.md](AGENTS.md); it is the single source of rules for AI agents in this repo.

Project skills (load the one that matches the task):

| Skill | Use for |
|---|---|
| `rc-dev` | running, testing, load testing, debugging the stack |
| `rc-netcode` | protocol, snapshots, prediction, interpolation, reconnection |
| `rc-anticheat` | validators, suspicion scoring, adding a cheat test |
| `rc-gameplay` | new items/weapons/abilities, balance, bots |
| `rc-track` | creating or editing a track |
| `rc-ui` | screens, HUD, design tokens, 3D look |
| `rc-web3` | wallet sign-in, escrow, settlement (phase 2–3) |
| `colyseus` | official Colyseus 0.18 reference (installed from colyseus/skill) |

External skills for the Web3 phases (installed from vetted sources, see `skills-lock.json`):

| Skill | Source | Use for |
|---|---|---|
| `build-on-base` | base/skills (official Base) | Base Sepolia/mainnet config, Foundry deploy + verification, wagmi/viem. Its "Builder Code" attribution is Base's referral program and is **optional** for us. |
| `web3-testing` | wshobson/agents | Foundry/Hardhat test patterns for the escrow contract |
| `solidity-security` | wshobson/agents | common Solidity vulnerabilities and fixes |
| `secure-workflow-guide` | trailofbits/skills | Trail of Bits secure development workflow (Slither, invariants) |
| `token-integration-analyzer` | trailofbits/skills | checking the USDC (ERC-20) integration |
| `entry-point-analyzer` | trailofbits/skills | mapping the contract's attack surface before audit |
