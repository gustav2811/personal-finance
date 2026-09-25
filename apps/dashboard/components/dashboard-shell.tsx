"use client";

import {
  Activity,
  Database,
  Gauge,
  Home,
  LockKeyhole,
  Radio,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useEffect, useMemo, useState } from "react";
import {
  fetchDashboardData,
  fetchDashboardDataFromLocalBridge,
  type ConsumptionDevice,
  type ConsumptionLedgerEntry,
  type ConsumptionReading,
  type DashboardData,
} from "../lib/data";
import { getPublicClient } from "../lib/supabase-browser";

const ALLOWED_EMAILS = new Set([
  "gustav@klingbiel.org",
  "cara@klingbiel.org",
]);
const HOUSEHOLD_TIMEZONE = "Africa/Johannesburg";
const IS_LOCAL_PREVIEW = process.env.NODE_ENV !== "production";

type ViewKey = "overview" | "energy" | "money" | "sources";
type RangeDays = 30 | 90 | 365;

type ChartPoint = {
  date: string;
  label: string;
  homeKwh: number;
  espressoKwh: number;
};

type MoneyPoint = {
  month: string;
  label: string;
  debits: number;
  credits: number;
};

type CustomTooltipProps = {
  active?: boolean;
  label?: string;
  payload?: Array<{
    color?: string;
    dataKey?: string | number;
    value?: number | string;
  }>;
};

const NAV_ITEMS: Array<{
  key: ViewKey;
  label: string;
  Icon: LucideIcon;
}> = [
  { key: "overview", label: "Overview", Icon: Home },
  { key: "energy", label: "Energy", Icon: Zap },
  { key: "money", label: "Money", Icon: Wallet },
  { key: "sources", label: "Sources", Icon: Radio },
];

const RANGE_ITEMS: Array<{ days: RangeDays; label: string }> = [
  { days: 30, label: "30D" },
  { days: 90, label: "90D" },
  { days: 365, label: "1Y" },
];

const VIEW_COPY: Record<
  ViewKey,
  { title: string; accent: string; subtitle: string }
> = {
  overview: {
    title: "Your home, in",
    accent: "orbit.",
    subtitle:
      "Energy, money, and the small signals that explain how the household moved.",
  },
  energy: {
    title: "Follow the",
    accent: "energy.",
    subtitle:
      "Whole-home demand alongside the devices that make the pattern personal.",
  },
  money: {
    title: "Keep an eye on",
    accent: "the bill.",
    subtitle:
      "Wallet movement, utility charges, and the financial record behind the usage.",
  },
  sources: {
    title: "Know what is",
    accent: "connected.",
    subtitle:
      "Every meter, plug, and ingestion run that gives the observatory its signal.",
  },
};

function localDateKey(timestamp: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: HOUSEHOLD_TIMEZONE,
    year: "numeric",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function shortDate(timestamp: string | null): string {
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat("en-ZA", {
    day: "numeric",
    month: "short",
    timeZone: HOUSEHOLD_TIMEZONE,
  }).format(new Date(timestamp));
}

function monthKey(timestamp: string): string {
  return localDateKey(timestamp).slice(0, 7);
}

function monthLabel(month: string): string {
  return new Intl.DateTimeFormat("en-ZA", {
    month: "short",
    year: "2-digit",
    timeZone: HOUSEHOLD_TIMEZONE,
  }).format(new Date(`${month}-01T00:00:00Z`));
}

function formatNumber(value: number, digits = 1): string {
  return new Intl.NumberFormat("en-ZA", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-ZA", {
    currency: "ZAR",
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
    style: "currency",
  }).format(value);
}

function toKwh(reading: ConsumptionReading): number | null {
  if (reading.metric !== "energy") return null;
  if (reading.unit.toLowerCase() === "wh") return reading.value / 1000;
  if (reading.unit.toLowerCase() === "kwh") return reading.value;
  return null;
}

function isWithinRange(timestamp: string | null, days: RangeDays): boolean {
  if (!timestamp) return false;
  return (
    new Date(timestamp).getTime() >=
    Date.now() - days * 24 * 60 * 60 * 1000
  );
}

