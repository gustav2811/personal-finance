-- Follow-up to 20260928143000. That migration already ran, so this does not
-- edit it. A 22:00Z stamp is a usage close only for an electricity usage
-- charge or a wallet subscription fee. Ledger identity includes the wallet and
-- the charge text so two wallets cannot share a row.

update consumption.ledger_entries
set
  occurred_at = posted_at,
  metadata = metadata || jsonb_build_object('incurred_date_rule', 'event_timestamp')
where source = 'ismrt'
  and metadata ->> 'incurred_date_rule' = 'daily_close'
  and not (
    (utility_type = 'electricity' and entry_type = 'usage_charge')
    or (
      utility_type = 'wallet'
      and entry_type = 'fee'
      and description ilike '%subscription fee%'
    )
  );

with keyed as (
  select
    entry.id,
    case
      when device.utility_type = 'wallet' then device.external_id
      else parent.external_id
    end as wallet_id,
    entry.utility_type,
    entry.entry_type,
    entry.posted_at,
    entry.direction,
    entry.amount,
    case
      when entry.utility_type = 'electricity' then device.external_id
      when nullif(btrim(entry.metadata ->> 'meter_serial'), '') is null then '-'
      else replace(btrim(entry.metadata ->> 'meter_serial'), ':', '/')
    end as meter_key,
    case
      when nullif(btrim(entry.description), '') is null then '-'
      else replace(btrim(entry.description), ':', '/')
    end as description_key,
    case
      when nullif(btrim(entry.reference), '') is null then '-'
      else replace(btrim(entry.reference), ':', '/')
    end as reference_key,
    row_number() over (
      partition by
        case
          when device.utility_type = 'wallet' then device.external_id
          else parent.external_id
        end,
        entry.utility_type,
        entry.entry_type,
        entry.posted_at,
        entry.direction,
        entry.amount,
        case
          when entry.utility_type = 'electricity' then device.external_id
          when nullif(btrim(entry.metadata ->> 'meter_serial'), '') is null then '-'
          else replace(btrim(entry.metadata ->> 'meter_serial'), ':', '/')
        end,
        case
          when nullif(btrim(entry.description), '') is null then '-'
          else replace(btrim(entry.description), ':', '/')
        end,
        case
          when nullif(btrim(entry.reference), '') is null then '-'
          else replace(btrim(entry.reference), ':', '/')
        end
      order by nullif(entry.metadata ->> 'source_row_index', '')::int nulls last, entry.id
    ) - 1 as occurrence
  from consumption.ledger_entries entry
  join consumption.devices device on device.id = entry.device_id
  left join consumption.devices parent on parent.id = device.parent_device_id
  where entry.source = 'ismrt'
),
prepared as (
  select
    id,
    'ismrt:ledger:' || wallet_id || ':' || utility_type || ':' || entry_type || ':' ||
      to_char(posted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || ':' ||
      direction || ':' ||
      trim(to_char(amount, 'FM999999990.0000')) || ':' ||
      meter_key || ':' ||
      description_key || ':' ||
      reference_key || ':' ||
      occurrence::text as source_record_id
  from keyed
)
update consumption.ledger_entries entry
set source_record_id = prepared.source_record_id
from prepared
where entry.id = prepared.id;

do $$
begin
  if exists (
    select 1
    from consumption.ledger_entries entry
    join consumption.devices device on device.id = entry.device_id
    left join consumption.devices parent on parent.id = device.parent_device_id
    where entry.source = 'ismrt'
      and case
        when device.utility_type = 'wallet' then device.external_id
        else parent.external_id
      end is null
  ) then
    raise exception 'ismrt ledger row has no wallet identity';
  end if;

  if exists (
    select source_record_id
    from consumption.ledger_entries
    where source = 'ismrt'
    group by source_record_id
    having count(*) > 1
  ) then
    raise exception 'ismrt ledger rekey produced duplicate source_record_id values';
  end if;

  if exists (
    select 1
    from consumption.ledger_entries
    where source = 'ismrt'
      and utility_type = 'electricity'
      and entry_type = 'usage_charge'
      and occurred_at is distinct from posted_at - interval '1 day'
  ) then
    raise exception 'electricity usage charge was not left on the usage day';
  end if;

  if exists (
    select 1
    from consumption.ledger_entries
    where source = 'ismrt'
      and (
        entry_type = 'deposit'
        or description ilike '%eft fee%'
      )
      and occurred_at is distinct from posted_at
  ) then
    raise exception 'deposit or EFT fee was shifted off its event timestamp';
  end if;
end;
$$;
