-- PR 1b command foundation.  Keep this layer deliberately narrow: it owns the
-- receipt protocol and the small, independently useful member commands.
create or replace function finance.budget_fail(p_prefix text, p_detail text)
returns void language plpgsql volatile set search_path = pg_temp as $$
begin
  raise exception using errcode = 'P0001', message = p_prefix || ': ' || p_detail;
end;
$$;

create or replace function finance.budget_validate_object(p_value jsonb, p_required text[], p_optional text[])
returns void language plpgsql immutable set search_path = pg_temp as $$
declare v_key text;
begin
  if p_value is null or jsonb_typeof(p_value) is distinct from 'object' then
    perform finance.budget_fail('budget_invalid', 'payload must be an object');
  end if;
  foreach v_key in array p_required loop
    if not p_value ? v_key or p_value -> v_key = 'null'::jsonb then perform finance.budget_fail('budget_invalid', 'missing ' || v_key); end if;
  end loop;
  for v_key in select jsonb_object_keys(p_value) loop
    if not (v_key = any(coalesce(p_required, array[]::text[])) or v_key = any(coalesce(p_optional, array[]::text[]))) then
      perform finance.budget_fail('budget_invalid', 'unknown key ' || v_key);
    end if;
  end loop;
end;
$$;

create or replace function finance.budget_text(p_value jsonb, p_key text, p_nullable boolean default false)
returns text language plpgsql immutable set search_path = pg_temp as $$
declare v_text text;
begin
  if p_value is null or jsonb_typeof(p_value) is distinct from 'object' then
    perform finance.budget_fail('budget_invalid', 'invalid object');
  end if;
  if not p_value ? p_key or p_value -> p_key = 'null'::jsonb then
    if p_nullable then return null; end if;
    perform finance.budget_fail('budget_invalid', 'missing ' || p_key);
  end if;
  if jsonb_typeof(p_value -> p_key) is distinct from 'string' then perform finance.budget_fail('budget_invalid', 'invalid ' || p_key); end if;
  v_text := btrim(p_value ->> p_key);
  if v_text = '' then perform finance.budget_fail('budget_invalid', 'empty ' || p_key); end if;
  return v_text;
end;
$$;

