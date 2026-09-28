# Household

Private household dashboard for energy, utility wallet movement, devices,
and source freshness. The UI is the shadcn design system documented in
`DESIGN.md`.

## Local development

From `apps/dashboard` (this app is not a yarn workspace):

```bash
yarn install
yarn dev
```

Local and production use the same Supabase project. Both require a Google
session. There is no service-role data bridge. `yarn dev` does not need the
repo `.env`. The finance-data URL and publishable key are the defaults.

Do not put a Supabase secret or a FinWise key on the dashboard host.

## Sign-in

Google is the only provider. `hd=klingbiel.org` is an account-chooser hint.
Membership in `finance.household_members` is the allowlist. The server rejects
unauthenticated requests before rendering, and Postgres RLS is the data boundary.

After the OAuth client exists, allow these redirect URLs:

```text
https://irykogsfzzoexmnnthgc.supabase.co/auth/v1/callback
http://localhost:3000/auth/callback
https://household.klingbiel.org/auth/callback
```

The Google client redirect is the Supabase callback. The app callback is
`/auth/callback` on localhost and production.
