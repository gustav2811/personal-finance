CREATE TABLE IF NOT EXISTS merchant_stats (
  merchant_key TEXT NOT NULL,
  category_name TEXT NOT NULL,
  support INTEGER NOT NULL,
  last_date TEXT NOT NULL,
  PRIMARY KEY (merchant_key, category_name)
);

CREATE INDEX IF NOT EXISTS idx_merchant_stats_key ON merchant_stats (merchant_key);

CREATE TABLE IF NOT EXISTS corrections (
  fingerprint TEXT PRIMARY KEY,
  category_name TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  detected_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audits (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  feature_hash TEXT NOT NULL,
  observed_category_id TEXT,
  predicted_category_name TEXT,
  source TEXT NOT NULL,
  confidence REAL,
  margin REAL,
  top_probability REAL,
  model TEXT,
  classifier_version TEXT NOT NULL,
  input_tokens INTEGER,
  notional_usd REAL,
  applied INTEGER NOT NULL,
  accept INTEGER NOT NULL,
  mode TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_audits_idem
  ON audits (transaction_id, classifier_version, feature_hash);

CREATE TABLE IF NOT EXISTS writes (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  written_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_writes_tx ON writes (transaction_id);

CREATE TABLE IF NOT EXISTS cursors (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
