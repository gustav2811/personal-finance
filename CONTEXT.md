# Context

Household finance. Supabase project `finance-data`. Timezone `Africa/Johannesburg`.

## Glossary

- **Consumption batch** — the `ingest_consumption_batch` payload: devices, raw events, readings, ledger entries, documents, and one ingestion run. Not the dashboard chart.
- **Energy chart** — the dashboard read model over `consumption.readings`. It is not the ingest payload.
- **Incurred date** — `occurred_at`. For an ISMRT daily close (`T22:00:00.000Z`) this is the usage day, 24 hours before the API stamp. Water uses the month named in the charge. `posted_at` keeps the API stamp.
- **Source record id** — `ismrt:ledger:{utility}:{entry_type}:{posted_at}:{direction}:{amount}:{occurrence}`. Stable across overlap windows.
- **Owned category** — the household decision on a transaction. Distinct from the FinWise source category.
- **Shadow** — the classifier records a proposal and does not write it.

## Sources

- FinWise is the connected-account source. Bank Zero statements arrive by email.
- ISMRT is the utility source: electricity meter, water invoice, wallet fees and deposits. Plug readings are not ingested yet.
