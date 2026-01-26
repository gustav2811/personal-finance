create or replace view dw.account_balances as
with joined as (
  select
    s.account_id,
    s.date,
    s.amount_cents,
    a.name
  from snapshots s
  left join accounts a
    on s.account_id = a.account_id
)
select
  account_id,
  name as account_name,
  date,
  (amount_cents / 100.0)::numeric(19, 2) as balance
from joined;

comment on view dw.account_balances is 'Daily account balances with normalized currency values';
comment on column dw.account_balances.account_id is 'Unique identifier for the account';
comment on column
 dw.account_balances.account_name is 'Human-readable name of the account';
comment on column dw.account_balances.date is 'Date of the balance snapshot';
comment on column dw.account_balances.balance is 'Account balance in standard currency units (converted from cents)';
