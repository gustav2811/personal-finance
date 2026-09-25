"""Render the Northcliff electricity analysis as a standalone dark-themed HTML report.

Charts are emitted as inline SVG so the output file has no network dependencies
and prints to PDF identically offline. Colors are the pinned `cursor/canvas`
dark palette and chart palette so the export matches the canvas.
"""

from __future__ import annotations

import csv
import html
import math
from datetime import datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
CSV_PATH = (
    REPO_ROOT
    / "data"
    / "consumption"
    / "electricity"
    / "raw"
    / "Elec usage - Sheet1.csv"
)
OUT_HTML = (
    REPO_ROOT
    / "reports"
    / "electricity"
    / "northcliff-electricity-jun-aug-2026.html"
)

# --- canvas dark palette (pinned copies from cursor/canvas tokens) ------------
BG = "#141414"
ELEVATED = "#1a1a1a"
FG = "#f0f0f0"
FG2 = "rgba(240,240,240,0.74)"
FG3 = "rgba(240,240,240,0.60)"
FG4 = "rgba(240,240,240,0.36)"
STROKE1 = "rgba(240,240,240,0.20)"
STROKE2 = "rgba(240,240,240,0.12)"
STROKE3 = "rgba(240,240,240,0.08)"
FILL2 = "rgba(240,240,240,0.14)"
FILL4 = "rgba(240,240,240,0.06)"
LINK = "#70b0d8"

# chart palette entries used by the canvas tones
C_INFO = "#2e79b5e0"
C_INFO_SOLID = "#4f93c9"
C_NEUTRAL = "#888899d0"
C_WARN = "#f0a040e0"
C_SUCCESS = "#1f8a65e8"
C_DANGER = "#c04848e0"

TONE_COLOR = {
    "info": C_INFO,
    "neutral": C_NEUTRAL,
    "warning": C_WARN,
    "success": C_SUCCESS,
    "danger": C_DANGER,
}


# --- data --------------------------------------------------------------------
def load_rows() -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    with CSV_PATH.open() as fh:
        for raw in csv.DictReader(fh):
            rows.append(
                {
                    "date": datetime.strptime(raw["date"], "%Y/%m/%d"),
                    "espresso": float(raw["espresso_kwh"]),
                    "house": float(raw["house_kwh"]),
                    "tariff": float(raw["tarrif"]),
                }
            )
    return rows


# Open-Meteo archive, Northcliff (-26.14, 27.97), 1 Jun - 23 Aug 2026.
TMEAN = [
    12.9, 12.7, 12.4, 11.1, 7.2, 7.9, 9.9, 12.7, 14.0, 12.2, 11.1, 13.5, 14.4,
    12.5, 12.8, 11.5, 11.7, 11.2, 12.4, 10.7, 9.5, 10.7, 10.6, 13.1, 13.3, 12.0,
    10.3, 11.2, 13.7, 14.1, 12.5, 10.5, 7.8, 9.4, 10.5, 12.3, 13.0, 13.0, 12.8,
    12.5, 12.8, 12.6, 11.7, 12.5, 14.1, 13.7, 13.9, 14.7, 14.6, 14.2, 14.6, 14.6,
    13.9, 12.5, 12.5, 12.4, 13.3, 13.7, 11.9, 13.7, 11.3, 11.0, 11.8, 12.1, 13.0,
    14.0, 15.8, 15.7, 13.7, 13.7, 10.2, 3.8, 7.4, 8.2, 8.9, 10.5, 12.2, 13.9,
    17.3, 17.7, 19.6, 18.7, 18.8, 19.0,
]

WEEK_LABELS = [
    "1–7 Jun", "8–14 Jun", "15–21 Jun", "22–28 Jun", "29 Jun–5 Jul", "6–12 Jul",
    "13–19 Jul", "20–26 Jul", "27 Jul–2 Aug", "3–9 Aug", "10–16 Aug", "17–23 Aug",
]
WEEK_ESPRESSO = [10.5, 7.98, 10.02, 10.67, 6.39, 7.02, 7.7, 11.26, 7.42, 8.22, 8.53, 9.67]
WEEK_HOUSE = [87.66, 88.99, 99.7, 79.63, 77.7, 99.69, 71.58, 95.94, 87.98, 90.92, 87.56, 98.92]
WEEK_TMEAN = [10.6, 12.9, 11.4, 11.6, 11.2, 12.7, 13.6, 13.5, 12.4, 14.0, 8.7, 17.9]

WEEKDAY_HOUSE = [10.39, 17.85, 10.24, 13.61, 13.58, 11.8, 11.38]
WEEKDAY_ESPRESSO = [0.97, 1.01, 1.05, 1.41, 1.2, 1.53, 1.61]


