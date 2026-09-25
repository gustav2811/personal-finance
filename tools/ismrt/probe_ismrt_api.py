#!/usr/bin/env python3
"""Probe the ISMRT dashboard API and export a redacted catalog + sample data.

Run from the repository root after exporting ISMRT_USERNAME /
ISMRT_PASSWORD:

    python3 tools/ismrt/probe_ismrt_api.py
    python3 tools/ismrt/probe_ismrt_api.py --days 120 --utility Electricity
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path

from ismrt_client import IsmrtClient, IsmrtCredentials, IsmrtError, default_date_range

TOOL_DIR = Path(__file__).resolve().parent
REPO_ROOT = TOOL_DIR.parents[1]
DATA_DIR = REPO_ROOT / "data" / "consumption" / "ismrt"
CATALOG_PATH = TOOL_DIR / "api_catalog.json"
BUNDLE_PATH = TOOL_DIR / "evidence" / "ismrt-main.js"

STATIC_CATALOG: dict[str, object] = {
    "service": "ismrt! smrt!Wallet dashboard",
    "login_url": "https://dashboard.ismrt.net/login",
    "auth": {
        "provider": "Keycloak",
        "issuer": "https://account.rmsconnect.net/auth/realms/rms",
        "token_url": "https://account.rmsconnect.net/auth/realms/rms/protocol/openid-connect/token",
        "client_id": "ismrt-dashboard",
        "grant_type": "password",
        "graphql_auth_header": "x-access-token",
    },
    "graphql": {
        "production": "https://api-gateway.rmsconnect.net/graphql",
        "development": "http://dev-api-gateway.rmsconnect.net/graphql",
    },
    "daily_kwh_entry_points": [
        {
            "operation": "walletUtilityTransactions",
            "fields": ["date", "consumption", "rate", "charge", "debit", "meterSerial"],
            "variables": ["id", "utilityType", "startDate", "endDate"],
            "utility_type_example": "Electricity",
            "notes": "Primary per-utility daily ledger used by the dashboard consumption view.",
        },
        {
            "operation": "walletExpenseTransactions",
            "fields": [
                "date",
                "utilityType",
                "consumption",
                "rate",
                "charge",
                "debit",
                "meterSerial",
                "reference",
            ],
            "variables": ["id", "startDate", "endDate"],
            "notes": "All utilities in one query; filter client-side on utilityType.",
        },
        {
            "operation": "meterProfile",
            "fields": ["serial", "interval", "time-series payload"],
            "variables": ["serial", "startDate", "endDate", "interval"],
            "notes": "Meter-level profile; dashboard passes interval as minutes: 1440=daily, 60=hourly.",
        },
    ],
    "other_operations_found_in_bundle": [],
}


def _extract_operations(bundle_text: str) -> list[str]:
    ops = set(re.findall(r"\b(?:query|mutation)\s+([A-Za-z0-9_]+)", bundle_text))
    return sorted(ops - {"or", "to"})


def _redact_wallet(wallet: dict[str, object]) -> dict[str, object]:
    return {
        "id": wallet.get("id"),
        "accountReference": wallet.get("accountReference"),
        "propertyName": wallet.get("propertyName"),
        "premiseName": wallet.get("premiseName"),
        "balance": wallet.get("balance"),
        "isActive": wallet.get("isActive"),
    }


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, default=str) + "\n", encoding="utf-8")


def _amount(value: object) -> float:
    return float(value or 0)


def _group_financial_rows(
    rows: list[dict[str, object]],
    *,
    key_fields: tuple[str, ...],
) -> list[dict[str, object]]:
    grouped: dict[tuple[object, ...], dict[str, object]] = {}
    for row in rows:
        key = tuple(row.get(field) for field in key_fields)
        summary = grouped.setdefault(
            key,
            {field: row.get(field) for field in key_fields}
            | {"count": 0, "debit": 0.0, "credit": 0.0},
        )
        summary["count"] = int(summary["count"]) + 1
        summary["debit"] = float(summary["debit"]) + _amount(row.get("debit"))
        summary["credit"] = float(summary["credit"]) + _amount(row.get("credit"))
    for summary in grouped.values():
        summary["net_debit"] = float(summary["debit"]) - float(summary["credit"])
    return list(grouped.values())


def main() -> int:
    parser = argparse.ArgumentParser(description="Probe ISMRT GraphQL API")
    parser.add_argument("--days", type=int, default=90, help="Lookback window")
    parser.add_argument("--utility", default="Electricity", help="utilityType filter")
    parser.add_argument(
        "--wallet-id",
        default="",
        help="Wallet id (defaults to first active wallet returned)",
    )
    args = parser.parse_args()

    catalog = dict(STATIC_CATALOG)
    if BUNDLE_PATH.exists():
        catalog["other_operations_found_in_bundle"] = _extract_operations(
            BUNDLE_PATH.read_text(encoding="utf-8", errors="ignore")
        )
    _write_json(CATALOG_PATH, catalog)

    creds = IsmrtCredentials.from_env()
    client = IsmrtClient(creds)
    auth_meta = client.authenticate()
    print("Authenticated:", json.dumps(auth_meta))

    wallets = client.list_wallets()
    redacted_wallets = [_redact_wallet(w) for w in wallets]
    _write_json(DATA_DIR / "wallets.redacted.json", redacted_wallets)
    print(f"Wallets: {len(wallets)}")

    if not wallets:
        raise IsmrtError("No wallets returned for this account.")

    wallet_id = args.wallet_id or str(wallets[0]["id"])
    start, end = default_date_range(args.days)

    detail = client.wallet_detail(wallet_id, start, end)
    _write_json(DATA_DIR / "wallet_detail.redacted.json", detail)

    meters: list[dict[str, object]] = []
    for contract in detail.get("contracts", {}).get("nodes", []) or []:
        service = contract.get("service") or {}
        for meter in service.get("meters", {}).get("nodes", []) or []:
            meters.append(meter)
    _write_json(DATA_DIR / "meters.redacted.json", meters)

    utility_rows = client.wallet_utility_transactions(
        wallet_id, args.utility, start, end
    )
    _write_json(DATA_DIR / f"utility_{args.utility.lower()}.json", utility_rows)
    print(f"{args.utility} rows: {len(utility_rows)}")

    expense_rows = client.wallet_expense_transactions(wallet_id, start, end)
    electricity_expense = [
        row for row in expense_rows if row.get("utilityType") == args.utility
    ]
    water_expense = [
        row for row in expense_rows if row.get("utilityType") == "Water"
    ]
    wallet_charge_expense = [
        row for row in expense_rows if row.get("utilityType") == "ismrt! Wallet Charges"
    ]
    consolidated_rows = detail.get("consolidatedTransactions", {}).get("nodes", [])
    deposits = [
        row for row in consolidated_rows if row.get("utilityType") == "PURCHASE"
    ]

    invoices = client.wallet_invoices(wallet_id, start, end)
    proof_of_payments = client.wallet_proof_of_payments(wallet_id, start, end)

    _write_json(DATA_DIR / "expense_all.json", expense_rows)
    _write_json(DATA_DIR / "expense_electricity.json", electricity_expense)
    _write_json(DATA_DIR / "water_charges.json", water_expense)
    _write_json(DATA_DIR / "wallet_charges.json", wallet_charge_expense)
    _write_json(DATA_DIR / "wallet_deposits.json", deposits)
    _write_json(DATA_DIR / "wallet_invoices.json", invoices)
    _write_json(DATA_DIR / "wallet_proof_of_payments.json", proof_of_payments)

    financial_summary = {
        "water_charges": _group_financial_rows(
            water_expense,
            key_fields=("reference",),
        ),
        "wallet_charges": _group_financial_rows(
            wallet_charge_expense,
            key_fields=("charge",),
        ),
        "deposits": {
            "count": len(deposits),
            "credit": sum(_amount(row.get("credit")) for row in deposits),
        },
        "invoices": {
            "count": len(invoices),
            "total": sum(_amount(row.get("total")) for row in invoices),
        },
        "proof_of_payments": {
            "count": len(proof_of_payments),
            "total": sum(_amount(row.get("total")) for row in proof_of_payments),
        },
    }
    _write_json(DATA_DIR / "wallet_financial_summary.json", financial_summary)

    print(
        "Financial rows:",
        f"all={len(expense_rows)}",
        f"water={len(water_expense)}",
        f"wallet_charges={len(wallet_charge_expense)}",
        f"deposits={len(deposits)}",
    )

    meter_profile_samples: dict[str, object] = {}
    profile_start = start.replace(hour=22, minute=0, second=0, microsecond=0)
    profile_end = end.replace(hour=22, minute=0, second=0, microsecond=0)
    for meter in meters[:2]:
        serial = str(meter.get("serial", ""))
        if not serial:
            continue
        # The dashboard passes a minute count as a string: 1440 = daily,
        # 60 = hourly. Try the actual dashboard values before labels.
        for interval in ("1440", "60", "Daily", "Hourly", "1 day", "1 hour"):
            try:
                meter_profile_samples[f"{serial}:{interval}"] = client.meter_profile(
                    serial, profile_start, profile_end, interval=interval
                )
                break
            except IsmrtError:
                continue
    if meter_profile_samples:
        _write_json(DATA_DIR / "meter_profile.samples.json", meter_profile_samples)

    if utility_rows:
        sample = utility_rows[-5:]
        print("Latest utility rows:")
        for row in sample:
            print(
                f"  {row.get('date')}  consumption={row.get('consumption')}  "
                f"rate={row.get('rate')}  charge={row.get('charge')}"
            )

    summary = {
        "probed_at": datetime.now(timezone.utc).isoformat(),
        "wallet_id": wallet_id,
        "utility_type": args.utility,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "wallet_count": len(wallets),
        "utility_row_count": len(utility_rows),
        "expense_row_count": len(expense_rows),
        "expense_electricity_row_count": len(electricity_expense),
        "water_row_count": len(water_expense),
        "wallet_charge_row_count": len(wallet_charge_expense),
        "deposit_count": len(deposits),
        "meter_count": len(meters),
        "outputs": {
            "catalog": str(CATALOG_PATH),
            "wallets": str(DATA_DIR / "wallets.redacted.json"),
            "utility": str(DATA_DIR / f"utility_{args.utility.lower()}.json"),
            "expense_all": str(DATA_DIR / "expense_all.json"),
            "expense_electricity": str(DATA_DIR / "expense_electricity.json"),
            "water_charges": str(DATA_DIR / "water_charges.json"),
            "wallet_charges": str(DATA_DIR / "wallet_charges.json"),
            "wallet_deposits": str(DATA_DIR / "wallet_deposits.json"),
            "wallet_invoices": str(DATA_DIR / "wallet_invoices.json"),
            "wallet_proof_of_payments": str(DATA_DIR / "wallet_proof_of_payments.json"),
            "wallet_financial_summary": str(DATA_DIR / "wallet_financial_summary.json"),
        },
    }
    _write_json(DATA_DIR / "probe_summary.json", summary)
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except IsmrtError as exc:
        print(f"ERROR: {exc}")
        raise SystemExit(1)
