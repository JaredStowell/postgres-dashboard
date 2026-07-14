"use client";

import { useMemo, useState } from "react";
import { Copy, Download, Filter, Search, Sparkles } from "lucide-react";
import { demoRepository } from "@/lib/demo/data";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { MetricCard } from "@/components/ui/metric-card";
import { PageHeader } from "@/components/ui/page-header";

export function IndexesPage() {
  const indexes = demoRepository.indexes();
  const [search, setSearch] = useState("");
  const [candidateOnly, setCandidateOnly] = useState(false);
  const filtered = useMemo(
    () =>
      indexes.filter(
        (index) =>
          `${index.name} ${index.schema}.${index.table} ${index.definition}`
            .toLowerCase()
            .includes(search.toLowerCase()) &&
          (!candidateOnly || index.status !== "healthy"),
      ),
    [candidateOnly, indexes, search],
  );
  const metrics = [
    {
      label: "Index footprint",
      value: "42.8 GB",
      detail: "31% of relation storage",
      trend: 2.8,
      tone: "cyan" as const,
      points: [42, 44, 46, 47, 49, 51, 53, 56, 58, 60, 62, 64],
    },
    {
      label: "Unused candidates",
      value: "18",
      detail: "4.2 GB · 14d window",
      trend: 0,
      tone: "amber" as const,
      points: [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50],
    },
    {
      label: "Overlap",
      value: "7",
      detail: "2 exact · 5 prefix",
      trend: 16.7,
      tone: "rose" as const,
      points: [22, 22, 28, 28, 31, 31, 38, 38, 44, 50, 55, 61],
    },
    {
      label: "Avoidable writes",
      value: "8.4 GB/d",
      detail: "Estimated maintenance I/O",
      trend: 3.2,
      tone: "violet" as const,
      points: [44, 46, 43, 48, 50, 49, 53, 51, 55, 57, 56, 59],
    },
  ];
  return (
    <div className="page">
      <PageHeader
        eyebrow="Storage and write economics"
        title="Indexes"
        description="Inventory every schema, surface duplicates and left-prefix overlap, and weigh read evidence against write amplification before suggesting a change."
        actions={
          <>
            <button className="button">
              <Download />
              Export inventory
            </button>
            <button className="button primary">
              <Sparkles />
              Generate recommendation
            </button>
          </>
        }
      />
      <div className="metric-grid" style={{ marginBottom: 12 }}>
        {metrics.map((metric) => (
          <MetricCard metric={metric} key={metric.label} />
        ))}
      </div>
      <div className="toolbar">
        <label className="search-field">
          <Search />
          <span className="sr-only">Search indexes</span>
          <input
            className="search-input"
            placeholder="Search index, table, schema, or definition…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <button
          className="filter-button"
          aria-pressed={candidateOnly}
          onClick={() => setCandidateOnly((value) => !value)}
        >
          <Filter />
          Candidates only
        </button>
      </div>
      <section className="card data-card">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Index</th>
                <th>Status</th>
                <th>Method</th>
                <th>Size</th>
                <th>Scans</th>
                <th>Write cost</th>
                <th>Definition</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((index) => (
                <tr key={index.name}>
                  <td>
                    <span className="table-primary mono">{index.name}</span>
                    <span className="query-id">
                      {index.schema}.{index.table}
                    </span>
                  </td>
                  <td>
                    <Badge
                      tone={
                        index.status === "healthy"
                          ? "green"
                          : index.status === "unused"
                            ? "amber"
                            : "rose"
                      }
                    >
                      {index.status}
                    </Badge>
                  </td>
                  <td>
                    <Badge>{index.type}</Badge>
                  </td>
                  <td className="number">{index.size}</td>
                  <td className="number">{index.scans.toLocaleString()}</td>
                  <td>
                    <div
                      className={`risk-meter severity-${index.writeCost === "high" ? "critical" : index.writeCost === "medium" ? "warning" : "success"}`}
                    >
                      <div className="risk-bar">
                        <span
                          style={{
                            width:
                              index.writeCost === "high"
                                ? "92%"
                                : index.writeCost === "medium"
                                  ? "57%"
                                  : "23%",
                          }}
                        />
                      </div>
                      <span>{index.writeCost}</span>
                    </div>
                  </td>
                  <td className="query-cell">
                    <span className="query-snippet">{index.definition}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-footer">
          Showing {filtered.length} of 284 indexes across 12 schemas
        </div>
      </section>
      <div className="content-grid">
        <Card>
          <CardHeader
            title="Evidence-backed candidate"
            subtitle="public.orders"
            action={<Badge tone="rose">High impact</Badge>}
          />
          <CardBody>
            <div className="query-panel">
              <span className="token-keyword">CREATE INDEX CONCURRENTLY</span>{" "}
              orders_store_status_created_cover_idx
              <br />
              <span className="token-keyword">ON</span>{" "}
              <span className="token-table">public.orders</span> (store_id,
              status, created_at <span className="token-keyword">DESC</span>)
              <br />
              <span className="token-keyword">INCLUDE</span> (total);
            </div>
            <div className="privacy-note" style={{ marginTop: 11 }}>
              <Sparkles />
              Evidence: 1,842 calls / 15m, 14.8k shared reads per call, stable
              filter pattern, and a matching sort key.
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button className="button">
                <Copy />
                Copy migration
              </button>
              <button className="button">Export .sql</button>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Hypothetical indexes"
            action={<Badge tone="amber">Unavailable</Badge>}
          />
          <CardBody>
            <p style={{ color: "var(--muted)", fontSize: 11, marginTop: 0 }}>
              HypoPG is not installed on this database. Recommendations are
              derived from observed plans and workload evidence, but no cost
              simulation is presented.
            </p>
            <button className="button">View enablement guide</button>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