# --- svg helpers -------------------------------------------------------------
def nice_axis(vmin: float, vmax: float, count: int = 5) -> tuple[list[float], float, float]:
    if vmax <= vmin:
        vmax = vmin + 1
    raw = (vmax - vmin) / (count - 1)
    mag = 10 ** math.floor(math.log10(raw)) if raw > 0 else 1
    step = mag
    for mult in (1, 2, 2.5, 5, 10):
        if mult * mag >= raw:
            step = mult * mag
            break
    lo = math.floor(vmin / step) * step
    hi = math.ceil(vmax / step) * step
    ticks: list[float] = []
    val = lo
    while val <= hi + step * 0.5:
        ticks.append(round(val, 10))
        val += step
    return ticks, lo, hi


def fmt_tick(val: float) -> str:
    if abs(val - round(val)) < 1e-9:
        return str(int(round(val)))
    return f"{val:g}"


def legend(series: list[dict[str, object]]) -> str:
    chips = "".join(
        f'<span class="lg"><i style="background:{TONE_COLOR[s["tone"]]}"></i>{html.escape(str(s["name"]))}</span>'
        for s in series
    )
    return f'<div class="legend">{chips}</div>'


def line_chart(
    categories: list[str],
    series: list[dict[str, object]],
    width: int = 1010,
    height: int = 290,
    y_suffix: str = "",
    y_title: str = "",
    x_title: str = "",
    ref_lines: list[dict[str, object]] | None = None,
    begin_at_zero: bool = True,
    fill: bool = False,
    rotate_labels: bool = False,
) -> str:
    left, right, top, bottom = 60, 18, 16, 62 if rotate_labels else 46
    plot_w = width - left - right
    plot_h = height - top - bottom

    values = [v for s in series for v in s["data"]]  # type: ignore[index]
    for ref in ref_lines or []:
        values.append(float(ref["value"]))  # type: ignore[index]
    vmin = 0.0 if begin_at_zero else min(values)
    vmax = max(values)
    ticks, lo, hi = nice_axis(vmin, vmax)

    def sx(i: int) -> float:
        n = len(categories)
        return left + (plot_w * i / (n - 1) if n > 1 else plot_w / 2)

    def sy(v: float) -> float:
        return top + plot_h - (v - lo) / (hi - lo) * plot_h

    parts: list[str] = [
        f'<svg class="chart" viewBox="0 0 {width} {height}" width="100%" '
        f'preserveAspectRatio="xMidYMid meet" role="img">'
    ]

    for tick in ticks:
        y = sy(tick)
        parts.append(
            f'<line x1="{left}" y1="{y:.1f}" x2="{left + plot_w}" y2="{y:.1f}" '
            f'stroke="{STROKE3}" stroke-width="1"/>'
        )
        parts.append(
            f'<text x="{left - 8}" y="{y + 3.5:.1f}" text-anchor="end" '
            f'font-size="10.5" fill="{FG3}">{fmt_tick(tick)}{html.escape(y_suffix)}</text>'
        )

    parts.append(
        f'<line x1="{left}" y1="{top + plot_h}" x2="{left + plot_w}" '
        f'y2="{top + plot_h}" stroke="{STROKE2}" stroke-width="1"/>'
    )

    for ref in ref_lines or []:
        y = sy(float(ref["value"]))  # type: ignore[index]
        color = TONE_COLOR[str(ref.get("tone", "neutral"))]
        parts.append(
            f'<line x1="{left}" y1="{y:.1f}" x2="{left + plot_w}" y2="{y:.1f}" '
            f'stroke="{color}" stroke-width="1" stroke-dasharray="4 3"/>'
        )
        if ref.get("label"):
            parts.append(
                f'<text x="{left + 5}" y="{y - 6:.1f}" text-anchor="start" '
                f'font-size="10" fill="{color}">{html.escape(str(ref["label"]))}</text>'
            )

    for s in series:
        color = TONE_COLOR[str(s["tone"])]
        pts = " ".join(f"{sx(i):.1f},{sy(float(v)):.1f}" for i, v in enumerate(s["data"]))  # type: ignore[index]
        if fill:
            base = top + plot_h
            area = f"{left:.1f},{base:.1f} " + pts + f" {left + plot_w:.1f},{base:.1f}"
            parts.append(f'<polygon points="{area}" fill="{color[:7]}26" stroke="none"/>')
        parts.append(
            f'<polyline points="{pts}" fill="none" stroke="{color}" stroke-width="1.6" '
            f'stroke-linejoin="round" stroke-linecap="round"/>'
        )
        if len(categories) <= 20:
            for i, v in enumerate(s["data"]):  # type: ignore[index]
                parts.append(
                    f'<circle cx="{sx(i):.1f}" cy="{sy(float(v)):.1f}" r="2.6" fill="{color}"/>'
                )

    for i, label in enumerate(categories):
        if not label:
            continue
        if rotate_labels:
            lx, ly = sx(i), top + plot_h + 14
            parts.append(
                f'<text x="{lx:.1f}" y="{ly:.1f}" text-anchor="end" font-size="10" '
                f'fill="{FG3}" transform="rotate(-32 {lx:.1f} {ly:.1f})">{html.escape(label)}</text>'
            )
        else:
            parts.append(
                f'<text x="{sx(i):.1f}" y="{top + plot_h + 16:.1f}" text-anchor="middle" '
                f'font-size="10.5" fill="{FG3}">{html.escape(label)}</text>'
            )

    if x_title:
        parts.append(
            f'<text x="{left + plot_w / 2:.1f}" y="{height - 6}" text-anchor="middle" '
            f'font-size="10.5" fill="{FG4}">{html.escape(x_title)}</text>'
        )
    if y_title:
        cy = top + plot_h / 2
        parts.append(
            f'<text x="14" y="{cy:.1f}" text-anchor="middle" font-size="10.5" '
            f'fill="{FG4}" transform="rotate(-90 14 {cy:.1f})">{html.escape(y_title)}</text>'
        )

    parts.append("</svg>")
    return legend(series) + "".join(parts)


