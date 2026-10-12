# Budget page: create, improve, and agree the household plan

Status: revised design brief incorporating the household's clarified priority.
Scope: `/budget` and its creation/revision workflow. Assume the correctness findings across PRs 46–48 are fixed.

## Purpose and boundary

The primary job is to create and edit the household budget, find problems with it, and evaluate improvements. Gustav and Cara should be able to understand whether their agreement is workable and change it without rebuilding the plan from scratch.

A separate analytics page will analyse spending independently of any budget. Merchant rankings, spending trends, exploratory category comparisons, and calendar-month spending reports belong there. The budget page uses actuals only as evidence for a specific planning decision. It must remain useful before any transactions exist.

Visitor mode: Operate. Preserve the existing Geist typography, semantic tokens, shadcn controls, sidebar, and 23rd–22nd cycle. This is a refinement of the existing visual system. The prior brief's remaining-balance-first hierarchy is superseded: the plan and ihyperts editing actions lead.

Evidence: the current budget components, `apps/dashboard/DESIGN.md`, and the household goals in this conversation. The previous browser check reached sign-in; this brief does not claim visual validation. The older read-only PRODUCT.md description is not the scope authority for this work.

## Information hierarchy

1. **The agreement:** selected cycle, published version or draft, and a clear Create/Edit action.
2. **Budget checks:** issues that make the agreement unaffordable, incomplete, or difficult to carry out; potential improvements are separately labelled.
3. **The plan itself:** an editable, grouped list of purposes with contributions, responsibilities, and relevant targets or dates.
4. **The effect of a proposed change:** before/after plan totals and affected purposes, followed by review and publication.
5. **Supporting current position:** funded balances and paying-account readiness, available when needed to judge the plan.

Do not lead with a large spendable-money figure, a transaction feed, or a gallery of charts. Keep current availability accessible as a supporting fact with its own timestamp and scope.

## Proposed desktop composition

All amounts and checks below are illustrative, not household records.

```text
Budget                 [23 Oct – 22 Nov ▾]       Version history
Published · Version 3                           [Edit budget]

Income planned R40,000   Contributions R41,200   Plan gap R1,200
This compares planned income and contributions, not bank cash.

Budget checks
Needs a decision · Plan exceeds expected income by R1,200
[Review contributions]
Worth reviewing · Annual insurance may miss its December target
[Review target and contribution]

Our plan                                      [Add purpose]
Purpose                 Contribution    For whom    Paid by
Bills and commitments
  Rates                 R1,200          Shared      Cara
  Internet              R900            Shared      Gustav
Everyday
  Groceries             R6,000          Shared      Cara
Saved for later
  Annual insurance      R500            Shared      Gustav
    Target R6,000 · Due 1 December · Saved R2,500 [Details]
  Gifts                 R500            Shared      Either
    Accumulates · No fixed deadline

[View current funding and paying accounts]
```

In edit mode the same plan remains in place, marked Draft. Replace the primary action with “Review changes”; provide “Save draft” and “Discard draft” as distinct secondary actions. Draft fields look editable, published fields look like values. Avoid presenting every published row as a form.

On wide screens, use the main width for the plan and a compact adjacent change summary while editing. Use section rules and whitespace rather than a card around every purpose. The visual emphasis belongs to the current task, an unresolved plan gap, and the selected row. Keep typography and status colour restrained.

## Create the first budget

The empty state leads with “Create this cycle's budget” and the exact 23rd–22nd dates. Do not route first setup into next cycle by default.

Use a short, resumable sequence:

1. **Expected income:** name Gustav and Cara, net amounts, expected dates, and receiving accounts where known. Unknown inputs remain explicitly unknown.
2. **Build the plan:** add regular bills, everyday purposes, and irregular costs. Reuse known categories and existing purposes as suggestions, never silently turn transaction history into an agreed budget.
3. **Check and agree:** show totals, unresolved inputs, targets, responsibilities, and effective cycle; review and publish through the existing contract.

