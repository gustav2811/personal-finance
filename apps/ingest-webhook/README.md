# Ingest Webhook

SendGrid Inbound Parse webhook that accepts bank statement emails, extracts XLSX attachments, parses them with pluggable bank parsers, and posts transactions to Finwise.

## Setup

1. **Environment variables** (see [Configuration](#configuration)).
2. **Supabase**: Run the SQL migration to create `dlq_ingest_jobs` and `processed_transactions`:

   ```bash
   psql $DATABASE_URL -f sql/001_dlq_and_processed.sql
   ```

   Or run the statements in the Supabase SQL editor.

3. **Redis**: Required for the job queue (e.g. Railway Redis add-on).

## Configuration

| Variable                | Required | Description                                                                                                                       |
| ----------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `INGEST_TOKEN`          | Yes      | Secret for webhook auth (query `token` or `Authorization: Bearer`)                                                                |
| `FINWISE_API_KEY`       | Yes      | Finwise API key                                                                                                                   |
| `FINWISE_BASE_URL`      | No       | Default `https://api.finwiseapp.io`                                                                                               |
| `REDIS_URL`             | Yes      | Redis connection URL                                                                                                              |
| `SUPABASE_URL`          | Yes      | Supabase project URL                                                                                                              |
| `SUPABASE_SERVICE_KEY`  | Yes      | Supabase service role key (or `SUPABASE_SERVICE_KEY`)                                                                             |
| `BANK_ZERO_ACCOUNT_ID`  | Yes\*    | Default Finwise account for Bank Zero                                                                                             |
| `BANK_ZERO_ACCOUNT_MAP` | No       | JSON array `[{ "pattern": "substring", "accountId": "..." }]` to map filename to account (first match wins; use `""` for default) |
| `PORT`                  | No       | Default `3000`                                                                                                                    |
| `NODE_ENV`              | No       | `development` \| `production`                                                                                                     |

## Run locally

From repo root (so `@investments/finwise` resolves):

```bash
cd apps/ingest-webhook
yarn install
yarn dev
```

In another terminal, run the worker:

```bash
cd apps/ingest-webhook
yarn worker
```

Health: `GET http://localhost:3000/` → `{ "status": "ok" }`.

## SendGrid Inbound Parse

1. **MX record**: Point `parse.klingbiel.org` (or your subdomain) to `mx.sendgrid.net` (priority 10).
2. **Inbound Parse**: In SendGrid → Settings → Inbound Parse, add:
   - **Receiving domain**: `parse.klingbiel.org`
   - **Destination URL**: `https://<your-host>/webhook/sendgrid?token=<INGEST_TOKEN>`
   - Optionally enable “POST the raw, full MIME message” if you want to store raw emails.

Send test emails to e.g. `statements@parse.klingbiel.org`.

## Railway deployment

1. Create a new Railway project and link the repo.
2. Set **Root Directory** to `apps/ingest-webhook` (or configure build to use this path).
3. Add **Redis** plugin; Railway will set `REDIS_URL`.
4. Set all required environment variables in the Railway dashboard.
5. **Start command**: `yarn start` (or `node --import tsx src/server.ts`).
6. **Worker**: Add a second service in the same project, same root directory, start command: `yarn worker`.
7. **Health check**: Railway can use `GET /` as the health check path.

## Tests

From `apps/ingest-webhook`:

```bash
yarn test
```

Requires `yarn install` to be run first (vitest, xlsx, etc.).

\* Either `BANK_ZERO_ACCOUNT_ID` or at least one entry in `BANK_ZERO_ACCOUNT_MAP` (e.g. `{"pattern":"","accountId":"..."}` for default) is required.

### Bank Zero statement format

- The XLSX has two sheets (e.g. "Feb 26 Summary" and "Feb 26 Transactions"). The parser uses the sheet whose name **includes "Transactions"** and ignores Summary.
- Columns: Date, Day, Time, Type, Description 1, Description 2, Fee, Amount, Balance, Has Attachments. Description 1 is used as counterparty; Description 2 (or Description 1 if empty) as the main description. Amount supports space as thousands separator (e.g. `-1 500.00`).
- To map **multiple statements to different Finwise accounts** by filename, set `BANK_ZERO_ACCOUNT_MAP` to a JSON array, e.g. `[{"pattern":"Savings","accountId":"..."},{"pattern":"","accountId":"default-account-id"}]`. First matching pattern (substring in filename, case-insensitive) wins.

## Acceptance checklist

- [ ] MX for `parse.klingbiel.org` → `mx.sendgrid.net`; Inbound Parse URL set in SendGrid.
- [ ] `POST /webhook/sendgrid` returns 200 after enqueuing (auth via `token` or `Bearer`).
- [ ] Worker parses Bank Zero XLSX and posts to Finwise with idempotency.
- [ ] Duplicate email does not create duplicate transactions.
- [ ] Failed jobs land in `dlq_ingest_jobs`; logs show failures.