def bar_chart(
    categories: list[str],
    series: list[dict[str, object]],
    width: int = 1010,
    height: int = 260,
    y_suffix: str = "",
    y_title: str = "",
    x_title: str = "",
    rotate_labels: bool = False,
) -> str:
    left, right, top, bottom = 60, 18, 16, 62 if rotate_labels else 46
    plot_w = width - left - right
    plot_h = height - top - bottom

    values = [v for s in series for v in s["data"]]  # type: ignore[index]
    ticks, lo, hi = nice_axis(0, max(values))

    def sy(v: float) -> float:
        return top + plot_h - (v - lo) / (hi - lo) * plot_h

    parts: list[str] = [
        f'<svg class="chart" viewBox="0 0 {width} {height}" width="100%" '
        f'preserveAspectRatio="xMidYMid meet" role="img">'
    ]

    for tick in ticks:
        y = sy(tick)
        parts.append(
            f'<line x1="{left}" y1="{y:.1f}" x2="{left + plot_w}" y2="{y:.1f}" '
            f'stroke="{STROKE3}" stroke-width="1"/>'
        )
        parts.append(
            f'<text x="{left - 8}" y="{y + 3.5:.1f}" text-anchor="end" '
            f'font-size="10.5" fill="{FG3}">{fmt_tick(tick)}{html.escape(y_suffix)}</text>'
        )

    parts.append(
        f'<line x1="{left}" y1="{top + plot_h}" x2="{left + plot_w}" '
        f'y2="{top + plot_h}" stroke="{STROKE2}" stroke-width="1"/>'
    )

    n = len(categories)
    group_w = plot_w / n
    inner = group_w * 0.68
    bar_w = inner / len(series)

    for gi in range(n):
        gx = left + group_w * gi + (group_w - inner) / 2
        for si, s in enumerate(series):
            v = float(s["data"][gi])  # type: ignore[index]
            y = sy(v)
            h = top + plot_h - y
            parts.append(
                f'<rect x="{gx + bar_w * si:.1f}" y="{y:.1f}" width="{bar_w - 1.5:.1f}" '
                f'height="{max(h, 0.5):.1f}" fill="{TONE_COLOR[str(s["tone"])]}" rx="1"/>'
            )

    for gi, label in enumerate(categories):
        cx = left + group_w * gi + group_w / 2
        if rotate_labels:
            parts.append(
                f'<text x="{cx:.1f}" y="{top + plot_h + 14:.1f}" text-anchor="end" '
                f'font-size="10" fill="{FG3}" '
                f'transform="rotate(-32 {cx:.1f} {top + plot_h + 14:.1f})">{html.escape(label)}</text>'
            )
        else:
            parts.append(
                f'<text x="{cx:.1f}" y="{top + plot_h + 16:.1f}" text-anchor="middle" '
                f'font-size="10.5" fill="{FG3}">{html.escape(label)}</text>'
            )

    if x_title:
        parts.append(
            f'<text x="{left + plot_w / 2:.1f}" y="{height - 5}" text-anchor="middle" '
            f'font-size="10.5" fill="{FG4}">{html.escape(x_title)}</text>'
        )
    if y_title:
        cy = top + plot_h / 2
        parts.append(
            f'<text x="14" y="{cy:.1f}" text-anchor="middle" font-size="10.5" '
            f'fill="{FG4}" transform="rotate(-90 14 {cy:.1f})">{html.escape(y_title)}</text>'
        )

    parts.append("</svg>")
    return legend(series) + "".join(parts)


