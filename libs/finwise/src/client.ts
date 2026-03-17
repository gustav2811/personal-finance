import axios, { type AxiosInstance } from "axios";
import { BASE_URL } from "./constants";
import type { FinWiseErrorBody } from "./types/errors";
import { FinWiseApiError } from "./types/errors";
import { createAccountsApi } from "./api/accounts";
import { createAccountBalancesApi } from "./api/account-balances";
import { createTransactionsApi } from "./api/transactions";
import { createTransactionCategoriesApi } from "./api/transaction-categories";
import type { AccountsApi } from "./api/accounts";
import type { AccountBalancesApi } from "./api/account-balances";
import type { TransactionsApi } from "./api/transactions";
import type { TransactionCategoriesApi } from "./api/transaction-categories";

/**
 * Optional logger for debug/error. No logging by default.
 */
export interface FinWiseLogger {
  debug?(message: string, meta?: Record<string, unknown>): void;
  info?(message: string, meta?: Record<string, unknown>): void;
  error?(message: string, meta?: Record<string, unknown>): void;
}

export interface FinWiseClientConfig {
  /** API key (e.g. from process.env.FINWISE_API_KEY). Never hardcode. */
  apiKey: string;
  /** Base URL; defaults to https://api.finwiseapp.io */
  baseUrl?: string;
  /** Optional logger for requests/errors */
  logger?: FinWiseLogger;
}

/**
 * Query params for list/aggregate endpoints. Keys like "filters" or "pagination"
 * are JSON-serialized when value is an object.
 */
export type RequestQuery = Record<string, unknown>;

/**
 * FinWise API client. Use apiKey from env (e.g. process.env.FINWISE_API_KEY).
 */
export class FinWiseClient {
  readonly accounts: AccountsApi;
  readonly accountBalances: AccountBalancesApi;
  readonly transactions: TransactionsApi;
  readonly transactionCategories: TransactionCategoriesApi;

  private readonly axiosInstance: AxiosInstance;
  private readonly logger: FinWiseLogger | undefined;

  constructor(config: FinWiseClientConfig) {
    const baseURL = config.baseUrl ?? BASE_URL;
    this.logger = config.logger;

    this.axiosInstance = axios.create({
      baseURL,
      headers: {
        "Content-Type": "application/json",
        Authorization: config.apiKey,
      },
    });

    this.accounts = createAccountsApi(this.request.bind(this));
    this.accountBalances = createAccountBalancesApi(this.request.bind(this));
    this.transactions = createTransactionsApi(this.request.bind(this));
    this.transactionCategories = createTransactionCategoriesApi(
      this.request.bind(this)
    );
  }

  /**
   * Execute a request. On non-2xx, throws FinWiseApiError with status, requestId, body.
   */
  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: RequestQuery
  ): Promise<T> {
    this.logger?.debug?.("FinWise request", {
      method,
      path,
    });

    try {
      const response = await this.axiosInstance.request<T>({
        method,
        url: path.startsWith("/") ? path : `/${path}`,
        params: query,
        paramsSerializer: (params) => {
          const p = new URLSearchParams();
          for (const [k, v] of Object.entries(params)) {
            if (v === undefined) continue;
            if (
              (k === "filters" || k === "pagination") &&
              typeof v === "object" &&
              v !== null
            ) {
              p.set(k, JSON.stringify(v));
            } else if (typeof v === "object" && v !== null) {
              p.set(k, JSON.stringify(v));
            } else {
              p.set(k, String(v));
            }
          }
          return p.toString();
        },
        data: body,
      });

      return response.data;
    } catch (err) {
      if (axios.isAxiosError(err) && err.response) {
        const status = err.response.status;
        const requestId = err.response.headers["request-id"] as
          | string
          | undefined;
        let body: FinWiseErrorBody | undefined;
        try {
          body = err.response.data as FinWiseErrorBody;
        } catch {
          // ignore parse error
        }
        const message =
          body?.message ?? err.message ?? `Request failed with status ${status}`;
        this.logger?.error?.(message, {
          status,
          requestId,
          body,
        });
        throw new FinWiseApiError(message, status, requestId, body);
      }
      throw err;
    }
  }
}
