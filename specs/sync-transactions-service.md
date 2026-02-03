# Transaction Sync Service

## Overview

The **Transaction Sync Service** (`syncTransactions.ts`) synchronizes all financial transactions from 22seven to the Supabase `transactions` table. This service combines data from multiple 22seven endpoints (hot and cold storage) and maintains a complete, deduplicated transaction history.

## Purpose

- Maintain a complete record of all financial transactions
- Support transaction categorization and analysis
- Enable spend tracking and budgeting features
- Provide audit trail for financial activity

## Service Flow

The service follows a 5-step ETL process:

```
┌──────────────────┐
│ 1. Authenticate  │
│    with 22seven  │
└────────┬─────────┘
         │
┌────────▼─────────┐
│ 2. Fetch Account │
│    Mapping (DB)  │
└────────┬─────────┘
         │
┌────────▼─────────┐
│ 3. Fetch All     │
│    Transactions  │
│  (Hot + Cold)    │
└────────┬─────────┘
         │
┌────────▼─────────┐
│ 4. Transform &   │
│    Filter Data   │
└────────┬─────────┘
         │
┌────────▼─────────┐
│ 5. Batch Upsert  │
│    to Database   │
└──────────────────┘
```

## Key Differences from Balance Sync

Unlike the balance sync service, the transaction sync:
- **Does NOT pre-fetch existing IDs** - relies on database upsert conflict resolution
- **Fetches from two API endpoints** - combines hot and cold transaction data
- **Uses full upsert strategy** - updates existing transactions if they've changed
- **Stores raw JSON** - preserves complete 22seven transaction object in `details` column

## Implementation Details

### Step 1: Authentication

```typescript
const tokens = await loginTwentyTwoSeven(cfg);
```

**Action**: Authenticates with 22seven API using username/password credentials.

**Returns**: Session tokens (customerId, sessionToken, requestToken)

**Same as balance sync** - reuses the same authentication flow.

---

### Step 2: Fetch Account Map

```typescript
const accountMap = await getAccountMap(supabase);
```

**Action**: Retrieves the mapping between 22seven account IDs and internal UUIDs.

**Returns**: `Map<string, string>` (22seven ID → internal UUID)

**Same as balance sync** - reuses the same account mapping logic.

---

### Step 3: Fetch All Transactions (Hot + Cold)

```typescript
const allTransactions = await fetchAllTransactions(tokens);
```

**Action**: Fetches transactions from both 22seven endpoints and deduplicates.

#### 22seven Transaction Storage

22seven uses a two-tier storage system:

- **Hot Storage** ("aggregate"): Recent transactions (typically last 90 days)
- **Cold Storage** ("archived"): Historical transactions (older data)

#### API Endpoints

1. **Hot/Aggregate**: `GET https://api.22seven.com/customer/{customerId}/aggregate`
   - Returns: `{ transactions: [...] }`
   - Contains recent, frequently accessed data

2. **Cold/Archived**: `GET https://api.22seven.com/customer/{customerId}/transactions/archived`
   - Returns: `[...]` (array directly)
   - Contains historical transaction archive

#### Deduplication Strategy

```typescript
const allTransactionsMap = new Map<string, TwentyTwoSevenTransaction>();

// Add cold transactions first
for (const tx of coldTransactions) {
  allTransactionsMap.set(tx.id, tx);
}

// Add hot transactions (overwrites cold if duplicate)
for (const tx of hotTransactions) {
  allTransactionsMap.set(tx.id, tx);
}
```

**Why this order?**
- Hot data is more recent and may contain updates to transactions
- By adding hot data second, we ensure the most up-to-date version is kept
- Transaction IDs are unique and stable across both endpoints

**Performance**: Both API calls are made in parallel using `Promise.all()`.

---

### Step 4: Transform & Filter