def donut(data: list[tuple[str, float, str]], size: int = 220) -> str:
    total = sum(v for _, v, _ in data)
    r = size / 2 - 16
    stroke = 26
    circ = 2 * math.pi * r
    cx = cy = size / 2
    parts = [
        f'<svg class="chart" viewBox="0 0 {size} {size}" width="{size}" height="{size}" role="img">'
    ]
    offset = 0.0
    for label, value, color in data:
        seg = circ * value / total
        parts.append(
            f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="{color}" '
            f'stroke-width="{stroke}" stroke-dasharray="{seg:.2f} {circ - seg:.2f}" '
            f'stroke-dashoffset="{-offset:.2f}" transform="rotate(-90 {cx} {cy})"/>'
        )
        offset += seg
    parts.append(
        f'<text x="{cx}" y="{cy - 2}" text-anchor="middle" font-size="19" '
        f'font-weight="590" fill="{FG}">{total:,.0f}</text>'
    )
    parts.append(
        f'<text x="{cx}" y="{cy + 15}" text-anchor="middle" font-size="10.5" '
        f'fill="{FG3}">kWh total</text>'
    )
    parts.append("</svg>")
    chips = "".join(
        f'<span class="lg"><i style="background:{color}"></i>{html.escape(label)} '
        f'<b>{value:,.1f}</b></span>'
        for label, value, color in data
    )
    return "".join(parts) + f'<div class="legend">{chips}</div>'


# --- content -----------------------------------------------------------------
OUTLIERS = [
    ("26 Jun (Thu)", "0.56", "12.8", "4%",
     "Left for Clarens at 17:00. Occupied until then; Bianca already off (0.56 kWh is a short morning, not an all-day idle).",
     "Confirmed"),
    ("27 Jun (Sat)", "2.76", "3.85", "72%",
     "Away. The 05:00 automation turned the Bianca on anyway. 2.76 kWh \u2248 24 h at ~115 W \u2014 boilers holding temp with nobody home.",
     "Confirmed \u2014 automation"),
    ("28\u201329 Jun", "0.88 \u2192 0", "1.90 \u2192 1.03", "46% \u2192 0",
     "Still away. Realised Sunday and disabled the automation that morning. 0.88 kWh is ~7\u20138 h from 05:00 until the disable. Monday is fridge/standby only.",
     "Confirmed"),
    ("30 Jun (Mon)", "0", "11.5", "0%",
     "Return day: house load comes back, Bianca stays off until 1 Jul.",
     "Confirmed"),
    ("11 Aug (Tue)", "0", "11.0", "0%",
     "No power in the morning, so the Bianca was never switched on. Power returned later: housekeeper still came, plus evening lights. Still no water, so no geyser and no espresso.",
     "Confirmed \u2014 outage, no water"),
    ("12 Aug (Wed)", "1.04", "2.17", "48%",
     "Geyser left off; Bianca left on at work. 1.04 kWh is boilers-on, nobody home. House 2.17 kWh with no geyser matches.",
     "Confirmed"),
    ("13 Aug (Thu)", "1.83", "22.9", "8%",
     "Catch-up after the outage and the geyser-off day.",
     "Confirmed rebound"),
    ("18\u201320 Jul", "1.89 / 1.47 / 0.74", "3.14 / 3.33 / 2.62", "60% / 44% / 28%",
     "Home, electricity on, no municipal water (Eikenhof / Northcliff system). Showers at the gym, so geyser and wet loads dropped out. Bianca still ran on its tank.",
     "Confirmed \u2014 water outage"),
    ("21 Jul (Tue)", "1.44", "23.1", "6%",
     "Highest house day in the series: water back, everything switching on again, and it was also housekeeper Tuesday. Two spikes stacked.",
     "Confirmed"),
    ("Tuesdays in general", "~1.0", "17.8 mean", "\u2014",
     "Housekeeper day \u2014 laundry, vacuum, extra geyser. Not weather.",
     "Confirmed"),
    ("19 Jun, 23 Jun, 26 Jul", "2.50 / 2.54 / 2.80", "16.4 / 21.8 / 15.0", "15% / 12% / 19%",
     "Bianca z-score above 2. Mix of guests and forgetting to switch it off. 26 Jul (Sunday, 2.80 kWh) is the series maximum.",
     "Confirmed"),
]

MONTHLY = [
    ("Jun", "30", "39.2", "368.5", "10.6%", "R119", "R1 120"),
    ("Jul", "31", "37.0", "394.1", "9.4%", "R123", "R1 309"),
    ("Aug (to 23rd)", "23", "29.2", "303.6", "9.6%", "R97", "R1 008"),
]

SUMMARY_STATS = [
    ("Bianca kWh", "1.26", "1.26", "0.57", "0", "2.80", "105.4"),
    ("House kWh", "12.69", "12.44", "4.36", "1.03", "23.07", "1 066"),
    ("Bianca share of house", "12.2%*", "9.9%", "11.7", "0%", "71.6%", "9.9% of kWh"),
    ("Bianca cost (R/day)", "4.03", "3.95", "1.83", "0", "9.30", "R339"),
]