Allow a useful draft before reconciliation is complete. Creating the agreement and verifying its cash backing are distinct tasks. If a publication prerequisite is missing, preserve the draft and link directly to that prerequisite. Do not make the user complete unrelated account setup merely to start planning.

Manual entry is the initial path. Spreadsheet import is a separate future feature; do not imply the current Google Drive spreadsheet is connected or imported by this design.

## Edit the agreement in context

“Edit budget” starts or resumes a draft for the selected effective cycle. Label whether it revises this cycle or prepares a later one. Reuse the applicable agreement and stable purpose identities; never overwrite published history.

Editing a contribution should take one row interaction. Expand the row for category matching, beneficiary, planned payer, expected payment account/date, target, recurrence, and rollover. Use names and plain language. Categories describe purchases; purposes describe what the household reserves money for. Do not force one to stand in for the other.

Group rows into Bills and commitments, Everyday, and Saved for later. Make grouping an explicit presentation choice wherever existing kinds/behaviours are ambiguous: a monthly bill is not automatically discretionary spending. Grouping must not silently change accounting behaviour or rewrite historical agreements.

For household attribution, “For whom” and “Paid by” remain separate fields. Cara paying a shared bill does not make it Cara's personal budget. Allow shared and unassigned values where the underlying contract permits them; show unresolved payment responsibility as a planning question.

When changing an accumulating purpose, show contribution and existing saved balance as different facts. Changing gifts from R500 to R700 changes the agreement; moving R200 of existing groceries money into gifts is a separate money action with a separate confirmation.

Provide a reliable saved-draft state and restore that draft after leaving the page. If this requires draft discovery or resume support beyond the current API, identify that dependency explicitly rather than keeping the only copy in component state. On conflicting edits, preserve entered values and offer a comparison with the newer version.

## Budget checks: problems versus improvements

Each check contains a specific observation, why it matters, the underlying evidence/assumption, and an action that opens the relevant field or row. Keep blocking contract errors distinct from warnings and optional suggestions. An overcommitted forecast can be an intentional scenario; do not introduce a new publication prohibition unless the established contract requires one.

| Check | Example | Action and limits |
| --- | --- | --- |
| Affordability | Contributions exceed expected net income by R1,200 | Open contribution review; show unknown income separately rather than treating it as zero |
| Annual target | Known saved balance and scheduled contributions do not reach the target by its date | Open target/contribution; explain remaining cycles and assumptions |
| Payment responsibility | Rates has no paying account | Open that bill's payer/account fields |
| Timing | A bill falls before expected funds reach its paying account | Open the dated cash schedule; distinguish plan forecast from observed cash |
| Recurring plan pressure | Groceries exceeded its agreed contribution in several comparable completed cycles | Offer a contribution review with cycle count and amounts; never infer the household should simply spend less |
| Unused allocation | A purpose repeatedly retains money after its cycle | Offer review, accounting for rollover and deliberate reserves; never recommend sweeping sinking funds |
| Missing evidence | Unreviewed purchases could change a proposed recommendation | Explain the dependency and link to those purchases; withhold the recommendation's confidence |

A target calculation must account for known savings, restricted access, due dates, and applicable future contributions. If that evidence is unavailable, say what is missing. Do not invent a safe recommendation from the target and monthly amount alone.

Historical suggestions are a later increment, not a prerequisite for the page. Require multiple comparable completed cycles, correct treatment of refunds/transfers, and sufficient review completeness. Display the evidence window and allow dismissal. No arbitrary “budget health score,” automatic optimisation, or moral judgement of a person's spending.

Show the most important few checks with “View all checks.” When clear, say “No issues found in the checks available”; do not imply financial certainty beyond the evidence.

## Evaluate a change before publishing

The draft summary compares the published agreement with proposed changes. Show changed purposes, income assumptions, total contributions, and forecast gap before/after. Keep source cash balances separate from these plan totals.

