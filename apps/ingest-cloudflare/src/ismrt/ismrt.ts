import { InvalidSourceDataError } from "../errors.js";

const TOKEN_URL =
  "https://account.rmsconnect.net/auth/realms/rms/protocol/openid-connect/token";
const GRAPHQL_URL = "https://api-gateway.rmsconnect.net/graphql";
const CLIENT_ID = "ismrt-dashboard";
const DAILY_INTERVAL = "1440";
const REQUEST_TIMEOUT_MS = 30_000;

export class IsmrtError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IsmrtError";
  }
}

export type IsmrtCredentials = {
  username: string;
  password: string;
};

export type IsmrtWallet = {
  id: string;
  propertyName: string;
  premiseName: string | null;
  accountReference: string | null;
  isActive: boolean;
};

export type IsmrtMeter = {
  id: string | null;
  serial: string;
};

export type IsmrtExpense = {
  utilityType: string;
  charge: string | null;
  debit: number | null;
  credit: number | null;
  rate: number | null;
  date: string;
  meterSerial: string | null;
  consumption: number | null;
  reference: string | null;
};

export type IsmrtDeposit = {
  date: string;
  credit: number | null;
};

export type IsmrtDocument = {
  idKey: string;
  documentNumber: string | null;
  documentDate: string;
  total: number;
};

export type IsmrtMeasure = {
  name: string;
  consumption: number | null;
  unit: string | null;
  displayName: string | null;
  startValue: number | null;
  endValue: number | null;
};

export type IsmrtInterval = {
  startDate: string;
  endDate: string;
  measures: IsmrtMeasure[];
};

export type IsmrtProfile = {
  serial: string;
  intervalMinutes: number;
  intervals: IsmrtInterval[];
};

export class IsmrtClient {
  private accessToken: string | null = null;