create or replace function finance.budget_uuid(p_value jsonb, p_key text, p_nullable boolean default false)
returns uuid language plpgsql immutable set search_path = pg_temp as $$
begin
  if p_value is null or jsonb_typeof(p_value) is distinct from 'object' then perform finance.budget_fail('budget_invalid','invalid object'); end if;
  if not p_value ? p_key or p_value -> p_key = 'null'::jsonb then
    if p_nullable then return null; end if; perform finance.budget_fail('budget_invalid', 'missing ' || p_key);
  end if;
  if jsonb_typeof(p_value -> p_key) is distinct from 'string' or not (p_value ->> p_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then perform finance.budget_fail('budget_invalid', 'invalid ' || p_key); end if;
  return (p_value ->> p_key)::uuid;
exception when invalid_text_representation then perform finance.budget_fail('budget_invalid', 'invalid ' || p_key); return null;
end;
$$;

create or replace function finance.budget_date(p_value jsonb, p_key text, p_nullable boolean default false)
returns date language plpgsql immutable set search_path = pg_temp as $$
declare v_text text; v_date date;
begin
  v_text := finance.budget_text(p_value,p_key,p_nullable); if v_text is null then return null; end if;
  if v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then perform finance.budget_fail('budget_invalid', 'invalid ' || p_key); end if;
  v_date := v_text::date;
  if v_date::text <> v_text then perform finance.budget_fail('budget_invalid', 'invalid ' || p_key); end if;
  return v_date;
exception when others then
  if sqlstate = 'P0001' then raise; end if; perform finance.budget_fail('budget_invalid', 'invalid ' || p_key); return null;
end;
$$;

create or replace function finance.budget_timestamp(p_value jsonb, p_key text, p_nullable boolean default false)
returns timestamptz language plpgsql stable set search_path = pg_temp set timezone = 'UTC' as $$
declare v_text text; v_result timestamptz;
begin
  v_text := finance.budget_text(p_value,p_key,p_nullable); if v_text is null then return null; end if;
  if v_text !~* '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' then perform finance.budget_fail('budget_invalid', 'invalid ' || p_key); end if;
  v_result := v_text::timestamptz;
  if not isfinite(v_result) then perform finance.budget_fail('budget_invalid', 'invalid ' || p_key); end if;
  return v_result;
exception when others then if sqlstate='P0001' then raise; end if; perform finance.budget_fail('budget_invalid','invalid '||p_key); return null;
end;
$$;

create or replace function finance.budget_integer(p_value jsonb, p_key text, p_min bigint, p_max bigint, p_nullable boolean default false)
returns bigint language plpgsql immutable set search_path = pg_temp as $$
declare v_text text; v_result bigint;
begin
  if p_value is null or jsonb_typeof(p_value) is distinct from 'object' then perform finance.budget_fail('budget_invalid','invalid object'); end if;
  if not p_value ? p_key or p_value -> p_key = 'null'::jsonb then if p_nullable then return null; end if; perform finance.budget_fail('budget_invalid','missing '||p_key); end if;
  if jsonb_typeof(p_value->p_key) is distinct from 'number' then perform finance.budget_fail('budget_invalid','invalid '||p_key); end if;
  v_text := p_value->>p_key;
  if v_text !~ '^-?[0-9]+$' then perform finance.budget_fail('budget_invalid','invalid '||p_key); end if;
  v_result := v_text::bigint;
  if v_result < p_min or v_result > p_max then perform finance.budget_fail('budget_invalid','out of range '||p_key); end if;
  return v_result;
exception when others then if sqlstate='P0001' then raise; end if; perform finance.budget_fail('budget_invalid','invalid '||p_key); return null;
end;
$$;

create or replace function finance.budget_cents(p_value jsonb, p_key text, p_nullable boolean default false)
returns bigint language plpgsql immutable set search_path = pg_temp as $$
declare v_text text;
begin
  if p_value is null or jsonb_typeof(p_value) is distinct from 'object' then perform finance.budget_fail('budget_invalid','invalid object'); end if;
  if not p_value ? p_key or p_value -> p_key = 'null'::jsonb then if p_nullable then return null; end if; perform finance.budget_fail('budget_invalid','missing '||p_key); end if;
  if jsonb_typeof(p_value->p_key) is distinct from 'string' then perform finance.budget_fail('budget_invalid','invalid '||p_key); end if;
  v_text := p_value->>p_key;
  if v_text !~ '^-?[0-9]+$' then perform finance.budget_fail('budget_invalid','invalid '||p_key); end if;
  return v_text::bigint;
exception when others then if sqlstate='P0001' then raise; end if; perform finance.budget_fail('budget_invalid','invalid '||p_key); return null;
end;
$$;

create or replace function finance.budget_boolean(p_value jsonb, p_key text)
returns boolean language plpgsql immutable set search_path = pg_temp as $$
begin
  if p_value is null or jsonb_typeof(p_value) is distinct from 'object' then perform finance.budget_fail('budget_invalid','invalid object'); end if;
  if not p_value ? p_key or jsonb_typeof(p_value->p_key) is distinct from 'boolean' then perform finance.budget_fail('budget_invalid','invalid '||p_key); end if;
  return (p_value->>p_key)::boolean;
end;
$$;

create or replace function finance.budget_hash(p_value jsonb)
returns text language sql immutable set search_path = pg_temp as $$
  select pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(p_value::text, 'UTF8')),
    'hex'
  )
$$;

