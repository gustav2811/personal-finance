# Household UI improvements

Status: approved by Gustav on 15 October 2026; implemented on the PR branch.
Prepared 15 October 2026 from `household-ui-system.md` and current dashboard code.

## Outcome

Make household data states dependable: every missing answer is explained, retry
recovers cleanly, old requests cannot replace new selections, and refresh cannot
silently reset edits or repeat financial commands. Preserve the current visual
system and feature/domain boundaries.

This is a dashboard reliability and composition plan. It does not establish
whether imported financial records are correct; no live-data audit was performed.

## Evidence that changes the order

- Budget Overview leaves its previous error intact when a subsequent read succeeds.
- TransactionBudget renders nothing during loading, after a required read fails,
  and when review is required but amount or fingerprint is missing. It also reads
  only the first review-queue page and treats saved-review read failure as null.
- ReviewView's post-save reload closes over `ready` and has no request ordering
  guard. A failed refresh leaves an error that later success does not clear.
- Agreement has separate main and supporting reads. PlanEditor initializes editable
  fields from fetched data. A mechanical hook migration could mix snapshots or
  overwrite user edits.
- Cutover uses the same error channel for read and command failure; a read failure
  can appear under a save-failure title.
- Wallet renders an unavailable transaction count as zero-like absence and exposes
  read-policy details. DataGate's failure copy also exposes backend configuration.
- Transactions still use a focusable row with custom Enter/Space handlers.
  Inspector now has stacked description/notes controls and a separate category
  layout; the report's field-grid extraction needs rechecking against this version.

## Iteration 1 — Restore visible answers

Fix TransactionBudget first, locally, before introducing shared lifecycle code.

- Render distinct loading, read-failed, already-approved, actionable-review, and
  unresolved-review states. Keep the surrounding inspector usable.
- Missing amount/fingerprint: explain that source details are incomplete, offer
  Retry and a route to budget review, and withhold the review form.
- Read failure: say “Budget review could not be loaded” with Retry. Missing data
  must never imply that a transaction has been approved.
- Clear the previous transaction's state immediately when its id changes and
  ignore late responses for that id.
- Resolve review-queue pagination with the existing capped traversal approach;
  surface incomplete traversal. Keep saved-review lookup failure distinguishable
  from a successful lookup with no review. Do not invent missing source facts.

Acceptance: missing amount, missing fingerprint, failed required/optional reads,
explicit approval, an item beyond page one, and rapid transaction switching each
produce the correct visible state. Incomplete source data cannot enable submission.

## Iteration 2 — Prove a small resource hook

Add `hooks/use-resource.ts` for asynchronous reads. No cache, query framework,
domain projection, command execution, or form initialization inside the hook.

- Inputs: stable loader, explicit resource identity, enabled state, and an explicit
  same-resource retention policy. Output: discriminated lifecycle state and reload.
- States: idle, loading, ready, refreshing, and error. An error may carry retained
  same-resource data; null/empty success is distinct from “not loaded”.
- Only the newest request may commit. Cleanup invalidates it. Pass an abort signal
  through loaders where supported; current RPC wrappers do not accept one, so
  response suppression is required even where physical cancellation is unavailable.
- A resource identity change hides old data immediately. A same-resource refresh
  may retain data with “Updating…”; failed refresh says “Couldn’t update. Showing
  the last loaded information.” Successful retry clears the error.
- After a mutation, retain context but block dependent financial actions until
  refreshed data is confirmed. Show “Saved, but the latest information couldn’t
  be loaded” when appropriate. Retry repeats the read only.

Pilot on LiquidityView, then mutation-driven Budget Overview. Keep projectLiquidity,
projectBudget, and projectRoutine outside the hook. DataGate stays a simple wrapper
during the pilot. Keep request freshness distinct from domain reconciliation status.

Acceptance: failure → retry → success; refresh failure with retained data; overlapping
reloads resolved out of order; selection change before effect cleanup; unmount;
nullable/empty success; successful command followed by failed refresh without a
second command. Test the hook through observable React behavior.

## Iteration 3 — Migrate the remaining budget reads

Use the proven hook in small groups, verifying each group before continuing:

1. Fund and History: explicit fund/version identities; independent history-list
   and comparison states; preserve pagination and partial-result explanations.
2. Review queue and TransactionBudget: ordered post-save reads, explicit partial
   dependencies, no stale queue resurrection. Retire the local lifecycle from
   iteration 1 once its behavior is preserved by the shared hook.
3. Cutover, PlanEditor, and Agreement: separate load errors from action errors;
   separate fetched snapshots from editable drafts. Supporting reads must belong
   to the displayed cycle. Reload must not reset dirty fields without an existing
   explicit reset action. Preserve conflict handling, held command identifiers,
   and uncertain-outcome recovery exactly.

