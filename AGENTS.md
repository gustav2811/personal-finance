# Agent map

Read this, then the one module for the job. Do not explore the rest of the repo.

Supabase is the backend. Do not merge the dashboard and the Workers into one app. Do not fold the ingest webhook into the classifier.

## Jobs

| Job | Open | Leave closed |
| --- | --- | --- |
| Bank email ingest | `apps/ingest-cloudflare/src/ingest.ts`, then `libs/ingest-core` | classifier, dashboard |
| Queue consumer, FinWise post, ISMRT cron | `apps/ingest-cloudflare/src/consumer.ts` | `src/ingest.ts` |
| ISMRT date mapping | `apps/ingest-cloudflare/src/ismrt/map.ts` | dashboard charts |
| Classifier | `apps/categorise-cloudflare/src/run.ts`, then `libs/categoriser` | ingest webhook, `libs/ingest-core` |
| Dashboard | `apps/dashboard` app routes and `domain/` | Workers, `components/ui`, generated types |
| Schema | `supabase/migrations` for the change, `CONTEXT.md` for names | `database.types.ts` |

## Seams that stay

- The ingest HTTP Worker and the queue consumer stay split.
- The dashboard stays a member client. It never receives a service key.
- The classifier stays `CLASSIFIER_MODE = "shadow"`. It is not the ingest path.
- ISMRT electricity, water, and wallet run on the ingest consumer cron and reuse that Worker's Supabase service key. Do not add a second consumption Worker.

## Do not read

- `data/`
- `reports/`
- `apps/dashboard/components/ui`
- `apps/dashboard/lib/supabase/database.types.ts`
- `tools/categorise-eval/` unless the job is an evaluation
- `specs/` unless the job is changing the finance model

Names live in `CONTEXT.md`.
