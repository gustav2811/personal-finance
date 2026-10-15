-- PostgREST 14 exposes JWT claims through request.jwt.claims. Supabase's
-- auth.role() handles both the legacy and current claim settings.
create or replace function public.provision_ismrt_consumption_ownership_v1(
  p_household_id uuid,
  p_wallet_external_id text,
  p_evidence text
) returns jsonb
language plpgsql
security definer
set search_path = pg_temp
as $$
declare
  v_role text;
  v_root_id uuid;
  v_node record;
  v_device_count integer := 0;
  v_ledger_count integer := 0;
  v_rows integer := 0;
begin
  v_role := coalesce(auth.role(), '');
  if current_user <> 'service_role' and v_role <> 'service_role' then
    raise exception using errcode='P0001', message='budget_forbidden: service_role required';
  end if;
  if p_household_id is null
     or nullif(btrim(p_wallet_external_id), '') is null
     or nullif(btrim(p_evidence), '') is null then
    raise exception using errcode='P0001', message='budget_invalid: ISMRT ownership binding';
  end if;

  perform 1 from finance.households where id=p_household_id for update;
  if not found then
    raise exception using errcode='P0001', message='budget_not_found: household';
  end if;

  select id into v_root_id
  from consumption.devices
  where source='ismrt'
    and external_id=btrim(p_wallet_external_id)
    and kind='wallet'
    and parent_device_id is null
  for update;
  if not found then
    raise exception using errcode='P0001', message='budget_not_found: ISMRT wallet';
  end if;

  if exists (
    with recursive device_tree(id, parent_device_id, depth, path) as (
      select d.id, d.parent_device_id, 0, array[d.id]
      from consumption.devices d where d.id=v_root_id
      union all
      select child.id, child.parent_device_id, parent.depth+1, parent.path || child.id
      from consumption.devices child
      join device_tree parent on child.parent_device_id=parent.id
      where not child.id=any(parent.path)
    )
    select 1
    from device_tree tree
    join consumption.devices device on device.id=tree.id
    where device.source <> 'ismrt'
       or device.household_id is not null and device.household_id <> p_household_id
  ) then
    raise exception using errcode='P0001', message='budget_conflict: ISMRT device tree has conflicting ownership';
  end if;

  -- Parent devices are assigned before children because the existing trigger
  -- enforces that every owned child matches its parent's household.
  for v_node in
    with recursive device_tree(id, parent_device_id, depth, path) as (
      select d.id, d.parent_device_id, 0, array[d.id]
      from consumption.devices d where d.id=v_root_id
      union all
      select child.id, child.parent_device_id, parent.depth+1, parent.path || child.id
      from consumption.devices child
      join device_tree parent on child.parent_device_id=parent.id
      where not child.id=any(parent.path)
    )
    select id from device_tree order by depth, id
  loop
    update consumption.devices
    set household_id=p_household_id,
        metadata=coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'budget_ownership_evidence', btrim(p_evidence),
          'budget_ownership_provisioned_at', statement_timestamp()
        )
    where id=v_node.id and household_id is null;
    get diagnostics v_rows = row_count;
    v_device_count := v_device_count + v_rows;
  end loop;

  with recursive device_tree(id, parent_device_id, path) as (
    select d.id, d.parent_device_id, array[d.id]
    from consumption.devices d where d.id=v_root_id
    union all
    select child.id, child.parent_device_id, parent.path || child.id
    from consumption.devices child
    join device_tree parent on child.parent_device_id=parent.id
    where not child.id=any(parent.path)
  )
  update consumption.ledger_entries entry
  set household_id=p_household_id
  where entry.device_id in (select id from device_tree)
    and entry.household_id is null;
  get diagnostics v_ledger_count = row_count;

  return jsonb_build_object(
    'wallet_external_id', btrim(p_wallet_external_id),
    'household_id', p_household_id,
    'devices_assigned', v_device_count,
    'ledger_entries_assigned', v_ledger_count
  );
end;
$$;