Acceptance: all eight report-listed budget roots use the shared read lifecycle,
plus TransactionBudget; domain tests pass; focused component tests prove dirty
draft preservation, snapshot identity, queue refresh, and existing command safety.

## Iteration 4 — Clear recovery and accessible transactions

- Give DataGate a plain failure message and Retry. Once the hook is proven, let
  DataGate consume it while preserving its simple blocking-load contract.
- Sources inherits this recovery. Wallet retains its usable ledger when financial
  context fails, labels that context unavailable, and offers a read retry. Only a
  successful zero-count result may say there are no records.
- Preserve actionable membership/sign-in and partial-data explanations. Keep raw
  diagnostics in existing development/logging paths, without financial payloads.
- Put a native named button in each transaction merchant cell, e.g. “Review Spar
  transaction, 15 October, R320”. Keep row-click convenience; remove the row's
  custom keyboard emulation and duplicate tab stop. Button clicks open once.
- Return focus to the initiating button when possible; after queue advancement or
  removal, use a deterministic neighboring trigger/list fallback.
- Extract InspectorField only for current same-intent repetition, with native label
  association. Its geometry stays feature-local; preserve autosave and dirty state.

Acceptance: keyboard activation, accessible name, single opening, dialog close/focus
return, review advancement, failed save, and partial Wallet reads. Check desktop
and 390px layouts in both themes with controlled fixtures.

## Iteration 5 — Small, evidence-led cleanup

- Consider a budget-local drawing primitive for track/fill/marker geometry only.
  Keep cents arithmetic, scale selection, labels, uncertainty, and accessibility
  in the existing domain components. Skip extraction if meaningful differences
  outweigh the reuse; preserve zero/unknown/negative/over-target behavior.
- Replace ordinary caption/numeric duplication with existing type utilities.
  Preserve container-relative instrument typography and chart geometry.
- Recheck repository-wide EnergyChart imports/exports and documented usage before
  removing the retired file. The dashboard currently has no caller.
- Split Analysis responsibilities only when this work touches them; a broad Analysis
  refactor is deferred because it is not needed to close the listed findings.

Acceptance: unchanged financial readouts, no active imports of removed code, and
no responsive/theme regressions. Chart changes start with the Smart Charts guide.

## Delivery and verification

Approval covers iterations 1–5 in this order. Each iteration produces a reviewable
diff and a short result before the next starts; material scope changes return for
approval. Preserve all pre-existing staged, unstaged, and untracked work.

Capture the current TypeScript and relevant test baseline before implementation.
Run focused lifecycle/component tests per iteration, the existing budget and
transaction suites for affected behavior, and TypeScript. Treat baseline failures
separately from regressions; do not claim the report's historical passes as current.
Update the pattern index and `/dev/ui` with small labelled lifecycle fixtures.
Run the UI detector after UI changes; batch desktop/mobile and light/dark visual
checks, fix discovered defects together, and confirm in one further pass at most.
Use an independent correctness review for the lifecycle/editor migration.

No Workers, schema migrations, generated types, registry primitives, finance-model
changes, new theme, backend deployment, or production data writes are in scope.

## Implementation decisions

- Kept the existing budget drawing components: TargetBar uses a bounded fraction;
  PurposeTarget uses an over-target scale; PlanCapacity uses a committed, capped
  comparison scale. A shared MoneyScale would add options without enough common
  behavior. No financial drawing or arithmetic was changed.
- Kept Inspector fields local. Current description/notes controls are stacked and
  category uses a different interaction; the reported common grid no longer exists.
- Removed the retired EnergyChart after checking imports and documented usage in
  apps, libraries, and docs. Active utility charts are unchanged.
- Consolidated ordinary Overview captions/numerals through existing utilities;
  container-relative instrument sizes and geometry remain local.
- Added an interactive, explicitly illustrative read/retry fixture to `/dev/ui`.
- Validation uses fixture/component reads, never production financial writes.

## Verification results

- TypeScript and the optimized Next.js production build passed.
- 190 tests passed: 99 budget, 29 resource/component, 27 transaction, 17 Overview,
  and 18 Analysis tests. The transaction suite finishes without React act warnings.
- Independent correctness review passed after fixing selection identity, partial
  queue, and retained-data action gates.
- Browser verification covered the read/retry fixture in both themes, desktop
  and 390px widths; the settled 390px document has no horizontal overflow.
  Failed refresh retains the illustrative amount; Retry restores fresh actions.
  Native Enter/Space open transaction review; closing after Next returns focus
  to the initiating merchant button.
- The UI detector reported only existing instrument typography advisories in
  Overview CSS. Those responsive sizes were explicitly preserved by this plan.
- Authenticated production data correctness and deployment were not tested.