Illustrative interaction: choose “Review target and contribution” on insurance; expand insurance; inspect its target/date/saved balance; propose a higher contribution; see the reduced plan remainder; choose whether to adjust another purpose; review the combined change. The system never silently chooses the offsetting cut.

“Review changes” shows a compact diff, effective cycle, and reason for revision. One final “Publish budget” action creates the immutable version. Confirmation reads “Version 4 published for 23 Oct–22 Nov,” with a link to the saved agreement. Current funding movements are not bundled implicitly.

If a request's outcome is uncertain, preserve its identity and pending state. Do not allow a second apparent publication to hide whether the first succeeded. Never erase a draft merely because refreshing the published view failed.

## Supporting current position

Provide an expandable section for available fund balances, restricted backing, and paying-account needs. These facts help decide whether to change the agreement or move existing money; they do not replace the plan editor.

Name people and accounts in liquidity explanations. A transfer in the bank and a reassignment between purposes are different actions. The app does not execute bank transfers or automatically infer debts between Gustav and Cara.

Only surface transaction review on this page when it blocks a budget check or a relevant decision. Open the existing inspector and return to the originating purpose/check. General transaction browsing and spending exploration stay on their dedicated pages.

When selecting an old version or cycle, show an explicit historical state. Keep historical agreement facts separate from current savings and balances. Version history records changes to the agreement; calendar-month spending analysis belongs to the future analytics page.

## States, mobile, and accessibility

| State | Leading content/action |
| --- | --- |
| No budget | Create this cycle's budget |
| Published, no draft | Inspect plan; Edit budget |
| Draft exists | Resume draft, with its effective cycle and saved state |
| Incomplete income | Show partial totals as incomplete; complete assumptions |
| Checks need attention | Named issue and link to affected row, without losing the draft |
| No issues found | Plan remains the main content; no manufactured task |
| Saving | Local pending indication; retain inputs and page position |
| Save failed | Inline error and retry; preserve edits |
| Conflicting revision | Compare newer agreement with retained edits |
| Historical version | Read-only agreement and clear return to current cycle |

Mobile order: agreement header/actions, compact plan summary, most relevant check, editable purposes, supporting current position. Put the review action within reach without obscuring fields or validation. Convert rows to stacked purpose/contribution entries with expandable details; do not require horizontal scrolling to edit a budget.

Use visible labels, keyboard-accessible row expansion, at least 44px touch targets, numeric input appropriate for ZAR, and explicit text for unknown/gap states. Retain focus after saving or returning from a check. Announce saved and failed states without a modal. Use restrained transitions and reduced-motion support; no money count-up animations.

## Colour: make decisions easier to read

Apply Impeccable colourize in Operate mode: calm neutral surfaces, small areas of clear colour, and stronger emphasis reserved for an active change or a material issue. Preserve the existing application palette and theme roles. Keep the primary button, sidebar, canvas, and focus treatment consistent with the rest of the app; do not recolour the whole page.

| Meaning | Existing token / treatment | Where it appears |
| --- | --- | --- |
| Agreed or recorded value | `chart-1` (shocking pink), solid geometry | Published contribution bar; recorded savings fill, always explicitly labelled |
| Proposed change | `chart-2` (violet), distinct second row or outlined marker | Draft comparison; proposed target outcome |
| Needs a decision | `warning` plus a warning icon and explicit text | Plan exceeds income; a dated target is at risk |
| Supporting information | `info` plus a short label | Assumption or explanation attached to a check |
| Confirmed completion | `success` plus text | Successful publication or a verified target reached; not a general health score |
| Failed action / invalid input | `destructive` plus field or action error | Validation errors and failed saves; not normal overspending |
| Unknown or unchanged | Neutral foreground, muted surface, dash and explanation | Missing income, unavailable projection, unchanged rows |

Pink and violet encode value roles, never good/bad or Gustav/Cara. Amounts remain in normal high-contrast text. Do not render long paragraphs or every currency value in chart colours. A draft row gets a small “Changed” label and a violet edge/marker; a warning gets an icon, a short warning title, and a subtle semantic surface treatment where the theme supports it. Unchanged rows stay neutral.