COST_TABLE = [
    ("Bianca kWh", "105.4", "~38"),
    ("Bianca at sheet rates", "R339", "~R122"),
    ("House kWh", "1 066", "~387"),
    ("House at sheet rates", "R3 437", "~R1 250"),
    ("Annualised Bianca @ R3.32", "\u2014", "~R1 520 / yr"),
]


def stat(value: str, label: str) -> str:
    return f'<div class="stat"><div class="sv">{html.escape(value)}</div><div class="sl">{html.escape(label)}</div></div>'


def table(headers: list[str], rows: list[tuple[str, ...]], align: list[str], wide_col: int | None = None) -> str:
    ths = "".join(
        f'<th class="{align[i]}">{html.escape(h)}</th>' for i, h in enumerate(headers)
    )
    trs = []
    for row in rows:
        tds = "".join(
            f'<td class="{align[i]}{" wide" if wide_col == i else ""}">{html.escape(str(c))}</td>'
            for i, c in enumerate(row)
        )
        trs.append(f"<tr>{tds}</tr>")
    return (
        f'<div class="tablewrap"><table><thead><tr>{ths}</tr></thead>'
        f'<tbody>{"".join(trs)}</tbody></table></div>'
    )


def build() -> str:
    rows = load_rows()
    daily_house = [r["house"] for r in rows]
    daily_espresso = [r["espresso"] for r in rows]
    daily_labels = [
        r["date"].strftime("%-d %b") if i % 7 == 0 else "" for i, r in enumerate(rows)  # type: ignore[union-attr]
    ]
    daily_labels[-1] = rows[-1]["date"].strftime("%-d %b")  # type: ignore[union-attr]

    daily = line_chart(
        daily_labels,
        [
            {"name": "House kWh (smart meter)", "data": daily_house, "tone": "neutral"},
            {"name": "Bianca kWh (plug meter)", "data": daily_espresso, "tone": "info"},
        ],
        height=226,
        y_suffix="",
        y_title="Energy (kWh / day)",
        x_title="Date (2026)",
        ref_lines=[{"value": 1.26, "label": "Bianca mean 1.26 kWh", "tone": "info"}],
    )

    weekly = bar_chart(
        WEEK_LABELS,
        [
            {"name": "House kWh", "data": WEEK_HOUSE, "tone": "neutral"},
            {"name": "Bianca kWh", "data": WEEK_ESPRESSO, "tone": "info"},
        ],
        width=600,
        height=236,
        y_title="Energy (kWh / week)",
        rotate_labels=True,
    )

    temps = line_chart(
        WEEK_LABELS,
        [{"name": "Weekly mean outdoor temperature", "data": WEEK_TMEAN, "tone": "warning"}],
        width=380,
        height=236,
        y_suffix="",
        y_title="Temperature (\u00b0C)",
        begin_at_zero=False,
        fill=True,
        rotate_labels=True,
    )

    weekday = bar_chart(
        ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
        [
            {"name": "Mean house kWh", "data": WEEKDAY_HOUSE, "tone": "neutral"},
            {"name": "Mean Bianca kWh", "data": WEEKDAY_ESPRESSO, "tone": "info"},
        ],
        height=232,
        y_title="Mean energy (kWh / day)",
        x_title="Day of week (n = 12 each)",
    )

    ring = donut(
        [("Bianca", 105.4, C_INFO), ("Rest of house", 960.9, C_NEUTRAL)],
        size=194,
    )

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Northcliff electricity &middot; Jun\u2013Aug 2026</title>
<style>
  :root {{ color-scheme: dark; }}
  * {{ box-sizing: border-box; }}
  html, body {{ background: {BG}; }}
  body {{
    margin: 0; padding: 30px 34px 40px;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", sans-serif;
    font-size: 14px; line-height: 20px; color: {FG};
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }}
  h1 {{ font-size: 24px; line-height: 30px; font-weight: 590; margin: 0; letter-spacing: -0.2px; }}
  h2 {{ font-size: 18px; line-height: 24px; font-weight: 590; margin: 30px 0 4px; }}
  h3 {{ font-size: 15px; line-height: 22px; font-weight: 590; margin: 0 0 6px; }}
  p {{ margin: 0 0 10px; }}
  a {{ color: {LINK}; text-decoration: none; }}
  .sub {{ color: {FG2}; margin: 8px 0 0; max-width: 128ch; }}
  .cap {{ color: {FG3}; font-size: 12px; line-height: 16px; margin: 2px 0 10px; }}
  .muted {{ color: {FG3}; font-size: 12px; line-height: 17px; }}
  .rule {{ height: 1px; background: {STROKE3}; border: 0; margin: 26px 0 0; }}

  .stats {{ display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 22px 0 0; }}
  .stats.three {{ grid-template-columns: repeat(3, minmax(0, 1fr)); margin-top: 12px; }}
  .stat {{ border: 1px solid {STROKE3}; border-radius: 8px; padding: 12px 14px; background: {ELEVATED}; }}
  .sv {{ font-size: 21px; line-height: 26px; font-weight: 590; }}
  .sl {{ font-size: 12px; line-height: 16px; color: {FG3}; margin-top: 2px; }}

  .callout {{
    border: 1px solid {STROKE3}; border-left: 2px solid {C_INFO_SOLID};
    border-radius: 6px; background: {FILL4}; padding: 12px 14px; margin: 18px 0 0;
  }}
  .callout .ct {{ font-weight: 590; margin-bottom: 4px; }}
  .callout p:last-child {{ margin-bottom: 0; }}

  .cols {{ display: grid; grid-template-columns: 1fr 1fr; gap: 22px; }}
  .split {{ display: grid; grid-template-columns: 1.58fr 1fr; gap: 22px; align-items: start; }}
  .ring {{ display: grid; grid-template-columns: 230px 1fr; gap: 24px; align-items: center; }}

  .chart {{ display: block; margin-top: 2px; }}
  .block {{ break-inside: avoid; page-break-inside: avoid; }}
  .legend {{ display: flex; flex-wrap: wrap; gap: 14px; margin: 2px 0 2px; font-size: 11.5px; color: {FG2}; }}
  .lg {{ display: inline-flex; align-items: center; gap: 6px; }}
  .lg i {{ width: 9px; height: 9px; border-radius: 2px; display: inline-block; }}
  .lg b {{ color: {FG}; font-weight: 590; }}

  .tablewrap {{ border: 1px solid {STROKE3}; border-radius: 8px; overflow: hidden; margin-top: 8px; }}
  table {{ width: 100%; border-collapse: collapse; font-size: 12.5px; line-height: 17px; }}
  th {{
    text-align: left; font-weight: 590; font-size: 11.5px; color: {FG3};
    padding: 7px 11px; background: {FILL4}; border-bottom: 1px solid {STROKE3};
    text-transform: uppercase; letter-spacing: 0.3px;
  }}
  td {{ padding: 6px 11px; border-bottom: 1px solid {STROKE3}; vertical-align: top; }}
  tbody tr:last-child td {{ border-bottom: 0; }}
  tbody tr:nth-child(even) td {{ background: rgba(240,240,240,0.025); }}
  tr {{ break-inside: avoid; page-break-inside: avoid; }}
  td.right, th.right {{ text-align: right; white-space: nowrap; }}
  td.wide {{ min-width: 300px; color: {FG2}; }}

  .card {{
    border: 1px solid {STROKE3}; border-radius: 8px; background: {ELEVATED};
    padding: 0; margin-top: 12px; break-inside: avoid; page-break-inside: avoid;
  }}
  .card .ch {{
    display: flex; justify-content: space-between; align-items: baseline; gap: 12px;
    padding: 9px 14px; border-bottom: 1px solid {STROKE3};
    font-size: 12px; font-weight: 590; color: {FG2};
  }}
  .card .ch span {{ color: {FG4}; font-weight: 400; }}
  .card .cb {{ padding: 12px 14px; }}
  .card .cb p:last-child {{ margin-bottom: 0; }}

  thead {{ display: table-header-group; }}

  @page {{ size: A4 landscape; margin: 12mm; background: {BG}; }}
  @media print {{
    body {{ padding: 0; }}
    h2 {{ break-after: avoid; page-break-after: avoid; margin-top: 22px; }}
    .cap {{ break-after: avoid; page-break-after: avoid; }}
    .pb {{ break-before: page; page-break-before: always; margin-top: 0; }}
  }}