function buildEnergySeries(
  readings: ConsumptionReading[],
  days: RangeDays,
): ChartPoint[] {
  const byDate = new Map<
    string,
    { homeKwh: number; espressoKwh: number }
  >();

  for (const reading of readings) {
    const value = toKwh(reading);
    if (value === null || !isWithinRange(reading.period_start, days)) continue;
    const date = localDateKey(reading.period_start);
    const point = byDate.get(date) ?? { homeKwh: 0, espressoKwh: 0 };
    if (reading.measurement_target === "whole_home") {
      point.homeKwh += value;
    }
    if (reading.measurement_target === "lelit-bianca") {
      point.espressoKwh += value;
    }
    byDate.set(date, point);
  }

  return [...byDate.entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([date, values]) => ({
      date,
      label: new Intl.DateTimeFormat("en-ZA", {
        day: "2-digit",
        month: "short",
        timeZone: HOUSEHOLD_TIMEZONE,
      }).format(new Date(`${date}T12:00:00+02:00`)),
      ...values,
    }));
}

function buildMoneySeries(
  entries: ConsumptionLedgerEntry[],
  days: RangeDays,
): MoneyPoint[] {
  const byMonth = new Map<string, { debits: number; credits: number }>();

  for (const entry of entries) {
    const timestamp = entry.occurred_at ?? entry.posted_at;
    if (!isWithinRange(timestamp, days)) continue;
    const month = monthKey(timestamp as string);
    const point = byMonth.get(month) ?? { debits: 0, credits: 0 };
    if (entry.direction === "debit") point.debits += entry.amount;
    if (entry.direction === "credit") point.credits += entry.amount;
    byMonth.set(month, point);
  }

  return [...byMonth.entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([month, values]) => ({
      month,
      label: monthLabel(month),
      ...values,
    }));
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function latestTimestampForDevice(
  device: ConsumptionDevice,
  readings: ConsumptionReading[],
): string | null {
  const deviceReadings = readings.filter(
    (reading) => reading.device_id === device.id,
  );
  return (
    deviceReadings
      .map((reading) => reading.period_end)
      .sort((first, second) => second.localeCompare(first))[0] ?? null
  );
}

function sourceClass(device: ConsumptionDevice): string {
  if (device.utility_type === "water") return "water";
  if (device.utility_type === "wallet") return "wallet";
  if (device.kind === "smart_plug") return "plug";
  return "";
}

function sourceKind(device: ConsumptionDevice): string {
  if (device.utility_type === "wallet") return "wallet";
  if (device.utility_type === "water") return "invoice";
  if (device.kind === "smart_plug") return "smart plug";
  return "meter";
}

function OrbitTooltip({
  active,
  label,
  payload,
}: CustomTooltipProps) {
  if (!active || !payload?.length) return null;

  return (
    <div className="tooltip-box">
      <p className="tooltip-date">{label}</p>
      {payload.map((item) => {
        const isEspresso = item.dataKey === "espressoKwh";
        return (
          <div className="tooltip-row" key={String(item.dataKey)}>
            <span>
              <i
                className={`tooltip-dot${isEspresso ? " espresso" : ""}`}
              />
              {isEspresso ? "Espresso" : "Whole home"}
            </span>
            <strong>{formatNumber(Number(item.value ?? 0))} kWh</strong>
          </div>
        );
      })}
    </div>
  );
}

function MoneyTooltip({ active, label, payload }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;

  return (
    <div className="tooltip-box">
      <p className="tooltip-date">{label}</p>
      {payload.map((item) => (
        <div className="tooltip-row" key={String(item.dataKey)}>
          <span>
            <i
              className={`tooltip-dot${
                item.dataKey === "credits" ? " espresso" : ""
              }`}
            />
            {item.dataKey === "credits" ? "Credits" : "Debits"}
          </span>
          <strong>{formatMoney(Number(item.value ?? 0))}</strong>
        </div>
      ))}
    </div>
  );
}

function EnergyChart({
  series,
  showNote = true,
}: {
  series: ChartPoint[];
  showNote?: boolean;
}) {
  return (
    <>
      <div className="chart-wrap">
        {series.length > 0 ? (
          <ResponsiveContainer height="100%" width="100%">
            <LineChart data={series} margin={{ top: 7, right: 15, bottom: 0, left: 4 }}>
              <CartesianGrid strokeDasharray="2 7" />
              <XAxis
                axisLine={false}
                dataKey="label"
                minTickGap={26}
                tickLine={false}
              />
              <YAxis
                axisLine={false}
                tickFormatter={(value: number) => `${value}`}
                tickLine={false}
                width={32}
              />
              <Tooltip
                content={<OrbitTooltip />}
                cursor={{ stroke: "rgba(216, 228, 232, 0.18)" }}
              />
              <Line
                activeDot={{ fill: "#a6e3a1", r: 4, stroke: "#0b1013", strokeWidth: 2 }}
                dataKey="homeKwh"
                dot={false}
                name="Whole home"
                stroke="#a6e3a1"
                strokeWidth={2.2}
                type="monotone"
              />
              <Line
                activeDot={{ fill: "#f0c674", r: 4, stroke: "#0b1013", strokeWidth: 2 }}
                dataKey="espressoKwh"
                dot={false}
                name="Espresso"
                stroke="#f0c674"
                strokeWidth={1.8}
                type="monotone"
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="empty-state">
            No daily energy readings in this range.
          </div>
        )}
      </div>
      {showNote ? (
        <p className="chart-note">
          <Activity size={13} />
          <span>
            <strong>Read the gap:</strong> the amber orbit is the espresso
            machine; the mint orbit is the whole home.
          </span>
        </p>
      ) : null}
    </>
  );
}

function MoneyChart({ series }: { series: MoneyPoint[] }) {
  return (
    <div className="money-chart-wrap">
      {series.length > 0 ? (
        <ResponsiveContainer height="100%" width="100%">
          <BarChart data={series} margin={{ top: 7, right: 15, bottom: 0, left: 4 }}>
            <CartesianGrid strokeDasharray="2 7" />
            <XAxis
              axisLine={false}
              dataKey="label"
              minTickGap={20}
              tickLine={false}
            />
            <YAxis
              axisLine={false}
              tickFormatter={(value: number) => `R${value}`}
              tickLine={false}
              width={40}
            />
            <Tooltip
              content={<MoneyTooltip />}
              cursor={{ fill: "rgba(216, 228, 232, 0.04)" }}
            />
            <Bar dataKey="debits" fill="#f0c674" maxBarSize={18} radius={[3, 3, 0, 0]} />
            <Bar dataKey="credits" fill="#8fb9d4" maxBarSize={18} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div className="empty-state">No wallet movement in this range.</div>
      )}
    </div>
  );
}

function SectionHeader({
  title,
  caption,
  meta,
}: {
  title: string;
  caption: string;
  meta?: string;
}) {
  return (
    <div className="panel-heading">
      <div>
        <h2 className="panel-title">{title}</h2>
        <p className="panel-caption">{caption}</p>
      </div>
      {meta ? <span className="panel-meta">{meta}</span> : null}
    </div>
  );
}

function Metric({
  label,
  value,
  detail,
  primary = false,
}: {
  label: string;
  value: string;
  detail: string;
  primary?: boolean;
}) {
  return (
    <div className={`metric${primary ? " primary" : ""}`}>
      <div className="metric-label">
        <span>{label}</span>
        <i className="metric-signal" />
      </div>
      <p className="metric-value">{value}</p>
      <p className="metric-detail">{detail}</p>
    </div>
  );
}

function Signals({
  series,
  entries,
  days,
}: {
  series: ChartPoint[];
  entries: ConsumptionLedgerEntry[];
  days: RangeDays;
}) {
  const largestDay = series.reduce<ChartPoint | null>(
    (largest, point) =>
      !largest || point.homeKwh > largest.homeKwh ? point : largest,
    null,
  );
  const homeTotal = sum(series.map((point) => point.homeKwh));
  const espressoTotal = sum(series.map((point) => point.espressoKwh));
  const espressoShare = homeTotal > 0 ? (espressoTotal / homeTotal) * 100 : 0;
  const waterEntry = entries
    .filter(
      (entry) =>
        entry.utility_type === "water" &&
        entry.direction === "debit" &&
        isWithinRange(entry.occurred_at ?? entry.posted_at, days),
    )
    .sort((first, second) =>
      (second.occurred_at ?? "").localeCompare(first.occurred_at ?? ""),
    )[0];
  const walletTotal = sum(
    entries
      .filter(
        (entry) =>
          entry.utility_type === "wallet" &&
          entry.direction === "debit" &&
          isWithinRange(entry.occurred_at ?? entry.posted_at, days),
      )
      .map((entry) => entry.amount),
  );

  return (
    <section className="panel">
      <SectionHeader
        caption="The small facts worth following"
        meta="Signal board"
        title="What moved"
      />
      <div className="signal-list">
        <div className="signal-item">
          <i className="signal-orbit" />
          <div>
            <p className="signal-label">Highest home day</p>
            <p className="signal-copy">
              {largestDay
                ? `The household peaked on ${largestDay.label}.`
                : "Waiting for a whole-home series."}
            </p>
          </div>
          <div className="signal-value">
            {largestDay ? `${formatNumber(largestDay.homeKwh)} kWh` : "—"}
            <span className="signal-time">
              {largestDay ? shortDate(`${largestDay.date}T12:00:00+02:00`) : ""}
            </span>
          </div>
        </div>
        <div className="signal-item">
          <i className="signal-orbit" />
          <div>
            <p className="signal-label">Espresso orbit</p>
            <p className="signal-copy">
              Bianca&apos;s share of the measured whole-home signal.
            </p>
          </div>
          <div className="signal-value">{formatNumber(espressoShare)}%</div>
        </div>
        <div className="signal-item">
          <i className="signal-orbit" />
          <div>
            <p className="signal-label">Wallet charges</p>
            <p className="signal-copy">
              Fees and wallet-level movement in the selected window.
            </p>
          </div>
          <div className="signal-value">{formatMoney(walletTotal)}</div>
        </div>
        <div className="signal-item">
          <i className="signal-orbit" />
          <div>
            <p className="signal-label">Water invoice</p>
            <p className="signal-copy">
              Water is tracked as a monthly charge, not a meter reading.
            </p>
          </div>
          <div className="signal-value">
            {waterEntry ? formatMoney(waterEntry.amount) : "—"}
            <span className="signal-time">
              {waterEntry ? shortDate(waterEntry.occurred_at) : "not in range"}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

function SourcesPanel({
  devices,
  readings,
}: {
  devices: ConsumptionDevice[];
  readings: ConsumptionReading[];
}) {
  return (
    <section className="panel">
      <SectionHeader
        caption="Physical and logical signals"
        meta={`${devices.length} connected`}
        title="The household constellation"
      />
      <div className="source-list">
        {devices.length > 0 ? (
          devices.map((device) => (
            <div className="source-row" key={device.id}>
              <div className="source-name">
                <i className={`source-swatch ${sourceClass(device)}`} />
                <div>
                  <strong>{device.name}</strong>
                  <span>
                    {device.source} · {device.external_id}
                  </span>
                </div>
              </div>
              <span className="source-kind">{sourceKind(device)}</span>
              <span className="source-state">
                {latestTimestampForDevice(device, readings) ? "live" : "quiet"}
              </span>
            </div>
          ))
        ) : (
          <div className="empty-state">No devices connected yet.</div>
        )}
      </div>
    </section>
  );
}

function Overview({
  data,
  days,
}: {
  data: DashboardData;
  days: RangeDays;
}) {
  const series = useMemo(
    () => buildEnergySeries(data.readings, days),
    [data.readings, days],
  );
  const moneySeries = useMemo(
    () => buildMoneySeries(data.ledgerEntries, days),
    [data.ledgerEntries, days],
  );
  const homeTotal = sum(series.map((point) => point.homeKwh));
  const espressoTotal = sum(series.map((point) => point.espressoKwh));
  const electricityEntries = data.ledgerEntries.filter(
    (entry) =>
      entry.utility_type === "electricity" &&
      entry.direction === "debit" &&
      isWithinRange(entry.occurred_at ?? entry.posted_at, days),
  );
  const electricityCost = sum(
    electricityEntries.map((entry) => entry.amount),
  );
  const knownQuantity = sum(
    electricityEntries
      .map((entry) => entry.quantity ?? 0)
      .filter((quantity) => quantity > 0),
  );
  const weightedRate =
    knownQuantity > 0 ? electricityCost / knownQuantity : null;
  const latestSnapshot = [...data.financialSnapshots].sort((first, second) =>
    second.date.localeCompare(first.date),
  )[0];

  return (
    <>
      <section className="metric-strip">
        <Metric
          detail={`${series.length} days with whole-home readings`}
          label="Whole-home energy"
          primary
          value={`${formatNumber(homeTotal)} kWh`}
        />
        <Metric
          detail={`${formatNumber(espressoTotal)} kWh in range`}
          label="Espresso orbit"
          value={`${homeTotal > 0 ? formatNumber((espressoTotal / homeTotal) * 100) : "0.0"}%`}
        />
        <Metric
          detail={weightedRate ? "weighted from electricity charges" : "rate not available"}
          label="Effective rate"
          value={weightedRate ? `R${formatNumber(weightedRate, 2)}` : "—"}
        />
        <Metric
          detail={latestSnapshot ? `as at ${shortDate(latestSnapshot.date)}` : "from wallet ledger"}
          label="Energy cost"
          value={electricityCost ? formatMoney(electricityCost) : "—"}
        />
      </section>

      <div className="orbit-layout">
        <section className="panel">
          <SectionHeader
            caption="Native readings, aligned by local household date"
            meta={`${days === 365 ? "last year" : `last ${days} days`}`}
            title="The energy constellation"
          />
          <div className="chart-legend">
            <span className="legend-item">
              <i className="legend-line" />
              Whole home
            </span>
            <span className="legend-item">
              <i className="legend-line espresso" />
              Espresso
            </span>
          </div>
          <EnergyChart series={series} />
        </section>
        <Signals days={days} entries={data.ledgerEntries} series={series} />
      </div>

      <div className="bottom-grid">
        <section className="panel">
          <SectionHeader
            caption="Debit and credit movement from the utility wallet"
            meta="ZAR"
            title="Money in motion"
          />
          <MoneyChart series={moneySeries} />
        </section>
        <SourcesPanel devices={data.devices} readings={data.readings} />
      </div>
    </>
  );
}

function EnergyView({
  data,
  days,
}: {
  data: DashboardData;
  days: RangeDays;
}) {
  const series = useMemo(
    () => buildEnergySeries(data.readings, days),
    [data.readings, days],
  );
  const recentReadings = [...data.readings]
    .filter((reading) => isWithinRange(reading.period_start, days))
    .sort((first, second) =>
      second.period_start.localeCompare(first.period_start),
    )
    .slice(0, 18);
  const deviceNames = new Map(data.devices.map((device) => [device.id, device.name]));

  return (
    <div className="data-view">
      <section className="panel">
        <SectionHeader
          caption="Daily traces preserve the source's native resolution"
          meta={`${series.length} plotted days`}
          title="Energy, without the smoothing"
        />
        <div className="chart-legend">
          <span className="legend-item">
            <i className="legend-line" />
            Whole home
          </span>
          <span className="legend-item">
            <i className="legend-line espresso" />
            Espresso
          </span>
        </div>
        <EnergyChart series={series} />
      </section>
      <section className="panel">
        <div className="view-intro">
          <h2>Recent readings</h2>
          <p>
            The exact rows behind the plotted signals. ISMRT energy remains in
            native Wh at rest and is normalised to kWh only for display.
          </p>
        </div>
        {recentReadings.length > 0 ? (
          <table className="reading-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Target</th>
                <th>Source</th>
                <th>Reading</th>
              </tr>
            </thead>
            <tbody>
              {recentReadings.map((reading) => {
                const value = toKwh(reading);
                return (
                  <tr key={reading.id}>
                    <td>{shortDate(reading.period_start)}</td>
                    <td>{reading.measurement_target}</td>
                    <td>{deviceNames.get(reading.device_id) ?? reading.source}</td>
                    <td>
                      {value === null
                        ? `${formatNumber(reading.value)} ${reading.unit}`
                        : `${formatNumber(value)} kWh`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="empty-state">No readings in this range.</div>
        )}
      </section>
    </div>
  );
}

function MoneyView({
  data,
  days,
}: {
  data: DashboardData;
  days: RangeDays;
}) {
  const moneySeries = useMemo(
    () => buildMoneySeries(data.ledgerEntries, days),
    [data.ledgerEntries, days],
  );
  const entries = [...data.ledgerEntries]
    .filter((entry) => isWithinRange(entry.occurred_at ?? entry.posted_at, days))
    .sort((first, second) =>
      (second.occurred_at ?? "").localeCompare(first.occurred_at ?? ""),
    )
    .slice(0, 24);
  const deviceNames = new Map(data.devices.map((device) => [device.id, device.name]));
  const debitTotal = sum(
    entries
      .filter((entry) => entry.direction === "debit")
      .map((entry) => entry.amount),
  );
  const latestSnapshot = [...data.financialSnapshots].sort((first, second) =>
    second.date.localeCompare(first.date),
  )[0];

  return (
    <div className="data-view">
      {data.financialError ? (
        <div className="error-state">
          <div>
            <strong>Financial tables need a read policy</strong>
            <span>
              Utility wallet data is available. Existing transaction and
              snapshot tables are not exposed to this authenticated role yet.
            </span>
          </div>
        </div>
      ) : null}
      <section className="panel">
        <SectionHeader
          caption="Wallet ledger, with debits and credits kept distinct"
          meta={`${entries.length} recent rows`}
          title="The financial orbit"
        />
        <MoneyChart series={moneySeries} />
        <p className="chart-note">
          <Wallet size={13} />
          <span>
            <strong>{formatMoney(debitTotal)}</strong> in utility ledger
            debits for this window.
          </span>
        </p>
      </section>
      <section className="panel">
        <div className="view-intro">
          <h2>Ledger entries</h2>
          <p>
            Charges, fees, deposits, and water invoices remain source facts.
            Nothing here silently turns an invoice into a meter reading.
          </p>
        </div>
        {entries.length > 0 ? (
          <table className="reading-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Device</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{shortDate(entry.occurred_at ?? entry.posted_at)}</td>
                  <td>{entry.entry_type.replaceAll("_", " ")}</td>
                  <td>{deviceNames.get(entry.device_id) ?? entry.utility_type}</td>
                  <td>
                    {entry.direction === "credit" ? "+" : "−"}
                    {formatMoney(entry.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty-state">No ledger entries in this range.</div>
        )}
      </section>
      <section className="panel">
        <div className="view-intro">
          <h2>Transactional finance</h2>
          <p>
            {data.financialTransactions.length > 0
              ? `${data.financialTransactions.length} imported transaction records are available to connect to this view.`
              : "No transactional records are visible to this role yet."}
          </p>
          {latestSnapshot ? (
            <p className="chart-note">
              <Gauge size={13} />
              <span>
                Latest tracked balance:{" "}
                <strong>
                  {formatMoney(latestSnapshot.amount_cents / 100)}
                </strong>
              </span>
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function SourcesView({ data }: { data: DashboardData }) {
  return (
    <div className="data-view">
      <SourcesPanel devices={data.devices} readings={data.readings} />
      <section className="panel">
        <div className="view-intro">
          <h2>Ingestion pulse</h2>
          <p>
            Each runner writes its own audit row. The dashboard reads this
            status; it never writes to the ingestion pipeline.
          </p>
        </div>
        {data.ingestionRuns.length > 0 ? (
          <table className="reading-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Runner</th>
                <th>Status</th>
                <th>Rows</th>
              </tr>
            </thead>
            <tbody>
              {data.ingestionRuns.slice(0, 15).map((run) => (
                <tr key={run.id}>
                  <td>{run.source}</td>
                  <td>{run.runner}</td>
                  <td>{run.status}</td>
                  <td>{formatNumber(run.rows_written, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty-state">No ingestion runs recorded yet.</div>
        )}
      </section>
      <section className="panel">
        <div className="view-intro">
          <h2>Data ownership</h2>
          <p>
            Raw events and source identifiers stay in Supabase so this view can
            evolve without asking a provider to explain your own history.
          </p>
        </div>
        <div className="signal-list">
          <div className="signal-item">
            <i className="signal-orbit" />
            <div>
              <p className="signal-label">Read-only surface</p>
              <p className="signal-copy">
                This app uses the authenticated browser role for reads only.
              </p>
            </div>
          </div>
          <div className="signal-item">
            <i className="signal-orbit" />
            <div>
              <p className="signal-label">Source lineage</p>
              <p className="signal-copy">
                Every reading and ledger fact keeps its source and raw-event
                relationship.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function AuthScreen({
  error,
  denied = false,
  onSignIn,
  signingIn,
}: {
  error: string | null;
  denied?: boolean;
  onSignIn: () => void;
  signingIn: boolean;
}) {
  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <div className="brand auth-brand">
          <span aria-hidden="true" className="brand-mark" />
          <div>
            <span className="brand-name">Common Orbit</span>
            <span className="brand-subtitle">Household observatory</span>
          </div>
        </div>
        <h1 className="auth-title">
          Your home, <em>in orbit.</em>
        </h1>
        <p className="auth-copy">
          A private read-only view of energy, money, and the signals that
          connect them.
        </p>
        {denied ? (
          <div className="error-state">
            <div>
              <strong>This observatory is private.</strong>
              <span>Use an approved household Google account.</span>
            </div>
          </div>
        ) : (
          <button
            className="google-button"
            disabled={signingIn}
            onClick={onSignIn}
            type="button"
          >
            <span className="google-icon">G</span>
            {signingIn ? "Opening Google…" : "Continue with Google"}
          </button>
        )}
        {error ? (
          <p className="auth-footnote" role="alert">
            {error}
          </p>
        ) : (
          <p className="auth-footnote">
            Access limited to gustav@klingbiel.org and cara@klingbiel.org
          </p>
        )}
      </section>
    </main>
  );
}

function AppNavigation({
  activeView,
  email,
  isLocalPreview,
  onSignOut,
  onViewChange,
}: {
  activeView: ViewKey;
  email: string;
  isLocalPreview: boolean;
  onSignOut: () => void;
  onViewChange: (view: ViewKey) => void;
}) {
  return (
    <aside className="app-nav">
      <div className="brand">
        <span aria-hidden="true" className="brand-mark" />
        <div>
          <span className="brand-name">Common Orbit</span>
          <span className="brand-subtitle">Household observatory</span>
        </div>
      </div>
      <p className="nav-heading">Navigate</p>
      <nav aria-label="Primary navigation">
        <ul className="nav-list">
          {NAV_ITEMS.map(({ key, label, Icon }) => (
            <li key={key}>
              <button
                aria-current={activeView === key ? "page" : undefined}
                className="nav-link"
                onClick={() => onViewChange(key)}
                type="button"
              >
                <span aria-hidden="true" className="nav-icon">
                  <Icon size={17} strokeWidth={1.7} />
                </span>
                <span>{label}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="nav-footer">
        <p className="privacy-note">
          <LockKeyhole size={13} />
          <span>
            {isLocalPreview
              ? "Local preview. Service key stays server-side."
              : "Private to this household. Read-only by design."}
          </span>
        </p>
        {isLocalPreview ? (
          <p className="privacy-note">
            <Database size={13} />
            <span>Local data bridge</span>
          </p>
        ) : (
          <>
            <p className="privacy-note">
              <Database size={13} />
              <span>{email}</span>
            </p>
            <button className="sign-out" onClick={onSignOut} type="button">
              Sign out
            </button>
          </>
        )}
      </div>
    </aside>
  );
}

export function DashboardShell() {
  const [authState, setAuthState] = useState<
    "loading" | "signed_out" | "denied" | "ready" | "error"
  >("loading");
  const [authError, setAuthError] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState("");
  const [data, setData] = useState<DashboardData | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [activeView, setActiveView] = useState<ViewKey>("overview");
  const [rangeDays, setRangeDays] = useState<RangeDays>(90);

  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | undefined;

    async function initialize() {
      if (IS_LOCAL_PREVIEW) {
        if (mounted) {
          setUserEmail("local preview");
          setAuthState("ready");
        }
        try {
          const dashboardData = await fetchDashboardDataFromLocalBridge();
          if (mounted) setData(dashboardData);
        } catch {
          if (mounted) {
            setDataError(
              "Local data bridge is unavailable. Start the dashboard with the repository .env loaded.",
            );
          }
        }
        return;
      }

      try {
        const supabase = getPublicClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session) {
          if (mounted) setAuthState("signed_out");
          return;
        }

        const {
          data: { user },
          error,
        } = await supabase.auth.getUser();
        if (error || !user?.email) {
          throw new Error("Your Google session could not be verified.");
        }

        const email = user.email.toLowerCase();
        const isGoogleIdentity =
          user.identities?.some((identity) => identity.provider === "google") ??
          false;
        if (!ALLOWED_EMAILS.has(email) || !isGoogleIdentity) {
          await supabase.auth.signOut();
          if (mounted) {
            setAuthState("denied");
            setUserEmail("");
          }
          return;
        }

        if (mounted) {
          setUserEmail(email);
          setAuthState("ready");
        }

        try {
          const dashboardData = await fetchDashboardData();
          if (mounted) setData(dashboardData);
        } catch {
          if (mounted) {
            setDataError(
              "Household data could not be read. Check the Supabase schema exposure and read policies.",
            );
          }
        }

        const subscription = supabase.auth.onAuthStateChange((event) => {
          if (event === "SIGNED_OUT" && mounted) {
            setAuthState("signed_out");
            setData(null);
          }
        });
        unsubscribe = () => subscription.data.subscription.unsubscribe();
      } catch (error) {
        if (mounted) {
          setAuthState("error");
          setAuthError(
            error instanceof Error
              ? error.message
              : "Dashboard configuration is incomplete.",
          );
        }
      }
    }

    void initialize();
    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);

  async function signIn() {
    setSigningIn(true);
    setAuthError(null);
    try {
      const supabase = getPublicClient();
      const { error } = await supabase.auth.signInWithOAuth({
        options: {
          redirectTo: window.location.origin,
        },
        provider: "google",
      });
      if (error) setAuthError("Google sign-in could not start.");
    } catch {
      setAuthError("Dashboard configuration is incomplete.");
    } finally {
      setSigningIn(false);
    }
  }

  async function signOut() {
    await getPublicClient().auth.signOut();
    setAuthState("signed_out");
    setData(null);
  }

  if (authState === "loading") {
    return <div className="loading-state">Checking household access…</div>;
  }

  if (
    authState === "signed_out" ||
    authState === "denied" ||
    authState === "error"
  ) {
    return (
      <AuthScreen
        denied={authState === "denied"}
        error={authError}
        onSignIn={() => void signIn()}
        signingIn={signingIn}
      />
    );
  }

  if (dataError || !data) {
    return (
      <div className="loading-state">
        {dataError ?? "Loading the household constellation…"}
      </div>
    );
  }

  const viewCopy = VIEW_COPY[activeView];

  return (
    <div className="app-shell">
      <AppNavigation
        activeView={activeView}
        email={userEmail}
        isLocalPreview={IS_LOCAL_PREVIEW}
        onSignOut={() => void signOut()}
        onViewChange={setActiveView}
      />
      <main className="main-content">
        <header className="topbar">
          <div>
            <h1 className="page-title">
              {viewCopy.title} <em>{viewCopy.accent}</em>
            </h1>
            <p className="page-subtitle">{viewCopy.subtitle}</p>
          </div>
          <div className="status-stack">
            <span className="status-pill">
              <i className="status-dot" />
              {IS_LOCAL_PREVIEW ? "Local data bridge" : "Supabase live"}
            </span>
            <div aria-label="Time range" className="range-control" role="group">
              {RANGE_ITEMS.map(({ days, label }) => (
                <button
                  aria-pressed={rangeDays === days}
                  className="range-button"
                  key={days}
                  onClick={() => setRangeDays(days)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </header>
        {activeView === "overview" ? (
          <Overview data={data} days={rangeDays} />
        ) : null}
        {activeView === "energy" ? (
          <EnergyView data={data} days={rangeDays} />
        ) : null}
        {activeView === "money" ? (
          <MoneyView data={data} days={rangeDays} />
        ) : null}
        {activeView === "sources" ? <SourcesView data={data} /> : null}
      </main>
    </div>
  );
}
