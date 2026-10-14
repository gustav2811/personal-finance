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

Production uses the Supabase project and requires a Google session. There is
no service-role data bridge. Normal `yarn dev` does not need the repo `.env`;
the finance-data URL and publishable key are the defaults.

For a login-free transaction review loop, run the development-only fixture mode:

```bash
DASHBOARD_DEMO_MODE=true yarn dev
```

This bypasses the auth gate only while `next dev` is running and routes the
local demo to the transactions screen with small, in-memory fixtures. Category,
treatment, description, and notes changes reset when the browser page reloads.
The switch is fail-closed in production builds and never uses a Supabase
service key.

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

### Verify transaction review locally

Open [the local transactions page](http://localhost:3000/transactions).
The yellow sample-data banner confirms demo mode. Unsupported dashboard pages
redirect here; category suggestions also use fixtures, with no live services.

1. Open Takealot, type `gifts`, and click Gifts with the mouse. It stays selected.
2. Edit Description and enter multiline Notes. Choose **Save & mark reviewed**.
3. Close and reopen it: category, description, and notes remain saved.
4. Opening a transaction clears its unseen dot. Seen state is remembered in this
   browser, separately from review confirmation. The review queue is available
   under **Filters → Show → Needs review**; saved reviews leave that queue.
5. Verify keyboard selection with Arrow Down and Enter. Unsaved changes prompt
   before closing or moving to another transaction.
6. Reload the page to reset the sample data.

Run `yarn test:transactions` for fixture concurrency/filter/production-guard
checks, and `yarn types` for the dashboard type check. Database access and atomic
save tests run in the disposable database with `./tools/budget-db-tests/run.sh`
from the repository root. Apply the transaction review migration before deploying
the dashboard changes to a real environment.
