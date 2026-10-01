#!/usr/bin/env bash
set -euo pipefail
container_id="${1:?usage: funding-concurrency.sh CONTAINER_ID}"
command -v docker >/dev/null 2>&1 || { printf '%s\n' 'budget-db-tests requires Docker' >&2; exit 2; }
tmp_dir="$(mktemp -d -t budget-db-funding.XXXXXX)"
trap 'rm -rf "$tmp_dir"' EXIT INT TERM
psql_admin() {
  docker exec -i -e PGOPTIONS='-c search_path=public,extensions' "$container_id" \
    psql -X -v ON_ERROR_STOP=1 -U supabase_admin -d postgres "$@"
}
session_header() {
  local app="$1" auth="$2" email="$3"
  cat <<SQL
BEGIN;
SET LOCAL application_name = '$app';
SELECT set_config('request.jwt.claims', '{"sub":"$auth","role":"authenticated","email":"$email"}', true);
SELECT set_config('request.jwt.claim.sub', '$auth', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;
SQL
}
wait_overlap() {
  local first="$1" second="$2"
  for _ in {1..100}; do
    if psql_admin -Atqc "select case when exists(select 1 from pg_stat_activity where application_name='$first' and wait_event='PgSleep' and state='active') and exists(select 1 from pg_stat_activity where application_name='$second' and wait_event_type='Lock' and state='active') then 1 else 0 end" | grep -qx 1; then return 0; fi
    sleep 0.1
  done
  printf 'timed out waiting for %s to block behind %s\n' "$second" "$first" >&2
  return 1
}
wait_sleep() {
  local app="$1"
  for _ in {1..100}; do
    if psql_admin -Atqc "select 1 from pg_stat_activity where application_name='$app' and wait_event='PgSleep' and state='active' limit 1" | grep -qx 1; then return 0; fi
    sleep 0.1
  done
  printf 'timed out waiting for %s to hold its transaction lock\n' "$app" >&2
  return 1
}
psql_admin <<'SQL'
insert into finance.households(id) values ('00000000-0000-4000-8000-00000000c101'),('00000000-0000-4000-8000-00000000c201');
insert into finance.household_members(id,household_id,email,auth_user_id,role) values
 ('00000000-0000-4000-8000-00000000c102','00000000-0000-4000-8000-00000000c101','race-a@test.invalid','00000000-0000-4000-8000-00000000c103','member'),
 ('00000000-0000-4000-8000-00000000c202','00000000-0000-4000-8000-00000000c201','race-b@test.invalid','00000000-0000-4000-8000-00000000c203','member');
insert into public.accounts(account_id,source_account_id,name,household_id,source_system,currency_code) values
 ('00000000-0000-4000-8000-00000000c104','race-a','Race A','00000000-0000-4000-8000-00000000c101','test','ZAR'),
 ('00000000-0000-4000-8000-00000000c204','race-b','Race B','00000000-0000-4000-8000-00000000c201','test','ZAR');
insert into finance.budget_account_settings(household_id,account_id,owner_scope,included,resource_class,freshness_hours,transaction_sign_convention,sign_evidence,actor_id) values
 ('00000000-0000-4000-8000-00000000c101','00000000-0000-4000-8000-00000000c104','shared',true,'liquid',24,'outflow_negative','race','00000000-0000-4000-8000-00000000c102'),
 ('00000000-0000-4000-8000-00000000c201','00000000-0000-4000-8000-00000000c204','shared',true,'liquid',24,'outflow_negative','race','00000000-0000-4000-8000-00000000c202');
insert into public.snapshots(account_id,date,amount_cents,currency_code,household_id,source_system,observed_at) values
 ('00000000-0000-4000-8000-00000000c104',current_date,50000,'ZAR','00000000-0000-4000-8000-00000000c101','test',now()-interval '1 hour'),
 ('00000000-0000-4000-8000-00000000c204',current_date,100000,'ZAR','00000000-0000-4000-8000-00000000c201','test',now()-interval '1 hour');
insert into finance.funds(id,household_id,name,beneficiary_scope,created_by) values
 ('00000000-0000-4000-8000-00000000c105','00000000-0000-4000-8000-00000000c101','Race A','shared','00000000-0000-4000-8000-00000000c102'),
 ('00000000-0000-4000-8000-00000000c106','00000000-0000-4000-8000-00000000c101','Race B','shared','00000000-0000-4000-8000-00000000c102'),
 ('00000000-0000-4000-8000-00000000c205','00000000-0000-4000-8000-00000000c201','Occurrence','shared','00000000-0000-4000-8000-00000000c202');
insert into finance.budget_versions(id,household_id,state,version_number,draft_revision,starts_on_cycle,published_at,actor_id,reason) values
 ('00000000-0000-4000-8000-00000000c107','00000000-0000-4000-8000-00000000c101','draft',null,1,date '2026-09-23',null,'00000000-0000-4000-8000-00000000c102','race A'),
 ('00000000-0000-4000-8000-00000000c207','00000000-0000-4000-8000-00000000c201','draft',null,1,date '2026-09-23',null,'00000000-0000-4000-8000-00000000c202','race B');
insert into finance.budget_lines(id,household_id,version_id,stable_line_id,fund_id,name,beneficiary_scope,kind,contribution_cents,funding_behaviour,recurrence,rollover_policy) values
 ('00000000-0000-4000-8000-00000000c108','00000000-0000-4000-8000-00000000c101','00000000-0000-4000-8000-00000000c107','00000000-0000-4000-8000-00000000c109','00000000-0000-4000-8000-00000000c105','Race A','shared','consumption',0,'accumulating','cycle','carry'),
 ('00000000-0000-4000-8000-00000000c208','00000000-0000-4000-8000-00000000c201','00000000-0000-4000-8000-00000000c207','00000000-0000-4000-8000-00000000c209','00000000-0000-4000-8000-00000000c205','Occurrence','shared','consumption',0,'accumulating','cycle','carry');
update finance.budget_versions set state='published',version_number=1,published_at=now()-interval '1 hour' where id in ('00000000-0000-4000-8000-00000000c107','00000000-0000-4000-8000-00000000c207');
do $$
declare h uuid; a uuid; actor uuid; fp text; sf text; coverage jsonb; checked jsonb;
begin
 for h,a,actor in select * from (values
  ('00000000-0000-4000-8000-00000000c101'::uuid,'00000000-0000-4000-8000-00000000c104'::uuid,'00000000-0000-4000-8000-00000000c102'::uuid),
  ('00000000-0000-4000-8000-00000000c201'::uuid,'00000000-0000-4000-8000-00000000c204'::uuid,'00000000-0000-4000-8000-00000000c202'::uuid)
 ) as x(h,a,actor) loop
  select finance.budget_settings_fingerprint(h,a),finance.budget_snapshot_fingerprint(h,a,current_date) into fp,sf;
  coverage:=jsonb_build_object('schema_version',1,'evidence','race','utility_coverage',jsonb_build_object('status','not_required','evidence','none'),'accounts',jsonb_build_array(jsonb_build_object('account_id',a::text,'status','included','settings_fingerprint',fp,'snapshot_date',current_date::text,'snapshot_fingerprint',sf,'balance_convention','cash_signed','activity_through',to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'pending_included_ids','[]'::jsonb,'evidence','cash')));
  checked:=finance.budget_check_coverage(h,coverage,now());
  insert into finance.budget_reconciliations(id,household_id,as_of,actor_id,status,coverage_snapshot,opening_fund_cutover,notes) values(gen_random_uuid(),h,now(),actor,checked->>'status',checked->'coverage_snapshot',date '2026-09-23','race');
 end loop;
end $$;
SQL
recon_a="$(psql_admin -Atqc "select id::text from finance.budget_reconciliations where household_id='00000000-0000-4000-8000-00000000c101' limit 1")"
recon_fp_a="$(psql_admin -Atqc "select finance.budget_resources('00000000-0000-4000-8000-00000000c101',now())->>'reconciliation_fingerprint'")"
recon_b="$(psql_admin -Atqc "select id::text from finance.budget_reconciliations where household_id='00000000-0000-4000-8000-00000000c201' limit 1")"
recon_fp_b="$(psql_admin -Atqc "select finance.budget_resources('00000000-0000-4000-8000-00000000c201',now())->>'reconciliation_fingerprint'")"

run_race() {
  local mode="$1" app1="$2" app2="$3" auth="$4" email="$5" command1="$6" command2="$7" payload1="$8" payload2="$9" expected_clause expected_notice
  if [[ "$mode" == insufficient ]]; then
    expected_clause="sqlerrm not like 'budget_insufficient:%'"
    expected_notice='EXPECTED_INSUFFICIENT'
  else
    expected_clause="sqlerrm <> 'budget_conflict: funding occurrence already exists'"
    expected_notice='EXPECTED_CONFLICT'
  fi
  session_header "$app1" "$auth" "$email" > "$tmp_dir/first.sql"
  cat >> "$tmp_dir/first.sql" <<SQL
select public.budget_move_funds_v1('$command1','$payload1'::jsonb);
select pg_sleep(5);
commit;
SQL
  session_header "$app2" "$auth" "$email" > "$tmp_dir/second.sql"
  cat >> "$tmp_dir/second.sql" <<SQL
do \$race\$
begin
 begin
  perform public.budget_move_funds_v1('$command2','$payload2'::jsonb);
  raise exception 'unexpected $mode race winner';
 exception when sqlstate 'P0001' then
  if $expected_clause then raise; end if;
  raise notice '$expected_notice';
 end;
end \$race\$;
rollback;
SQL
  docker exec -i "$container_id" psql -X -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < "$tmp_dir/first.sql" > "$tmp_dir/first.out" 2>&1 & local p1=$!
  wait_sleep "$app1"
  docker exec -i "$container_id" psql -X -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < "$tmp_dir/second.sql" > "$tmp_dir/second.out" 2>&1 & local p2=$!
  wait_overlap "$app1" "$app2"; wait "$p2"; wait "$p1"
  grep -q "$expected_notice" "$tmp_dir/second.out"
  printf '%s\n' "ok $mode funding race (lock overlap and exact loser)"
}
payload_a='{"kind":"assign","to_fund_id":"00000000-0000-4000-8000-00000000c105","amount_cents":"50000","effective_on":"2026-09-23","expected_version_id":"00000000-0000-4000-8000-00000000c107","expected_reconciliation_id":"'$recon_a'","expected_reconciliation_fingerprint":"'$recon_fp_a'","reason":"race"}'
payload_b='{"kind":"assign","to_fund_id":"00000000-0000-4000-8000-00000000c106","amount_cents":"50000","effective_on":"2026-09-23","expected_version_id":"00000000-0000-4000-8000-00000000c107","expected_reconciliation_id":"'$recon_a'","expected_reconciliation_fingerprint":"'$recon_fp_a'","reason":"race"}'
run_race insufficient budget-concurrency-funding-first budget-concurrency-funding-second 00000000-0000-4000-8000-00000000c103 race-a@test.invalid 00000000-0000-4000-8000-00000000c111 00000000-0000-4000-8000-00000000c112 "$payload_a" "$payload_b"
[[ "$(psql_admin -Atqc "select count(*) from finance.fund_movements where household_id='00000000-0000-4000-8000-00000000c101' and amount_cents=50000")" == 1 ]]
[[ "$(psql_admin -Atqc "select count(*) from finance.budget_commands where household_id='00000000-0000-4000-8000-00000000c101' and kind='budget_move_funds_v1'")" == 1 ]]
payload_occ='{"kind":"assign","to_fund_id":"00000000-0000-4000-8000-00000000c205","amount_cents":"10000","effective_on":"2026-09-23","expected_version_id":"00000000-0000-4000-8000-00000000c207","expected_reconciliation_id":"'$recon_b'","expected_reconciliation_fingerprint":"'$recon_fp_b'","reason":"occurrence","funding_occurrence_key":"cycle:2026-09-23:line:00000000-0000-4000-8000-00000000c209:occurrence:1"}'
run_race conflict budget-concurrency-occurrence-first budget-concurrency-occurrence-second 00000000-0000-4000-8000-00000000c203 race-b@test.invalid 00000000-0000-4000-8000-00000000c211 00000000-0000-4000-8000-00000000c212 "$payload_occ" "$payload_occ"
[[ "$(psql_admin -Atqc "select count(*) from finance.fund_movements where household_id='00000000-0000-4000-8000-00000000c201' and funding_occurrence_key is not null")" == 1 ]]
[[ "$(psql_admin -Atqc "select count(*) from finance.budget_commands where household_id='00000000-0000-4000-8000-00000000c201' and kind='budget_move_funds_v1'")" == 1 ]]