Use colour in the plan summary, changed-row markers, and budget checks, rather than giving every purpose a different colour. Purpose group headings remain typographic. An increased contribution is not inherently bad, and a reduced contribution is not inherently good; show signed changes with neutral text.

Both light and dark modes use existing tokens. Exact foreground/background pairs must be measured during implementation: 4.5:1 for body text and 3:1 for essential graphical boundaries, controls, and large text. Bright series colours may need a contrasting outline, not a new ad hoc palette. Patterns, position, direct labels, and text summaries must preserve meaning in monochrome and with colour-vision differences. Do not claim contrast is verified from this brief alone.

## Charts: two small decision aids, with a strict scope

Reference review: read the Smart Charts guide, token file and SVG index, viewed the complete example sheet, and inspected the SVG geometry for Charts 5, 6 and 12. Chart 5 uses paired bars on a shared baseline, small rounded corners and a quieter comparison series. Chart 6 shows stacked composition against a muted track. Chart 12 uses labelled horizontal fills with rounded tracks and compact endpoint treatment. Borrow those structural ideas, not their static SVGs, gradients, 600px canvases, SF Pro font, shadows, or reference palette.

Application components and tokens take precedence. The existing `ComparisonBars` already follows Chart 5 and `TargetBar` provides a lightweight accessible progress treatment. Reuse their useful patterns without coupling the editor to the historical-actuals model. No new chart library, chart framework, image assets, or time-series query is justified for this iteration.

### A. Plan capacity — the only default chart

**Question:** Does the agreement fit the expected income, and does this edit improve or worsen the gap?

Place one compact horizontal comparison beneath the plan summary, above the checks and editable rows. Use Chart 5's common-baseline comparison adapted horizontally so amounts and labels remain readable on mobile. This is a bar comparison, not a percentage gauge or a category breakdown.

- Published view: one solid pink bar labelled “Agreed contributions”. A clearly labelled income reference marker supplies the comparison.
- Draft view: add a separate violet bar labelled “Proposed contributions”. Keep the published row visible and unchanged.
- Use the same zero baseline and currency scale for both rows. Include both contribution totals and both relevant income values in the domain. Do not clip an overcommitted plan at 100%.
- If income changes in the draft, each row gets its own directly labelled income marker. Show the numeric change in income alongside the change in contributions; do not compare the old plan against only the new income.
- Put exact totals and the resulting “R… over planned income” or “R… not yet planned” beside/below the graphic. A positive plan remainder is not cash available to spend and does not receive a success badge.
- Keep the scale steady while typing. Recompute the shared scale at an editing boundary if needed, so the bars do not jump on every keystroke. Text updates immediately when the input is valid; an incomplete number shows a pending calculation state, not a zero.
- Missing income or contribution values: omit the comparison and name the missing input. Zero income with positive contributions is a real gap and must still render without dividing by zero. No existing plan: show just the proposed row; do not invent a zero-valued published agreement.

Illustrative readout: “Agreed: R41,200 against R40,000 income — R1,200 over. Proposed: R39,500 against R40,000 income — R500 not yet planned.” Both amounts are plans. The graph adds a quick comparison while the text remains sufficient by itself.

Keep this small enough that the first editable purposes remain near the top of the page. No hover interaction is needed to understand it. On narrow screens stack the labelled bar rows and retain the exact text values.

### B. Dated target progress — only inside the selected purpose

**Question:** Will the proposed contribution get this purpose to its target by the due date?

Use Chart 12's horizontal track and labels, building on `TargetBar`. Render only when a dated purpose is expanded or its target check is opened, not on every row or in a separate chart gallery.

