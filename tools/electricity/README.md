# Household electricity analysis

`build_report.py` renders the Northcliff household electricity analysis as a
standalone dark-themed HTML report with inline SVG charts.

## Source and output

- Input: `data/consumption/electricity/raw/Elec usage - Sheet1.csv`
- HTML output: `reports/electricity/northcliff-electricity-jun-aug-2026.html`
- PDF output: the matching PDF in `reports/electricity/`, generated from the
  HTML with a local headless browser.

Run from the repository root:

```bash
set -a; source .env; set +a
python3 tools/electricity/load_espresso_to_supabase.py
python3 tools/electricity/build_report.py
```

`load_espresso_to_supabase.py` backfills the daily Lelit Bianca readings from
the CSV into the `bneta` device in the `consumption` schema. It preserves the
CSV house usage, tariff, proportion, and source row as reading metadata, and is
safe to rerun.

The input and reports contain private household data and are ignored by Git.
