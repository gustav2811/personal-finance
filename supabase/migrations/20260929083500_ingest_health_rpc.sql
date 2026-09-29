create or replace function consumption.ingest_health(p_tuya_source_record_id text)
returns jsonb
language sql
stable
security invoker
set search_path = consumption
as $$
  select jsonb_build_object(
    'tuya_reading_exists',
    exists (
      select 1
      from consumption.readings
      where source = 'tuya'
        and source_record_id = p_tuya_source_record_id
    ),
    'ismrt_latest_period_end',
    (
      select max(period_end)
      from consumption.readings
      where source = 'ismrt'
        and metric = 'energy'
        and measurement_target = 'whole_home'
    )
  );
$$;

revoke execute on function consumption.ingest_health(text)
  from public, anon, authenticated;
grant execute on function consumption.ingest_health(text)
  to service_role;