```typescript
const toSync: NewTransactionRow[] = [];
const unknownAccountIds = new Set<string>();

for (const tx of allTransactions) {
  const internalAccountId = accountMap.get(tx.accountId);
  
  if (!internalAccountId) {
    if (!unknownAccountIds.has(tx.accountId)) {
      logInfo("Found transactions for unknown account. Skipping.", {
        unknownAccountId: tx.accountId,
        transactionDescription: tx.description,
      });
      unknownAccountIds.add(tx.accountId);
    }
    continue;
  }
  
  toSync.push({
    id: tx.id,
    account_id: internalAccountId,
    date: new Date(tx.transactionDate).toISOString(),
    details: tx,
  });
}
```

**Transformations**:
1. **ID Mapping**: Convert 22seven `accountId` to internal `account_id`
2. **Date Conversion**: Convert transaction date to ISO 8601 timestamp
3. **Preserve Raw Data**: Store complete 22seven object in `details` (JSONB)

**Filtering Logic**:
- Transactions for unmapped accounts are skipped
- Each unknown account is logged once per run (not per transaction)
- All other transactions are included (upsert handles duplicates)

**No Pre-Filtering**: Unlike balance sync, we don't check for existing transactions. The database upsert handles duplicates efficiently.

---

### Step 5: Batch Upsert

```typescript
const BATCH_SIZE = 500;
const batches = chunk(toSync, BATCH_SIZE);

for (const [index, batch] of batches.entries()) {
  await insertTransactions(supabase, batch);
}
```

**Action**: Upserts transactions in batches of 500.

**Upsert Strategy**:
```typescript
.upsert(transactions, { onConflict: 'id' })
```

