create or replace view dw.detailed_transactions as
select
  id as transaction_id,
  account_id,
  date,
  (details->'amount'->>'amount')::numeric as amount,
  details->'amount'->>'currencyCode' as currency,
  details->'amount'->>'debitOrCredit' as type,
  details->>'description' as description,
  details->>'categoryName' as category,
  details->>'accountName' as account_name,
  details->>'merchantName' as merchant,
  details->>'spendingGroupName' as spending_group
from transactions;

comment on view dw.detailed_transactions is 'Flattened view of transactions with JSON details extraction for analytics';
comment on column dw.detailed_transactions.transaction_id is 'Unique identifier for the transaction (from source system)';
comment on column dw.detailed_transactions.account_id is 'Foreign key linking to the accounts table';
comment on column dw.detailed_transactions.date is 'Transaction date in UTC';
comment on column dw.detailed_transactions.amount is 'Transaction amount as a numeric value';
comment on column dw.detailed_transactions.currency is 'Currency code (e.g., ZAR, USD)';
comment on column dw.detailed_transactions.type is 'Transaction type: credit or debit';
comment on column dw.detailed_transactions.description is 'Raw description from the transaction source';
comment on column dw.detailed_transactions.category is 'Categorization of the transaction (e.g., Groceries, Rent)';
comment on column dw.detailed_transactions.account_name is 'Name of the account as provided in details';
comment on column dw.detailed_transactions.merchant is 'Merchant name if identified';
comment on column dw.detailed_transactions.spending_group is 'High-level spending group definition';
