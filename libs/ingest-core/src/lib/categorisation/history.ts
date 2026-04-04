/**
 * FinWise historical prefetch + in-memory match — deferred until there is enough
 * prior categorized data. Reserved for a later phase; not used by the pipeline v1.
 */

export type HistoryPrefetchDeferred = "deferred";

export const HISTORY_LOOKUP_DEFERRED: HistoryPrefetchDeferred = "deferred";