**Behavior**:
- **New transactions**: Inserted
- **Existing transactions**: Updated with new data
- **Conflict key**: Transaction `id` (22seven's unique identifier)

**Why Upsert Instead of Insert?**
- Transactions can be updated by 22seven (e.g., pending → cleared)
- Handles re-runs gracefully without errors
- Ensures data is always up-to-date
- Simpler than checking existing IDs first

## Data Model

### Input (22seven API)

```typescript
interface TwentyTwoSevenTransaction {
  id: string;                    // Unique transaction ID
  accountId: string;             // 22seven account ID
  transactionDate: string;       // ISO date string
  description: string;           // Merchant/description
  amount: {
    amount: number;              // Transaction amount
    currencyCode: string;        // Currency (e.g., "ZAR")
  };
  category?: {
    id: string;
    name: string;
  };
  tags?: string[];
  // ... other 22seven fields
}
```

### Output (Supabase)

```typescript
interface NewTransactionRow {
  id: string;                    // 22seven transaction ID (PK)
  account_id: string;            // Internal account UUID (FK)
  date: string;                  // ISO timestamp
  details: TwentyTwoSevenTransaction; // Complete JSON object
}
```

## Storage Strategy: JSONB Details Column

The service stores the **complete 22seven transaction object** in the `details` JSONB column.

### Benefits

1. **Flexibility**: Access any 22seven field without schema changes
2. **Future-Proof**: New 22seven fields automatically captured
3. **Audit Trail**: Preserve original data exactly as received
4. **Queryability**: PostgreSQL JSONB supports efficient querying

### Example Queries

```sql
-- Query by category
SELECT * FROM transactions 
WHERE details->>'category'->>'name' = 'Groceries';

-- Query by amount range
SELECT * FROM transactions 
WHERE (details->'amount'->>'amount')::numeric > 100;

-- Extract specific fields
SELECT 
  id,
  details->>'description' as merchant,
  (details->'amount'->>'amount')::numeric as amount
FROM transactions;
```

## Error Handling

### Supabase Errors

```typescript
throw new Error(`Supabase insert error (transactions): ${error.message}`);
```

Database errors fail the entire sync to maintain data integrity.

### Unknown Accounts

Unknown accounts are logged but don't fail the sync:

```json
{
  "level": "info",
  "message": "Found transactions for unknown account. Skipping.",
  "unknownAccountId": "22seven-account-123",
  "transactionDescription": "Coffee Shop"
}
```

**Deduplication**: Each unknown account is logged only once per run.

### API Failures

If either hot or cold endpoint fails, the entire sync fails. This prevents incomplete data from being stored.

## Logging

Structured JSON logging with transaction counts:

```json
{"level":"info","message":"--- Starting Transaction Sync ---"}
{"level":"info","message":"Step 1/6: Authenticating with 22seven..."}
{"level":"info","message":"-> Login successful."}
{"level":"info","message":"-> Accounts loaded.","count":5}
{"level":"info","message":"-> All transactions fetched.","count":15234}
{"level":"info","message":"-> Syncing batch 1/31","size":500}
{"level":"info","message":"--- Transaction Sync COMPLETE ---"}
{"level":"info","message":"Transactions successfully synced.","synced":15234}
```

## Performance Considerations

### API Performance

- **Parallel Fetch**: Hot and cold endpoints called simultaneously
- **Network Time**: ~2-5 seconds for both endpoints
- **Deduplication**: O(n) using Map, typically < 1 second

### Database Performance

- **Batch Size**: 500 transactions per upsert
- **Upsert Speed**: ~1-2 seconds per batch
- **Total Time**: 30-60 seconds for 15,000 transactions

### Memory Usage

- **In-Memory Storage**: All transactions loaded before insert
- **Typical Dataset**: 10-20K transactions = ~5-10 MB
- **Not a concern**: For personal finance use case

### Optimization Opportunities

1. **Streaming**: Process in chunks without loading all data
2. **Incremental Sync**: Add `since` parameter to fetch only recent transactions
3. **Parallel Inserts**: Batch inserts could be parallelized

## Scheduling

### GitHub Actions

Runs daily at **06:11 UTC** with random jitter:

```yaml
sync-transactions:
  runs-on: ubuntu-latest
  timeout-minutes: 15  # Prevents hanging
```

**Timeout**: 15 minutes to prevent runaway jobs.

### Manual Execution

```bash
# Local run
yarn tsx apps/src/functions/syncTransactions.ts

# GitHub Actions
# Navigate to Actions → Daily fetch → Run workflow
```

## Idempotency

The service is **fully idempotent** - safe to run multiple times:

- ✅ Running twice does not create duplicates
- ✅ Updates are applied correctly on re-run
- ✅ No data loss if interrupted and restarted
- ✅ Can safely re-process historical data

This is achieved through:
1. Upsert with `id` conflict resolution
2. 22seven IDs are stable and unique
3. No incremental state tracking required

## Common Scenarios

### Scenario 1: First Run

- All transactions are new
- Bulk insert of entire history
- May take 1-2 minutes for large accounts

### Scenario 2: Daily Sync

- Mostly no-ops (upserts existing data)
- ~50-100 new transactions per day
- Completes in 5-10 seconds

### Scenario 3: Transaction Updates

- 22seven changes a pending transaction
- Upsert updates the existing record
- No duplicate created

### Scenario 4: New Account Added

- Transactions for unknown account are logged and skipped
- Admin adds account to `accounts` table
- Next run processes those transactions

## Monitoring & Alerts

### Success Indicators

- Log: `"--- Transaction Sync COMPLETE ---"`
- Count of synced transactions logged
- Exit code: 0

### Warning Indicators

- Unknown account logs (action may be needed)
- Zero transactions synced (investigate if unexpected)

### Failure Indicators

- Error-level logs
- Non-zero exit code
- GitHub Actions job failure

## Future Enhancements

- [ ] Incremental sync with date filtering
- [ ] Separate staging table for validation
- [ ] Data quality checks (duplicate detection, anomaly detection)
- [ ] Webhooks for real-time transaction updates
- [ ] Support for multiple financial platforms
- [ ] Transaction matching and reconciliation
- [ ] Category learning and auto-categorization
