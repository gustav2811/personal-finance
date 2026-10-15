# Household

Private household app for energy, utility wallet movement, financial analysis,
budget planning, transaction review, devices, and source freshness.

Start UI work with [DESIGN.md](DESIGN.md), then the
[pattern contracts](components/patterns/README.md). Engineering boundaries live in
[ARCHITECTURE.md](ARCHITECTURE.md). The portable design-panel previews are generated
in `.impeccable/design.json`; the executable fixture reference is `/dev/ui`.

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
2. Edit Description or Notes. Changes save automatically after a short pause.
3. Click Next or Close immediately after typing: the pending edit saves first.
   On failure the editor stays open with your draft and a Retry button.
4. Opening a transaction clears its unseen dot. Seen state is remembered in this
   browser, separately from review confirmation. The review queue is available
   under **Filters → Show → Needs review**. Explicit Save or Mark reviewed advances
   to the next queued transaction; background autosave keeps the current editor open.
5. Navigation and save feedback stay visible. Transaction details, classification
   history, and budgeting controls are available in collapsed sections.
6. Reload the page to reset the sample data.

Run `yarn test:transactions` for fixture concurrency/filter/production-guard
checks, and `yarn types` for the dashboard type check. Database access and atomic
save tests run in the disposable database with `./tools/budget-db-tests/run.sh`
from the repository root. Apply the transaction review migration before deploying
the dashboard changes to a real environment.

## UI reference

In development demo mode, open `/dev/ui` for reusable household compositions,
tokens, controls, chart states, and utility fixtures. It is unavailable in
production. Start new UI work with [the pattern index](components/patterns/README.md)
and [the extraction review](../../docs/design/household-ui-system.md).
