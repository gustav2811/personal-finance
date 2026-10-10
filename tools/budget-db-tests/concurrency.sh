#!/usr/bin/env bash
set -euo pipefail

container_id="${1:?usage: concurrency.sh CONTAINER_ID}"
command -v docker >/dev/null 2>&1 || { printf '%s\n' 'budget-db-tests requires Docker' >&2; exit 2; }
tmp_dir="$(mktemp -d -t budget-db-concurrency.XXXXXX)"
trap 'rm -rf "$tmp_dir"' EXIT INT TERM

psql_admin() {
  docker exec -i -e PGOPTIONS='-c search_path=public,extensions' "$container_id" \
    psql -X -v ON_ERROR_STOP=1 -U supabase_admin -d postgres "$@"
}

household='00000000-0000-4000-8000-00000000e001'
member='00000000-0000-4000-8000-00000000e002'
auth_user='00000000-0000-4000-8000-00000000e003'
fund_command='00000000-0000-4000-8000-00000000e101'
draft_id='00000000-0000-4000-8000-00000000e201'
draft_first_command='00000000-0000-4000-8000-00000000e202'
draft_second_command='00000000-0000-4000-8000-00000000e203'
publish_first_command='00000000-0000-4000-8000-00000000e301'
publish_second_command='00000000-0000-4000-8000-00000000e302'

psql_admin <<SQL
insert into finance.households(id) values ('$household') on conflict do nothing;
insert into finance.household_members(id, household_id, email, auth_user_id, role)
values ('$member', '$household', 'budget-concurrency@test.invalid', '$auth_user', 'member')
on conflict do nothing;
insert into finance.budget_versions(id, household_id, state, draft_revision, starts_on_cycle, actor_id, reason)
values ('$draft_id', '$household', 'draft', 1, date '2026-10-23', '$member', 'race fixture')
on conflict do nothing;
SQL

