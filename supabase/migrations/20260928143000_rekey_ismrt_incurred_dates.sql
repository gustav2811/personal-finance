-- ISMRT daily charges are stamped at 22:00Z, which is midnight Africa/Johannesburg
-- on the following calendar day. That stamp is the close of the usage day, not
-- the day the electricity was used. Rekey the experimental hash+index ids so the
-- scheduled worker can upsert the same rows, and move occurred_at onto the
-- incurred day.

do $$
begin
  if exists (
    select 1
    from consumption.ledger_entries
    where source = 'ismrt'
      and utility_type = 'water'
      and description !~ '^(January|February|March|April|May|June|July|August|September|October|November|December) monthly'
  ) then
    raise exception 'water ledger row is missing a usage month';
  end if;
end;
$$;

with months(name, month_num) as (
  values
    ('January', 1),
    ('February', 2),
    ('March', 3),
    ('April', 4),
    ('May', 5),
    ('June', 6),
    ('July', 7),
    ('August', 8),
    ('September', 9),
    ('October', 10),
    ('November', 11),
    ('December', 12)
),
ranked as (
  select
    entry.id,
    entry.utility_type,
    entry.entry_type,
    entry.direction,
    entry.amount,
    entry.posted_at,
    entry.description,
    row_number() over (
      partition by
        entry.utility_type,
        entry.entry_type,
        entry.posted_at,
        entry.direction,
        entry.amount
      order by nullif(entry.metadata ->> 'source_row_index', '')::int nulls last, entry.id
    ) - 1 as occurrence
  from consumption.ledger_entries entry
  where entry.source = 'ismrt'
),
prepared as (
  select
    ranked.id,
    'ismrt:ledger:' || ranked.utility_type || ':' || ranked.entry_type || ':' ||
      to_char(ranked.posted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || ':' ||
      ranked.direction || ':' ||
      trim(to_char(ranked.amount, 'FM999999990.0000')) || ':' ||
      ranked.occurrence::text as source_record_id,
    case
      when ranked.utility_type = 'water' then make_timestamptz(
        case
          when months.month_num > extract(
            month from ranked.posted_at at time zone 'Africa/Johannesburg'
          )::int
            then extract(year from ranked.posted_at at time zone 'Africa/Johannesburg')::int - 1
          else extract(year from ranked.posted_at at time zone 'Africa/Johannesburg')::int
        end,
        months.month_num,
        1,
        0,
        0,
        0,
        'Africa/Johannesburg'
      )
      when (ranked.posted_at at time zone 'UTC')
        = date_trunc('day', ranked.posted_at at time zone 'UTC') + interval '22 hours'
        then ranked.posted_at - interval '1 day'
      else ranked.posted_at
    end as occurred_at,
    case
      when ranked.utility_type = 'water' then 'named_month'
      when (ranked.posted_at at time zone 'UTC')
        = date_trunc('day', ranked.posted_at at time zone 'UTC') + interval '22 hours'
        then 'daily_close'
      else 'event_timestamp'
    end as incurred_date_rule
  from ranked
  left join months
    on ranked.utility_type = 'water'
   and ranked.description like months.name || ' monthly%'
)
update consumption.ledger_entries entry
set
  source_record_id = prepared.source_record_id,
  occurred_at = prepared.occurred_at,
  metadata = entry.metadata || jsonb_build_object(
    'incurred_date_rule', prepared.incurred_date_rule
  )
from prepared
where entry.id = prepared.id;

do $$
begin
  if exists (
    select 1
    from consumption.ledger_entries
    where source = 'ismrt'
      and utility_type = 'electricity'
      and occurred_at is distinct from posted_at - interval '1 day'
  ) then
    raise exception 'electricity incurred date was not shifted to the usage day';
  end if;

  if exists (
    select 1
    from consumption.ledger_entries
    where source = 'ismrt'
      and utility_type = 'water'
      and (
        extract(day from occurred_at at time zone 'Africa/Johannesburg') <> 1
        or (occurred_at at time zone 'Africa/Johannesburg')::time <> time '00:00'
      )
  ) then
    raise exception 'water incurred date is not the start of the named month';
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
end;
$$;