create or replace function finance.budget_actor_member(p_household_id uuid)
returns uuid language plpgsql volatile security definer set search_path = pg_temp as $$
declare v_actor uuid;
begin
  if auth.uid() is null or coalesce(auth.jwt() ->> 'role','') <> 'authenticated' then perform finance.budget_fail('budget_forbidden','authenticated caller required'); end if;
  perform finance.bind_household_member();
  select id into v_actor from finance.household_members where household_id=p_household_id and auth_user_id=auth.uid();
  if v_actor is null then perform finance.budget_fail('budget_forbidden','household member required'); end if;
  return v_actor;
end;
$$;

create or replace function finance.budget_begin_command(p_command_id uuid, p_kind text, p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = pg_temp as $$
declare v_household uuid; v_actor uuid; v_receipt finance.budget_commands%rowtype;
begin
  if p_command_id is null or btrim(coalesce(p_kind,''))='' or jsonb_typeof(p_payload) is distinct from 'object' then perform finance.budget_fail('budget_invalid','invalid command'); end if;
  if auth.uid() is null or coalesce(auth.jwt() ->> 'role','') <> 'authenticated' then perform finance.budget_fail('budget_forbidden','authenticated caller required'); end if;
  perform finance.bind_household_member();
  if not exists (select 1 from finance.household_members where auth_user_id = auth.uid()) then
    perform finance.budget_fail('budget_forbidden','household member required');
  end if;
  v_household := finance.resolve_caller_household();
  perform 1 from finance.households where id=v_household for update;
  v_actor := finance.budget_actor_member(v_household);
  select * into v_receipt from finance.budget_commands where household_id=v_household and command_id=p_command_id;
  if found then
    if v_receipt.kind is distinct from p_kind or v_receipt.payload is distinct from p_payload then perform finance.budget_fail('budget_conflict','command receipt differs'); end if;
    return v_receipt.result;
  end if;
  return null;
end;
$$;

create or replace function finance.budget_finish_command(p_command_id uuid,p_kind text,p_payload jsonb,p_result jsonb)
returns jsonb language plpgsql volatile security definer set search_path = pg_temp as $$
declare v_household uuid; v_actor uuid;
begin
  if jsonb_typeof(p_result) is distinct from 'object' then perform finance.budget_fail('budget_invalid','invalid command result'); end if;
  if auth.uid() is null or coalesce(auth.jwt() ->> 'role','') <> 'authenticated' then
    perform finance.budget_fail('budget_forbidden','authenticated caller required');
  end if;
  perform finance.bind_household_member();
  if not exists (select 1 from finance.household_members where auth_user_id = auth.uid()) then
    perform finance.budget_fail('budget_forbidden','household member required');
  end if;
  v_household:=finance.resolve_caller_household(); perform 1 from finance.households where id=v_household for update; v_actor:=finance.budget_actor_member(v_household);
  insert into finance.budget_commands(household_id,command_id,kind,payload,actor_id,result) values(v_household,p_command_id,p_kind,p_payload,v_actor,p_result);
  return p_result;
end;
$$;

create or replace function finance.budget_settings_snapshot(p_household_id uuid,p_account_id uuid)
returns jsonb language sql stable security definer set search_path = pg_temp as $$
 select jsonb_build_object('household_id',s.household_id::text,'account_id',s.account_id::text,'owner_scope',s.owner_scope,'owner_member_id',s.owner_member_id::text,'included',s.included,'exclusion_reason',s.exclusion_reason,'resource_class',s.resource_class,'settlement_account_id',s.settlement_account_id::text,'usual_due_day',s.usual_due_day,'freshness_hours',s.freshness_hours,'transaction_sign_convention',s.transaction_sign_convention,'sign_evidence',s.sign_evidence,'utility_device_id',s.utility_device_id::text) from finance.budget_account_settings s where s.household_id=p_household_id and s.account_id=p_account_id
$$;
create or replace function finance.budget_settings_fingerprint(p_household_id uuid,p_account_id uuid) returns text language sql stable security definer set search_path=pg_temp as $$ select case when finance.budget_settings_snapshot(p_household_id,p_account_id) is null then null else finance.budget_hash(finance.budget_settings_snapshot(p_household_id,p_account_id)) end $$;

create or replace function finance.budget_snapshot_snapshot(p_household_id uuid,p_account_id uuid,p_date date)
returns jsonb language sql stable security definer set search_path=pg_temp as $$
 select jsonb_build_object(
   'household_id', s.household_id::text,
   'account_id', s.account_id::text,
   'date', s.date::text,
   'amount_cents', case
     when s.amount_cents is null then null
     when s.amount_cents::text ~ '^-?[0-9]+([.]0+)?$'
       and s.amount_cents between -9223372036854775808::numeric and 9223372036854775807::numeric
       then (s.amount_cents::bigint)::text
     else s.amount_cents::text
   end,
   'currency_code', s.currency_code,
   'account_currency_code', a.currency_code,
   'observed_at', case when s.observed_at is null then null else to_char(s.observed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
   'source_system', s.source_system,
   'sync_run_id', s.sync_run_id::text
 )
 from public.snapshots s
 join public.accounts a on a.account_id=s.account_id and a.household_id=s.household_id
 where s.household_id=p_household_id and s.account_id=p_account_id and s.date=p_date
$$;
create or replace function finance.budget_snapshot_fingerprint(p_household_id uuid,p_account_id uuid,p_date date) returns text language sql stable security definer set search_path=pg_temp as $$ select case when finance.budget_snapshot_snapshot(p_household_id,p_account_id,p_date) is null then null else finance.budget_hash(finance.budget_snapshot_snapshot(p_household_id,p_account_id,p_date)) end $$;

create or replace function public.budget_create_fund_v1(p_command_id uuid,p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path=pg_temp set timezone='UTC' as $$
declare v_payload jsonb; v_replay jsonb; v_household uuid; v_actor uuid; v_member uuid; v_id uuid:=gen_random_uuid();
begin
 perform finance.budget_validate_object(p_payload,array['name','beneficiary_scope'],array['beneficiary_member_id']);
 v_member:=finance.budget_uuid(p_payload,'beneficiary_member_id',true);
 v_payload:=jsonb_build_object('name',finance.budget_text(p_payload,'name'),'beneficiary_scope',finance.budget_text(p_payload,'beneficiary_scope'),'beneficiary_member_id',v_member::text);
 if v_payload->>'beneficiary_scope' not in ('shared','member') or ((v_payload->>'beneficiary_scope'='shared') <> (v_member is null)) then perform finance.budget_fail('budget_invalid','invalid beneficiary'); end if;
 v_replay:=finance.budget_begin_command(p_command_id,'budget_create_fund_v1',v_payload); if v_replay is not null then return v_replay; end if;
 v_household:=finance.resolve_caller_household(); v_actor:=finance.budget_actor_member(v_household);
 if v_member is not null and not exists(select 1 from finance.household_members where household_id=v_household and id=v_member) then perform finance.budget_fail('budget_not_found','beneficiary member'); end if;
 insert into finance.funds(id,household_id,name,beneficiary_scope,beneficiary_member_id,created_by) values(v_id,v_household,v_payload->>'name',v_payload->>'beneficiary_scope',v_member,v_actor);
 set constraints all immediate;
 return finance.budget_finish_command(p_command_id,'budget_create_fund_v1',v_payload,jsonb_build_object('fund_id',v_id::text));
end; $$;

create or replace function public.budget_update_fund_v1(p_command_id uuid,p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path=pg_temp set timezone='UTC' as $$
declare v_payload jsonb; v_replay jsonb; v_household uuid; v_fund finance.funds%rowtype; v_id uuid;
begin
 perform finance.budget_validate_object(p_payload,array['fund_id','expected_name','expected_status','name','status'],array[]::text[]);
 v_id:=finance.budget_uuid(p_payload,'fund_id');
 v_payload:=jsonb_build_object('fund_id',v_id::text,'expected_name',finance.budget_text(p_payload,'expected_name'),'expected_status',finance.budget_text(p_payload,'expected_status'),'name',finance.budget_text(p_payload,'name'),'status',finance.budget_text(p_payload,'status'));
 if v_payload->>'expected_status' not in ('active','retired') or v_payload->>'status' not in ('active','retired') then perform finance.budget_fail('budget_invalid','invalid status'); end if;
 v_replay:=finance.budget_begin_command(p_command_id,'budget_update_fund_v1',v_payload); if v_replay is not null then return v_replay; end if;
 v_household:=finance.resolve_caller_household(); select * into v_fund from finance.funds where household_id=v_household and id=v_id for update; if not found then perform finance.budget_fail('budget_not_found','fund'); end if;
 if v_fund.name is distinct from v_payload->>'expected_name' or v_fund.status is distinct from v_payload->>'expected_status' then perform finance.budget_fail('budget_stale','fund'); end if;
 update finance.funds set name=v_payload->>'name',status=v_payload->>'status' where household_id=v_household and id=v_id;
 set constraints all immediate;
 return finance.budget_finish_command(p_command_id,'budget_update_fund_v1',v_payload,jsonb_build_object('fund_id',v_id::text,'name',v_payload->>'name','status',v_payload->>'status'));
end; $$;

create or replace function public.budget_configure_account_v1(p_command_id uuid,p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path=pg_temp set timezone='UTC' as $$
declare
  v_payload jsonb;
  v_replay jsonb;
  v_household uuid;
  v_actor uuid;
  v_account uuid;
  v_owner uuid;
  v_settlement uuid;
  v_existing text;
  v_expected text;
  v_before jsonb;
  v_after jsonb;
  v_fingerprint text;
  v_scope text;
  v_included boolean;
  v_class text;
  v_sign text;
begin
 perform finance.budget_validate_object(
   p_payload,
   array['account_id','owner_scope','included','resource_class','freshness_hours','transaction_sign_convention'],
   array['expected_settings_fingerprint','owner_member_id','exclusion_reason','settlement_account_id','usual_due_day','sign_evidence']
 );
 v_account:=finance.budget_uuid(p_payload,'account_id');
 v_owner:=finance.budget_uuid(p_payload,'owner_member_id',true);
 v_settlement:=finance.budget_uuid(p_payload,'settlement_account_id',true);
 v_expected:=finance.budget_text(p_payload,'expected_settings_fingerprint',true);
 v_scope:=finance.budget_text(p_payload,'owner_scope');
 v_included:=finance.budget_boolean(p_payload,'included');
 v_class:=finance.budget_text(p_payload,'resource_class');
 v_sign:=finance.budget_text(p_payload,'transaction_sign_convention');
 v_payload:=jsonb_build_object(
   'account_id',v_account::text,
   'expected_settings_fingerprint',v_expected,
   'owner_scope',v_scope,
   'owner_member_id',v_owner::text,
   'included',v_included,
   'exclusion_reason',finance.budget_text(p_payload,'exclusion_reason',true),
   'resource_class',v_class,
   'settlement_account_id',v_settlement::text,
   'usual_due_day',finance.budget_integer(p_payload,'usual_due_day',1,31,true),
   'freshness_hours',finance.budget_integer(p_payload,'freshness_hours',1,2147483647),
   'transaction_sign_convention',v_sign,
   'sign_evidence',finance.budget_text(p_payload,'sign_evidence',true)
 );
 if v_scope not in ('shared','member') or ((v_scope='shared') <> (v_owner is null)) or v_class not in ('liquid','restricted','mortgage','card','tracking_only') or (v_included and v_class='tracking_only') or (not v_included and coalesce(v_payload->>'exclusion_reason','')='') or v_sign not in ('outflow_negative','outflow_positive','unknown') or (v_sign<>'unknown' and coalesce(v_payload->>'sign_evidence','')='') then perform finance.budget_fail('budget_invalid','invalid account settings'); end if;
 v_replay:=finance.budget_begin_command(p_command_id,'budget_configure_account_v1',v_payload); if v_replay is not null then return v_replay; end if;
 v_household:=finance.resolve_caller_household(); v_actor:=finance.budget_actor_member(v_household);
 if not exists(select 1 from public.accounts where household_id=v_household and account_id=v_account) then perform finance.budget_fail('budget_not_found','account'); end if;
 if v_owner is not null and not exists(select 1 from finance.household_members where household_id=v_household and id=v_owner) then perform finance.budget_fail('budget_not_found','owner member'); end if;
 if v_settlement is not null and not exists(select 1 from public.accounts where household_id=v_household and account_id=v_settlement) then perform finance.budget_fail('budget_not_found','settlement account'); end if;
 v_before:=finance.budget_settings_snapshot(v_household,v_account); v_existing:=finance.budget_settings_fingerprint(v_household,v_account);
 if (v_existing is null and v_expected is not null) or (v_existing is not null and v_expected is distinct from v_existing) then perform finance.budget_fail('budget_stale','settings'); end if;
 insert into finance.budget_account_settings as s(household_id,account_id,owner_scope,owner_member_id,included,exclusion_reason,resource_class,settlement_account_id,usual_due_day,freshness_hours,transaction_sign_convention,sign_evidence,actor_id) values(v_household,v_account,v_scope,v_owner,v_included,v_payload->>'exclusion_reason',v_class,v_settlement,(v_payload->>'usual_due_day')::integer,(v_payload->>'freshness_hours')::integer,v_sign,v_payload->>'sign_evidence',v_actor) on conflict(household_id,account_id) do update set owner_scope=excluded.owner_scope,owner_member_id=excluded.owner_member_id,included=excluded.included,exclusion_reason=excluded.exclusion_reason,resource_class=excluded.resource_class,settlement_account_id=excluded.settlement_account_id,usual_due_day=excluded.usual_due_day,freshness_hours=excluded.freshness_hours,transaction_sign_convention=excluded.transaction_sign_convention,sign_evidence=excluded.sign_evidence,updated_at=now(),actor_id=excluded.actor_id;
 v_after:=finance.budget_settings_snapshot(v_household,v_account); v_fingerprint:=finance.budget_hash(v_after);
 set constraints all immediate;
 return finance.budget_finish_command(p_command_id,'budget_configure_account_v1',v_payload,jsonb_build_object('account_id',v_account::text,'settings_fingerprint',v_fingerprint,'before',v_before,'after',v_after));
end; $$;

revoke all on function finance.budget_fail(text,text), finance.budget_validate_object(jsonb,text[],text[]), finance.budget_text(jsonb,text,boolean), finance.budget_uuid(jsonb,text,boolean), finance.budget_date(jsonb,text,boolean), finance.budget_timestamp(jsonb,text,boolean), finance.budget_integer(jsonb,text,bigint,bigint,boolean), finance.budget_cents(jsonb,text,boolean), finance.budget_boolean(jsonb,text), finance.budget_hash(jsonb), finance.budget_actor_member(uuid), finance.budget_begin_command(uuid,text,jsonb), finance.budget_finish_command(uuid,text,jsonb,jsonb), finance.budget_settings_snapshot(uuid,uuid), finance.budget_settings_fingerprint(uuid,uuid), finance.budget_snapshot_snapshot(uuid,uuid,date), finance.budget_snapshot_fingerprint(uuid,uuid,date) from public, anon, authenticated, service_role;
revoke all on function public.budget_create_fund_v1(uuid,jsonb), public.budget_update_fund_v1(uuid,jsonb), public.budget_configure_account_v1(uuid,jsonb) from public, anon, service_role;
grant execute on function public.budget_create_fund_v1(uuid,jsonb), public.budget_update_fund_v1(uuid,jsonb), public.budget_configure_account_v1(uuid,jsonb) to authenticated;
