# Household security boundary

Shared plan and acceptance criteria for the security-boundary change.
Local and production both use the `finance-data` Supabase project
(`irykogsfzzoexmnnthgc`). There is no Vercel preview and no second database.

## Model

```text
Google identity
  -> Supabase authenticated user
  -> household_members.auth_user_id
  -> household_id
  -> household rows
```

Email is bootstrap only. After a row is bound, authorization uses
`auth_user_id`. `hd=klingbiel.org` is a Google account-chooser hint, not an
authorization rule. Membership is the allowlist: Gustav and Cara, one household.

## In scope

- Cookie sessions via `@supabase/ssr`, PKCE, `/auth/callback`, and Next.js
  `proxy.ts`. Server `getClaims()` rejects unauthenticated app routes before
  render. The `(app)` layout checks `finance_caller_membership_v1`.
- Delete the local auth skip and the service-role routes
  `/api/dashboard` and `/api/transactions`.
- One migration, applied to production through the Supabase MCP:
  - Bind `auth_user_id` on first verified Google login. Do not write inside
    `is_household_member`.
  - Email matches only an unbound row, and only for a verified Google identity.
  - Remove the `service_role` shortcut in `resolve_caller_household`.
  - `accounts`, `transactions`, and `snapshots` policies use
    `finance.is_household_member(household_id)`.
  - `consumption.is_dashboard_user()` stops hardcoding emails. Consumption has
    no `household_id`; any member still sees all of it.
  - Revoke `finance` table grants from `anon`, `authenticated`, and
    `service_role`. Revoke schema usage from `anon` and `service_role`.
  - `authenticated` keeps `USAGE` on `finance` and `EXECUTE` on
    `is_household_member`, because RLS policies call that function.
  - `supabase_auth_admin` may receive `USAGE` plus execute on the bind trigger
    function only, if the trigger can be created.
  - Revoke `anon` grants, and `authenticated` writes, on public finance and
    ingest tables. Keep `authenticated` `SELECT` on `accounts`, `transactions`,
    and `snapshots`.
  - Keep `service_role` grants on `public` and `consumption`. Ingest writes the
    DLQ directly, and `ingest_consumption_batch` is not `SECURITY DEFINER`.
  - Revoke execute on `get_local_dashboard_data` and on the user-facing finance
    RPCs from `service_role`.
- Rolled-back isolation proof. Do not leave a second household in production.
- Remove the categoriser `fetch` handler and deploy that worker. Do not rename
  `SUPABASE_SERVICE_KEY`. Do not touch the ingest webhook.
- Production Vercel must not have `SUPABASE_SERVICE_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, or `FINWISE_API_KEY`.
- Enforcing `nosniff`, `frame-ancestors 'none'`, referrer policy, and a locked
  Permissions-Policy. CSP is Report-Only. HSTS is in `vercel.json` only.

## Out of scope

- Google Cloud OAuth client, Supabase Google provider, and redirect allowlist.
  Those stay with Gustav after the PR exists.
- Preview environments, a staging database, Vercel Authentication.
- Renaming the Cloudflare secret or rotating to `sb_secret_`.
- Remodelling consumption onto `household_id`.
- Applying `20260926030000_finance_review_semantics.sql`.
- Enforcing the full CSP.
- Dropping the unbound-email fallback. `auth.users` is empty, so that fallback
  is required until both people sign in.

## Acceptance criteria

1. Unauthenticated requests to `/`, `/transactions`, `/money`, `/energy`,
   `/sources`, and `/dev/ui` redirect to `/login` in `proxy.ts` before the app
   shell renders.
2. The dashboard package does not reference `SUPABASE_SERVICE_KEY` or
   `SUPABASE_SERVICE_ROLE_KEY`. `/api/dashboard` and `/api/transactions` are gone.
3. Sign-in uses PKCE, `redirectTo` ends in `/auth/callback`, and sends
   `hd=klingbiel.org` only as `queryParams`.
4. Server protection uses `getClaims()`, not `getSession()`.
5. `finance_caller_membership_v1` exists in production, is granted only to
   `authenticated`, binds, then returns membership.
6. `is_household_member` does not write. A bound row ignores email. An unbound
   row matches only a verified Google email.
7. `resolve_caller_household` has no `service_role` branch.
8. `anon` has no table grants on `accounts`, `transactions`, `snapshots`,
   `dlq_ingest_jobs`, or `processed_transactions`.
9. `authenticated` cannot insert, update, or delete those tables.
   `service_role` still can, so ingest keeps working.
10. `service_role` has no grants on `finance` tables and no usage on schema
    `finance`. User-facing finance RPCs are not executable by `service_role`.
    Source sync RPCs remain executable by `service_role` only.
11. The isolation script proves Gustav and Cara see household A and not B, an
    outsider sees B and not A, and anon sees neither. After it rolls back,
    production still has one household and both member rows unbound.
12. The categoriser worker exports `scheduled` and does not export `fetch`.
13. Production Vercel env names do not include a Supabase secret or FinWise key.
14. Local data does not load until the Google redirect checklist is done. That
    is expected.