session_header() {
  local app_name="$1"
  cat <<SQL
BEGIN;
SET LOCAL application_name = '$app_name';
SELECT set_config('request.jwt.claims', '{"sub":"$auth_user","role":"authenticated","email":"budget-concurrency@test.invalid"}', true);
SELECT set_config('request.jwt.claim.sub', '$auth_user', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;
SQL
}

wait_for_sleep() {
  local app_name="$1"
  for _ in {1..100}; do
    if psql_admin -Atqc "select 1 from pg_stat_activity where application_name='$app_name' and wait_event='PgSleep' and state='active' limit 1" | grep -qx 1; then return 0; fi
    sleep 0.1
  done
  printf 'timed out waiting for %s to hold its transaction lock\n' "$app_name" >&2
  return 1
}

wait_for_overlap() {
  local first_app="$1" second_app="$2"
  for _ in {1..100}; do
    if psql_admin -Atqc "select case when exists (select 1 from pg_stat_activity where application_name='$first_app' and wait_event='PgSleep' and state='active') and exists (select 1 from pg_stat_activity where application_name='$second_app' and wait_event_type='Lock' and state='active') then 1 else 0 end" | grep -qx 1; then return 0; fi
    sleep 0.1
  done
  printf 'timed out waiting for %s to block behind %s\n' "$second_app" "$first_app" >&2
  return 1
}

json_result() { grep -E '^\{.*\}$' "$1" | tail -n 1; }

run_fund_race() {
  local first_app='budget-concurrency-fund-first' second_app='budget-concurrency-fund-second'
  session_header "$first_app" > "$tmp_dir/fund-first.sql"
  cat >> "$tmp_dir/fund-first.sql" <<SQL
SELECT public.budget_create_fund_v1('$fund_command', '{"name":"Race fund","beneficiary_scope":"shared"}'::jsonb);
SELECT pg_sleep(5);
COMMIT;
SQL
  session_header "$second_app" > "$tmp_dir/fund-second.sql"
  cat >> "$tmp_dir/fund-second.sql" <<SQL
SELECT public.budget_create_fund_v1('$fund_command', '{"beneficiary_scope":"shared","name":"Race fund"}'::jsonb);
COMMIT;
SQL
  docker exec -i "$container_id" psql -X -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < "$tmp_dir/fund-first.sql" > "$tmp_dir/fund-first.out" 2>&1 & local first_pid=$!
  wait_for_sleep "$first_app"
  docker exec -i "$container_id" psql -X -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < "$tmp_dir/fund-second.sql" > "$tmp_dir/fund-second.out" 2>&1 & local second_pid=$!
  wait_for_overlap "$first_app" "$second_app"
  wait "$second_pid"
  wait "$first_pid"
  [[ "$(json_result "$tmp_dir/fund-first.out")" == "$(json_result "$tmp_dir/fund-second.out")" ]] || { printf '%s\n' 'same-command replay race returned different results' >&2; exit 1; }
  [[ "$(psql_admin -Atqc "select count(*) from finance.funds where household_id='$household' and name='Race fund'")" == 1 ]]
  [[ "$(psql_admin -Atqc "select count(*) from finance.budget_commands where household_id='$household' and command_id='$fund_command'")" == 1 ]]
  printf '%s\n' 'ok same-command replay race (one fund, one receipt)'
}

run_draft_race() {
  local first_app='budget-concurrency-draft-first' second_app='budget-concurrency-draft-second'
  local payload='{"draft_id":"'$draft_id'","expected_draft_revision":1,"starts_on_cycle":"2026-10-23","reason":"first winner","income_assumptions":[],"source_references":[],"lines":[]}'
  local second_payload='{"draft_id":"'$draft_id'","expected_draft_revision":1,"starts_on_cycle":"2026-10-23","reason":"second loser","income_assumptions":[],"source_references":[],"lines":[]}'
  session_header "$first_app" > "$tmp_dir/draft-first.sql"
  cat >> "$tmp_dir/draft-first.sql" <<SQL
SELECT public.budget_save_draft_v1('$draft_first_command', '$payload'::jsonb);
SELECT pg_sleep(5);
COMMIT;
SQL
  session_header "$second_app" > "$tmp_dir/draft-second.sql"
  cat >> "$tmp_dir/draft-second.sql" <<SQL
DO \$race\$
BEGIN
  BEGIN
    PERFORM public.budget_save_draft_v1('$draft_second_command', '$second_payload'::jsonb);
    RAISE EXCEPTION 'unexpected draft race winner';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF sqlerrm NOT LIKE 'budget_stale:%' THEN RAISE; END IF;
    RAISE NOTICE 'EXPECTED_BUDGET_STALE';
  END;
END
\$race\$;
ROLLBACK;
SQL
  docker exec -i "$container_id" psql -X -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < "$tmp_dir/draft-first.sql" > "$tmp_dir/draft-first.out" 2>&1 & local first_pid=$!
  wait_for_sleep "$first_app"
  docker exec -i "$container_id" psql -X -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < "$tmp_dir/draft-second.sql" > "$tmp_dir/draft-second.out" 2>&1 & local second_pid=$!
  wait_for_overlap "$first_app" "$second_app"
  wait "$second_pid"
  wait "$first_pid"
  grep -q EXPECTED_BUDGET_STALE "$tmp_dir/draft-second.out"
  [[ "$(psql_admin -Atqc "select count(*) from finance.budget_versions where id='$draft_id' and state='draft' and draft_revision=2 and reason='first winner'")" == 1 ]]
  [[ "$(psql_admin -Atqc "select count(*) from finance.budget_commands where household_id='$household' and kind='budget_save_draft_v1'")" == 1 ]]
  printf '%s\n' 'ok stale draft race (revision two, one receipt, exact budget_stale loser)'
}

run_publish_race() {
  local first_app='budget-concurrency-publish-first' second_app='budget-concurrency-publish-second'
  local payload='{"draft_id":"'$draft_id'","expected_draft_revision":2,"expected_parent_version_id":null,"expected_latest_version_number":0,"reason":"publish winner"}'
  session_header "$first_app" > "$tmp_dir/publish-first.sql"
  cat >> "$tmp_dir/publish-first.sql" <<SQL
SELECT public.budget_publish_v1('$publish_first_command', '$payload'::jsonb);
SELECT pg_sleep(5);
COMMIT;
SQL
  session_header "$second_app" > "$tmp_dir/publish-second.sql"
  cat >> "$tmp_dir/publish-second.sql" <<SQL
DO \$race\$
BEGIN
  BEGIN
    PERFORM public.budget_publish_v1('$publish_second_command', '$payload'::jsonb);
    RAISE EXCEPTION 'unexpected publish race winner';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF sqlerrm NOT LIKE 'budget_stale:%' THEN RAISE; END IF;
    RAISE NOTICE 'EXPECTED_BUDGET_STALE';
  END;
END
\$race\$;
ROLLBACK;
SQL
  docker exec -i "$container_id" psql -X -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < "$tmp_dir/publish-first.sql" > "$tmp_dir/publish-first.out" 2>&1 & local first_pid=$!
  wait_for_sleep "$first_app"
  docker exec -i "$container_id" psql -X -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < "$tmp_dir/publish-second.sql" > "$tmp_dir/publish-second.out" 2>&1 & local second_pid=$!
  wait_for_overlap "$first_app" "$second_app"
  wait "$second_pid"
  wait "$first_pid"
  grep -q EXPECTED_BUDGET_STALE "$tmp_dir/publish-second.out"
  [[ "$(psql_admin -Atqc "select count(*) from finance.budget_versions where id='$draft_id' and state='published' and version_number=1")" == 1 ]]
  [[ "$(psql_admin -Atqc "select count(*) from finance.budget_versions where household_id='$household' and state='published'")" == 1 ]]
  [[ "$(psql_admin -Atqc "select count(*) from finance.budget_commands where household_id='$household' and kind='budget_publish_v1'")" == 1 ]]
  printf '%s\n' 'ok stale publication race (one published header, one receipt, exact budget_stale loser)'
}

run_fund_race
run_draft_race
run_publish_race
