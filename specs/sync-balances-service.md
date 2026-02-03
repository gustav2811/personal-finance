# Balance Sync Service

## Overview

The **Balance Sync Service** (`syncBalances.ts`) is responsible for synchronizing daily account balance snapshots from 22seven to the Supabase `snapshots` table. This service captures the historical balance data for all tracked accounts, enabling trend analysis and reporting over time.

## Purpose

- Maintain a historical record of daily account balances
- Support time-series analysis and balance trending
- Enable portfolio performance tracking
- Provide data for net worth calculations

## Service Flow

The service follows a 6-step ETL process:

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
│ 3. Fetch Existing│
│    Snapshot Keys │
└────────┬─────────┘
         │
┌────────▼─────────┐
│ 4. Fetch All     │
│    Snapshots API │
└────────┬─────────┘
         │
┌────────▼─────────┐
│ 5. Transform &   │
│    Filter New    │
└────────┬─────────┘
         │
┌────────▼─────────┐
│ 6. Batch Insert  │
│    to Database   │
└──────────────────┘
```

## Implementation Details

### Step 1: Authentication

```typescript
const tokens = await loginTwentyTwoSeven(cfg);
```

**Action**: Authenticates with 22seven API using username/password credentials.

**Returns**: Session tokens required for subsequent API calls:
- `customerId`: Customer identifier
- `sessionToken`: Authentication token
- `requestToken`: Request verification token

**Error Handling**: Throws if credentials are invalid or API is unavailable.

---

### Step 2: Fetch Account Map

```typescript
const accountMap = await getAccountMap(supabase);
```

**Action**: Retrieves the mapping between 22seven account IDs and internal UUIDs from the `accounts` table.

**Returns**: `Map<string, string>` where:
- Key: 22seven `source_account_id`
- Value: Internal `account_id` (UUID)

**Purpose**: This mapping is essential for translating external IDs to internal references.

**Query**:
```sql
SELECT account_id, source_account_id FROM accounts;
```

---

### Step 3: Fetch Existing Snapshot Keys

```typescript
const existingKeys = await getExistingSnapshotKeys(supabase);
```

**Action**: Loads all existing snapshot keys from the database to enable deduplication.

**Returns**: `Set<string>` of composite keys in format: `{account_id}-{date}`

**Purpose**: Prevents duplicate snapshot inserts by checking if a snapshot already exists for a given account and date.

**Query**:
```sql
SELECT account_id, date FROM snapshots;
```

**Optimization**: Uses a Set for O(1) lookup performance during filtering.

---

### Step 4: Fetch Snapshots from 22seven

```typescript
const allSnapshots = await fetchAllSnapshots(tokens);
```

**Action**: Calls the 22seven API to retrieve all current account balance snapshots.

**API Endpoint**: `GET https://api.22seven.com/customer/{customerId}/accounts-balances`

**Response Format**:
```typescript
{
  accountId: string;
  date: number;        // Unix timestamp
  amount: {
    amount: number;    // Decimal amount (e.g., 1234.56)
    currencyCode: string;
  };
}
```

---

### Step 5: Transform & Filter

```typescript
const toInsert: NewSnapshotRow[] = [];
for (const snapshot of allSnapshots) {
  const internalAccountId = accountMap.get(snapshot.accountId);
  if (!internalAccountId) continue; // Skip unknown accounts
  
  const date = normalizeTimestampToDateString(snapshot.date);
  const key = `${internalAccountId}-${date}`;
  if (existingKeys.has(key)) continue; // Skip duplicates
  
  const amount_cents = Math.round(snapshot.amount.amount * 100);
  toInsert.push({
    account_id: internalAccountId,
    date,
    amount_cents,
    currency_code: snapshot.amount.currencyCode,
  });
}
```

**Transformations**:
1. **ID Mapping**: Convert 22seven `accountId` to internal `account_id`
2. **Date Normalization**: Convert Unix timestamp to ISO date string (YYYY-MM-DD)
3. **Currency Conversion**: Convert decimal amount to cents (integer)
4. **Deduplication**: Skip snapshots that already exist in the database

