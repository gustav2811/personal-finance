# Context

Household finance. Supabase project `finance-data`. Timezone `Africa/Johannesburg`.

## Glossary

- **Consumption batch** — the `ingest_consumption_batch` payload: devices, raw events, readings, ledger entries, documents, and one ingestion run. Not the dashboard chart.
- **Energy chart** — the dashboard read model over `consumption.readings`. It is not the ingest payload.
- **Incurred date** — `occurred_at`. For an ISMRT daily close (`T22:00:00.000Z`) this is the usage day, 24 hours before the API stamp. Water uses the month named in the charge. `posted_at` keeps the API stamp.
- **Source record id** — `ismrt:ledger:{wallet}:{utility}:{entry_type}:{posted_at}:{direction}:{amount}:{meter}:{description}:{reference}:{occurrence}`. Empty text fields are `-`. `occurrence` separates genuinely identical source rows.
- **Owned category** — the household decision on a transaction. Distinct from the FinWise source category.
- **Shadow** — the classifier records a proposal and does not write it.
- **Job** — a scheduled unit of work on `investments-jobs`.
- **Health check** — 10:00 UTC job verifying Tuya markers/readings, ISMRT freshness, and email DLQ.

## Sources

- FinWise is the connected-account source. Bank Zero statements arrive by email.
- ISMRT is the utility source: electricity meter, water invoice, wallet fees and deposits.
- Tuya is the smart-plug source: closed-day BNETA espresso readings use `tuya:day:{device_id}:{YYYY-MM-DD}` and write raw logs to `tuya/{device_id}/date={YYYY-MM-DD}/{code}.ndjson.gz`, with `_SUCCESS` last.
- Ingestion run identities: Tuya uses `tuya:{device_id}:{YYYY-MM-DD}`; ISMRT runs are per execution.
