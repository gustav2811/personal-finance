#!/usr/bin/env python3
"""Load the latest ISMRT probe extracts into the private consumption schema.

Run from the repository root after loading the ignored .env:

    set -a; source .env; set +a
    python3 tools/ismrt/load_to_supabase.py

The loader sends one transactional batch to the service-role-only Supabase RPC.
It is safe to rerun: source records are upserted by deterministic keys and raw
events are retained immutably per probe capture.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Mapping, cast

import httpx

TOOL_DIR = Path(__file__).resolve().parent
REPO_ROOT = TOOL_DIR.parents[1]
DEFAULT_DATA_DIR = REPO_ROOT / "data" / "consumption" / "ismrt"
RPC_NAME = "ingest_consumption_batch"
SOURCE = "ismrt"

JsonObject = dict[str, object]


class JsonLogFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: JsonObject = {
            "level": record.levelname.lower(),
            "message": record.getMessage(),
        }
        context = getattr(record, "context", None)
        if isinstance(context, dict):
            payload.update(context)
        return json.dumps(payload, default=str)


def configure_logging() -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonLogFormatter())
    logging.basicConfig(level=logging.INFO, handlers=[handler], force=True)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)


logger = logging.getLogger("ismrt.supabase_loader")


def log_info(message: str, **context: object) -> None:
    logger.info(message, extra={"context": context})


def log_error(message: str, **context: object) -> None:
    logger.error(message, extra={"context": context})


def read_json(data_dir: Path, filename: str) -> object:
    return json.loads((data_dir / filename).read_text(encoding="utf-8"))


def object_list(value: object, field: str) -> list[JsonObject]:
    if not isinstance(value, list):
        raise ValueError(f"Expected list while reading {field}")
    rows: list[JsonObject] = []
    for index, row in enumerate(value):
        if not isinstance(row, dict):
            raise ValueError(f"Expected object at {field}[{index}]")
        rows.append(cast(JsonObject, row))
    return rows


def object_map(value: object, field: str) -> dict[str, JsonObject]:
    if not isinstance(value, dict):
        raise ValueError(f"Expected object while reading {field}")
    result: dict[str, JsonObject] = {}
    for key, row in value.items():
        if not isinstance(row, dict):
            raise ValueError(f"Expected object at {field}.{key}")
        result[key] = cast(JsonObject, row)
    return result


def string_value(row: Mapping[str, object], field: str) -> str:
    value = row.get(field)
    if not isinstance(value, str) or not value:
        raise ValueError(f"Expected non-empty string field {field}")
    return value


def optional_string(row: Mapping[str, object], field: str) -> str | None:
    value = row.get(field)
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"Expected string or null field {field}")
    return value


def number_value(row: Mapping[str, object], field: str) -> float:
    value = row.get(field)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"Expected numeric field {field}")
    return float(value)


def optional_number(row: Mapping[str, object], field: str) -> float | None:
    value = row.get(field)
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"Expected numeric or null field {field}")
    return float(value)


def timestamp_date(value: object, field: str) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError(f"Expected timestamp field {field}")
    return value


def utc_date(value: object, field: str) -> str:
    timestamp = timestamp_date(value, field)
    return timestamp.split("T", 1)[0]


def payload_hash(payload: object) -> str:
    encoded = json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def utility_type(value: object) -> str:
    if value == "Electricity":
        return "electricity"
    if value == "Water":
        return "water"
    if value == "ismrt! Wallet Charges":
        return "wallet"
    if value == "PURCHASE":
        return "wallet"
    raise ValueError(f"Unsupported ISMRT utility type: {value!r}")


def quantity_from_reference(reference: str | None) -> float | None:
    if not reference:
        return None
    match = re.search(r"Usage\s+([0-9]+(?:\.[0-9]+)?)\s+kl\b", reference)
    return float(match.group(1)) if match else None


def source_record_id(event_type: str, row: Mapping[str, object], index: int) -> str:
    digest = payload_hash(row)
    return f"{event_type}:{digest}:{index}"


def add_raw_event(
    raw_events: list[JsonObject],
    raw_event_ids: dict[str, str],
    *,
    event_type: str,
    source_record_id_value: str,
    payload: object,
    event_at: str | None,
    fetched_at: str,
    metadata: JsonObject,
) -> None:
    raw_events.append(
        {
            "source": SOURCE,
            "source_record_id": source_record_id_value,
            "event_type": event_type,
            "event_at": event_at,
            "fetched_at": fetched_at,
            "payload_hash": payload_hash(payload),
            "payload": payload,
            "metadata": metadata,
        }
    )
    raw_event_ids[event_type] = source_record_id_value


def build_payload(data_dir: Path) -> tuple[JsonObject, JsonObject]:
    summary = cast(JsonObject, read_json(data_dir, "probe_summary.json"))
    wallet_id = string_value(summary, "wallet_id")
    water_device_external_id = f"water:{wallet_id}"
    probed_at = timestamp_date(summary.get("probed_at"), "probed_at")
    window_start = timestamp_date(summary.get("start"), "start")
    window_end = timestamp_date(summary.get("end"), "end")

    wallets = object_list(read_json(data_dir, "wallets.redacted.json"), "wallets")
    meters = object_list(read_json(data_dir, "meters.redacted.json"), "meters")
    wallet_detail = cast(JsonObject, read_json(data_dir, "wallet_detail.redacted.json"))
    utility_rows = object_list(
        read_json(data_dir, "utility_electricity.json"),
        "utility_electricity",
    )
    expense_rows = object_list(
        read_json(data_dir, "expense_all.json"),
        "expense_all",
    )
    deposits = object_list(
        read_json(data_dir, "wallet_deposits.json"),
        "wallet_deposits",
    )
    invoices = object_list(
        read_json(data_dir, "wallet_invoices.json"),
        "wallet_invoices",
    )
    proof_of_payments = object_list(
        read_json(data_dir, "wallet_proof_of_payments.json"),
        "wallet_proof_of_payments",
    )
    profiles = object_map(
        read_json(data_dir, "meter_profile.samples.json"),
        "meter_profile.samples",
    )

    capture_metadata: JsonObject = {
        "wallet_id": wallet_id,
        "window_start": window_start,
        "window_end": window_end,
        "probed_at": probed_at,
        "source": "data/consumption/ismrt",
    }
    raw_events: list[JsonObject] = []
    raw_event_ids: dict[str, str] = {}
    add_raw_event(
        raw_events,
        raw_event_ids,
        event_type="user_wallets",
        source_record_id_value=f"user_wallets:{wallet_id}:{probed_at}",
        payload=wallets,
        event_at=None,
        fetched_at=probed_at,
        metadata=capture_metadata,
    )
    add_raw_event(
        raw_events,
        raw_event_ids,
        event_type="wallet_detail",
        source_record_id_value=f"wallet_detail:{wallet_id}:{window_start}:{window_end}",
        payload=wallet_detail,
        event_at=window_start,
        fetched_at=probed_at,
        metadata=capture_metadata,
    )
    add_raw_event(
        raw_events,
        raw_event_ids,
        event_type="meters",
        source_record_id_value=f"meters:{wallet_id}:{probed_at}",
        payload=meters,
        event_at=None,
        fetched_at=probed_at,
        metadata=capture_metadata,
    )
    add_raw_event(
        raw_events,
        raw_event_ids,
        event_type="wallet_utility_transactions",
        source_record_id_value=(
            f"wallet_utility_transactions:{wallet_id}:{window_start}:{window_end}"
        ),
        payload=utility_rows,
        event_at=window_start,
        fetched_at=probed_at,
        metadata=capture_metadata
        | {"utility_type": string_value(summary, "utility_type")},
    )
    add_raw_event(
        raw_events,
        raw_event_ids,
        event_type="wallet_expense_transactions",
        source_record_id_value=(
            f"wallet_expense_transactions:{wallet_id}:{window_start}:{window_end}"
        ),
        payload=expense_rows,
        event_at=window_start,
        fetched_at=probed_at,
        metadata=capture_metadata,
    )
    add_raw_event(
        raw_events,
        raw_event_ids,
        event_type="wallet_deposits",
        source_record_id_value=f"wallet_deposits:{wallet_id}:{window_start}:{window_end}",
        payload=deposits,
        event_at=window_start,
        fetched_at=probed_at,
        metadata=capture_metadata,
    )
    add_raw_event(
        raw_events,
        raw_event_ids,
        event_type="wallet_invoices",
        source_record_id_value=f"wallet_invoices:{wallet_id}:{window_start}:{window_end}",
        payload=invoices,
        event_at=window_start,
        fetched_at=probed_at,
        metadata=capture_metadata,
    )
    add_raw_event(
        raw_events,
        raw_event_ids,
        event_type="wallet_proof_of_payments",
        source_record_id_value=(
            f"wallet_proof_of_payments:{wallet_id}:{window_start}:{window_end}"
        ),
        payload=proof_of_payments,
        event_at=window_start,
        fetched_at=probed_at,
        metadata=capture_metadata,
    )

    if not wallets:
        raise ValueError("ISMRT probe returned no wallets")
    wallet = wallets[0]
    wallet_location = string_value(wallet, "propertyName")
    devices: list[JsonObject] = [
        {
            "source": SOURCE,
            "external_id": wallet_id,
            "kind": "wallet",
            "name": f"ISMRT wallet {wallet_id}",
            "utility_type": "wallet",
            "location": wallet_location,
            "timezone": "Africa/Johannesburg",
            "parent_source": None,
            "parent_external_id": None,
            "metadata": {
                "account_reference": optional_string(
                    wallet, "accountReference"
                ),
                "premise_name": optional_string(wallet, "premiseName"),
            },
        }
    ]
    for meter in meters:
        serial = string_value(meter, "serial")
        devices.append(
            {
                "source": SOURCE,
                "external_id": serial,
                "kind": "utility_meter",
                "name": f"ISMRT meter {serial}",
                "utility_type": "electricity",
                "location": wallet_location,
                "timezone": "Africa/Johannesburg",
                "parent_source": SOURCE,
                "parent_external_id": wallet_id,
                "metadata": {"ismrt_meter_id": optional_string(meter, "id")},
            }
        )
    devices.append(
        {
            "source": SOURCE,
            "external_id": water_device_external_id,
            "kind": "utility_stream",
            "name": "ISMRT water billing",
            "utility_type": "water",
            "location": wallet_location,
            "timezone": "Africa/Johannesburg",
            "parent_source": SOURCE,
            "parent_external_id": wallet_id,
            "metadata": {"meter_type": "invoice_billing"},
        }
    )

    readings: list[JsonObject] = []
    for profile_key, profile in profiles.items():
        serial = string_value(profile, "serial")
        interval_minutes = profile.get("interval")
        add_raw_event(
            raw_events,
            raw_event_ids,
            event_type=f"meter_profile:{serial}:{interval_minutes}",
            source_record_id_value=(
                f"meter_profile:{serial}:{interval_minutes}:"
                f"{window_start}:{window_end}"
            ),
            payload=profile,
            event_at=optional_string(profile, "startDate"),
            fetched_at=probed_at,
            metadata=capture_metadata
            | {"profile_key": profile_key, "meter_serial": serial},
        )
        profile_raw_record_id = raw_event_ids[f"meter_profile:{serial}:{interval_minutes}"]
        intervals = object_list(profile.get("intervals"), f"{profile_key}.intervals")
        for interval_index, interval in enumerate(intervals):
            period_start = timestamp_date(interval.get("startDate"), "startDate")
            period_end = timestamp_date(interval.get("endDate"), "endDate")
            measures = object_list(
                interval.get("measures"),
                f"{profile_key}.intervals[{interval_index}].measures",
            )
            for measure in measures:
                consumption = optional_number(measure, "consumption")
                if consumption is None:
                    continue
                metric = string_value(measure, "name")
                readings.append(
                    {
                        "source": SOURCE,
                        "source_record_id": (
                            f"meter_profile:{serial}:{period_start}:"
                            f"{period_end}:{metric}"
                        ),
                        "period_start": period_start,
                        "period_end": period_end,
                        "metric": "energy",
                        "measurement_target": "whole_home",
                        "value": consumption,
                        "unit": string_value(measure, "unit"),
                        "quality": "measured",
                        "device_source": SOURCE,
                        "device_external_id": serial,
                        "raw_source": SOURCE,
                        "raw_record_id": profile_raw_record_id,
                        "metadata": {
                            "measure_name": metric,
                            "display_name": optional_string(measure, "displayName"),
                            "start_value": measure.get("startValue"),
                            "end_value": measure.get("endValue"),
                            "profile_interval_minutes": interval_minutes,
                        },
                    }
                )

    ledger_entries: list[JsonObject] = []
    water_quantity_references: set[str] = set()
    for index, row in enumerate(expense_rows):
        source_id = source_record_id("wallet_expense", row, index)
        utility = utility_type(row.get("utilityType"))
        debit = optional_number(row, "debit")
        credit = optional_number(row, "credit")
        direction = "debit" if debit is not None else "credit"
        amount = debit if debit is not None else credit
        if amount is None:
            raise ValueError(f"Expense row {index} has neither debit nor credit")

        reference = optional_string(row, "reference")
        meter_serial = optional_string(row, "meterSerial")
        quantity = optional_number(row, "consumption")
        quantity_unit: str | None = None
        metadata: JsonObject = {
            "source_row_index": index,
            "meter_serial": optional_string(row, "meterSerial"),
        }
        if quantity is not None:
            quantity_unit = "kWh" if utility == "electricity" else None
        elif utility == "water":
            extracted_quantity = quantity_from_reference(reference)
            if (
                extracted_quantity is not None
                and direction == "debit"
                and reference not in water_quantity_references
            ):
                quantity = extracted_quantity
                quantity_unit = "kl"
                water_quantity_references.add(reference or "")
                metadata["quantity_extracted_from"] = "reference"
            else:
                metadata["quantity_suppressed_reason"] = (
                    "duplicate_or_credit_water_ledger_row"
                )

        ledger_entries.append(
            {
                "source": SOURCE,
                "source_record_id": source_id,
                "utility_type": utility,
                "entry_type": "fee" if utility == "wallet" else "usage_charge",
                "direction": direction,
                "amount": amount,
                "currency": "ZAR",
                "quantity": quantity,
                "quantity_unit": quantity_unit,
                "rate": optional_number(row, "rate"),
                "occurred_at": timestamp_date(row.get("date"), "date"),
                "posted_at": timestamp_date(row.get("date"), "date"),
                "description": optional_string(row, "charge"),
                "reference": reference,
                "device_source": SOURCE,
                "device_external_id": (
                    meter_serial
                    if meter_serial
                    else wallet_id
                    if utility == "wallet"
                    else water_device_external_id
                ),
                "raw_source": SOURCE,
                "raw_record_id": raw_event_ids["wallet_expense_transactions"],
                "metadata": metadata,
            }
        )

    for index, row in enumerate(deposits):
        source_id = source_record_id("wallet_purchase", row, index)
        amount = number_value(row, "credit")
        timestamp = timestamp_date(row.get("date"), "date")
        ledger_entries.append(
            {
                "source": SOURCE,
                "source_record_id": source_id,
                "utility_type": "wallet",
                "entry_type": "deposit",
                "direction": "credit",
                "amount": amount,
                "currency": "ZAR",
                "quantity": None,
                "quantity_unit": None,
                "rate": None,
                "occurred_at": timestamp,
                "posted_at": timestamp,
                "description": "PURCHASE",
                "reference": None,
                "device_source": SOURCE,
                "device_external_id": wallet_id,
                "raw_source": SOURCE,
                "raw_record_id": raw_event_ids["wallet_deposits"],
                "metadata": {"source_row_index": index},
            }
        )

    documents: list[JsonObject] = []
    for document_type, rows, raw_event_type in (
        ("invoice", invoices, "wallet_invoices"),
        ("proof_of_payment", proof_of_payments, "wallet_proof_of_payments"),
    ):
        for index, row in enumerate(rows):
            document_id = string_value(row, "idKey")
            documents.append(
                {
                    "source": SOURCE,
                    "source_record_id": f"{document_type}:{document_id}",
                    "document_type": document_type,
                    "document_number": optional_string(row, "documentNumber"),
                    "document_date": utc_date(row.get("documentDate"), "documentDate"),
                    "total": number_value(row, "total"),
                    "currency": "ZAR",
                    "file_name": None,
                    "storage_path": None,
                    "raw_source": SOURCE,
                    "raw_record_id": raw_event_ids[raw_event_type],
                    "metadata": {
                        "id_key": document_id,
                        "source_row_index": index,
                        "document_timestamp": row.get("documentDate"),
                    },
                }
            )

    rows_fetched = len(expense_rows) + len(deposits) + len(readings) + len(documents)
    payload: JsonObject = {
        "devices": devices,
        "raw_events": raw_events,
        "readings": readings,
        "ledger_entries": ledger_entries,
        "documents": documents,
        "ingestion_run": {
            "source": SOURCE,
            "runner": "load_ismrt_to_supabase",
            "status": "succeeded",
            "started_at": probed_at,
            "finished_at": datetime.now(timezone.utc).isoformat(),
            "window_start": window_start,
            "window_end": window_end,
            "rows_fetched": rows_fetched,
            "rows_written": rows_fetched,
            "metadata": {
                "wallet_id": wallet_id,
                "probe_summary": summary,
                "raw_event_count": len(raw_events),
                "profile_count": len(profiles),
            },
        },
    }
    return payload, {
        "wallet_id": wallet_id,
        "window_start": window_start,
        "window_end": window_end,
        "devices": len(devices),
        "raw_events": len(raw_events),
        "readings": len(readings),
        "ledger_entries": len(ledger_entries),
        "documents": len(documents),
    }


def load_payload(
    *,
    supabase_url: str,
    service_key: str,
    payload: JsonObject,
) -> object:
    endpoint = f"{supabase_url.rstrip('/')}/rest/v1/rpc/{RPC_NAME}"
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }
    with httpx.Client(timeout=120.0) as client:
        response = client.post(
            endpoint,
            headers=headers,
            json={"p_payload": payload},
        )
    if response.status_code >= 400:
        raise RuntimeError(
            f"Supabase RPC failed ({response.status_code}): {response.text[:1000]}"
        )
    return response.json()


def main() -> int:
    configure_logging()
    parser = argparse.ArgumentParser(
        description="Load ISMRT extracts into Supabase consumption schema"
    )
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=DEFAULT_DATA_DIR,
        help="Directory containing probe JSON outputs",
    )
    args = parser.parse_args()

    supabase_url = os.environ.get("SUPABASE_URL", "").strip()
    service_key = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
    if not supabase_url or not service_key:
        raise RuntimeError(
            "Set SUPABASE_URL and SUPABASE_SERVICE_KEY before running."
        )

    payload, counts = build_payload(args.data_dir)
    log_info("Prepared ISMRT batch", **counts)
    result = load_payload(
        supabase_url=supabase_url,
        service_key=service_key,
        payload=payload,
    )
    log_info("Loaded ISMRT batch into Supabase", rpc_result=result, **counts)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, ValueError) as exc:
        configure_logging()
        log_error("ISMRT Supabase load failed", error=str(exc))
        raise SystemExit(1)
