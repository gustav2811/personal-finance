-- Member workspace reads. household_members stays ungranted. These functions
-- return only the caller's household, and they do not write.

create or replace function public.budget_list_members_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_temp
set timezone = 'UTC'
as $$
declare
  h uuid;
  rows jsonb;
begin
  h := finance.budget_reader_household();
  select coalesce(
    jsonb_agg(jsonb_build_object('id', m.id::text, 'email', m.email) order by m.email nulls last, m.id),
    '[]'::jsonb
  )
  into rows
  from finance.household_members m
  where m.household_id = h;
  return jsonb_build_object(
    'calculation_version', 'household-budget-v1',
    'household_id', h::text,
    'as_of', statement_timestamp(),
    'members', rows
  );
end $$;

create or replace function public.budget_get_cutover_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_temp
set timezone = 'UTC'
as $$
declare
  h uuid;
  accounts jsonb := '[]'::jsonb;
  funds jsonb := '[]'::jsonb;
  categories jsonb := '[]'::jsonb;
  earmarks jsonb := '[]'::jsonb;
  movements jsonb := '[]'::jsonb;
  members jsonb := '[]'::jsonb;
  reconciliation jsonb;
  rec finance.budget_reconciliations%rowtype;
  live jsonb;
  account record;
  snapshot_date date;
  snapshot jsonb;
begin
  h := finance.budget_reader_household();

  select coalesce(
    jsonb_agg(jsonb_build_object('id', m.id::text, 'email', m.email) order by m.email nulls last, m.id),
    '[]'::jsonb
  )
  into members
  from finance.household_members m
  where m.household_id = h;

  select coalesce(
    jsonb_agg(jsonb_build_object(
      'id', c.id::text,
      'name', c.name,
      'group_name', c.group_name
    ) order by c.name, c.id),
    '[]'::jsonb
  )
  into categories
  from finance.categories c
  where c.household_id = h
    and c.archived_at is null
    and c.lifecycle_status = 'active';

  select coalesce(
    jsonb_agg(jsonb_build_object(
      'fund_id', f.id::text,
      'name', f.name,
      'status', f.status,
      'beneficiary_scope', f.beneficiary_scope,
      'beneficiary_member_id', f.beneficiary_member_id
    ) order by f.name, f.id),
    '[]'::jsonb
  )
  into funds
  from finance.funds f
  where f.household_id = h;

  for account in
    select a.account_id, a.name, a.currency_code, a.account_type
    from public.accounts a
    where a.household_id = h
      and a.archived_at is null
      and a.lifecycle_status <> 'archived'
    order by a.name, a.account_id
  loop
    select s.date into snapshot_date
    from public.snapshots s
    where s.household_id = h
      and s.account_id = account.account_id
    order by s.date desc
    limit 1;
    snapshot := case
      when snapshot_date is null then null
      else finance.budget_snapshot_snapshot(h, account.account_id, snapshot_date)
    end;
    accounts := accounts || jsonb_build_array(jsonb_build_object(
      'account_id', account.account_id::text,
      'name', account.name,
      'currency_code', account.currency_code,
      'account_type', account.account_type,
      'settings', (
        select case when s.account_id is null then null else jsonb_build_object(
          'owner_scope', s.owner_scope,
          'owner_member_id', s.owner_member_id,
          'included', s.included,
          'exclusion_reason', s.exclusion_reason,
          'resource_class', s.resource_class,
          'settlement_account_id', s.settlement_account_id,
          'usual_due_day', s.usual_due_day,
          'freshness_hours', s.freshness_hours,
          'transaction_sign_convention', s.transaction_sign_convention,
          'sign_evidence', s.sign_evidence,
          'settings_fingerprint', finance.budget_settings_fingerprint(h, s.account_id)
        ) end
        from finance.budget_account_settings s
        where s.household_id = h and s.account_id = account.account_id
      ),
      'latest_snapshot', case when snapshot is null then null else jsonb_build_object(
        'date', snapshot->>'date',
        'amount_cents', snapshot->>'amount_cents',
        'currency_code', snapshot->>'currency_code',
        'observed_at', snapshot->>'observed_at',
        'snapshot_fingerprint', finance.budget_snapshot_fingerprint(h, account.account_id, snapshot_date)
      ) end,
      'pending_ids', coalesce((
        select jsonb_agg(t.id order by t.id)
        from public.transactions t
        where t.household_id = h
          and t.account_id = account.account_id
          and t.source_is_pending is true
          and t.source_is_archived is distinct from true
      ), '[]'::jsonb)
    ));
  end loop;

  select * into rec
  from finance.budget_reconciliations r
  where r.household_id = h
  order by r.recorded_at desc, r.id desc
  limit 1;
  if found then
    live := finance.budget_reconciliation_state(h, rec.id, statement_timestamp());
    reconciliation := jsonb_build_object(
      'reconciliation_id', rec.id::text,
      'stored_status', rec.status,
      'status', live->>'status',
      'as_of', rec.as_of,
      'opening_fund_cutover', rec.opening_fund_cutover,
      'reconciliation_fingerprint', live->>'reconciliation_fingerprint',
      'reasons', coalesce(live->'reasons', '[]'::jsonb),
      'notes', rec.notes
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id::text,
    'fund_id', e.fund_id::text,
    'restricted_account_id', e.restricted_account_id::text,
    'amount_cents', e.amount_cents::text,
    'effective_on', e.effective_on,
    'reason', e.reason
  ) order by e.effective_on desc, e.recorded_at desc, e.id), '[]'::jsonb)
  into earmarks
  from (
    select *
    from finance.fund_earmarks
    where household_id = h
    order by effective_on desc, recorded_at desc, id
    limit 100
  ) e;

  select coalesce(jsonb_agg(jsonb_build_object(
    'movement_id', m.id::text,
    'kind', m.kind,
    'from_fund_id', m.from_fund_id,
    'to_fund_id', m.to_fund_id,
    'amount_cents', m.amount_cents::text,
    'effective_on', m.effective_on,
    'reason', m.reason,
    'budget_version_id', m.budget_version_id
  ) order by m.effective_on desc, m.recorded_at desc, m.id), '[]'::jsonb)
  into movements
  from (
    select *
    from finance.fund_movements movement
    where movement.household_id = h
      and movement.correction_role is null
      and not exists (
        select 1
        from finance.fund_movements reversal
        where reversal.household_id = movement.household_id
          and reversal.correction_of = movement.id
          and reversal.correction_role = 'reversal'
      )
    order by movement.effective_on desc, movement.recorded_at desc, movement.id
    limit 50
  ) m;

  return jsonb_build_object(
    'calculation_version', 'household-budget-v1',
    'household_id', h::text,
    'as_of', statement_timestamp(),
    'members', members,
    'categories', categories,
    'accounts', accounts,
    'funds', funds,
    'reconciliation', reconciliation,
    'earmarks', earmarks,
    'movements', movements
  );
end $$;

revoke all on function public.budget_list_members_v1() from public, anon, service_role;
revoke all on function public.budget_get_cutover_v1() from public, anon, service_role;
grant execute on function public.budget_list_members_v1() to authenticated;
grant execute on function public.budget_get_cutover_v1() to authenticated;