- A solid pink fill represents verified savings already assigned to this purpose. The track represents its positive target.
- An outlined marker shows the projected balance by the due date under the agreed contribution. When editing, add a violet marker for the proposed outcome. Forecast markers are labelled explicitly and never filled as if that money were already saved.
- Keep the markers visually and textually distinguishable: “Saved now”, “Agreed projection”, “Proposed projection”, “Target”. If positions overlap, use labelled rows rather than hiding one marker.
- Show the exact gap/excess in text. Scale to include projections above target and place the target tick accordingly; do not silently cap every outcome at 100%.
- Show restricted backing and its accessibility date separately. Reaching the nominal target does not prove the bill can be paid by its due date.
- Projection requires authoritative savings and dated contributions, including known intervening uses. If the API does not supply a trustworthy projection, show saved-versus-target only and a missing-assumption explanation. Do not implement a second forecasting engine in the component.
- Gifts, clothing, or personal care with no chosen target/date get plain savings and contribution amounts. No arbitrary target or chart is invented. Unknown savings, negative balances, and non-positive targets get an explanatory text state rather than a misleading progress bar.

The first implementation can reuse the current saved-versus-target bar. Projection markers are conditional on existing calculation support; they are not a reason to expand backend scope for a decorative enhancement.

### Deliberately omit and defer

- No doughnuts or category-share charts (Charts 1–3): they compete with the editable plan and are poor at explaining a small affordability gap.
- No health gauges (Charts 10–11): they imply a score or threshold policy the household has not defined.
- No spending trend/area charts (Charts 7–9 and 15): those belong to the independent analytics page. A budget improvement can cite a few completed-cycle figures in text.
- No stacked category chart (Chart 6) in this increment: it duplicates the purpose groups and adds grouping/legend work without improving the contribution-edit decision.
- No separate before/after chart for every purpose. The numeric revision diff is clearer and cheaper for many changed lines.

**Resource budget:** one always-visible comparison; at most one target graphic mounted with the actively expanded editor; zero additional historical reads to draw either. Derive the plan bar from the agreement/draft already loaded. Load target detail only when needed, reuse existing authoritative values, and keep exact cents for calculations; convert to bounded chart coordinates only at rendering. Use a simple existing progress primitive where sufficient and the established Recharts/ChartContainer approach if chart axes/markers require it. Do not add new dependencies or polling. No chart animations while entering money.

**Verification at implementation:** check light/dark and desktop/mobile together in one inspection pass. Include changed income, overcommitment, zero income, missing values, no published baseline, long labels, coincident projection markers, restricted savings, and above-target outcomes. Verify direct labels and the textual equivalent without hover. Chart failure or unavailable data must never prevent editing or publication through the valid contract.

## Implementation order and acceptance

1. **Creation and revision:** selected-cycle agreement, first-budget flow, grouped editable purposes, saved drafts, publication diff, and the compact plan-capacity comparison with agreed/proposed colour roles. Must work with zero transaction history.
2. **Actionable budget checks:** affordability, target/date completeness, payer/account responsibility, and evidence-qualified target/timing checks. Every finding opens its relevant edit. Add the target graphic only in the expanded purpose, using saved-versus-target first if projections are unavailable.
3. **Improvement suggestions:** add comparisons across completed budget cycles once sufficient data exists. Link to broader analytics when that page is built; do not add a placeholder navigation item now.

Acceptance stories: create the first budget mid-cycle; resume a draft; increase a contribution and inspect its effect; prepare next cycle without changing this one; keep gifts accumulating without a date; plan an annual expense; assign a shared bill to Cara; distinguish a contribution change from moving saved money; publish an intentional warning-bearing plan where permitted; handle conflicting edits; inspect an older agreement; complete the same tasks on mobile.

Data dependencies must be named per feature: draft discovery/persistence, published-versus-draft comparisons, target contribution suggestions, and budget-cycle evidence for repeated pressure. Reuse existing authoritative calculations and command contracts. Treat unsupported checks as unavailable, not as frontend guesses.

Success is the household being able to create a workable agreement, understand a specific weakness, make a deliberate change, and publish it confidently. This page is complete without spending analytics.