</style>
</head>
<body>

<header>
  <h1>Northcliff electricity &middot; June\u2013August 2026</h1>
  <p class="sub">Lelit Bianca plug meter versus City Power smart-meter house consumption, 1 June to 23 August 2026
  (84 consecutive days, no gaps). Weather is the Open-Meteo archive for Northcliff; tariff is the rate recorded in the sheet.</p>
</header>

<div class="stats">
  {stat("1.26 kWh", "Mean Bianca per day")}
  {stat("R4.03", "Mean Bianca cost per day")}
  {stat("9.9%", "Bianca share of house kWh")}
  {stat("R339", "Bianca over 84 days")}
</div>
<div class="stats three">
  {stat("12.7 kWh", "Mean house per day")}
  {stat("R3 437", "House energy at sheet rates")}
  {stat("+9.2%", "Rate step on 1 Jul (R3.04 \u2192 R3.32)")}
</div>

<div class="callout">
  <div class="ct">What the numbers say</div>
  <p>The Bianca is a stable load of about 1.3&nbsp;kWh per day \u2014 roughly a 50&nbsp;W idle machine left on, plus
  shots \u2014 and it is not what moves the house bill. House consumption is driven by occupancy, the geyser, and a handful
  of away, outage and no-water days. Outdoor temperature barely correlates with daily house use (r \u2248 0).</p>
