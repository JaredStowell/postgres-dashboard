"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, ChevronLeft, ChevronRight, Filter, Search } from "lucide-react";
import type { QueryStat } from "@/lib/demo/types";
import { contextualHref } from "@/lib/presentation/inventory";
import { Badge } from "@/components/ui/badge";

const PAGE_SIZE = 25;
type QuerySort =
  | "total_exec_time"
  | "mean_exec_time"
  | "total_plan_time"
  | "mean_plan_time"
  | "calls"
  | "rows"
  | "shared_blks_read"
  | "temp_blks_written"
  | "wal_bytes"
  | "delta";

export function QueryTable({
  queries: initialQueries,
  initialHasMore = false,
  source,
  schema,
}: {
  queries: QueryStat[];
  initialHasMore?: boolean;
  source?: string;
  schema?: string;
}) {
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [onlyRegressed, setOnlyRegressed] = useState(false);
  const [sort, setSort] = useState<QuerySort>("total_exec_time");
  const [page, setPage] = useState(0);
  const [queries, setQueries] = useState(initialQueries);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const skippedInitialRequest = useRef(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setPage(0);
      setAppliedSearch(search.trim());
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    if (!skippedInitialRequest.current) {
      skippedInitialRequest.current = true;
      return;
    }
    const controller = new AbortController();
    const parameters = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
      sort,
      direction: "desc",
    });
    if (source) parameters.set("source", source);
    if (appliedSearch) parameters.set("search", appliedSearch);
    setLoading(true);
    setError(null);
    void fetch(`/api/queries?${parameters}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json()) as {
          queryViews?: QueryStat[];
          pagination?: { hasMore?: boolean };
          error?: { message?: string };
        };
        if (!response.ok || !body.queryViews) {
          throw new Error(body.error?.message ?? "Query inventory failed");
        }
        setQueries(body.queryViews);
        setHasMore(Boolean(body.pagination?.hasMore));
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError")
          return;
        setError(
          caught instanceof Error ? caught.message : "Query inventory failed",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [appliedSearch, page, sort, source]);

  const filtered = useMemo(
    () =>
      queries.filter((query) => {
        const matches =
          `${query.query} ${query.id} ${query.database} ${query.user}`
            .toLowerCase()
            .includes(search.trim().toLowerCase());
        return matches && (!onlyRegressed || query.status === "regressed");
      }),
    [onlyRegressed, queries, search],
  );

  return (
    <>
      <div className="toolbar">
        <label className="search-field">
          <Search aria-hidden="true" />
          <span className="sr-only">Search queries</span>
          <input
            className="search-input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search SQL or exact query ID…"
          />
        </label>
        <select
          className="context-select compact"
          aria-label="Sort queries"
          value={sort}
          onChange={(event) => {
            setPage(0);
            setSort(event.target.value as QuerySort);
          }}
        >
          <option value="total_exec_time">Total execution</option>
          <option value="mean_exec_time">Mean latency</option>
          <option value="total_plan_time">Total planning time</option>
          <option value="mean_plan_time">Mean planning time</option>
          <option value="calls">Calls</option>
          <option value="rows">Rows</option>
          <option value="shared_blks_read">Shared blocks read</option>
          <option value="temp_blks_written">Temporary blocks written</option>
          <option value="wal_bytes">WAL bytes</option>
          <option value="delta">Interval mean delta (current page)</option>
        </select>
        <button
          className={`filter-button${onlyRegressed ? " active" : ""}`}
          onClick={() => setOnlyRegressed((value) => !value)}
          aria-pressed={onlyRegressed}
          title="Collector regressions in the current API page"
        >
          <Filter size={13} />
          Regressed on page
        </button>
      </div>
      <section
        className="card data-card"
        aria-label="Query workload"
        aria-busy={loading}
      >
        {error ? (
          <div className="privacy-note" role="alert">
            {error}
          </div>
        ) : null}
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Query</th>
                <th>Status</th>
                <th>Calls</th>
                <th>Total time</th>
                <th>Mean</th>
                <th>Rows</th>
                <th>Cache hit</th>
                <th>Temp I/O</th>
                <th>Δ mean</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody style={{ opacity: loading ? 0.55 : 1 }}>
              {filtered.map((query) => {
                const detailHref = contextualHref(`/queries/${query.id}`, {
                  source,
                  schema,
                });
                const advisorHref = contextualHref("/advisor", {
                  source,
                  schema,
                  parameters: { queryId: query.id },
                });
                return (
                  <tr key={query.id}>
                    <td className="query-cell">
                      <a href={detailHref}>
                        <span className="query-snippet">{query.query}</span>
                        <span className="query-id">
                          qid {query.id} · {query.database} · {query.user}
                        </span>
                      </a>
                    </td>
                    <td>
                      <Badge
                        tone={
                          query.status === "regressed"
                            ? "rose"
                            : query.status === "improved"
                              ? "green"
                              : ""
                        }
                      >
                        {query.status}
                      </Badge>
                    </td>
                    <td className="number">{query.calls.toLocaleString()}</td>
                    <td className="number">
                      {(query.totalTime / 1000).toFixed(1)}s
                    </td>
                    <td className="number">{query.meanTime.toFixed(2)}ms</td>
                    <td className="number">{query.rows.toLocaleString()}</td>
                    <td className="number">{query.cacheHit}%</td>
                    <td className="number">{query.tempIo}</td>
                    <td
                      className={`number ${query.delta > 5 ? "delta-up" : query.delta < -5 ? "delta-down" : "delta-flat"}`}
                    >
                      {query.delta > 0 ? "+" : ""}
                      {query.delta}%
                    </td>
                    <td>
                      <a
                        className="icon-button"
                        href={advisorHref}
                        aria-label={`Analyze query ${query.id} with AI`}
                      >
                        <Bot size={13} />
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 ? (
            <div className="empty-state" style={{ minHeight: 220 }}>
              <div>
                <h2>No matching queries</h2>
                <p>
                  {onlyRegressed
                    ? "No collected regressions are present on this API page."
                    : "Try a different query ID or SQL fragment."}
                </p>
                <button
                  className="button"
                  onClick={() => {
                    setSearch("");
                    setOnlyRegressed(false);
                  }}
                >
                  Clear filters
                </button>
              </div>
            </div>
          ) : null}
        </div>
        <footer className="table-footer">
          <span>
            {queries.length.toLocaleString()} loaded queries · API limit 250 ·
            page {page + 1}
            {appliedSearch ? ` matching “${appliedSearch}”` : ""}
          </span>
          <nav className="pagination" aria-label="Query pages">
            <button
              className="page-button"
              aria-label="Previous query page"
              disabled={page === 0 || loading}
              onClick={() => setPage((value) => Math.max(0, value - 1))}
            >
              <ChevronLeft size={13} />
            </button>
            <span className="page-button active" aria-current="page">
              {page + 1}
            </span>
            <button
              className="page-button"
              aria-label="Next query page"
              disabled={!hasMore || loading}
              onClick={() => setPage((value) => value + 1)}
            >
              <ChevronRight size={13} />
            </button>
          </nav>
        </footer>
      </section>
    </>
  );
}
