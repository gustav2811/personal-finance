# Budget database tests

`run.sh` starts a disposable PostgreSQL 17 Supabase database, loads the
schema-only legacy public-table bootstrap, replays every checked-in migration
in timestamp order, and runs every `supabase/tests/database/*.test.sql` file
with pgTAP.

After pgTAP, the runner invokes `concurrency.sh` with the created container ID.
It uses two real in-container PostgreSQL sessions under `authenticated` JWT
context and checks same-command replay, stale draft revision, and stale
publication races. The first session is synchronized at the `pg_stat_activity`
`PgSleep` state while it retains the household transaction lock. The runner also
requires the competing session to wait on a lock at the same time; all fixture
rows are synthetic and disappear with the runner's disposable container.

The runner then invokes `funding-concurrency.sh`, which adds the two stage 2
funding races: a last-50000 assignment race with an exact `budget_insufficient`
loser and a duplicate occurrence-key race with an exact `budget_conflict` loser.

It then invokes `source-concurrency.sh` for stage 3. The source races use four
fresh `d5xx` households and real overlapping sessions: a pending transaction
phantom, an existing source amount update, and a snapshot reduction each block
funding until the source commit makes the read incomplete. The funding-first
case commits its prior evidence while the source insert waits on the household
mutex, then verifies the following member read is incomplete. Each race checks
the `PgSleep`/lock overlap, the exact `budget_incomplete` outcome, and movement
or receipt counts. Race dates come from PostgreSQL's Johannesburg clock, and
the resource read asserts its `complete` boolean. If a session or assertion
fails, both sessions are waited for and their SQL logs are preserved for
diagnosis; the original concurrency scripts remain unchanged.

The runtime is deliberately isolated from Supabase CLI state and production
credentials. It uses the pinned PostgreSQL 17.6 image digest
`docker.io/supabase/postgres@sha256:ca7871b587ca2c401ac0f325df6249c9aa0d25647ded34631158efc51176767f`
image (PostgreSQL 17.6) and the repository's pinned Supabase CLI compatibility
target, `2.118.0`. The runner does not read or accept a remote database URL,
does not mount a volume, and stops only the container it created.

```sh
./tools/budget-db-tests/run.sh
```

The command must be run from the repository root or from any directory inside
the repository. A clean replay is required before the test files are executed;
any SQL error, failed TAP assertion, or missing test suite exits non-zero.
