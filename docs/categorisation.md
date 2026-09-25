# Transaction categorisation

The classifier is a separate Cloudflare Worker, `investments-categoriser`. Email ingest still applies the existing hand rules and optional Gemini batch before create. A model failure must not fail statement ingest, so the ingest consumer does not call JEV.

## Why JEV, and why this integration

JEV (`typesafe/jev`, observed model `jev-1.13.0`) is an evaluation model. It returns a choice, probabilities, and confidence. It does not generate text. Do not call it with `generateText`.

Cloudflare's `ai-gateway-provider` (docs, 20 Apr 2026) only adapts language models. Vercel `experimental_evaluate` bills Vercel AI Gateway (`typesafe-ai/jev`), not the Cloudflare AI Gateway credit on this account. The working path, verified with a live call, is:

`POST /accounts/{account}/ai/run` with `cf-aig-gateway-id: finance-ai-gateway`, or in a Worker:

`env.AI.run("typesafe/jev", { state, questions }, { gateway: { id: "finance-ai-gateway", skipCache: true, collectLog: false } })`

`gatewayMetadata.keySource` was `Unified`, so the call spent the Cloudflare AI Gateway credit. Logs are not collected, because the state contains transaction text. Notional cost is tracked from `usage.input_tokens` at $0.042 / 1M input tokens. Output tokens are free. A Vercel promotional price existed through 25 Sep 2026; this account's gateway path is billed as unified credit, and this experiment recorded charged cost as $0 in the response (no charge field was returned).

## Flow

V1 short-circuited on history and rules. That contaminated the threshold curve, because those sources are only about 60% and 53% precise. Hybrid and JEV modes now always call JEV. History, rules, FinWise's original category, account-pair context, and nearest examples are evidence, not a final decision. `mayAutoApply` returns false. The deployed worker is still shadow and has not been redeployed with this change.

## V2 measurement

Development window only: 2026-04-01 to 2026-07-01. The post-2026-07-01 set was not reused, and transactions on or after 2026-09-11 were not sent to JEV (86 rows left untouched).

On a seeded natural sample of 80, candidate-restricted JEV with relational state was 75.0% accurate (macro F1 0.71) against 56.3% for 45-way descriptions. The paired lift was +18.8 points, 95% bootstrap interval 10 to 29 points, McNemar 13.2. FinWise's original category on the 62 comparable rows was 74.2%. The same rows were 80.6% for v2, but that interval includes zero.

A second April–June slice, not used to design that prompt, tied: relational state with every category was 76.3%, and the same state restricted to retrieved candidates was also 76.3% (2 disagreements each way). Candidate restriction is not the accuracy bottleneck.

A third slice was 83.8% for JEV alone. Adding a Llama business-type hint on low-support merchants lowered that to 80.0% (3 losses, 0 wins). Do not adopt the hint.

A fourth slice compared one JEV call with a sequential nature-then-category call. Single-stage was 85.0%. Two-stage was 83.8% (1 loss, 0 wins). Generic two-stage does not help. Do not spend more experiments on candidate lists or question shape.

The deployed worker only retrieves from the current 14-day poll. It does not know what each account is for, and it does not see history outside that window. Account meanings live in Supabase `classifier.account_semantics`, loaded by `classifier_current_account_semantics()`. The gitignored JSON under `reports/` is only the local draft. It is not deployed.

On a fifth April–June slice, full-catalogue JEV without those sentences was 77.5%. The same rows with all 32 sentences were 75.0% (2 losses, 0 wins). The sentences did not raise accuracy. The movement slice went from 66.7% to 60.0%.

Across the three slices JEV-alone accuracy is about 75–84%, not 90%. Of 58 development rows whose true category is missing from the candidate set, 37 are an unseen merchant and 19 are a seen merchant that has never carried that category. A pure account-pair rule (support ≥ 5, purity 1) was 25/25 on Jan–Mar and 10/11 on the third slice, and combining it with JEV did not raise third-slice accuracy. Amount-only pairs disagree with the other side's label 42 of 153 times, so a pair stays evidence, not a shared label. Work Eats versus Eating Out, and Transfers versus Savings or Investments, are the remaining structural misses. Those need accumulated correction events, not another prompt.

## FinWise

`PATCH /transactions/:id` is real. A notes update and a category update were applied and restored. `originalTransactionCategoryId` did not change on either write. It is FinWise's original category, not "the value before our PATCH" and not "the value before a human edit". Where it is present, agreement with the cleaned `transactionCategoryId` is the FinWise baseline.

There is no transaction webhook in the API index, and the MCP connection is request/response only. The worker polls the last 14 days. It pages past the first 20 rows so an already-audited head cannot hide an older unprocessed transaction. A category change since the last audit is an observation, not a skip. New observations are appended to Supabase `classifier_category_events` when that secret is configured. They are not overwritten into one fingerprint row.

There is no `GET /transactions/:id`. Use list filters.

## Learning

Human corrections win. If we applied category A and a later poll shows category B, and B is not in our `writes` table, that fingerprint is stored as a correction and future matches use it. Our own PATCH is recorded in `writes`, so we do not treat it as a correction or overwrite it.

