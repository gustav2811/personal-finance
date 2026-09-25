#!/usr/bin/env python3
"""Export ISMRT daily electricity rows to CSV (date, consumption, rate, charge)."""

from __future__ import annotations

import argparse
import csv
from datetime import datetime
from pathlib import Path

from ismrt_client import IsmrtClient, IsmrtCredentials, IsmrtError, default_date_range

REPO_ROOT = Path(__file__).resolve().parents[2]
OUT_DEFAULT = (
    REPO_ROOT
    / "data"
    / "consumption"
    / "ismrt"
    / "ismrt_electricity_daily.csv"
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=120)
    parser.add_argument("--utility", default="Electricity")
    parser.add_argument("--wallet-id", default="")
    parser.add_argument("--out", type=Path, default=OUT_DEFAULT)
    args = parser.parse_args()

    client = IsmrtClient(IsmrtCredentials.from_env())
    client.authenticate()
    wallets = client.list_wallets()
    if not wallets:
        raise IsmrtError("No wallets returned.")
    wallet_id = args.wallet_id or str(wallets[0]["id"])
    start, end = default_date_range(args.days)
    rows = client.wallet_utility_transactions(wallet_id, args.utility, start, end)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(
            fh,
            fieldnames=[
                "date",
                "consumption",
                "rate",
                "charge",
                "debit",
                "credit",
                "meterSerial",
            ],
        )
        writer.writeheader()
        for row in sorted(rows, key=lambda r: str(r.get("date", ""))):
            writer.writerow(
                {
                    "date": row.get("date"),
                    "consumption": row.get("consumption"),
                    "rate": row.get("rate"),
                    "charge": row.get("charge"),
                    "debit": row.get("debit"),
                    "credit": row.get("credit"),
                    "meterSerial": row.get("meterSerial"),
                }
            )

    print(f"Wrote {len(rows)} rows to {args.out}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except IsmrtError as exc:
        print(f"ERROR: {exc}")
        raise SystemExit(1)
