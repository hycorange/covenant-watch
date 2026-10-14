# CovenantWatch: ~3 min demo script

| # | Time | Shot | Voice-over |
|---|---|---|---|
| 1 | 0:00–0:20 | Title card, then an EDGAR page showing a real 8-K with Item 1.03 | "When an issuer goes bankrupt, the first public signal is an SEC 8-K. Tokenized notes keep trading anyway. CovenantWatch fixes that with Chainlink CRE." |
| 2 | 0:20–0:50 | README mermaid diagram | "Every six hours a CRE cron fires. Each DON node fetches the issuer's EDGAR submissions and reduces them to the most severe new 8-K. The nodes must agree on every field." |
| 3 | 0:50–1:15 | `edgar.ts` item table, then `config.staging.json` | "Items 1.03, 2.04, 3.01 and 4.02 count as breaches: bankruptcy, acceleration, delisting, restatement. Other material items are watch-level. All of it is configurable per deployment." |
| 4 | 1:15–1:45 | `workflow.ts` onCron: the `seen()` read and `writeReport` | "Before writing, the workflow reads CovenantRegistry on-chain, so a filing is recorded only once. New events become a signed report through the forwarder." |
| 5 | 1:45–2:10 | `assess.ts` and the `llm` config flag | "An optional LLM adds a severity and a plain-English summary. The key lives only in CRE secrets. If the step is off, the key is missing, the call errors, or the nodes disagree, a rule-based result is used. It's advisory and never decides the breach." |
| 6 | 2:10–2:35 | Terminal: `bun test` (21 pass) and `forge test` (7 pass) | "Twenty-one workflow tests cover parsing, consensus inputs, idempotency, and both LLM paths. Seven Foundry tests cover the registry and the note." |
| 7 | 2:35–2:50 | `TokenizedNote.sol` transfer guard, then a forge test where transfer reverts after a breach report | "Once a breach is flagged, the note halts transfers until the trustee cures it." |
| 8 | 2:50–3:00 | Closing card: limitations and next steps | "Next: a live simulation and a Sepolia deployment once our CRE account is active. CovenantWatch: legal events, enforced on-chain." |

Recording notes: 1080p, terminal font 16pt or larger, no secrets on screen (`.env` stays closed). If a CRE account
is available by recording time, replace shot 6 with `cre workflow simulate`.
