create or replace function public.ingest_consumption_batch(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, consumption
as $$
declare
  request_role text;
begin
  request_role := coalesce(
    current_setting('request.jwt.claim.role', true),
    ''
  );

  if current_user <> 'service_role'
     and request_role <> 'service_role' then
    raise exception 'service_role is required';
  end if;

  if p_payload is null then
    raise exception 'payload is required';
  end if;

  insert into consumption.devices (
    source,
    external_id,
    kind,
    name,
    utility_type,
    location,
    timezone,
    active_from,
    active_to,
    metadata
  )
  select
    device.source,
    device.external_id,
    device.kind,
    device.name,
    device.utility_type,
    device.location,
    coalesce(device.timezone, 'Africa/Johannesburg'),
    device.active_from,
    device.active_to,
    coalesce(device.metadata, '{}'::jsonb)
  from jsonb_to_recordset(
    coalesce(p_payload -> 'devices', '[]'::jsonb)
  ) as device(
    source text,
    external_id text,
    kind text,
    name text,
    utility_type text,
    location text,
    timezone text,
    active_from timestamptz,
    active_to timestamptz,
    metadata jsonb,
    parent_source text,
    parent_external_id text
  )
  where device.parent_external_id is null
  on conflict (source, external_id) do update
  set
    kind = excluded.kind,
    name = excluded.name,
    utility_type = excluded.utility_type,
    location = excluded.location,
    timezone = excluded.timezone,
    active_from = excluded.active_from,
    active_to = excluded.active_to,
    metadata = excluded.metadata,
    updated_at = now();

  if exists (
    select 1
    from jsonb_to_recordset(
      coalesce(p_payload -> 'devices', '[]'::jsonb)
    ) as device(
      source text,
      external_id text,
      kind text,
      name text,
      utility_type text,
      location text,
      timezone text,
      active_from timestamptz,
      active_to timestamptz,
      metadata jsonb,
      parent_source text,
      parent_external_id text
    )
    where device.parent_external_id is not null
      and not exists (
        select 1
        from consumption.devices parent
        where parent.source = device.parent_source
          and parent.external_id = device.parent_external_id
      )
  ) then
    raise exception 'Every child device must reference an existing parent';
  end if;

  insert into consumption.devices (
    parent_device_id,
    source,
    external_id,
    kind,
    name,
    utility_type,
    location,
    timezone,
    active_from,
    active_to,
    metadata
  )
  select
    parent.id,
    device.source,
    device.external_id,
    device.kind,
    device.name,
    device.utility_type,
    device.location,
    coalesce(device.timezone, 'Africa/Johannesburg'),
    device.active_from,
    device.active_to,
    coalesce(device.metadata, '{}'::jsonb)
  from jsonb_to_recordset(
    coalesce(p_payload -> 'devices', '[]'::jsonb)
  ) as device(
    source text,
    external_id text,
    kind text,
    name text,
    utility_type text,
    location text,
    timezone text,
    active_from timestamptz,
    active_to timestamptz,
    metadata jsonb,
    parent_source text,
    parent_external_id text
  )
  join consumption.devices parent
    on parent.source = device.parent_source
   and parent.external_id = device.parent_external_id
  where device.parent_external_id is not null
  on conflict (source, external_id) do update
  set
    parent_device_id = excluded.parent_device_id,
    kind = excluded.kind,
    name = excluded.name,
    utility_type = excluded.utility_type,
    location = excluded.location,
    timezone = excluded.timezone,
    active_from = excluded.active_from,
    active_to = excluded.active_to,
    metadata = excluded.metadata,
    updated_at = now();

  insert into consumption.raw_events (
    source,
    source_record_id,
    event_type,
    event_at,
    fetched_at,
    payload_hash,
    payload,
    metadata
  )
  select
    event.source,
    event.source_record_id,
    event.event_type,
    event.event_at,
    coalesce(event.fetched_at, now()),
    event.payload_hash,
    event.payload,
    coalesce(event.metadata, '{}'::jsonb)
  from jsonb_to_recordset(
    coalesce(p_payload -> 'raw_events', '[]'::jsonb)
  ) as event(
    source text,
    source_record_id text,
    event_type text,
    event_at timestamptz,
    fetched_at timestamptz,
    payload_hash text,
    payload jsonb,
    metadata jsonb
  )
  on conflict (source, source_record_id) do nothing;

  insert into consumption.readings (
    device_id,
    source,
    source_record_id,
    period_start,
    period_end,
    metric,
    value,
    unit,
    quality,
    raw_event_id,
    metadata
  )
  select
    device.id,
    reading.source,
    reading.source_record_id,
    reading.period_start,
    reading.period_end,
    reading.metric,
    reading.value,
    reading.unit,
    coalesce(reading.quality, 'measured'),
    raw_event.id,
    coalesce(reading.metadata, '{}'::jsonb)
  from jsonb_to_recordset(
    coalesce(p_payload -> 'readings', '[]'::jsonb)
  ) as reading(
    source text,
    source_record_id text,
    period_start timestamptz,
    period_end timestamptz,
    metric text,
    value numeric,
    unit text,
    quality text,
    device_source text,
    device_external_id text,
    raw_source text,
    raw_record_id text,
    metadata jsonb
  )
  left join consumption.devices device
    on device.source = reading.device_source
   and device.external_id = reading.device_external_id
  left join consumption.raw_events raw_event
    on raw_event.source = reading.raw_source
   and raw_event.source_record_id = reading.raw_record_id
  on conflict (source, source_record_id, metric) do update
  set
    device_id = excluded.device_id,
    period_start = excluded.period_start,
    period_end = excluded.period_end,
    value = excluded.value,
    unit = excluded.unit,
    quality = excluded.quality,
    raw_event_id = excluded.raw_event_id,
    metadata = excluded.metadata;

  insert into consumption.ledger_entries (
    source,
    source_record_id,
    device_id,
    utility_type,
    entry_type,
    direction,
    amount,
    currency,
    quantity,
    quantity_unit,
    rate,
    occurred_at,
    posted_at,
    description,
    reference,
    raw_event_id,
    metadata
  )
  select
    entry.source,
    entry.source_record_id,
    device.id,
    entry.utility_type,
    entry.entry_type,
    entry.direction,
    entry.amount,
    coalesce(entry.currency, 'ZAR'),
    entry.quantity,
    entry.quantity_unit,
    entry.rate,
    entry.occurred_at,
    entry.posted_at,
    entry.description,
    entry.reference,
    raw_event.id,
    coalesce(entry.metadata, '{}'::jsonb)
  from jsonb_to_recordset(
    coalesce(p_payload -> 'ledger_entries', '[]'::jsonb)
  ) as entry(
    source text,
    source_record_id text,
    utility_type text,
    entry_type text,
    direction text,
    amount numeric,
    currency text,
    quantity numeric,
    quantity_unit text,
    rate numeric,
    occurred_at timestamptz,
    posted_at timestamptz,
    description text,
    reference text,
    device_source text,
    device_external_id text,
    raw_source text,
    raw_record_id text,
    metadata jsonb
  )
  left join consumption.devices device
    on device.source = entry.device_source
   and device.external_id = entry.device_external_id
  left join consumption.raw_events raw_event
    on raw_event.source = entry.raw_source
   and raw_event.source_record_id = entry.raw_record_id
  on conflict (source, source_record_id) do update
  set
    device_id = excluded.device_id,
    utility_type = excluded.utility_type,
    entry_type = excluded.entry_type,
    direction = excluded.direction,
    amount = excluded.amount,
    currency = excluded.currency,
    quantity = excluded.quantity,
    quantity_unit = excluded.quantity_unit,
    rate = excluded.rate,
    occurred_at = excluded.occurred_at,
    posted_at = excluded.posted_at,
    description = excluded.description,
    reference = excluded.reference,
    raw_event_id = excluded.raw_event_id,
    metadata = excluded.metadata;

  insert into consumption.documents (
    source,
    source_record_id,
    document_type,
    document_number,
    document_date,
    total,
    currency,
    file_name,
    storage_path,
    raw_event_id,
    metadata
  )
  select
    document.source,
    document.source_record_id,
    document.document_type,
    document.document_number,
    document.document_date,
    document.total,
    coalesce(document.currency, 'ZAR'),
    document.file_name,
    document.storage_path,
    raw_event.id,
    coalesce(document.metadata, '{}'::jsonb)
  from jsonb_to_recordset(
    coalesce(p_payload -> 'documents', '[]'::jsonb)
  ) as document(
    source text,
    source_record_id text,
    document_type text,
    document_number text,
    document_date date,
    total numeric,
    currency text,
    file_name text,
    storage_path text,
    raw_source text,
    raw_record_id text,
    metadata jsonb
  )
  left join consumption.raw_events raw_event
    on raw_event.source = document.raw_source
   and raw_event.source_record_id = document.raw_record_id
  on conflict (source, source_record_id) do update
  set
    document_type = excluded.document_type,
    document_number = excluded.document_number,
    document_date = excluded.document_date,
    total = excluded.total,
    currency = excluded.currency,
    file_name = excluded.file_name,
    storage_path = excluded.storage_path,
    raw_event_id = excluded.raw_event_id,
    metadata = excluded.metadata;

  insert into consumption.ingestion_runs (
    source,
    runner,
    status,
    started_at,
    finished_at,
    window_start,
    window_end,
    rows_fetched,
    rows_written,
    error,
    metadata
  )
  select
    run.source,
    run.runner,
    run.status,
    coalesce(run.started_at, now()),
    run.finished_at,
    run.window_start,
    run.window_end,
    coalesce(run.rows_fetched, 0),
    coalesce(run.rows_written, 0),
    run.error,
    coalesce(run.metadata, '{}'::jsonb)
  from jsonb_to_record(
    coalesce(p_payload -> 'ingestion_run', '{}'::jsonb)
  ) as run(
    source text,
    runner text,
    status text,
    started_at timestamptz,
    finished_at timestamptz,
    window_start timestamptz,
    window_end timestamptz,
    rows_fetched integer,
    rows_written integer,
    error text,
    metadata jsonb
  )
  where run.source is not null;

  return jsonb_build_object(
    'devices', jsonb_array_length(coalesce(p_payload -> 'devices', '[]'::jsonb)),
    'raw_events', jsonb_array_length(coalesce(p_payload -> 'raw_events', '[]'::jsonb)),
    'readings', jsonb_array_length(coalesce(p_payload -> 'readings', '[]'::jsonb)),
    'ledger_entries', jsonb_array_length(
      coalesce(p_payload -> 'ledger_entries', '[]'::jsonb)
    ),
    'documents', jsonb_array_length(coalesce(p_payload -> 'documents', '[]'::jsonb))
  );
end;
$$;

revoke execute on function public.ingest_consumption_batch(jsonb)
  from public, anon, authenticated;
grant execute on function public.ingest_consumption_batch(jsonb)
  to service_role;

