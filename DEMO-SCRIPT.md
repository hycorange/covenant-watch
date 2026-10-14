# CovenantWatch: ~3 min demo script (terminal recording)

Setup: terminal at the repo root, font 16pt or larger, 1080p. `.env` stays closed and no secrets are on screen.
Run `cre login` before recording.

| # | Time | Shot | Voice-over |
|---|---|---|---|
| 1 | 0:00–0:20 | Title card, then the EDGAR page for Petros Pharmaceuticals' 8-K 0001104659-26-112399 (Items 1.03 + 2.04, filed 2026-09-30) | "When an issuer goes bankrupt, the first public signal is an SEC 8-K. Tokenized notes keep trading anyway. CovenantWatch fixes that with Chainlink CRE." |
| 2 | 0:20–0:45 | `docs/architecture.png` (README diagram) | "A CRE cron fires every six hours. Each DON node fetches the issuer's EDGAR submissions and reduces them to the most severe new 8-K, and the nodes must agree on every field. The workflow checks the registry on-chain so a filing is recorded only once, then writes a signed report through the forwarder." |
| 3 | 0:45–1:05 | `edgar.ts` item table and `config.staging.json` | "Items 1.03, 2.04, 3.01 and 4.02 count as breaches: bankruptcy, acceleration, delisting, restatement. An optional LLM adds an advisory summary with a rule-based fallback. It never decides the breach." |
| 4 | 1:05–1:40 | Terminal: `cre workflow simulate my-workflow --target staging-settings` (or replay `docs/simulate-2026-10-15.txt`) | "Here is the workflow in the CRE simulator, calling live SEC EDGAR. Apple has no covenant-relevant 8-K this week, so the result is 'clear'." |
| 5 | 1:40–2:35 | Terminal: `./scripts/local-demo.sh` | "Now the on-chain side on a local anvil chain. We deploy CovenantRegistry and a note for Petros, and a transfer works. We take the real Petros 8-K, recorded from EDGAR, and encode it with the workflow's own code. The forwarder delivers it, the issuer is flagged, and the next transfer reverts with TransfersHalted. A non-forwarder can't write, a duplicate report is ignored, and the trustee's cure resumes transfers." |
| 6 | 2:35–2:50 | Terminal: `bun test` and `forge test`, both green | "The workflow and contracts are covered by bun and Foundry tests." |
| 7 | 2:50–3:00 | Closing card: status | "Simulated on CRE against live EDGAR, demonstrated on-chain locally, and DON deployment pending Chainlink's deploy-access approval. CovenantWatch: legal events, enforced on-chain." |
