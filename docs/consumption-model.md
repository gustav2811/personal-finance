# Household consumption model

Status: schema applied to the `finance-data` Supabase project. ISMRT
electricity, water, and wallet ingestion runs on the existing ingest
consumer's daily cron. Bneta plug ingestion is not included yet.

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

## Incurred dates

ISMRT stamps a completed electricity day at `T22:00:00.000Z`. That instant is
midnight in `Africa/Johannesburg` on the following calendar day, and it matches
the meter-profile interval **end**, not the day the electricity was used. The
matching kWh sits on the interval that starts 24 hours earlier.

- `posted_at` keeps the API timestamp.
- `occurred_at` for a daily close (`22:00:00.000Z`, electricity and the daily
  wallet subscription) is that timestamp minus one day: 00:00 SAST on the usage
  day. The dashboard reads `occurred_at` in Johannesburg, so this is the usage
  date.
- Water charges name the usage month (`April monthly Water Usage`) and are
  posted around the 6th of the next month at `22:01Z`. `occurred_at` is 00:00
  SAST on the 1st of the named month.
- EFT fees and `PURCHASE` deposits keep their event timestamp.
- Meter readings already use the profile interval. Intervals with no
  consumption are the open day and are not written.

The wallet does not expose a partial current day, so the job stops at the last
closed Johannesburg midnight.

## Loading

Production ingestion is the existing ingest consumer
(`investments-ingest-consumer`). Its daily cron at 07:00 UTC (09:00 SAST)
already has `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`. The ISMRT pull reuses
those. The only new secrets are the ISMRT login. It calls the same
service-role `ingest_consumption_batch` RPC, with a 45-day overlap. Source ids
are a stable natural key
(`ismrt:ledger:{utility}:{entry_type}:{posted_at}:{direction}:{amount}:{occurrence}`),
not the probe row index.

```bash
cd apps/ingest-cloudflare
yarn wrangler secret put ISMRT_USERNAME -c wrangler.consumer.toml
yarn wrangler secret put ISMRT_PASSWORD -c wrangler.consumer.toml
yarn deploy:consumer
```

The Supabase project currently reports six pre-existing `dw.int_*` tables with
RLS disabled and no policies. Do not silently enable RLS there: existing
readers would be blocked. Remediate those tables separately with explicit
policies.