**Filtering Logic**:
- Snapshots for unmapped accounts are silently skipped
- Existing snapshots (based on account + date) are skipped

---

### Step 6: Batch Insert

```typescript
const BATCH_SIZE = 500;
const chunks = chunk(toInsert, BATCH_SIZE);
for (const part of chunks) {
  await insertSnapshots(supabase, part);
}
```

**Action**: Inserts new snapshots in batches to avoid API limits and improve performance.

**Batch Size**: 500 rows per insert

**Insert Strategy**: Upsert with conflict handling
```typescript
.upsert(rows, {
  onConflict: 'account_id, date',
  ignoreDuplicates: true
})
```

**Why Batching?**: 
- Prevents timeout on large datasets
- Reduces memory footprint
- Improves database performance
- Provides granular progress logging

## Data Model

### Input (22seven API)

```typescript
interface TwentyTwoSevenSnapshot {
  accountId: string;
  date: number;
  amount: {
    amount: number;
    currencyCode: string;
  };
}
```

### Output (Supabase)

```typescript
interface NewSnapshotRow {
  account_id: string;    // UUID
  date: string;          // YYYY-MM-DD
  amount_cents: number;  // Integer
  currency_code: string; // e.g., "ZAR"
}
```

## Error Handling

### Supabase Errors

All database errors are caught and wrapped with context:

```typescript
throw new Error(`Supabase error (snapshots): ${error.message}`);
```

### Unknown Accounts

Snapshots for accounts not in the `accounts` table are silently skipped. This is expected behavior when 22seven includes accounts the user hasn't configured for tracking.

### API Failures

22seven API errors will propagate and fail the entire sync. This ensures data integrity by preventing partial syncs.

## Logging

The service uses structured JSON logging:

```json
{"level":"info","message":"Step 1/6: Authenticating with 22seven..."}
{"level":"info","message":"-> Login successful."}
{"level":"info","message":"-> Accounts loaded.","count":5}
{"level":"info","message":"Inserting batch","batch_index":1,"size":500}
{"level":"info","message":"New snapshots successfully added to Supabase.","inserted":1247}
```

## Performance Considerations

### Optimization Strategies

1. **Parallel Queries**: Account map and existing keys are fetched sequentially but could be parallelized
2. **Set-Based Deduplication**: O(1) lookup for existing snapshots
3. **Batch Inserts**: Reduces round-trips to database
4. **Memory Efficiency**: Streaming could be added for very large datasets

### Typical Performance

- **Accounts**: ~5-20 accounts (sub-second)
- **API Fetch**: 1-3 seconds
- **Transform**: < 1 second for 10k snapshots
- **Insert**: ~2 seconds per 500 rows
- **Total Runtime**: 5-15 seconds for typical workload

## Scheduling

### GitHub Actions

The service runs daily at **06:11 UTC** via GitHub Actions:

```yaml
on:
  schedule:
    - cron: "11 6 * * *"
```

**Random Jitter**: A random sleep (0-600 seconds) is added before execution to avoid rate limiting.

### Manual Execution

Can be triggered manually via:
- GitHub Actions UI (workflow_dispatch)
- Local command: `yarn tsx apps/src/functions/syncBalances.ts`

## Monitoring & Alerts

### Success Indicators

- Log message: `"--- COMPLETE ---"`
- Exit code: 0
- Logged count of inserted snapshots

### Failure Indicators

- Log level: `"error"`
- Non-zero exit code
- GitHub Actions job failure notification

## Future Enhancements

- [ ] Add retry logic for transient API failures
- [ ] Implement incremental syncs (date range filtering)
- [ ] Add alerting for missing expected snapshots
- [ ] Support multiple source platforms beyond 22seven
- [ ] Add data validation (negative balance checks, etc.)
- [ ] Implement soft deletes for removed accounts
