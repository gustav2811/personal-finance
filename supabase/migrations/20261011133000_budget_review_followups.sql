-- Attach the live source fingerprint the utility review form needs, and
-- return the saved wallet device so a later account edit does not clear it.

create or replace function public.budget_get_review_queue_v1(p_cursor text default null, p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_temp
set timezone = 'UTC'
as $$
declare
  base jsonb;
  h uuid;
  items jsonb := '[]'::jsonb;
  entry jsonb;
  tx text;
  utility uuid;
  snap jsonb;
  live text;
  fingerprint text;
begin
  base := finance.budget_get_review_queue_v1_stage5(p_cursor, p_limit);
  h := nullif(base->>'household_id', '')::uuid;
  if h is null then perform finance.budget_fail('budget_forbidden', 'household'); end if;
  for entry in select value from jsonb_array_elements(coalesce(base->'items', '[]'::jsonb)) loop
    tx := nullif(entry->>'source_transaction_id', '');
    utility := nullif(entry->>'utility_entry_id', '')::uuid;
    live := null;
    fingerprint := null;
    snap := null;
    if tx is not null then
      begin
        snap := finance.budget_source_snapshot(h, tx);
        live := snap->>'amount_cents';
        fingerprint := snap->>'source_fingerprint';
      exception when others then
        live := null;
        fingerprint := null;
      end;
    elsif utility is not null then
      begin
        snap := finance.budget_utility_snapshot(h, utility);
        live := coalesce(snap->>'signed_amount_cents', snap->>'amount_cents');
        fingerprint := snap->>'source_fingerprint';
      exception when others then
        live := null;
        fingerprint := null;
      end;
    end if;
    if live is not null or fingerprint is not null then
      entry := jsonb_set(
        entry,
        '{provenance}',
        coalesce(entry->'provenance', '{}'::jsonb) || jsonb_build_object(
          'live_source_amount_cents', live,
          'current_fingerprint', fingerprint,
          'source_snapshot', coalesce(entry->'provenance'->'source_snapshot', '{}'::jsonb)
            || jsonb_build_object('amount_cents', live, 'source_fingerprint', fingerprint)
        ),
        true
      );
    end if;
    items := items || jsonb_build_array(entry);
  end loop;
  return base || jsonb_build_object('items', items, 'entries', items);
end $$;

alter function public.budget_get_cutover_v1() set schema finance;
alter function finance.budget_get_cutover_v1() rename to budget_get_cutover_v1_base;

create or replace function public.budget_get_cutover_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_temp
set timezone = 'UTC'
as $$
declare
  base jsonb;
  h uuid;
  accounts jsonb := '[]'::jsonb;
  account jsonb;
  device text;
begin
  base := finance.budget_get_cutover_v1_base();
  h := nullif(base->>'household_id', '')::uuid;
  for account in select value from jsonb_array_elements(coalesce(base->'accounts', '[]'::jsonb)) loop
    device := null;
    if h is not null and account->'settings' is not null and jsonb_typeof(account->'settings') = 'object' then
      select s.utility_device_id::text into device
      from finance.budget_account_settings s
      where s.household_id = h and s.account_id = nullif(account->>'account_id', '')::uuid;
      account := jsonb_set(account, '{settings,utility_device_id}', coalesce(to_jsonb(device), 'null'::jsonb), true);
    end if;
    accounts := accounts || jsonb_build_array(account);
  end loop;
  return jsonb_set(base, '{accounts}', accounts, true);
end $$;

revoke all on function finance.budget_get_cutover_v1_base() from public, anon, authenticated, service_role;
revoke all on function public.budget_get_cutover_v1() from public, anon, service_role;
grant execute on function public.budget_get_cutover_v1() to authenticated;

notify pgrst, 'reload schema';
