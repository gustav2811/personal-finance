#!/usr/bin/env bash
set -euo pipefail
container_id="${1:?usage: source-concurrency.sh CONTAINER_ID}"
command -v docker >/dev/null 2>&1 || { printf '%s\n' 'budget-db-tests requires Docker' >&2; exit 2; }
tmp_dir="$(mktemp -d -t budget-db-source.XXXXXX)"
cleanup() {
  local status=$?
  if (( status == 0 )); then
    rm -rf "$tmp_dir"
  else
    printf 'source concurrency diagnostics preserved at %s\n' "$tmp_dir" >&2
  fi
  return "$status"
}
trap cleanup EXIT INT TERM
psql_admin() {
  docker exec -i -e PGOPTIONS='-c search_path=public,extensions' "$container_id" psql -X -v ON_ERROR_STOP=1 -U supabase_admin -d postgres "$@"
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
wait_sleep() {
  local app="$1"
  for _ in {1..100}; do
    if psql_admin -Atqc "select 1 from pg_stat_activity where application_name='$app' and wait_event='PgSleep' and state='active' limit 1" | grep -qx 1; then return 0; fi
    sleep 0.1
  done
  printf 'timed out waiting for %s to hold its transaction lock\n' "$app" >&2
  return 1
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
setup_fixture() {
  local h="$1" m="$2" a="$3" f="$4" v="$5" l="$6" tx="$7"
  psql_admin <<SQL
insert into finance.households(id) values ('$h');
insert into finance.household_members(id,household_id,email,auth_user_id,role) values ('$m','$h','$m@source-race.test.invalid','$m','member');
insert into public.accounts(account_id,source_account_id,name,household_id,source_system,currency_code) values ('$a','$a','Source race account','$h','source-race','ZAR');
insert into finance.budget_account_settings(household_id,account_id,owner_scope,included,resource_class,freshness_hours,transaction_sign_convention,sign_evidence,actor_id) values ('$h','$a','shared',true,'liquid',24,'outflow_negative','source-race','$m');
insert into public.snapshots(account_id,date,amount_cents,currency_code,household_id,source_system,observed_at) values ('$a',current_date,500000,'ZAR','$h','source-race',now()-interval '1 hour');
insert into finance.funds(id,household_id,name,beneficiary_scope,created_by) values ('$f','$h','Source race fund','shared','$m');
insert into finance.budget_versions(id,household_id,state,version_number,draft_revision,starts_on_cycle,published_at,actor_id,reason) values ('$v','$h','draft',null,1,finance.budget_cycle_start((now() at time zone 'Africa/Johannesburg')::date),null,'$m','source race');
insert into finance.budget_lines(id,household_id,version_id,stable_line_id,fund_id,name,beneficiary_scope,kind,contribution_cents,funding_behaviour,recurrence,rollover_policy) values ('$l','$h','$v','$l','$f','Source race','shared','consumption',0,'accumulating','cycle','carry');
update finance.budget_versions set state='published',version_number=1,published_at=now()-interval '1 hour' where id='$v';
insert into public.transactions(id,account_id,date,effective_at,occurred_on,details,household_id,source_system,source_is_pending,source_is_archived,amount,currency_code,raw_payload_hash) values ('$tx','$a',now()-interval '3 hours',now()-interval '3 hours',current_date,'{}','$h','source-race',false,false,0,'ZAR','initial');
do \$\$
declare fp text; sf text; cov jsonb; checked jsonb;
begin
 select finance.budget_settings_fingerprint('$h','$a'),finance.budget_snapshot_fingerprint('$h','$a',current_date) into fp,sf;
 cov:=jsonb_build_object('schema_version',1,'evidence','source-race','utility_coverage',jsonb_build_object('status','not_required','evidence','none'),'accounts',jsonb_build_array(jsonb_build_object('account_id','$a','status','included','settings_fingerprint',fp,'snapshot_date',current_date::text,'snapshot_fingerprint',sf,'balance_convention','cash_signed','activity_through',to_char(now()-interval '1 hour','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'pending_included_ids','[]'::jsonb,'evidence','source-race')));
 checked:=finance.budget_check_coverage('$h',cov,now());
 if checked->>'status' <> 'complete' then raise exception 'fixture coverage incomplete: %',checked; end if;
 insert into finance.budget_reconciliations(id,household_id,as_of,actor_id,status,coverage_snapshot,opening_fund_cutover,notes) values(gen_random_uuid(),'$h',now(),'$m',checked->>'status',checked->'coverage_snapshot',current_date-7,'source race');
end \$\$;
SQL
}
setup_fixture 00000000-0000-4000-8000-00000000d501 00000000-0000-4000-8000-00000000d502 00000000-0000-4000-8000-00000000d503 00000000-0000-4000-8000-00000000d504 00000000-0000-4000-8000-00000000d505 00000000-0000-4000-8000-00000000d506 00000000-0000-4000-8000-00000000d507
setup_fixture 00000000-0000-4000-8000-00000000d511 00000000-0000-4000-8000-00000000d512 00000000-0000-4000-8000-00000000d513 00000000-0000-4000-8000-00000000d514 00000000-0000-4000-8000-00000000d515 00000000-0000-4000-8000-00000000d516 00000000-0000-4000-8000-00000000d517
setup_fixture 00000000-0000-4000-8000-00000000d521 00000000-0000-4000-8000-00000000d522 00000000-0000-4000-8000-00000000d523 00000000-0000-4000-8000-00000000d524 00000000-0000-4000-8000-00000000d525 00000000-0000-4000-8000-00000000d526 00000000-0000-4000-8000-00000000d527
setup_fixture 00000000-0000-4000-8000-00000000d531 00000000-0000-4000-8000-00000000d532 00000000-0000-4000-8000-00000000d533 00000000-0000-4000-8000-00000000d534 00000000-0000-4000-8000-00000000d535 00000000-0000-4000-8000-00000000d536 00000000-0000-4000-8000-00000000d537

recon_for() { psql_admin -Atqc "select id::text from finance.budget_reconciliations where household_id='$1' order by as_of desc limit 1"; }
fingerprint_for() { psql_admin -Atqc "select finance.budget_resources('$1',now())->>'reconciliation_fingerprint'"; }

wait_sessions() {
  local label="$1" p1="$2" p2="$3" s1=0 s2=0
  wait "$p1" || s1=$?
  wait "$p2" || s2=$?
  if (( s1 != 0 || s2 != 0 )); then
    printf 'source race %s failed (first=%d second=%d); session logs:\n' "$label" "$s1" "$s2" >&2
    sed -n '1,240p' "$tmp_dir/$label-first.out" "$tmp_dir/$label-second.out" >&2 || true
    return 1
  fi
}

run_source_first() {
  local name="$1" h="$2" m="$3" a="$4" fund="$5" version="$6" command_id="$7" source_sql="$8"
  local r f payload
  r="$(recon_for "$h")"; f="$(fingerprint_for "$h")"
  local today_za
  today_za="$(psql_admin -Atqc "select (now() at time zone 'Africa/Johannesburg')::date")"
  payload="{\"kind\":\"assign\",\"to_fund_id\":\"$fund\",\"amount_cents\":\"1000\",\"effective_on\":\"$today_za\",\"expected_version_id\":\"$version\",\"expected_reconciliation_id\":\"$r\",\"expected_reconciliation_fingerprint\":\"$f\",\"reason\":\"source race\"}"
  session_header "source-$name-first" "$m" "$m@source-race.test.invalid" > "$tmp_dir/$name-first.sql"
  cat >> "$tmp_dir/$name-first.sql" <<SQL
$source_sql
select pg_sleep(3);
commit;
SQL
  session_header "source-$name-funding" "$m" "$m@source-race.test.invalid" > "$tmp_dir/$name-second.sql"
  cat >> "$tmp_dir/$name-second.sql" <<SQL
do \$race\$
begin
 begin
  perform public.budget_move_funds_v1('$command_id','$payload'::jsonb);
  raise exception 'unexpected funding winner in $name source race';
 exception when sqlstate 'P0001' then
  if sqlerrm not like 'budget_incomplete:%' then raise; end if;
  raise notice 'EXPECTED_SOURCE_INCOMPLETE';
 end;
end \$race\$;
rollback;
SQL
  docker exec -i "$container_id" psql -X -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < "$tmp_dir/$name-first.sql" > "$tmp_dir/$name-first.out" 2>&1 & local p1=$!
  if ! wait_sleep "source-$name-first"; then wait "$p1" || true; return 1; fi
  docker exec -i "$container_id" psql -X -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < "$tmp_dir/$name-second.sql" > "$tmp_dir/$name-second.out" 2>&1 & local p2=$!
  if ! wait_overlap "source-$name-first" "source-$name-funding"; then wait_sessions "$name" "$p1" "$p2" || true; return 1; fi
  wait_sessions "$name" "$p1" "$p2"
  grep -q EXPECTED_SOURCE_INCOMPLETE "$tmp_dir/$name-second.out"
  [[ "$(psql_admin -Atqc "select count(*) from finance.fund_movements where household_id='$h'")" == 0 ]]
  [[ "$(psql_admin -Atqc "select count(*) from finance.budget_commands where household_id='$h' and kind='budget_move_funds_v1'")" == 0 ]]
  printf '%s\n' "ok source-first $name (lock overlap, exact incomplete, no movement or receipt)"
}

run_source_first pending 00000000-0000-4000-8000-00000000d501 00000000-0000-4000-8000-00000000d502 00000000-0000-4000-8000-00000000d503 00000000-0000-4000-8000-00000000d504 00000000-0000-4000-8000-00000000d505 00000000-0000-4000-8000-00000000d50a "set local role service_role; insert into public.transactions(id,account_id,date,occurred_on,details,household_id,source_system,source_is_pending,source_is_archived,amount,currency_code,raw_payload_hash) values ('00000000-0000-4000-8000-00000000d509','00000000-0000-4000-8000-00000000d503',now(),current_date,'{}','00000000-0000-4000-8000-00000000d501','source-race',true,false,-1000,'ZAR','pending');"
run_source_first amount-update 00000000-0000-4000-8000-00000000d511 00000000-0000-4000-8000-00000000d512 00000000-0000-4000-8000-00000000d513 00000000-0000-4000-8000-00000000d514 00000000-0000-4000-8000-00000000d515 00000000-0000-4000-8000-00000000d51a "set local role service_role; update public.transactions set amount=-2000,effective_at=now(),raw_payload_hash='updated' where id='00000000-0000-4000-8000-00000000d517';"
run_source_first snapshot-reduction 00000000-0000-4000-8000-00000000d521 00000000-0000-4000-8000-00000000d522 00000000-0000-4000-8000-00000000d523 00000000-0000-4000-8000-00000000d524 00000000-0000-4000-8000-00000000d525 00000000-0000-4000-8000-00000000d52a "set local role service_role; update public.snapshots set amount_cents=450000,observed_at=now() where account_id='00000000-0000-4000-8000-00000000d523' and date=current_date;"

h=00000000-0000-4000-8000-00000000d531; m=00000000-0000-4000-8000-00000000d532; a=00000000-0000-4000-8000-00000000d533; f=00000000-0000-4000-8000-00000000d534; v=00000000-0000-4000-8000-00000000d535
r="$(recon_for "$h")"; fp="$(fingerprint_for "$h")"
today_za="$(psql_admin -Atqc "select (now() at time zone 'Africa/Johannesburg')::date")"
payload="{\"kind\":\"assign\",\"to_fund_id\":\"$f\",\"amount_cents\":\"1000\",\"effective_on\":\"$today_za\",\"expected_version_id\":\"$v\",\"expected_reconciliation_id\":\"$r\",\"expected_reconciliation_fingerprint\":\"$fp\",\"reason\":\"source race\"}"
session_header source-funding-first "$m" "$m@source-race.test.invalid" > "$tmp_dir/funding-first.sql"
cat >> "$tmp_dir/funding-first.sql" <<SQL
select public.budget_move_funds_v1('00000000-0000-4000-8000-00000000d53a','$payload'::jsonb);
select pg_sleep(3);
commit;
SQL
session_header source-phantom-write "$m" "$m@source-race.test.invalid" > "$tmp_dir/phantom.sql"
cat >> "$tmp_dir/phantom.sql" <<SQL
set local role service_role;
insert into public.transactions(id,account_id,date,occurred_on,details,household_id,source_system,source_is_pending,source_is_archived,amount,currency_code,raw_payload_hash)
values ('00000000-0000-4000-8000-00000000d539','$a',now(),current_date,'{}','$h','source-race',true,false,-1000,'ZAR','phantom');
do \$\$ begin raise notice 'SOURCE_INSERT_COMMITTED'; end \$\$;
commit;
SQL
docker exec -i "$container_id" psql -X -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < "$tmp_dir/funding-first.sql" > "$tmp_dir/funding-first-first.out" 2>&1 & p1=$!
if ! wait_sleep source-funding-first; then wait "$p1" || true; exit 1; fi
docker exec -i "$container_id" psql -X -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < "$tmp_dir/phantom.sql" > "$tmp_dir/funding-first-second.out" 2>&1 & p2=$!
if ! wait_overlap source-funding-first source-phantom-write; then wait_sessions funding-first "$p1" "$p2" || true; exit 1; fi
wait_sessions funding-first "$p1" "$p2"
grep -q SOURCE_INSERT_COMMITTED "$tmp_dir/funding-first-second.out"
[[ "$(psql_admin -Atqc "select finance.budget_resources('$h',now())->>'complete'")" == false ]]
[[ "$(psql_admin -Atqc "select count(*) from finance.fund_movements where household_id='$h'")" == 1 ]]
[[ "$(psql_admin -Atqc "select count(*) from finance.budget_commands where household_id='$h' and kind='budget_move_funds_v1'")" == 1 ]]
printf '%s\n' 'ok funding-first phantom source insert (lock overlap, commit before later incomplete read)'
