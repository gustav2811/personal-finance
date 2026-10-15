# Dashboard ownership and implementation

[DESIGN.md](DESIGN.md) owns visual rules and the extracted token contract. This
file preserves the engineering constraints previously mixed into that guide.
Read the repository AGENTS.md first; open only the module needed for the task.

## Layers

| Location | Owns |
| --- | --- |
| `components/ui` | Installed shadcn registry primitives; no feature behavior. |
| `components/patterns` | Domain-neutral compositions; direct file imports. |
| `components/shell` | Navigation, membership context, theme, providers. |
| `domain/overview`, `domain/analysis`, `domain/consumption`, `domain/budget` | Domain projections and visuals. |
| `features/*` | Page interactions, feature reads, mutations, and composition. |
| `app` | Routes and route-level auth/development guards. |
| `lib/format` | Shared date and money formatting. |
| `lib/finance` | Shared transaction read/model contracts used by ledger consumers. |
| `lib/supabase` | Browser/server clients, explicit row projections, generated database types. |
| `app/dev/ui` | Fixture reference; unavailable in production. |

Routes assemble features. Features use domain, neutral patterns, and primitives.
Domain visuals may use neutral patterns and primitives. Patterns must not import
domain, features, or shell. Primitives must not import application layers. Shell
may use primitives and patterns, but does not load page data. Cross-feature reuse
should move to a domain or shared library with an explicit contract; avoid imports
of another feature's internals.

The registry configuration is in `components.json`. Install a missing primitive
with `npx shadcn@latest add <name>` from this directory when a feature needs it.
Do not install the entire catalogue ahead of use or put feature behavior in a
registry primitive. Respect AGENTS.md restrictions on inspecting this directory.

## Loading and state

Each feature owns its read type and loader, such as `getXData` or `loadXData`.
Pass stable loaders to DataGate: module functions or useCallback. Inline loaders
change identity on render and can repeatedly fetch. Do not grow one shared
"dashboard data" bag for unrelated screens.

DataGate handles a basic initial read and blocking retry. Budget views with
mutations currently manage richer request lifecycles locally; consolidation is
follow-up work, not an existing common resource API. A feature owns whether a
reload retains prior data, clears a draft, or changes selection.

Preserve financial meaning in the domain layer: unknown does not become zero,
restricted funds are not available cash, and partial reads do not imply complete
totals. Do not make these decisions in generic UI components.

## Auth and reads

`proxy.ts` and the `(app)` layout own auth. Membership is stored in
`finance.household_members` and checked through `finance_caller_membership_v1`.
Supabase row-level policies remain the authorization boundary. The dashboard is
a member client; it never receives a service-role key. Workers remain separate
applications. The ingest HTTP Worker and queue consumer remain split, and the
classifier stays in shadow mode outside the ingest path.

Operational reads name their columns. Do not use `select("*")` on rendered feeds;
new metadata or source blobs must be explicitly opted into. Count-only queries
select `id` with `head: true`.

`lib/supabase/database.types.ts` is generated. Do not edit it by hand. Regenerate
from the finance-data project for `public`, `consumption`, and `finance` when the
schema changes. Projection aliases belong in `lib/supabase/rows.ts`. If a new RPC
is temporarily asserted before regeneration, keep that assertion at its call
site and verify the deployed RPC rather than documenting an outdated type state.

## Current routes

| Group | Destinations |
| --- | --- |
| Household | Overview `/`, Budget `/budget`, Analysis `/analysis`, Transactions `/transactions` |
| Home | Utilities `/utilities` with electricity, water, and wallet exploration |
| Record | Sources `/sources`, Bank Zero `/bank-zero` |

Accounts and Settings have no destinations yet. Add their sidebar items when
working routes exist. Range/filter controls belong to pages, not the sidebar.

The development demo is guarded by `demoEnabled()`, which fails closed in
production. `/dev/ui` is permitted by the proxy only in demo mode and independently
returns 404 in production. It renders fixtures, not privileged data.
