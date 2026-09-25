"use client";

import { Check } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  getTransaction,
  getTransactionActivity,
  getTransactionFilters,
  listTransactions,
  setTransactionCategory,
  setTransactionTreatment,
  SignInRequiredError,
  undoTransactionCategory,
  type AccountOption,
  type CategoryOption,
  type LedgerActivity,
  type ReviewState,
  type TransactionDetail,
  type TransactionFeedItem,
  type TransactionFilters,
} from "../lib/transactions";

const HOUSEHOLD_TIMEZONE = "Africa/Johannesburg";
const RECENT_KEY = "ledger-recent-categories";

type ReviewFilter = "all" | "needs_review" | ReviewState;

const ADVANCED_REVIEWS: Array<{ value: ReviewState; label: string }> = [
  { value: "jev_disagrees", label: "Differs" },
  { value: "unclassified", label: "Uncategorised" },
  { value: "classifier_abstained", label: "Abstained" },
  { value: "classifier_failed", label: "Failed" },
  { value: "awaiting_classifier", label: "Awaiting" },
  { value: "jev_agrees", label: "Agrees" },
  { value: "confirmed", label: "Confirmed" },
];

type UndoOffer = {
  categoryId: string | null;
  expectedConfirmedClassificationId: string | null;
};

type RowOverlay = {
  item: TransactionFeedItem;
  pending: boolean;
  error: string | null;
  undo: UndoOffer | null;
};

type DecisionNote = {
  text: string | null;
  tone: "yours" | "proposal" | "source" | "failed" | "quiet";
  accept: boolean;
};

type StoryBeat = {
  label: string;
  title: string;
  meta: string | null;
};

function commandId(): string {
  return crypto.randomUUID();
}

function formatAmount(amount: string, currency: string): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return amount;
  return new Intl.NumberFormat("en-ZA", {
    currency,
    currencyDisplay: "narrowSymbol",
    style: "currency",
  }).format(value);
}

function formatDay(occurredOn: string): string {
  return new Intl.DateTimeFormat("en-ZA", {
    day: "numeric",
    month: "short",
    timeZone: HOUSEHOLD_TIMEZONE,
  }).format(new Date(`${occurredOn}T12:00:00+02:00`));
}

function gutterParts(occurredOn: string): { day: string; month: string } {
  const date = new Date(`${occurredOn}T12:00:00+02:00`);
  const day = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    timeZone: HOUSEHOLD_TIMEZONE,
  }).format(date);
  const month = new Intl.DateTimeFormat("en-GB", {
    month: "short",
    timeZone: HOUSEHOLD_TIMEZONE,
  })
    .format(date)
    .replace(".", "")
    .slice(0, 3)
    .toUpperCase();
  return { day, month };
}

function formatWhen(value: string | null): string {
  if (!value) return "Not yet";
  return new Intl.DateTimeFormat("en-ZA", {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    timeZone: HOUSEHOLD_TIMEZONE,
  }).format(new Date(value));
}

function percent(value: number | null): string | null {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return `${Math.round(Number(value) * 100)}%`;
}

function subject(item: TransactionFeedItem): string {
  return item.merchant.name || item.description;
}

function words(value: string): string {
  return value.replaceAll("_", " ");
}

function decisionNote(item: TransactionFeedItem): DecisionNote {
  if (item.category.state === "confirmed" && item.category.provenance === "user") {
    return { accept: false, text: "Yours", tone: "yours" };
  }
  if (item.category.state === "confirmed" && item.category.provenance === "policy") {
    return { accept: false, text: "Policy", tone: "yours" };
  }
  if (item.category.state === "confirmed") {
    return { accept: false, text: "Confirmed", tone: "quiet" };
  }
  if (item.reviewState === "jev_agrees") {
    return { accept: false, text: null, tone: "quiet" };
  }
  if (item.category.state === "proposed" && item.category.id) {
    return { accept: true, text: "JEV proposal", tone: "proposal" };
  }
  if (item.reviewState === "classifier_failed" || item.classifier.state === "failed") {
    return { accept: false, text: "Classifier failed", tone: "failed" };
  }
  if (
    item.reviewState === "classifier_abstained" ||
    item.classifier.state === "abstained"
  ) {
    return { accept: false, text: "JEV abstained", tone: "failed" };
  }
  if (item.category.provenance === "source" && item.category.name) {
    return { accept: false, text: "FinWise", tone: "source" };
  }
  return { accept: false, text: null, tone: "quiet" };
}

