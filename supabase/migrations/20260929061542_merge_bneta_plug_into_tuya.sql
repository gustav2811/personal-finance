-- The manual BNETA CSV plug and the Tuya plug are the same espresso plug.
-- Rehome the CSV readings onto the Tuya device and Tuya reading identity.

do $$
declare
  bneta_id uuid;
  tuya_id uuid;
begin
  select id into bneta_id
  from consumption.devices
  where source = 'bneta' and external_id = 'bneta-plug-1';

  if bneta_id is null then
    return;
  end if;

  select id into tuya_id
  from consumption.devices
  where source = 'tuya' and external_id = 'bf425b172390340134huph';

  if tuya_id is null then
    update consumption.devices
    set source = 'tuya',
        external_id = 'bf425b172390340134huph',
        name = 'BNETA espresso smart plug',
        location = 'home',
        metadata = jsonb_build_object(
          'device_role', 'espresso_machine',
          'tuya_device_id', 'bf425b172390340134huph'
        )
    where id = bneta_id;
    tuya_id := bneta_id;
  end if;

  update consumption.readings
  set device_id = tuya_id,
      source = 'tuya',
      source_record_id = 'tuya:day:bf425b172390340134huph:' || (metadata ->> 'local_date')
  where source = 'bneta';

  update consumption.context_events
  set device_id = tuya_id
  where device_id = bneta_id;

  if tuya_id <> bneta_id then
    delete from consumption.devices where id = bneta_id;
  end if;

  if exists (select 1 from consumption.readings where source = 'bneta') then
    raise exception 'bneta readings remain after merge';
  end if;
end;
$$;
