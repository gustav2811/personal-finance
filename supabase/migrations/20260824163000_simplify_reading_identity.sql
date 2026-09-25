alter table consumption.readings
  add column if not exists measurement_target text;

update consumption.readings
set measurement_target = 'whole_home'
where source = 'ismrt'
  and measurement_target is null;

update consumption.readings
set measurement_target = 'lelit-bianca'
where source = 'bneta'
  and measurement_target is null;

do $$
begin
  if exists (
    select 1
    from consumption.readings
    where measurement_target is null
      or btrim(measurement_target) = ''
  ) then
    raise exception 'Every consumption reading must have a measurement_target';
  end if;
end;
$$;

alter table consumption.readings
  alter column measurement_target set not null;

alter table consumption.readings
  add constraint readings_measurement_target_check
  check (btrim(measurement_target) <> '');

update consumption.devices
set
  external_id = 'bneta-plug-1',
  name = 'Bneta smart plug 1',
  metadata = metadata || '{"device_role": "physical_smart_plug"}'::jsonb,
  updated_at = now()
where source = 'bneta'
  and external_id = 'lelit-bianca';

