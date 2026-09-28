# ISMRT wallet tools

Python client and export scripts for the ISMRT / RMS Connect wallet API.

## Credentials

Set these variables locally. Never commit them:

- `ISMRT_USERNAME`
- `ISMRT_PASSWORD`

The repository root `.env` is ignored. Load it into the shell before running
the tools; the scripts do not print credential values.

## Commands

From the repository root:

```bash
set -a; source .env; set +a
python3 tools/ismrt/probe_ismrt_api.py --days 120
python3 tools/ismrt/export_ismrt_daily.py --days 120
```

Production loads run on the ingest consumer cron
(`apps/ingest-cloudflare`), not `load_to_supabase.py`. That script is
retired: its row indexes are not stable, and it stored the expense close stamp
as the incurred date. The consumer reuses its existing Supabase service key.

The probe collects:

- daily utility transactions;
- all utility expenses;
- wallet fees;
- water charges;
- purchase/deposit credits;
- invoices and proof-of-payment metadata;
- meter profiles.

Private output is written to `data/consumption/ismrt/`, which is ignored by
Git. The downloaded dashboard bundle used for API discovery lives under the
ignored `evidence/` directory.

The scheduled Worker calls the service-role-only `ingest_consumption_batch`
RPC. Bneta plug data is not loaded yet.

The ISMRT device model is one wallet parent with electricity and logical water
billing children. Wallet fees and deposits attach to the parent; electricity
charges attach to the electricity child; water remains a monthly ledger charge,
not a meter reading.

## API notes

- Authentication: Keycloak realm `rms`.
- Production GraphQL: `https://api-gateway.rmsconnect.net/graphql`.
- GraphQL token header: `x-access-token`.
- `walletExpenseTransactions` is the broadest ledger query.
- `walletConsolidatedTransactions` includes `PURCHASE` credits.
- `walletProofOfPayments` confirms deposit records.

The `walletPayments` operation is present in the dashboard bundle but currently
returns `User not found` for this wallet. Do not treat it as the source of
truth until the provider fixes that resolver.