Merchant stats are support, purity, and last date. They are built from older transactions only during eval. The worker reads D1 `merchant_stats`. That table is empty until a seed is loaded. Do not seed it for auto-apply: purity 1.0 and support >= 5 was only 60% precise on the later holdout, mostly because a merchant key that was stable in the past later split across categories.

## Storage

D1 database `investments-categoriser` (free tier: 5 GB, 5M reads/day, 100k writes/day). Tables: `audits`, `corrections`, `writes`, `merchant_stats`, `cursors`. Migration: `apps/categorise-cloudflare/migrations/0001_init.sql`.

Supabase stays the ingest DLQ. It is the wrong place for this state: the classifier should keep working if Supabase is paused, and D1 is already inside the free Worker account.

## Worker limits

Workers Free is 10 ms CPU, 50 subrequests, and 5 cron triggers per account. Ingest already uses one cron. This worker uses `*/15 * * * *` (96 runs/day) and at most 3 classifications per run. Waiting on JEV does not count as CPU. A household's new transactions fit in that budget.

## Evaluation

Live eval is `LIVE_EVAL=1 yarn tsx tools/categorise-eval/run.ts`. It is not part of CI. It refuses to run without `LIVE_EVAL=1`. Raw transactions are not committed. Metrics land in `reports/categoriser/` (gitignored).

Splits, leakage-safe (evidence built only from older rows, or from merchants not in the holdout):

- reference: before 2026-04-01 (1378)
- tune: 2026-04-01 to 2026-07-01 (683, stratified sample 208 for JEV)
- final: after 2026-07-01 (649, first 500 sent to JEV, not used to pick the threshold)
- merchant-unseen: 20% of merchant keys held out (95 JEV calls)

Dataset: 2712 transactions, 2710 labelled, 2023-09-05 to 2026-09-23, 410 merchants. 2026 labels were checked: 0 uncategorised. Treat current labels as the gold set. 11 rows were `needsReview` at survey time; a category can still be set.

| system | split | n | top-1 | selective precision | coverage |
| --- | --- | --- | --- | --- | --- |
| FinWise original vs cleaned label | final | 504 comparable | 0.744 | n/a | n/a |
| history, purity 1, support >= 5 | final | 649 | 0.603 on accepted | 0.603 | 0.089 |
| hand rules | final | 649 | 0.529 on accepted | 0.529 | 0.026 |
| JEV names only | tune | 208 | 0.577 | 0.877 | 0.389 |
| JEV + descriptions | tune | 208 | 0.606 | 0.859 | 0.442 |
| hybrid history/rules/JEV | tune | 208 | 0.678 | 0.861 | 0.486 |
| hybrid | final | 500 | 0.734 | 0.884 | 0.482 |
| JEV descriptions, merchant unseen | held-out merchants | 95 | 0.684 | 0.868 | 0.400 |

No threshold on the tune grid reached 98% selective precision. Macro F1 on the final hybrid was 0.55. FinWise's own original category, on the same final window, matches the cleaned label at 74.4%, slightly above the hybrid's 73.4% top-1. The hybrid is not better than leaving FinWise's original category in place, and it is not precise enough to PATCH automatically.

Cost for 1103 JEV requests: 1,380,314 input tokens, notional $0.058 at $0.042/1M. Charged field was not returned. Hard stop in code is $4.50. This run plus the earlier killed run stayed under $0.15 notional.

Hard categories: Coffee vs Eating Out, Groceries vs Transport & Fuel, Savings vs Mortgage (the mortgage memo rule), Interest vs Rewards, Investments vs Cash. Low-support categories (Pets, Education, Rewards, Dividends, Flowers) should not be auto-applied.

## Deploy

```sh
cd apps/categorise-cloudflare
yarn wrangler d1 execute investments-categoriser --remote --file migrations/0001_init.sql
yarn wrangler secret put FINWISE_API_KEY
yarn deploy
```

Vars: `CLASSIFIER_MODE=shadow`, `AI_GATEWAY_ID=finance-ai-gateway`, `CLASSIFIER_VERSION=1`. Binding `AI`, D1 binding `DB`. Gateway log collection is off.

Shadow check on 24 Sep 2026: two remote scheduled runs wrote 6 audits, 6 distinct transaction ids, `applied = 0`. The second run continued with the next unprocessed rows rather than repeating the first three. Ingest was not changed.

Rollback: mode is already shadow, so there are no category writes to undo. To stop the worker, remove the cron or `wrangler delete investments-categoriser`. Ingest is unchanged.

## Local tests

`yarn --cwd libs/categoriser test` and `yarn --cwd libs/ingest-core test`.

## Recommendation

Do not enable `auto`. FinWise's original category is a slightly stronger match to the cleaned label than this hybrid, and the best selective precision observed was about 88% at under half coverage. Next evidence that would change that: a merchant key that does not collapse unrelated counterparties, a correction log from a few weeks of shadow mode, and a retune that actually clears 98% precision on a fresh later window.
