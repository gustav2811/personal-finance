# Investments - System Overview

## Introduction

The **Investments** project is a personal finance data pipeline that automatically syncs financial data from 22seven (a South African financial aggregation service) to a Supabase database. The system runs on a scheduled basis via GitHub Actions, extracting account balances and transaction data for analysis and reporting.

## Architecture

### High-Level Components

```
┌─────────────┐         ┌──────────────┐         ┌──────────────┐
│   22seven   │ ──────> │  Sync Jobs   │ ──────> │   Supabase   │
│  (Source)   │   API   │  (Pipeline)  │  Write  │  (Database)  │
└─────────────┘         └──────────────┘         └──────────────┘
```

### Technology Stack

- **Runtime**: Node.js 20+ with TypeScript
- **Build Tool**: Nx monorepo
- **Scheduler**: GitHub Actions (daily cron)
- **Source API**: 22seven REST API
- **Database**: Supabase (PostgreSQL)
- **HTTP Client**: Axios

## Core Services

The system consists of two main synchronization services:

1. **Balance Sync** (`syncBalances.ts`) - Syncs account balance snapshots
2. **Transaction Sync** (`syncTransactions.ts`) - Syncs transaction history

Both services follow a similar ETL (Extract, Transform, Load) pattern:
- **Extract**: Authenticate with 22seven and fetch data
- **Transform**: Map 22seven IDs to internal account IDs, deduplicate, format data
- **Load**: Batch insert/upsert data into Supabase

## Database Schema

### Tables

#### `accounts`
Stores account metadata and mapping between 22seven IDs and internal UUIDs.

| Column              | Type   | Description                      |
|---------------------|--------|----------------------------------|
| `account_id`        | uuid   | Internal unique identifier       |
| `source_platform`   | text   | Always "22seven"                 |
| `source_account_id` | text   | 22seven's account ID             |
| `name`              | text   | Account name                     |
| `type`              | text   | Account type                     |

#### `snapshots`
Daily account balance snapshots.

| Column          | Type    | Description                   |
|-----------------|---------|-------------------------------|
| `account_id`    | uuid    | References `accounts`         |
| `date`          | date    | Snapshot date (YYYY-MM-DD)    |
| `amount_cents`  | integer | Balance in cents              |
| `currency_code` | text    | Currency (e.g., "ZAR")        |

**Unique Constraint**: `(account_id, date)`

#### `transactions`
Individual financial transactions.

| Column       | Type   | Description                           |
|--------------|--------|---------------------------------------|
| `id`         | text   | 22seven transaction ID (primary key)  |
| `account_id` | uuid   | References `accounts`                 |
| `date`       | timestamp | Transaction timestamp              |
| `details`    | jsonb  | Full 22seven transaction object       |

## Automation

### GitHub Actions Workflow

**Schedule**: Daily at 06:11 UTC (with random jitter to avoid rate limiting)

**Jobs**:
- `sync-snapshots`: Runs balance sync
- `sync-transactions`: Runs transaction sync (15-minute timeout)

Both jobs run independently and in parallel.

### Required Secrets

- `SUPABASE_URL`: Supabase project URL
- `SUPABASE_SERVICE_KEY`: Supabase service role key
- `MY_22SEVEN_USERNAME`: 22seven login username
- `MY_22SEVEN_PASSWORD`: 22seven login password

## Error Handling

- Structured logging using JSON format
- All Supabase errors are caught and logged with context
- Unknown accounts are logged but don't fail the sync
- Duplicate data is handled via upserts with conflict resolution

## Local Development

### Prerequisites

- Node.js 20+
- Yarn 1.22+
- Access to 22seven account
- Supabase project

### Setup

```bash
# Install dependencies
yarn install

# Configure environment variables
cp .env.example .env
# Edit .env with your credentials

# Run balance sync locally
yarn tsx apps/src/functions/syncBalances.ts

# Run transaction sync locally
yarn tsx apps/src/functions/syncTransactions.ts
```

### Environment Variables

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-key
MY_22SEVEN_USERNAME=your-username
MY_22SEVEN_PASSWORD=your-password
```

## Project Structure

```
apps/src/
├── 22seven/              # 22seven API client
│   ├── 22seven.ts       # API methods
│   ├── headers.ts       # Authentication headers
│   └── types.ts         # TypeScript types
├── functions/           # Main sync scripts
│   ├── syncBalances.ts
│   └── syncTransactions.ts
├── repos/               # Data access layer
│   ├── accounts.ts      # Account queries
│   ├── snapshots.ts     # Snapshot queries
│   └── transactions.ts  # Transaction queries
└── lib/                 # Utilities
    ├── supabase.ts      # Supabase client
    └── utils.ts         # Helper functions
```

## Next Steps

For detailed documentation on specific services:
- [Balance Sync Service](./sync-balances-service.md)
- [Transaction Sync Service](./sync-transactions-service.md)
