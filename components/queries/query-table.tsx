"use client";

import { useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Filter,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import type { QueryStat } from "@/lib/demo/types";
import { Badge } from "@/components/ui/badge";

export function QueryTable({ queries }: { queries: QueryStat[] }) {
  const [search, setSearch] = useState("");
  const [onlyRegressed, setOnlyRegressed] = useState(false);
  const filtered = useMemo(
    () =>
      queries.filter((query) => {
        const matches =
          `${query.query} ${query.id} ${query.database} ${query.user}`
            .toLowerCase()
            .includes(search.toLowerCase());
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
            placeholder="Search SQL, query ID, database, or role…"
          />
        </label>
        <button
          className={`filter-button${onlyRegressed ? " active" : ""}`}
          onClick={() => setOnlyRegressed((value) => !value)}
          aria-pressed={onlyRegressed}
        >
          <Filter size={13} />
          Regressed
        </button>
        <button className="filter-button">
          <SlidersHorizontal size={13} />
          Columns
        </button>
      </div>
      <section className="card data-card" aria-label="Query workload">
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
              </tr>
            </thead>
            <tbody>
              {filtered.map((query) => (
                <tr key={query.id}>
                  <td className="query-cell">
                    <a href={`/queries/${query.id}`}>
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
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 ? (
            <div className="empty-state" style={{ minHeight: 220 }}>
              <div>
                <h2>No matching queries</h2>
                <p>
                  Try a different query ID, role, database, or SQL fragment.
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
            {filtered.length.toLocaleString()} of 18,421 normalized queries
          </span>
          <nav className="pagination" aria-label="Query pages">
            <button className="page-button" aria-label="Previous page">
              <ChevronLeft size={13} />
            </button>
            <button className="page-button active">1</button>
            <button className="page-button">2</button>
            <button className="page-button">3</button>
            <button className="page-button" aria-label="Next page">
              <ChevronRight size={13} />
            </button>
          </nav>
        </footer>
      </section>
    </>
  );
}