</div>

<h2>Where the kilowatt-hours went</h2>
<div class="ring block">
  <div>{ring}</div>
  <div>
    <h3>By month</h3>
    {table(["Month", "Days", "Bianca kWh", "House kWh", "Share", "Bianca cost", "House cost"], MONTHLY,
           ["left", "right", "right", "right", "right", "right", "right"])}
    <p class="muted" style="margin-top:8px">Costs use the sheet rate (R3.04 then R3.32). July has the highest full-month
    house consumption, while Bianca energy is slightly <em>down</em> versus June. Excluding days where the house drew
    under 5&nbsp;kWh, the Bianca share is 9.2%.</p>
  </div>
</div>

<h2 class="pb">Daily consumption</h2>
<p class="cap">House (smart meter) and Bianca (plug meter), kWh per day. Dashed line is the Bianca mean.
Source: Elec usage sheet &middot; 1 Jun \u2013 23 Aug 2026.</p>
<div class="block">{daily}</div>

<h2>Weekly totals against Northcliff temperature</h2>
<div class="split">
  <div class="block">
    <h3>Weekly house and Bianca energy</h3>
    <p class="cap">ISO weeks, Monday to Sunday. The Clarens trip falls in 22\u201328 Jun and 29 Jun \u2013 5 Jul.
    Source: Elec usage sheet.</p>
    {weekly}
  </div>
  <div class="block">
    <h3>Weekly mean outdoor temperature</h3>
    <p class="cap">Open-Meteo archive, Northcliff. The week of 10\u201316 Aug is the cold front
    (11 Aug daytime high 5.9&nbsp;\u00b0C).</p>
    {temps}
  </div>
</div>

<h2 class="pb">Rhythm: weekday versus weekend</h2>
<p class="cap">Mean daily kWh by day of week. The Bianca is a weekend machine; the house peaks on Tuesday.
Source: Elec usage sheet, n = 12 of each weekday.</p>
<div class="block">{weekday}</div>
<div class="cols" style="margin-top:10px">
  <p>Weekend Bianca use is 1.57&nbsp;kWh per day against 1.13 on weekdays, about 39% higher. Saturday and Sunday are
  the two highest espresso days, consistent with more shots and longer heat-up rather than anything about weather.</p>
  <p>The Tuesday house mean is 17.8&nbsp;kWh, some 40% above the all-day mean of 12.7, and nearly every house day above
  18&nbsp;kWh is a Tuesday. Confirmed cause: housekeeper day, with laundry, vacuuming and extra geyser load.</p>
</div>

<h2>Tariff and bill</h2>
<div class="split">
  <div>
    <p>City Power's 2026/27 increase landed on 1 July: an 8.63% headline, with residential energy blocks up 9.01%.
    The sheet steps from R3.04 to R3.32, a 9.2% rise, which tracks the VAT-inclusive first block (officially
    R3.06 rising to R3.34 per kWh including VAT).</p>
    <p>Full months are 369&nbsp;kWh in June and 394&nbsp;kWh in July, which already crosses the 350&nbsp;kWh block-one
    cap, so a prepaid inclining-block bill runs slightly above a flat R3.32 \u2014 roughly R17 to R30 a month. That is
    immaterial for the Bianca, which uses about 38&nbsp;kWh a month and sits entirely inside block one.</p>
    <p class="muted">Sources:
      <a href="https://www.timeslive.co.za/news/south-africa/2026-07-01-joburg-households-have-to-deal-with-electricity-price-increase-from-july-1/">TimesLIVE, 1 Jul 2026</a> &middot;
      <a href="https://energybee.co.za/news/city-power-tariffs-july-2026-bill-breakdown">City Power tariff book, VAT-inclusive</a>.
      Fixed charges of about R242 a month on Residential Prepaid High are not in the sheet.</p>
  </div>
  <div>{table(["Item", "84-day", "Per month"], COST_TABLE, ["left", "right", "right"])}</div>
</div>

<h2 class="pb">Outliers, all accounted for</h2>
<p class="cap">Days where the house drew under 5&nbsp;kWh are not the espresso machine eating the bill. They are days
when the rest of the house dropped out \u2014 away, no water, or geyser off \u2014 so the machine's share looks large.</p>
{table(["Date", "Bianca", "House", "Share", "What happened", "Status"], OUTLIERS,
       ["left", "right", "right", "right", "left", "left"], wide_col=4)}