function applyCategory(
  item: TransactionFeedItem,
  category: CategoryOption,
): TransactionFeedItem {
  return {
    ...item,
    category: {
      confidence: null,
      id: category.id,
      name: category.name,
      proposalDiffersFromSource: false,
      provenance: "user",
      state: "confirmed",
    },
    reviewState: "confirmed",
  };
}

function readRecent(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

function rememberCategory(id: string) {
  const next = [id, ...readRecent().filter((entry) => entry !== id)].slice(0, 6);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
}

function focusCategory(id: string) {
  window.setTimeout(() => {
    document
      .querySelector<HTMLButtonElement>(`[data-category-for="${CSS.escape(id)}"]`)
      ?.focus();
  }, 0);
}

function accountLine(item: TransactionFeedItem): string {
  const parts = [
    item.source.isPending ? "Pending" : null,
    item.account.name,
    item.treatment.isTransfer ? "Transfer" : null,
    item.treatment.excludeFromSpend ? "Excluded from spend" : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

export function TransactionsView({ onSignIn }: { onSignIn: () => void }) {
  const searchId = useId();
  const [items, setItems] = useState<TransactionFeedItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [feedState, setFeedState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [feedError, setFeedError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [activity, setActivity] = useState<LedgerActivity | null>(null);
  const [review, setReview] = useState<ReviewFilter>("all");
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [showMore, setShowMore] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [direction, setDirection] = useState<"" | "debit" | "credit">("");
  const [transfer, setTransfer] = useState<"" | "yes" | "no" | "unknown">("");
  const [spend, setSpend] = useState<"" | "included" | "excluded" | "unknown">(
    "",
  );
  const [archived, setArchived] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, TransactionDetail>>({});
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [overlays, setOverlays] = useState<Record<string, RowOverlay>>({});
  const [signInHint, setSignInHint] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [picker, setPicker] = useState<{
    transactionId: string;
    top: number;
    left: number;
  } | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    setRecentIds(readRecent());
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const filters = useMemo<TransactionFilters>(() => {
    const next: TransactionFilters = {};
    if (review !== "all") next.reviewState = review;
    if (accountId) next.accountId = accountId;
    if (categoryId) next.categoryId = categoryId;
    if (debouncedSearch) next.search = debouncedSearch;
    if (fromDate) next.fromDate = fromDate;
    if (toDate) next.toDate = toDate;
    if (direction) next.direction = direction;
    if (transfer) next.transfer = transfer;
    if (spend) next.spend = spend;
    if (archived) next.archived = true;
    return next;
  }, [
    accountId,
    archived,
    categoryId,
    debouncedSearch,
    direction,
    fromDate,
    review,
    spend,
    toDate,
    transfer,
  ]);

  useEffect(() => {
    let cancelled = false;
    void getTransactionFilters()
      .then((catalogue) => {
        if (cancelled) return;
        setAccounts(catalogue.accounts);
        setCategories(catalogue.categories);
      })
      .catch(() => {
        if (!cancelled) setAccounts([]);
      });
    void getTransactionActivity()
      .then((next) => {
        if (!cancelled) setActivity(next);
      })
      .catch(() => {
        if (!cancelled) setActivity(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setFeedState("loading");
    setFeedError(null);
    void listTransactions({ filters, limit: 50 })
      .then((page) => {
        if (requestRef.current !== requestId) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setFeedState("ready");
      })
      .catch((error: unknown) => {
        if (requestRef.current !== requestId) return;
        setFeedState("error");
        setFeedError(
          error instanceof Error ? error.message : "The ledger could not be read.",
        );
      });
  }, [filters, reloadKey]);

  useEffect(() => {
    if (!selectedId || details[selectedId]) return;
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    void getTransaction(selectedId)
      .then((detail) => {
        if (cancelled) return;
        setDetails((current) => ({ ...current, [selectedId]: detail }));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setDetailError(
          error instanceof Error
            ? error.message
            : "The inspection could not be read.",
        );
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [details, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    if (!window.matchMedia("(max-width: 920px)").matches) return;
    document.querySelector<HTMLButtonElement>(".ledger-plate-close")?.focus();
  }, [selectedId]);

  const visibleItems = items.map((item) => overlays[item.id]?.item ?? item);
  const selected = visibleItems.find((item) => item.id === selectedId) ?? null;
  const selectedDetail = selectedId ? details[selectedId] : undefined;
  const activeCategories = categories.filter(
    (category) => category.lifecycleStatus === "active",
  );
  const advancedReview = ADVANCED_REVIEWS.find((entry) => entry.value === review);

  function followingId(id: string): string | null {
    const index = visibleItems.findIndex((entry) => entry.id === id);
    return visibleItems[index + 1]?.id ?? null;
  }

  function closePlate(id: string) {
    setSelectedId(null);
    window.setTimeout(() => {
      document
        .querySelector<HTMLButtonElement>(`[data-open-for="${CSS.escape(id)}"]`)
        ?.focus();
    }, 0);
  }

  function toggleRow(id: string) {
    setSelectedId((current) => (current === id ? null : id));
  }

  async function loadOlder() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await listTransactions({
        cursor: nextCursor,
        filters,
        limit: 50,
      });
      setItems((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (error) {
      setFeedError(
        error instanceof Error
          ? error.message
          : "Older movements could not be read.",
      );
    } finally {
      setLoadingMore(false);
    }
  }

  async function classify(item: TransactionFeedItem, category: CategoryOption) {
    const priorCategoryId = item.category.id;
    const command = commandId();
    const following = followingId(item.id);
    rememberCategory(category.id);
    setRecentIds(readRecent());
    setSignInHint(false);
    setPicker(null);
    setOverlays((current) => ({
      ...current,
      [item.id]: {
        error: null,
        item: applyCategory(item, category),
        pending: true,
        undo: null,
      },
    }));
    if (following) focusCategory(following);
    try {
      const result = await setTransactionCategory({
        categoryId: category.id,
        expectedConfirmedClassificationId:
          item.revision.confirmedClassificationId,
        expectedProposedClassificationId: item.revision.proposedClassificationId,
        reviewCommandId: command,
        transactionId: item.id,
      });
      const undo =
        priorCategoryId !== category.id
          ? {
              categoryId: priorCategoryId,
              expectedConfirmedClassificationId:
                result.item.revision.confirmedClassificationId,
            }
          : null;
      setOverlays((current) => ({
        ...current,
        [item.id]: {
          error: result.conflict
            ? "This movement changed. Showing the current decision."
            : null,
          item: result.item,
          pending: false,
          undo,
        },
      }));
      setDetails((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      if (result.conflict) focusCategory(item.id);
    } catch (error) {
      if (error instanceof SignInRequiredError) setSignInHint(true);
      focusCategory(item.id);
      setOverlays((current) => ({
        ...current,
        [item.id]: {
          error:
            error instanceof Error
              ? error.message
              : "The decision could not be saved.",
          item,
          pending: false,
          undo: null,
        },
      }));
    }
  }

  async function undo(item: TransactionFeedItem, offer: UndoOffer) {
    const command = commandId();
    setOverlays((current) => ({
      ...current,
      [item.id]: { ...current[item.id], error: null, pending: true, undo: null },
    }));
    try {
      const result = await undoTransactionCategory({
        categoryId: offer.categoryId,
        expectedConfirmedClassificationId: offer.expectedConfirmedClassificationId,
        reviewCommandId: command,
        transactionId: item.id,
      });
      setOverlays((current) => ({
        ...current,
        [item.id]: {
          error: result.conflict
            ? "This movement changed. Showing the current decision."
            : null,
          item: result.item,
          pending: false,
          undo: null,
        },
      }));
      setDetails((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
    } catch (error) {
      setOverlays((current) => ({
        ...current,
        [item.id]: {
          error: error instanceof Error ? error.message : "Undo could not be saved.",
          item,
          pending: false,
          undo: offer,
        },
      }));
    }
  }

  function clearFilters() {
    setReview("all");
    setAccountId("");
    setCategoryId("");
    setSearch("");
    setFromDate("");
    setToDate("");
    setDirection("");
    setTransfer("");
    setSpend("");
    setArchived(false);
  }

  function onLogKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest("input, select, textarea")) return;
    const current = target.closest<HTMLButtonElement>("[data-category-for]");
    if (!current) return;
    const buttons = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
        "[data-category-for]",
      ),
    ];
    const next = buttons[buttons.indexOf(current) + (event.key === "ArrowDown" ? 1 : -1)];
    if (!next) return;
    event.preventDefault();
    next.focus();
  }

  function openPicker(itemId: string, anchor: HTMLButtonElement) {
    const rect = anchor.getBoundingClientRect();
    const width = 300;
    const height = 340;
    const top =
      rect.bottom + 8 + height > window.innerHeight
        ? Math.max(8, rect.top - height - 8)
        : rect.bottom + 8;
    const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
    setPicker({ left, top, transactionId: itemId });
  }

  return (
    <section
      className="ledger"
      aria-label="Transactions"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !selectedId || picker) return;
        event.preventDefault();
        closePlate(selectedId);
      }}
    >
      <div className="ledger-stage">
        <div className="ledger-tools">
          <div className="ledger-search-row">
            <label className="ledger-search" htmlFor={searchId}>
              <span>Search</span>
              <input
                id={searchId}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Merchant or description"
                type="search"
                value={search}
              />
            </label>
            <label className="ledger-field">
              <span>Account</span>
              <select
                onChange={(event) => setAccountId(event.target.value)}
                value={accountId}
              >
                <option value="">All accounts</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="ledger-field">
              <span>Category</span>
              <select
                onChange={(event) => setCategoryId(event.target.value)}
                value={categoryId}
              >
                <option value="">All categories</option>
                {activeCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="ledger-controls">
            <div className="ledger-reviews" role="group" aria-label="Review">
              <button
                aria-pressed={review === "all"}
                onClick={() => setReview("all")}
                type="button"
              >
                All
              </button>
              <button
                aria-pressed={review === "needs_review"}
                onClick={() => setReview("needs_review")}
                type="button"
              >
                Review
              </button>
              {advancedReview ? (
                <button
                  aria-pressed="true"
                  onClick={() => setReview("all")}
                  type="button"
                >
                  {advancedReview.label}
                </button>
              ) : null}
            </div>
            <div className="ledger-dates">
              <label>
                <span>From</span>
                <input
                  onChange={(event) => setFromDate(event.target.value)}
                  type="date"
                  value={fromDate}
                />
              </label>
              <label>
                <span>To</span>
                <input
                  onChange={(event) => setToDate(event.target.value)}
                  type="date"
                  value={toDate}
                />
              </label>
            </div>
            <button
              aria-expanded={showMore}
              className="ledger-more-toggle"
              onClick={() => setShowMore((open) => !open)}
              type="button"
            >
              {showMore ? "Fewer filters" : "More filters"}
            </button>
          </div>
          {showMore ? (
            <div className="ledger-more">
              <div className="ledger-reviews" role="group" aria-label="Review state">
                {ADVANCED_REVIEWS.map((filter) => (
                  <button
                    aria-pressed={review === filter.value}
                    key={filter.value}
                    onClick={() => setReview(filter.value)}
                    type="button"
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
              <label>
                <span>Direction</span>
                <select
                  onChange={(event) =>
                    setDirection(event.target.value as "" | "debit" | "credit")
                  }
                  value={direction}
                >
                  <option value="">Either</option>
                  <option value="debit">Money out</option>
                  <option value="credit">Money in</option>
                </select>
              </label>
              <label>
                <span>Transfer</span>
                <select
                  onChange={(event) =>
                    setTransfer(event.target.value as "" | "yes" | "no" | "unknown")
                  }
                  value={transfer}
                >
                  <option value="">Any</option>
                  <option value="yes">Transfer</option>
                  <option value="no">Not a transfer</option>
                  <option value="unknown">Unknown</option>
                </select>
              </label>
              <label>
                <span>Spend</span>
                <select
                  onChange={(event) =>
                    setSpend(
                      event.target.value as "" | "included" | "excluded" | "unknown",
                    )
                  }
                  value={spend}
                >
                  <option value="">Any</option>
                  <option value="included">Included</option>
                  <option value="excluded">Excluded</option>
                  <option value="unknown">Unknown</option>
                </select>
              </label>
              <label className="ledger-archive">
                <input
                  checked={archived}
                  onChange={(event) => setArchived(event.target.checked)}
                  type="checkbox"
                />
                Archived only
              </label>
              <p className="ledger-sync">
                {activity?.lastFinwiseSyncAt
                  ? `FinWise ${formatWhen(activity.lastFinwiseSyncAt)}`
                  : "FinWise sync not recorded"}
                {activity?.classifierVersion
                  ? ` · JEV ${activity.classifierVersion}`
                  : ""}
              </p>
            </div>
          ) : null}
          {signInHint ? (
            <p className="ledger-signin" role="status">
              Sign in to keep a decision.
              <button onClick={onSignIn} type="button">
                Sign in with Google
              </button>
            </p>
          ) : null}
        </div>

        <div
          className="ledger-log"
          aria-busy={feedState === "loading"}
          onKeyDown={onLogKeyDown}
        >
          {feedState === "loading" ? <LedgerSkeleton /> : null}
          {feedState === "error" ? (
            <div className="ledger-empty">
              <p>{feedError}</p>
              <button onClick={() => setReloadKey((key) => key + 1)} type="button">
                Retry the ledger
              </button>
            </div>
          ) : null}
          {feedState === "ready" && visibleItems.length === 0 ? (
            <div className="ledger-empty">
              <p>Nothing in this reading matches.</p>
              <button onClick={clearFilters} type="button">
                Clear filters
              </button>
            </div>
          ) : null}
          {feedState === "ready"
            ? visibleItems.map((item, index) => {
                const overlay = overlays[item.id];
                const note = decisionNote(item);
                const showDate =
                  index === 0 || visibleItems[index - 1]?.occurredOn !== item.occurredOn;
                const gutter = gutterParts(item.occurredOn);
                const categoryName = item.category.name ?? "Uncategorised";
                return (
                  <article
                    className={`ledger-row${selectedId === item.id ? " is-selected" : ""}${overlay?.pending ? " is-pending" : ""}`}
                    key={item.id}
                  >
                    <div className="ledger-gutter">
                      {showDate ? (
                        <time dateTime={item.occurredOn}>
                          <span>{gutter.day}</span>
                          <span>{gutter.month}</span>
                        </time>
                      ) : null}
                    </div>
                    <button
                      aria-expanded={selectedId === item.id}
                      className="ledger-open"
                      data-open-for={item.id}
                      onClick={() => toggleRow(item.id)}
                      type="button"
                    >
                      <strong>{subject(item)}</strong>
                      <span
                        className={`ledger-amount${Number(item.amount) < 0 ? " is-out" : " is-in"}`}
                      >
                        {formatAmount(item.amount, item.currencyCode)}
                      </span>
                    </button>
                    <div className="ledger-meta">
                      <span className="ledger-account-line">{accountLine(item)}</span>
                      <div className="ledger-decision">
                        <button
                          aria-label={
                            note.text
                              ? `${categoryName}, ${note.text}. Change category`
                              : `${categoryName}. Change category`
                          }
                          className={`ledger-category is-${note.tone}`}
                          data-category-for={item.id}
                          onClick={(event) => openPicker(item.id, event.currentTarget)}
                          type="button"
                        >
                          <span>{categoryName}</span>
                          {note.text ? <small>{note.text}</small> : null}
                        </button>
                        {note.accept ? (
                          <button
                            aria-label={`Accept ${categoryName}`}
                            className="ledger-accept"
                            onClick={() => {
                              const category = categories.find(
                                (entry) => entry.id === item.category.id,
                              );
                              if (category) void classify(item, category);
                            }}
                            type="button"
                          >
                            <Check size={15} strokeWidth={2} />
                          </button>
                        ) : null}
                        {overlay?.undo ? (
                          <button
                            className="ledger-undo"
                            onClick={() => void undo(item, overlay.undo as UndoOffer)}
                            type="button"
                          >
                            Undo
                          </button>
                        ) : null}
                      </div>
                    </div>
                    {overlay?.error ? (
                      <p className="ledger-row-error" role="status">
                        {overlay.error}
                      </p>
                    ) : null}
                  </article>
                );
              })
            : null}
          {feedState === "ready" && nextCursor ? (
            <button
              className="ledger-older"
              disabled={loadingMore}
              onClick={() => void loadOlder()}
              type="button"
            >
              {loadingMore ? "Reading older movements…" : "Older movements"}
            </button>
          ) : null}
        </div>

        <aside
          className={`ledger-plate${selected ? " is-open" : ""}`}
          aria-label="Inspection"
        >
          {selected ? (
            <Inspection
              activity={activity}
              detail={selectedDetail}
              detailError={detailError}
              detailLoading={detailLoading && !selectedDetail}
              item={selected}
              onClose={() => closePlate(selected.id)}
              onRetryDetail={() => {
                if (!selectedId) return;
                setDetails((current) => {
                  const next = { ...current };
                  delete next[selectedId];
                  return next;
                });
              }}
              onTreatmentSaved={(next) => {
                setOverlays((current) => ({
                  ...current,
                  [next.id]: {
                    error: null,
                    item: next,
                    pending: false,
                    undo: current[next.id]?.undo ?? null,
                  },
                }));
                setDetails((current) => {
                  const copy = { ...current };
                  delete copy[next.id];
                  return copy;
                });
              }}
            />
          ) : null}
        </aside>
      </div>
      {picker ? (
        <CategoryPicker
          categories={activeCategories}
          onClose={() => setPicker(null)}
          onSelect={(category) => {
            const item = visibleItems.find((entry) => entry.id === picker.transactionId);
            if (item) void classify(item, category);
          }}
          position={picker}
          recentIds={recentIds}
        />
      ) : null}
    </section>
  );
}

function LedgerSkeleton() {
  return (
    <div className="ledger-skeleton" aria-hidden="true">
      {Array.from({ length: 8 }, (_, index) => (
        <span key={index} />
      ))}
    </div>
  );
}

function CategoryPicker({
  categories,
  onClose,
  onSelect,
  position,
  recentIds,
}: {
  categories: CategoryOption[];
  onClose: () => void;
  onSelect: (category: CategoryOption) => void;
  position: { top: number; left: number };
  recentIds: string[];
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const listId = useId();
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const trimmed = query.trim().toLowerCase();
  const recent = recentIds
    .map((id) => categories.find((category) => category.id === id))
    .filter((category): category is CategoryOption => Boolean(category));
  const matches = trimmed
    ? categories.filter(
        (category) =>
          category.name.toLowerCase().includes(trimmed) ||
          (category.group ?? "").toLowerCase().includes(trimmed),
      )
    : [
        ...recent,
        ...categories.filter((category) => !recent.some((entry) => entry.id === category.id)),
      ];

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [index, trimmed]);

  return (
    <>
      <button
        aria-label="Close categories"
        className="ledger-picker-scrim"
        onClick={onClose}
        type="button"
      />
      <div
        className="ledger-picker"
        role="dialog"
        aria-label="Choose a category"
        style={{ left: position.left, top: position.top }}
      >
        <input
          aria-controls={listId}
          autoFocus
          onChange={(event) => {
            setQuery(event.target.value);
            setIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setIndex((current) => Math.min(current + 1, Math.max(matches.length - 1, 0)));
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setIndex((current) => Math.max(current - 1, 0));
            }
            if (event.key === "Enter" && matches[index]) {
              event.preventDefault();
              onSelect(matches[index]);
            }
          }}
          placeholder="Find a category"
          value={query}
        />
        <ul id={listId} role="listbox">
          {matches.map((category, matchIndex) => {
            const showRecent = !trimmed && matchIndex === 0 && recent.length > 0;
            const showRest = !trimmed && recent.length > 0 && matchIndex === recent.length;
            return (
              <li key={category.id}>
                {showRecent ? <p>Recent</p> : null}
                {showRest ? <p>All</p> : null}
                <button
                  aria-selected={matchIndex === index}
                  onClick={() => onSelect(category)}
                  onMouseEnter={() => setIndex(matchIndex)}
                  ref={matchIndex === index ? activeRef : null}
                  type="button"
                >
                  <span>{category.name}</span>
                  {category.group ? <small>{category.group}</small> : null}
                </button>
              </li>
            );
          })}
        </ul>
        {matches.length === 0 ? <p className="ledger-picker-empty">No category matches.</p> : null}
      </div>
    </>
  );
}

function Inspection({
  activity,
  detail,
  detailError,
  detailLoading,
  item,
  onClose,
  onRetryDetail,
  onTreatmentSaved,
}: {
  activity: LedgerActivity | null;
  detail: TransactionDetail | undefined;
  detailError: string | null;
  detailLoading: boolean;
  item: TransactionFeedItem;
  onClose: () => void;
  onRetryDetail: () => void;
  onTreatmentSaved: (item: TransactionFeedItem) => void;
}) {
  const [isTransfer, setIsTransfer] = useState<boolean | null>(item.treatment.isTransfer);
  const [excludeFromSpend, setExcludeFromSpend] = useState<boolean | null>(
    item.treatment.excludeFromSpend,
  );
  const [nature, setNature] = useState(item.treatment.nature ?? "");
  const [treatmentError, setTreatmentError] = useState<string | null>(null);
  const [savingTreatment, setSavingTreatment] = useState(false);
  const beats = storyBeats(item, detail);

  useEffect(() => {
    setIsTransfer(item.treatment.isTransfer);
    setExcludeFromSpend(item.treatment.excludeFromSpend);
    setNature(item.treatment.nature ?? "");
    setTreatmentError(null);
  }, [item]);

  async function saveTreatment() {
    if (isTransfer == null || excludeFromSpend == null) return;
    setSavingTreatment(true);
    setTreatmentError(null);
    try {
      const result = await setTransactionTreatment({
        excludeFromSpend,
        expectedConfirmedTreatmentId: item.revision.confirmedTreatmentId,
        expectedProposedTreatmentId: item.revision.proposedTreatmentId,
        isTransfer,
        nature: nature.trim() || null,
        reviewCommandId: commandId(),
        transactionId: item.id,
      });
      onTreatmentSaved(result.item);
      if (result.conflict) {
        setTreatmentError("Treatment changed. Showing the current decision.");
      }
    } catch (error) {
      setTreatmentError(
        error instanceof SignInRequiredError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Treatment could not be saved.",
      );
    } finally {
      setSavingTreatment(false);
    }
  }

  return (
    <div className="ledger-inspection">
      <button className="ledger-plate-close" onClick={onClose} type="button">
        Close
      </button>
      <header>
        <h2>{subject(item)}</h2>
        <strong className={Number(item.amount) < 0 ? "is-out" : "is-in"}>
          {formatAmount(item.amount, item.currencyCode)}
        </strong>
        <p>
          {formatDay(item.occurredOn)} · {item.account.name}
        </p>
      </header>
      <ol className="ledger-story">
        {beats.map((beat, index) => (
          <li key={`${beat.label}-${beat.title}-${index}`}>
            <span>{beat.label}</span>
            <strong>{beat.title}</strong>
            {beat.meta ? <small>{beat.meta}</small> : null}
          </li>
        ))}
      </ol>
      {detailLoading ? <p className="ledger-quiet-status">Reading the history…</p> : null}
      {detailError ? (
        <p className="ledger-detail-error">
          {detailError}
          <button onClick={onRetryDetail} type="button">
            Retry inspection
          </button>
        </p>
      ) : null}
      {item.event ? (
        <p className="ledger-event-note">
          Part of {words(item.event.type)}, as {words(item.event.role)}.
        </p>
      ) : null}
      <form
        className="ledger-treatment"
        onSubmit={(event) => {
          event.preventDefault();
          void saveTreatment();
        }}
      >
        <h3>Spend treatment</h3>
        <p>Changing this does not change the category.</p>
        <div role="group" aria-label="Transfer">
          <button
            aria-pressed={isTransfer === true}
            onClick={() => setIsTransfer(true)}
            type="button"
          >
            Transfer
          </button>
          <button
            aria-pressed={isTransfer === false}
            onClick={() => setIsTransfer(false)}
            type="button"
          >
            Not a transfer
          </button>
        </div>
        <div role="group" aria-label="Spend">
          <button
            aria-pressed={excludeFromSpend === false}
            onClick={() => setExcludeFromSpend(false)}
            type="button"
          >
            Include in spend
          </button>
          <button
            aria-pressed={excludeFromSpend === true}
            onClick={() => setExcludeFromSpend(true)}
            type="button"
          >
            Exclude
          </button>
        </div>
        <label>
          <span>Nature</span>
          <input
            maxLength={80}
            onChange={(event) => setNature(event.target.value)}
            value={nature}
          />
        </label>
        <button
          disabled={savingTreatment || isTransfer == null || excludeFromSpend == null}
          type="submit"
        >
          {savingTreatment ? "Saving treatment…" : "Save treatment"}
        </button>
        {treatmentError ? <p role="status">{treatmentError}</p> : null}
      </form>
      <details className="ledger-technical">
        <summary>Classifier and source</summary>
        <dl>
          <Fact label="FinWise category" value={item.source.categoryName ?? "None recorded"} />
          <Fact
            label="Source transfer"
            value={
              item.source.isTransfer == null
                ? "Not recorded"
                : item.source.isTransfer
                  ? "Marked transfer"
                  : "Not a transfer"
            }
          />
          <Fact label="Classifier" value={classifierSummary(item)} />
          <Fact
            label="FinWise sync"
            value={activity?.lastFinwiseSyncAt ? formatWhen(activity.lastFinwiseSyncAt) : "Not recorded"}
          />
          {detail
            ? detail.history.runs.map((run) => (
                <Fact
                  key={run.id}
                  label="Run"
                  value={`${run.classifier} ${run.classifierVersion} · ${run.status}${
                    run.completedAt ? ` · ${formatWhen(run.completedAt)}` : ""
                  }`}
                />
              ))
            : null}
          {detail && detail.history.eventLegs.length > 1
            ? detail.history.eventLegs.map((leg) => (
                <Fact
                  key={`${leg.transactionId}-${leg.role}`}
                  label={words(leg.role)}
                  value={`${leg.accountName}${leg.description ? ` · ${leg.description}` : ""}`}
                />
              ))
            : null}
        </dl>
      </details>
    </div>
  );
}

function storyBeats(
  item: TransactionFeedItem,
  detail: TransactionDetail | undefined,
): StoryBeat[] {
  const beats: StoryBeat[] = [
    {
      label: "FinWise observed",
      meta: item.source.isTransfer ? "Marked as a transfer" : null,
      title: item.source.categoryName ?? "No category",
    },
  ];
  if (!detail) {
    if (item.category.state === "proposed" && item.category.name) {
      beats.push({
        label: "JEV proposed",
        meta:
          item.reviewState === "jev_agrees"
            ? "Agrees with FinWise"
            : percent(item.category.confidence),
        title: item.category.name,
      });
    } else if (item.category.state === "confirmed" && item.category.name) {
      beats.push({
        label: item.category.provenance === "user" ? "You classified" : "Confirmed",
        meta: null,
        title: item.category.name,
      });
    }
    return beats;
  }

  for (const entry of [...detail.history.classifications].reverse()) {
    if (entry.decisionSource === "jev" || entry.decisionSource === "agent") {
      beats.push({
        label: entry.decisionSource === "agent" ? "Agent proposed" : "JEV proposed",
        meta: [entry.status === "proposed" ? null : words(entry.status), percent(entry.confidence)]
          .filter(Boolean)
          .join(" · ") || null,
        title: entry.categoryName,
      });
    } else if (entry.decisionSource === "user") {
      beats.push({
        label: "You classified",
        meta: entry.status === "superseded" ? "Superseded" : null,
        title: entry.categoryName,
      });
    } else if (
      entry.decisionSource === "policy" ||
      entry.decisionSource === "imported" ||
      entry.decisionSource === "rule"
    ) {
      beats.push({
        label: "Policy",
        meta: null,
        title: entry.categoryName,
      });
    }
  }
  return beats;
}

function classifierSummary(item: TransactionFeedItem): string {
  if (item.classifier.state === "not_run") return "Not run";
  if (item.classifier.state === "failed") return "Failed";
  const confidence = percent(item.classifier.confidence);
  const margin = percent(item.classifier.margin);
  const parts = [
    item.classifier.state === "abstained" ? "Abstained" : "Ran",
    item.classifier.classifierVersion ? `v${item.classifier.classifierVersion}` : null,
    item.classifier.modelId,
    confidence ? `${confidence} confidence` : null,
    margin ? `${margin} margin` : null,
    item.classifier.accepted == null
      ? null
      : item.classifier.accepted
        ? "accepted its result"
        : "did not accept its result",
  ];
  return parts.filter(Boolean).join(" · ");
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