  constructor(
    private readonly credentials: IsmrtCredentials,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async authenticate(): Promise<void> {
    const body = new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: "password",
      username: this.credentials.username,
      password: this.credentials.password,
    });
    const response = await this.fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new IsmrtError(`token request failed (${response.status})`);
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new InvalidSourceDataError("token response was not valid JSON");
    }
    const token = field(payload, "access_token");
    if (typeof token !== "string" || token.length === 0) {
      throw new InvalidSourceDataError("token response missing access_token");
    }
    this.accessToken = token;
  }

  async listWallets(): Promise<IsmrtWallet[]> {
    const data = await this.graphql(
      `query UserWallets {
        userWallets { nodes { id propertyName premiseName accountReference isActive } }
      }`,
      undefined,
      "UserWallets",
    );
    return nodes(data, "userWallets").map((node, index) => ({
      id: requiredString(node, "id", `userWallets[${index}]`),
      propertyName: requiredString(node, "propertyName", `userWallets[${index}]`),
      premiseName: optionalString(node, "premiseName"),
      accountReference: optionalString(node, "accountReference"),
      isActive: node.isActive !== false,
    }));
  }

  async listMeters(walletId: string): Promise<IsmrtMeter[]> {
    const data = await this.graphql(
      `query WalletMeters($id: ID!) {
        wallet(id: $id) {
          contracts { nodes { service { meters { nodes { id serial } } } } }
        }
      }`,
      { id: walletId },
      "WalletMeters",
    );
    const wallet = field(data, "wallet");
    if (!isRecord(wallet)) {
      throw new InvalidSourceDataError("wallet meters response missing wallet");
    }
    const contracts = nodes(wallet, "contracts");
    const meters: IsmrtMeter[] = [];
    for (const contract of contracts) {
      const service = field(contract, "service");
      if (!isRecord(service)) continue;
      for (const meter of nodes(service, "meters")) {
        const serial = optionalString(meter, "serial");
        if (!serial) continue;
        meters.push({ id: optionalString(meter, "id"), serial });
      }
    }
    return meters;
  }

  async listExpenses(walletId: string, start: string, end: string): Promise<IsmrtExpense[]> {
    const data = await this.graphql(
      `query WalletExpenseTransactions($id: ID!, $startDate: DateTime!, $endDate: DateTime!) {
        walletExpenseTransactions(id: $id, startDate: $startDate, endDate: $endDate) {
          nodes { utilityType charge debit credit rate date meterSerial consumption reference }
        }
      }`,
      { id: walletId, startDate: start, endDate: end },
      "WalletExpenseTransactions",
    );
    return nodes(data, "walletExpenseTransactions").map((node, index) => ({
      utilityType: requiredString(node, "utilityType", `expense[${index}]`),
      charge: optionalString(node, "charge"),
      debit: optionalNumber(node, "debit"),
      credit: optionalNumber(node, "credit"),
      rate: optionalNumber(node, "rate"),
      date: requiredString(node, "date", `expense[${index}]`),
      meterSerial: optionalString(node, "meterSerial"),
      consumption: optionalNumber(node, "consumption"),
      reference: optionalString(node, "reference"),
    }));
  }

  async listDeposits(walletId: string, start: string, end: string): Promise<IsmrtDeposit[]> {
    const data = await this.graphql(
      `query WalletDeposits($id: ID!, $startDate: DateTime!, $endDate: DateTime!) {
        wallet(id: $id) {
          consolidatedTransactions(startDate: $startDate, endDate: $endDate) {
            nodes { utilityType credit date }
          }
        }
      }`,
      { id: walletId, startDate: start, endDate: end },
      "WalletDeposits",
    );
    const wallet = field(data, "wallet");
    if (!isRecord(wallet)) {
      throw new InvalidSourceDataError("wallet deposits response missing wallet");
    }
    return nodes(wallet, "consolidatedTransactions")
      .filter((node) => node.utilityType === "PURCHASE")
      .map((node, index) => ({
        date: requiredString(node, "date", `deposit[${index}]`),
        credit: optionalNumber(node, "credit"),
      }));
  }

  async listInvoices(walletId: string, start: string, end: string): Promise<IsmrtDocument[]> {
    return this.listDocuments(walletId, start, end, "walletInvoices", "WalletInvoices");
  }

  async listProofs(walletId: string, start: string, end: string): Promise<IsmrtDocument[]> {
    return this.listDocuments(walletId, start, end, "walletProofOfPayments", "WalletProofOfPayments");
  }

  async meterProfile(serial: string, start: string, end: string): Promise<IsmrtProfile> {
    const data = await this.graphql(
      `query MeterProfile($serial: String!, $startDate: DateTime!, $endDate: DateTime!, $interval: String!) {
        meterProfile(serial: $serial, startDate: $startDate, endDate: $endDate, interval: $interval)
      }`,
      { serial, startDate: start, endDate: end, interval: DAILY_INTERVAL },
      "MeterProfile",
    );
    const profile = field(data, "meterProfile");
    if (!isRecord(profile)) {
      throw new InvalidSourceDataError(`meter ${serial} profile was empty`);
    }
    const intervals = field(profile, "intervals");
    if (!Array.isArray(intervals)) {
      throw new InvalidSourceDataError(
        `meter ${serial} profile has no intervals`,
      );
    }
    return {
      serial,
      intervalMinutes: Number(DAILY_INTERVAL),
      intervals: intervals.map((interval, index) => parseInterval(interval, serial, index)),
    };
  }

  private async listDocuments(
    walletId: string,
    start: string,
    end: string,
    fieldName: "walletInvoices" | "walletProofOfPayments",
    operationName: string,
  ): Promise<IsmrtDocument[]> {
    const data = await this.graphql(
      `query ${operationName}($id: ID!, $startDate: DateTime!, $endDate: DateTime!) {
        ${fieldName}(id: $id, startDate: $startDate, endDate: $endDate) {
          nodes { idKey documentNumber documentDate total }
        }
      }`,
      { id: walletId, startDate: start, endDate: end },
      operationName,
    );
    return nodes(data, fieldName).map((node, index) => ({
      idKey: requiredString(node, "idKey", `${fieldName}[${index}]`),
      documentNumber: optionalString(node, "documentNumber"),
      documentDate: requiredString(node, "documentDate", `${fieldName}[${index}]`),
      total: requiredNumber(node, "total", `${fieldName}[${index}]`),
    }));
  }

  private async graphql(
    query: string,
    variables: Record<string, string> | undefined,
    operationName: string,
  ): Promise<Record<string, unknown>> {
    if (!this.accessToken) throw new IsmrtError("call authenticate() first");
    const response = await this.fetchImpl(GRAPHQL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-access-token": this.accessToken,
      },
      body: JSON.stringify({ query, variables, operationName }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 180);
      throw new IsmrtError(`${operationName} HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new InvalidSourceDataError(
        `${operationName} response was not valid JSON`,
      );
    }
    if (!isRecord(payload)) {
      throw new InvalidSourceDataError(
        `${operationName} response was not an object`,
      );
    }
    const errors = payload.errors;
    if (Array.isArray(errors) && errors.length > 0) {
      const first = errors[0];
      const message = isRecord(first) && typeof first.message === "string" ? first.message : "graphql error";
      throw new IsmrtError(`${operationName}: ${message}`);
    }
    const data = payload.data;
    if (!isRecord(data)) {
      throw new InvalidSourceDataError(
        `${operationName} response missing data`,
      );
    }
    return data;
  }
}

function parseInterval(value: unknown, serial: string, index: number): IsmrtInterval {
  if (!isRecord(value)) {
    throw new InvalidSourceDataError(
      `meter ${serial} interval ${index} was not an object`,
    );
  }
  const measures = field(value, "measures");
  if (!Array.isArray(measures)) {
    throw new InvalidSourceDataError(
      `meter ${serial} interval ${index} has no measures`,
    );
  }
  return {
    startDate: requiredString(value, "startDate", `interval[${index}]`),
    endDate: requiredString(value, "endDate", `interval[${index}]`),
    measures: measures.map((measure, measureIndex) => {
      if (!isRecord(measure)) {
        throw new InvalidSourceDataError(
          `meter ${serial} measure ${measureIndex} was not an object`,
        );
      }
      return {
        name: requiredString(measure, "name", `measure[${measureIndex}]`),
        consumption: optionalNumber(measure, "consumption"),
        unit: optionalString(measure, "unit"),
        displayName: optionalString(measure, "displayName"),
        startValue: optionalNumber(measure, "startValue"),
        endValue: optionalNumber(measure, "endValue"),
      };
    }),
  };
}

function nodes(parent: Record<string, unknown>, fieldName: string): Record<string, unknown>[] {
  const connection = field(parent, fieldName);
  if (!isRecord(connection)) {
    throw new InvalidSourceDataError(`${fieldName} was not an object`);
  }
  const rows = field(connection, "nodes");
  if (!Array.isArray(rows)) {
    throw new InvalidSourceDataError(`${fieldName}.nodes was not a list`);
  }
  return rows.map((row, index) => {
    if (!isRecord(row)) {
      throw new InvalidSourceDataError(
        `${fieldName}[${index}] was not an object`,
      );
    }
    return row;
  });
}

function field(value: unknown, key: string): unknown {
  if (!isRecord(value)) return undefined;
  return value[key];
}

function requiredString(row: Record<string, unknown>, key: string, label: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new InvalidSourceDataError(`${label}.${key} must be a non-empty string`);
  }
  return value;
}

function optionalString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") {
    throw new InvalidSourceDataError(`${key} must be a string`);
  }
  return value;
}

function optionalNumber(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new InvalidSourceDataError(`${key} must be a number`);
  }
  return value;
}

function requiredNumber(row: Record<string, unknown>, key: string, label: string): number {
  const value = optionalNumber(row, key);
  if (value === null) {
    throw new InvalidSourceDataError(`${label}.${key} is required`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