<h2 class="pb">Northcliff context</h2>
<div class="card">
  <div class="ch">Cold snap and local outages <span>11\u201313 Aug</span></div>
  <div class="cb">
    <p>Johannesburg recorded an unofficial August daytime high of only 5.9&nbsp;\u00b0C on 11 August, then reached
    27&nbsp;\u00b0C by 20 August. City Power logged more than 6&nbsp;000 outstanding outage calls during the front, and a
    Northcliff resident was reported without power from Tuesday morning until Wednesday afternoon. In this data: the
    Bianca was never switched on on the 11th; the house still drew about 11&nbsp;kWh from the housekeeper and evening
    lights after restoration; Wednesday was geyser-off with the machine left on; Thursday shows a 22.9&nbsp;kWh
    catch-up.</p>
    <p class="muted"><a href="https://www.dailymaverick.co.za/article/2026-08-13-cold-snap-exposes-the-obvious-joburg-s-power-grid-can-t-cope/">Daily Maverick, 13 Aug 2026</a> &middot;
    <a href="https://iol.co.za/news/south-africa/2026-08-20-record-cold-and-heat-in-just-one-week-the-most-extreme-temps-recorded-in-sas-cities/">IOL on the temperature swing</a></p>
  </div>
</div>
<div class="card">
  <div class="ch">Eikenhof failure and the Northcliff water system <span>16\u201319 Jul</span></div>
  <div class="cb">
    <p>A pole-mounted transformer fire at Eikenhof tripped the Orlando switching station. Johannesburg Water listed
    the Northcliff system among those that lost pumping, and local reporting had Northcliff and Linden on intermittent
    supply through 19 July. Confirmed here: you were home with electricity but no municipal water, showering at the
    gym. House consumption collapsed because the geyser and wet loads were off, not because the house was empty.</p>
    <p class="muted"><a href="https://www.news24.com/southafrica/news/power-outage-disrupts-water-supply-to-large-parts-of-southern-johannesburg-20260716-1045">News24, 16 Jul</a> &middot;
    <a href="https://www.citizen.co.za/northcliff-melville-times/news-headlines/local-news/2026/07/19/water-crisis-continues-across-northcliff-linden-as-recovery-remains-painfully-slow/">Northcliff Melville Times, 19 Jul</a></p>
  </div>
</div>
<div class="card">
  <div class="ch">Grid faults, not load shedding <span>Winter 2026</span></div>
  <div class="cb">
    <p>National load shedding was suspended through this period. Northcliff sits in City Power block 2, and the
    outages this winter were unplanned faults. Neighbouring Ward 86 was already under public warning in early June
    about overloaded feeders, cable theft, and plant between 60 and 100 years old. Cold weather raises metro demand
    and slows cable repairs, but in a single household that shows up as discrete outage days rather than a smooth
    temperature correlation.</p>
    <p class="muted"><a href="https://www.citizen.co.za/northcliff-melville-times/news-headlines/local-news/2026/06/02/ward-86-power-grid-under-pressure/">Northcliff Melville Times, 2 Jun</a></p>
  </div>
</div>

<h2 class="pb">Summary statistics</h2>
{table(["Metric", "Mean", "Median", "SD", "Min", "Max", "Total"], SUMMARY_STATS,
       ["left", "right", "right", "right", "right", "right", "right"])}
<p class="muted" style="margin-top:8px">* The mean of daily share percentages is inflated by away and outage days.
The energy-weighted figure is the honest one: 105.4 of 1&nbsp;066&nbsp;kWh, or 9.9%. Correlation between Bianca and
house consumption is only r = 0.22, rising to 0.31 once days under 5&nbsp;kWh are excluded. Correlation between
outdoor temperature and house consumption is approximately zero.</p>

<div class="callout" style="border-left-color:{C_WARN}">
  <div class="ct">The expensive-looking days were not the coffee</div>
  <p>Over the Clarens weekend the 05:00 automation ran the machine unattended for about 3.6&nbsp;kWh, roughly R11.
  From 18 to 20 July you were home without water, so the house looked like an empty one. Tuesdays are the
  housekeeper. Used as intended, the Bianca's run-rate stays near R4 a day, or about R1&nbsp;520 a year.</p>
</div>

<p class="muted" style="margin-top:22px">Sources: Elec usage \u2013 Sheet1.csv; Open-Meteo archive for Northcliff
(\u221226.14, 27.97); City of Johannesburg approved 2026/27 tariffs; Daily Maverick, News24, Northcliff Melville Times,
TimesLIVE and IOL as linked. Outlier explanations confirmed by the household.</p>

</body>
</html>
"""


if __name__ == "__main__":
    OUT_HTML.parent.mkdir(parents=True, exist_ok=True)
    OUT_HTML.write_text(build(), encoding="utf-8")
    print(f"wrote {OUT_HTML} ({OUT_HTML.stat().st_size / 1024:.1f} KB)")
