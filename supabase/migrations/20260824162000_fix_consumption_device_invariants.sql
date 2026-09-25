insert into consumption.devices (
  source,
  external_id,
  kind,
  name,
  utility_type,
  location,
  timezone,
  parent_device_id,
  metadata
)
select
  wallet.source,
  'water:' || wallet.external_id,
  'utility_stream',
  'ISMRT water billing',
  'water',
  wallet.location,
  wallet.timezone,
  wallet.id,
  jsonb_build_object('meter_type', 'invoice_billing')
from consumption.devices wallet
where wallet.source = 'ismrt'
  and wallet.utility_type = 'wallet'
on conflict (source, external_id) do update
set
  kind = excluded.kind,
  name = excluded.name,
  utility_type = excluded.utility_type,
  location = excluded.location,
  timezone = excluded.timezone,
  parent_device_id = excluded.parent_device_id,
  metadata = excluded.metadata,
  updated_at = now();

update consumption.devices child
set
  parent_device_id = wallet.id,
  location = wallet.location,
  timezone = wallet.timezone,
  updated_at = now()
from consumption.devices wallet
where child.source = 'ismrt'
  and child.utility_type = 'electricity'
  and wallet.source = 'ismrt'
  and wallet.utility_type = 'wallet'
  and (
    select count(*)
    from consumption.devices candidate_wallet
    where candidate_wallet.source = 'ismrt'
      and candidate_wallet.utility_type = 'wallet'
  ) = 1;

update consumption.ledger_entries entry
set device_id = wallet.id
from consumption.devices wallet
where entry.source = 'ismrt'
  and entry.utility_type = 'wallet'
  and entry.device_id is null
  and wallet.source = 'ismrt'
  and wallet.utility_type = 'wallet'
  and (
    select count(*)
    from consumption.devices candidate_wallet
    where candidate_wallet.source = 'ismrt'
      and candidate_wallet.utility_type = 'wallet'
  ) = 1;

update consumption.ledger_entries entry
set device_id = water.id
from consumption.devices water
where entry.source = 'ismrt'
  and entry.utility_type = 'water'
  and entry.device_id is null
  and water.source = 'ismrt'
  and water.utility_type = 'water'
  and (
    select count(*)
    from consumption.devices candidate_water
    where candidate_water.source = 'ismrt'
      and candidate_water.utility_type = 'water'
  ) = 1;

do $$
begin
  if exists (
    select 1
    from consumption.devices
    where source = 'ismrt'
      and location is null
  ) then
    raise exception 'Every ISMRT device must have a location';
  end if;

  if exists (
    select 1
    from consumption.ledger_entries
    where device_id is null
  ) then
    raise exception 'Every consumption ledger entry must have a device_id';
  end if;
end;
$$;

alter table consumption.ledger_entries
  alter column device_id set not null;

create or replace function consumption.validate_ledger_device()
returns trigger
language plpgsql
set search_path = consumption, pg_catalog
as $$
declare
  linked_source text;
  linked_utility_type text;
begin
  if new.device_id is null then
    raise exception 'consumption.ledger_entries.device_id is required';
  end if;

  select device.source, device.utility_type
  into linked_source, linked_utility_type
  from consumption.devices device
  where device.id = new.device_id;

  if not found then
    raise exception 'Ledger device_id % does not reference a device', new.device_id;
  end if;

  if linked_source <> new.source then
    raise exception
      'Ledger source % must use a device from source %',
      new.source,
      linked_source;
  end if;

  if linked_utility_type is distinct from new.utility_type then
    raise exception
      'Ledger utility_type % must use a % device',
      new.utility_type,
      new.utility_type;
  end if;

  return new;
end;
$$;

drop trigger if exists ledger_entries_validate_device
  on consumption.ledger_entries;

create trigger ledger_entries_validate_device
before insert or update of source, utility_type, device_id
on consumption.ledger_entries
for each row
execute function consumption.validate_ledger_device();

create or replace function consumption.validate_device_location()
returns trigger
language plpgsql
set search_path = consumption, pg_catalog
as $$
declare
  parent_source text;
  parent_location text;
begin
  if new.source = 'ismrt' and new.location is null then
    raise exception 'Every ISMRT device must have a location';
  end if;

  if new.parent_device_id is null then
    return new;
  end if;

  select parent.source, parent.location
  into parent_source, parent_location
  from consumption.devices parent
  where parent.id = new.parent_device_id;

  if not found then
    raise exception
      'parent_device_id % does not reference a device',
      new.parent_device_id;
  end if;

  if new.source <> parent_source then
    raise exception 'A device parent must use the same source';
  end if;

  if new.location is distinct from parent_location then
    raise exception 'A device and its parent must use the same location';
  end if;

  return new;
end;
$$;

drop trigger if exists devices_validate_location
  on consumption.devices;

create trigger devices_validate_location
before insert or update of source, location, parent_device_id
on consumption.devices
for each row
execute function consumption.validate_device_location();

