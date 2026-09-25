update public.transactions
set
  amount = case details->'amount'->>'debitOrCredit'
    when 'debit' then -((details->'amount'->>'amount')::numeric)
    when 'credit' then (details->'amount'->>'amount')::numeric
    else (details->'amount'->>'amount')::numeric
  end,
  currency_code = details->'amount'->>'currencyCode'
where amount is null
  and jsonb_typeof(details->'amount') = 'object'
  and details->'amount'->>'amount' ~ '^-?[0-9]+(\.[0-9]+)?$';
