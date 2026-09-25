# Household consumption model

Status: initial schema applied to the `finance-data` Supabase project on
2026-08-24. Bneta plug ingestion is intentionally not included yet.

## Goal

Unify household utility charges and device readings without losing the source
record. The first consumers are:

- ISMRT wallet electricity and water charges.
- ISMRT meter-level electricity readings.
- Plug-level devices such as the Lelit Bianca.
- Future geyser, appliance, or smart-switch readings.

## Applied schema

The migration lives under
`supabase/migrations/20260824160000_create_consumption_schema.sql`.

| Table | Purpose |
| --- | --- |
| `consumption.devices` | Wallets, meters, plugs, appliances, and their source identifiers. |
| `consumption.raw_events` | Immutable API responses for audit and reprocessing. |
| `consumption.readings` | Native-resolution measurements over a time window. |
| `consumption.ledger_entries` | Utility charges, fees, deposits, and corrections. |
| `consumption.documents` | Invoice and proof-of-payment metadata. |
| `consumption.context_events` | Human or provider explanations for unusual usage. |
| `consumption.ingestion_runs` | Source-run status and row-count audit trail. |

Usage and money are separate tables. This prevents a water correction or wallet
fee from being mistaken for physical consumption while still allowing reports
to join both facts.

All seven tables have RLS enabled. There are currently no client-facing
policies, so access is service-role-only. The ingestion RPC is in
`public.ingest_consumption_batch(jsonb)`, with execute permission revoked from
`anon` and `authenticated`.

Every `consumption.ledger_entries` row must reference a device. A database
`NOT NULL` constraint, foreign key, and validation trigger enforce that the
linked device has the same source and utility type as the ledger entry.

## Source mappings

### ISMRT

- `source`: `ismrt`
- `source_record_id`: deterministic composite derived from the source row or
  document ID.
- `devices`: one ISMRT wallet parent, one electricity child, and one logical
  water-invoice child. All three use the same property location.
- `readings`: `meterProfile` daily `forwardActiveEnergy` in native `Wh`.
- `ledger_entries`: all 251 expense rows plus five `PURCHASE` deposit credits.
  Electricity carries `kWh` and rate; wallet charges and deposits map to the
  wallet parent; water invoice rows map to the water child and `usage` is
  optional invoice metadata, not a meter reading.
- `documents`: eight invoices and five proof-of-payment records.
- `raw_events`: the original probe response for each API operation.

ISMRT emits two April water debits and one matching credit for the same
`9.199 kl` reference. All money rows are retained. The loader assigns that
quantity to one debit row only, preventing a report from tripling water usage.

### Device readings

Device adapters should emit the same canonical row shape. Use a stable
`device_id` for each physical meter or reporting device and retain the device's
native unit in `unit`. Do not convert away the native reading; add a normalized
electricity value where useful.

## Database direction

The existing finance database stores source transactions and exposes flattened
`dw` views. Add consumption storage as a separate source table or schema, then
build reporting views that join:

1. wallet-level costs;
2. whole-house meter readings;
3. device-level readings;
4. weather and household annotations.

## Loading

Regenerate the private ISMRT extracts, then load them:

```bash
set -a; source .env; set +a
python3 tools/ismrt/probe_ismrt_api.py --days 120
python3 tools/ismrt/load_to_supabase.py
```

The loader is idempotent for source facts. Re-running the same capture keeps
the row counts stable; it appends an `ingestion_runs` audit row. Private raw
extracts remain under ignored `data/consumption/`.

The Supabase project currently reports six pre-existing `dw.int_*` tables with
RLS disabled and no policies. Do not silently enable RLS there: existing
readers would be blocked. Remediate those tables separately with explicit
policies.
