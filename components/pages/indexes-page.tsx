"use client";

import { useMemo, useState } from "react";
import { Copy, Download, Filter, Search, Sparkles } from "lucide-react";
import { demoRepository } from "@/lib/demo/data";
import type { IndexRecord } from "@/lib/demo/types";
import type { DataSourceState } from "@/lib/server/dashboard-data";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { MetricCard } from "@/components/ui/metric-card";
import { PageHeader } from "@/components/ui/page-header";
import { DataSourceBadge } from "@/components/ui/data-source-badge";

export function IndexesPage({
  indexes = demoRepository.indexes(),
  hypopgAvailable = false,
  source = {
    mode: "unavailable",
    label: "Sample preview",
    detail: "No database data was supplied.",
  },
}: {
  indexes?: IndexRecord[];
  hypopgAvailable?: boolean;
  source?: DataSourceState;
}) {
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
  const selected =
    indexes.find((index) => index.status !== "healthy") ?? indexes[0];
  const footprint = indexes.reduce(
    (total, index) => total + (index.sizeBytes ?? 0),
    0,
  );
  const formatBytes = (bytes: number) =>
    bytes >= 1_073_741_824
      ? `${(bytes / 1_073_741_824).toFixed(1)} GB`
      : `${(bytes / 1_048_576).toFixed(1)} MB`;
  const metrics = [
    {
      label: "Index footprint",
      value: formatBytes(footprint),
      detail: `${indexes.length} bounded index rows`,
      trend: 0,
      tone: "cyan" as const,
      points: [42, 44, 46, 47, 49, 51, 53, 56, 58, 60, 62, 64],
    },
    {
      label: "Unused candidates",
      value: String(
        indexes.filter((index) => index.status === "unused").length,
      ),
      detail: "Zero scans · current stats window",
      trend: 0,
      tone: "amber" as const,
      points: [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50],
    },
    {
      label: "Overlap",
      value: String(
        indexes.filter(
          (index) => index.status === "duplicate" || index.status === "overlap",
        ).length,
      ),
      detail: `${indexes.filter((index) => index.status === "duplicate").length} exact · ${indexes.filter((index) => index.status === "overlap").length} prefix`,
      trend: 0,
      tone: "rose" as const,
      points: [22, 22, 28, 28, 31, 31, 38, 38, 44, 50, 55, 61],
    },
    {
      label: "Avoidable writes",
      value: String(
        indexes.filter((index) => index.writeCost === "high").length,
      ),
      detail: "High write-cost signals",
      trend: 0,
      tone: "violet" as const,
      points: [44, 46, 43, 48, 50, 49, 53, 51, 55, 57, 56, 59],
    },
  ];
  const downloadInventory = () => {
    const csv = [
      [
        "schema",
        "table",
        "index",
        "status",
        "method",
        "size",
        "scans",
        "definition",
      ],
      ...indexes.map((index) => [
        index.schema,
        index.table,
        index.name,
        index.status,
        index.type,
        index.size,
        String(index.scans),
        index.definition,
      ]),
    ]
      .map((row) =>
        row.map((value) => `"${value.replaceAll('"', '""')}"`).join(","),
      )
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "index-analyzer-indexes.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="page">
      <PageHeader
        eyebrow="Storage and write economics"
        title="Indexes"
        description="Inventory every schema, surface duplicates and left-prefix overlap, and weigh read evidence against write amplification before suggesting a change."
        actions={
          <>
            <DataSourceBadge source={source} />
            <button className="button" onClick={downloadInventory}>
              <Download />
              Export inventory
            </button>
            <a className="button primary" href="/plans">
              <Sparkles />
              Analyze a plan
            </a>
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
          Showing {filtered.length} of {indexes.length} indexes across{" "}
          {new Set(indexes.map((index) => index.schema)).size} schemas
        </div>
      </section>
      <div className="content-grid">
        <Card>
          <CardHeader
            title="Selected catalog evidence"
            subtitle={
              selected
                ? `${selected.schema}.${selected.table}`
                : "No index selected"
            }
            action={
              <Badge tone={selected?.status === "healthy" ? "green" : "amber"}>
                {selected?.status ?? "empty"}
              </Badge>
            }
          />
          <CardBody>
            <div className="query-panel">
              {selected?.definition ?? "No index definition is available."}
            </div>
            <div className="privacy-note" style={{ marginTop: 11 }}>
              <Sparkles />
              Evidence: {selected?.scans.toLocaleString() ?? 0} scans ·{" "}
              {selected?.size ?? "0 B"} · {selected?.writeCost ?? "low"}{" "}
              write-cost signal. Removal and creation SQL always require
              operator review.
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button
                className="button"
                disabled={!selected}
                onClick={() => {
                  if (selected)
                    void navigator.clipboard?.writeText(selected.definition);
                }}
              >
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
            action={
              <Badge tone={hypopgAvailable ? "green" : "amber"}>
                {hypopgAvailable ? "Available" : "Unavailable"}
              </Badge>
            }
          />
          <CardBody>
            <p style={{ color: "var(--muted)", fontSize: 11, marginTop: 0 }}>
              {hypopgAvailable
                ? "HypoPG is available for future hypothetical-index experiments; this implementation still requires operator review before every real DDL change."
                : "HypoPG is not installed on this database. Recommendations are derived from observed plans and workload evidence, but no cost simulation is presented."}
            </p>
            <button className="button">View enablement guide</button>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
