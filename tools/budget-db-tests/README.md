# Budget database tests

`run.sh` starts a disposable PostgreSQL 17 Supabase database, loads the
schema-only legacy public-table bootstrap, replays every checked-in migration
in timestamp order, and runs every `supabase/tests/database/*.test.sql` file
with pgTAP.

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
