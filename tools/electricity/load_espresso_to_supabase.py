#!/usr/bin/env python3
"""Backfill daily Lelit Bianca readings from the household CSV.

Run from the repository root after loading the ignored .env:

    set -a; source .env; set +a
    python3 tools/electricity/load_espresso_to_supabase.py

The CSV is treated as a manual Bneta backfill. Daily readings are written to
the same service-role-only Supabase RPC used by the ISMRT loader. House usage,
tariff, and proportion are retained as metadata on each espresso reading.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import logging
import os
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CSV_PATH = (
    REPO_ROOT
    / "data"
    / "consumption"
    / "electricity"
    / "raw"
    / "Elec usage - Sheet1.csv"
)
RPC_NAME = "ingest_consumption_batch"
SOURCE = "bneta"
DEVICE_EXTERNAL_ID = "bneta-plug-1"
MEASUREMENT_TARGET = "lelit-bianca"
LOCAL_TIMEZONE = ZoneInfo("Africa/Johannesburg")
REQUIRED_COLUMNS = {"date", "espresso_kwh", "house_kwh", "tarrif", "proportion"}

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


logger = logging.getLogger("electricity.espresso_loader")


def log_info(message: str, **context: object) -> None:
    logger.info(message, extra={"context": context})


def log_error(message: str, **context: object) -> None:
    logger.error(message, extra={"context": context})


def parse_float(value: str, field: str, row_number: int) -> float:
    try:
        return float(value.strip())
    except ValueError as exc:
        raise ValueError(
            f"Invalid numeric value for {field} on CSV row {row_number}: {value!r}"
        ) from exc


def parse_proportion(value: str, row_number: int) -> float:
    stripped = value.strip()
    if not stripped.endswith("%"):
        raise ValueError(
            f"Expected percentage for proportion on CSV row {row_number}: {value!r}"
        )
    return parse_float(stripped[:-1], "proportion", row_number) / 100


def parse_csv(path: Path) -> tuple[list[JsonObject], str]:
    csv_bytes = path.read_bytes()
    file_hash = hashlib.sha256(csv_bytes).hexdigest()
    rows: list[JsonObject] = []
    seen_dates: set[str] = set()
    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        columns = set(reader.fieldnames or [])
        missing = REQUIRED_COLUMNS - columns
        if missing:
            raise ValueError(f"CSV is missing required columns: {sorted(missing)}")

        for row_number, raw in enumerate(reader, start=2):
            raw_date = (raw.get("date") or "").strip()
            try:
                day = datetime.strptime(raw_date, "%Y/%m/%d").date()
            except ValueError as exc:
                raise ValueError(
                    f"Invalid date on CSV row {row_number}: {raw_date!r}"
                ) from exc
            normalized_date = day.isoformat()
            if normalized_date in seen_dates:
                raise ValueError(f"Duplicate date on CSV row {row_number}: {raw_date!r}")
            seen_dates.add(normalized_date)
            rows.append(
                {
                    "date": normalized_date,
                    "espresso_kwh": parse_float(
                        raw["espresso_kwh"], "espresso_kwh", row_number
                    ),
                    "house_kwh": parse_float(
                        raw["house_kwh"], "house_kwh", row_number
                    ),
                    "tariff_zar_per_kwh": parse_float(
                        raw["tarrif"], "tarrif", row_number
                    ),
                    "proportion": parse_proportion(
                        raw["proportion"], row_number
                    ),
                    "source_row_number": row_number,
                    "source_row": dict(raw),
                }
            )
    if not rows:
        raise ValueError("CSV contains no data rows")
    return rows, file_hash


def local_period(day: date) -> tuple[str, str]:
    start = datetime.combine(day, time.min, tzinfo=LOCAL_TIMEZONE)
    end = start + timedelta(days=1)
    return start.isoformat(), end.isoformat()


def payload_hash(payload: object) -> str:
    encoded = json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def build_payload(
    rows: list[JsonObject],
    *,
    file_hash: str,
    file_name: str,
) -> tuple[JsonObject, JsonObject]:
    observed_at = datetime.now(timezone.utc).isoformat()
    raw_record_id = f"manual_csv:{DEVICE_EXTERNAL_ID}:{file_hash}"
    raw_payload: JsonObject = {
        "file_name": file_name,
        "sha256": file_hash,
        "rows": rows,
    }
    raw_event: JsonObject = {
        "source": SOURCE,
        "source_record_id": raw_record_id,
        "event_type": "manual_csv_backfill",
        "event_at": None,
        "fetched_at": observed_at,
        "payload_hash": payload_hash(raw_payload),
        "payload": raw_payload,
        "metadata": {
            "provider": "Bneta",
            "ingestion_mode": "manual_csv",
            "file_name": file_name,
        },
    }

    devices: list[JsonObject] = [
        {
            "source": SOURCE,
            "external_id": DEVICE_EXTERNAL_ID,
            "kind": "smart_plug",
            "name": "Bneta smart plug 1",
            "utility_type": "electricity",
            "location": None,
            "timezone": "Africa/Johannesburg",
            "parent_source": None,
            "parent_external_id": None,
            "metadata": {
                "provider": "Bneta",
                "ingestion_mode": "manual_csv",
                "file_name": file_name,
            },
        }
    ]
    readings: list[JsonObject] = []
    for row in rows:
        day = date.fromisoformat(str(row["date"]))
        period_start, period_end = local_period(day)
        readings.append(
            {
                "source": SOURCE,
                "source_record_id": f"daily:{day.isoformat()}",
                "period_start": period_start,
                "period_end": period_end,
                "metric": "energy",
                "measurement_target": MEASUREMENT_TARGET,
                "value": row["espresso_kwh"],
                "unit": "kWh",
                "quality": "measured",
                "device_source": SOURCE,
                "device_external_id": DEVICE_EXTERNAL_ID,
                "raw_source": SOURCE,
                "raw_record_id": raw_record_id,
                "metadata": {
                    "local_date": day.isoformat(),
                    "house_kwh_csv": row["house_kwh"],
                    "tariff_zar_per_kwh": row["tariff_zar_per_kwh"],
                    "proportion_csv": row["proportion"],
                    "source_row_number": row["source_row_number"],
                    "source_file": file_name,
                },
            }
        )

    start_date = str(rows[0]["date"])
    end_date = str(rows[-1]["date"])
    payload: JsonObject = {
        "devices": devices,
        "raw_events": [raw_event],
        "readings": readings,
        "ledger_entries": [],
        "documents": [],
        "ingestion_run": {
            "source": SOURCE,
            "runner": "load_espresso_to_supabase",
            "status": "succeeded",
            "started_at": observed_at,
            "finished_at": observed_at,
            "window_start": local_period(date.fromisoformat(start_date))[0],
            "window_end": local_period(date.fromisoformat(end_date))[1],
            "rows_fetched": len(rows),
            "rows_written": len(rows),
            "metadata": {
                "provider": "Bneta",
                "ingestion_mode": "manual_csv",
                "file_name": file_name,
                "file_sha256": file_hash,
            },
        },
    }
    stats: JsonObject = {
        "device": DEVICE_EXTERNAL_ID,
        "days": len(rows),
        "start_date": start_date,
        "end_date": end_date,
        "espresso_kwh": sum(float(row["espresso_kwh"]) for row in rows),
        "raw_events": 1,
        "readings": len(readings),
    }
    return payload, stats


def send_to_supabase(
    *,
    supabase_url: str,
    service_key: str,
    payload: JsonObject,
) -> object:
    endpoint = f"{supabase_url.rstrip('/')}/rest/v1/rpc/{RPC_NAME}"
    request = Request(
        endpoint,
        data=json.dumps({"p_payload": payload}).encode("utf-8"),
        method="POST",
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urlopen(request, timeout=120) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"Supabase RPC failed ({exc.code}): {body[:1000]}"
        ) from exc
    except URLError as exc:
        raise RuntimeError(f"Supabase request failed: {exc.reason}") from exc


def main() -> int:
    configure_logging()
    parser = argparse.ArgumentParser(
        description="Load manual espresso readings into Supabase"
    )
    parser.add_argument(
        "--csv",
        type=Path,
        default=DEFAULT_CSV_PATH,
        help="CSV containing daily espresso readings",
    )
    args = parser.parse_args()

    supabase_url = os.environ.get("SUPABASE_URL", "").strip()
    service_key = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
    if not supabase_url or not service_key:
        raise RuntimeError(
            "Set SUPABASE_URL and SUPABASE_SERVICE_KEY before running."
        )

    rows, file_hash = parse_csv(args.csv)
    payload, stats = build_payload(
        rows,
        file_hash=file_hash,
        file_name=args.csv.name,
    )
    log_info("Prepared espresso backfill", **stats)
    result = send_to_supabase(
        supabase_url=supabase_url,
        service_key=service_key,
        payload=payload,
    )
    log_info("Loaded espresso backfill into Supabase", rpc_result=result, **stats)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, ValueError) as exc:
        configure_logging()
        log_error("Espresso Supabase load failed", error=str(exc))
        raise SystemExit(1)
