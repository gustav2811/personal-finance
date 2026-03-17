# @investments/finwise

TypeScript client for the [FinWise API](https://finwiseapp.io/docs/api).

## Setup

- Use the library via the workspace path alias `@investments/finwise` (see root `tsconfig.json` paths).
- Provide your API key via environment variable; **do not hardcode** secrets.

## Usage

```ts
import { FinWiseClient } from "@investments/finwise";

const finwise = new FinWiseClient({
  apiKey: process.env.FINWISE_API_KEY!,
});

const accounts = await finwise.accounts.list({
  filters: { userId: "your-user-id" },
});
const one = await finwise.accounts.get(accounts[0].id);
```

## API key

Get and manage API keys in the [FinWise Dashboard](https://app.finwiseapp.io/settings/api-keys) under Settings > API Keys. Pass the key via config (e.g. `process.env.FINWISE_API_KEY`).

## Resources

- **accounts** – `list`, `get`, `create`, `update`, `archive`
- **accountBalances** – `list`, `getAggregated`, `create`, `archive`
- **transactions** – `list`, `getAggregated`, `create`, `archive`
- **transactionCategories** – `list`, `create`, `delete`

## Errors

On non-2xx responses the client throws `FinWiseApiError` with `status`, `requestId`, and `body` (typed per FinWise docs).

## Docs

[FinWise API Reference](https://finwiseapp.io/docs/api)
