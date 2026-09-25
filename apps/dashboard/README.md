# Common Orbit

Private, read-only household dashboard for energy, utility wallet movement,
devices, and source freshness.

## Local development

From the repository root:

```bash
yarn install
set -a; source .env; set +a
yarn workspace @investments/dashboard dev
```

Local development intentionally skips the login screen and reads through a
server-only data bridge. The bridge uses `SUPABASE_SERVICE_KEY` on the server;
it is never sent to browser code. Production builds keep Google-only
authentication and the RLS allowlist.

Required local variables:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

## Supabase setup

1. Apply the consumption migrations, including
   `20260824170000_add_consumption_dashboard_read_policy.sql`.
2. Add `consumption` to the project's exposed schemas in Supabase API settings.
3. Enable Google as an Auth provider.
4. Add the local and deployed dashboard URLs to Auth redirect URLs.
5. Keep the service key server-side only for ingestion runners.

The database policy is the real allowlist for dashboard data:
`gustav@klingbiel.org` and `cara@klingbiel.org`. The client-side check only
controls the experience after Google returns.

For Google Cloud OAuth, add this exact authorized redirect URI to the Web
client configured in Supabase:

```text
https://irykogsfzzoexmnnthgc.supabase.co/auth/v1/callback
```

The app's `redirectTo` value is the local or Vercel site URL. It is the
post-login destination, not the Google provider callback.

