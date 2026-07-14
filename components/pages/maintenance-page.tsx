"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  ChevronLeft,
  ChevronRight,
  Copy,
  Gauge,
  Play,
  RefreshCw,
  Search,
} from "lucide-react";
import { demoRepository } from "@/lib/demo/data";
import type { MaintenanceRecord } from "@/lib/demo/types";
import type { ProgressOperation } from "@/lib/db/maintenance";
import type { DataSourceState } from "@/lib/server/dashboard-data";
import { contextualHref } from "@/lib/presentation/inventory";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { MetricCard } from "@/components/ui/metric-card";
import { PageHeader } from "@/components/ui/page-header";
import { DataSourceBadge } from "@/components/ui/data-source-badge";

const PAGE_SIZE = 25;
type RiskFilter = "all" | "high" | "medium" | "low";
type MaintenanceOperation = "vacuum" | "analyze" | "vacuum_analyze";

export function MaintenancePage({
  maintenance: initialMaintenance = demoRepository.maintenance(),
  initialHasMore = false,
  progress: initialProgress = [],
  pgstattupleAvailable = false,
  sourceKey,
  schema,
  source = {
    mode: "unavailable",
    label: "Sample preview",
    detail: "No database data was supplied.",
  },
}: {
  maintenance?: MaintenanceRecord[];
  initialHasMore?: boolean;
  progress?: ProgressOperation[];
  pgstattupleAvailable?: boolean;
  sourceKey?: string;
  schema?: string;
  source?: DataSourceState;
}) {
  const [tab, setTab] = useState<"tables" | "progress">("tables");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [risk, setRisk] = useState<RiskFilter>("all");
  const [rows, setRows] = useState(initialMaintenance);
  const [progress, setProgress] = useState(initialProgress);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState(
    initialMaintenance[0]
      ? `${initialMaintenance[0].schema}.${initialMaintenance[0].table}`
      : null,
  );
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [bloatResult, setBloatResult] = useState<string | null>(null);
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
    });
    if (sourceKey) parameters.set("source", sourceKey);
    if (schema) parameters.set("schema", schema);
    if (appliedSearch) parameters.set("search", appliedSearch);
    setLoading(true);
    setError(null);
    void fetch(`/api/maintenance?${parameters}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json()) as {
          tableViews?: MaintenanceRecord[];
          progress?: ProgressOperation[];
          pagination?: { hasMore?: boolean };
          error?: { message?: string };
        };
        if (!response.ok || !body.tableViews)
          throw new Error(
            body.error?.message ?? "Maintenance inventory failed",
          );
        setRows(body.tableViews);
        setProgress(body.progress ?? []);
        setHasMore(Boolean(body.pagination?.hasMore));
        setSelectedKey(
          body.tableViews[0]
            ? `${body.tableViews[0].schema}.${body.tableViews[0].table}`
            : null,
        );
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError")
          return;
        setError(
          caught instanceof Error
            ? caught.message
            : "Maintenance inventory failed",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [appliedSearch, page, schema, sourceKey]);

  const visibleRows = useMemo(
    () => (risk === "all" ? rows : rows.filter((row) => row.risk === risk)),
    [risk, rows],
  );
  const selected =
    rows.find((row) => `${row.schema}.${row.table}` === selectedKey) ?? rows[0];
  const totalDead = rows.reduce((total, row) => total + row.deadRows, 0);
  const totalLive = rows.reduce((total, row) => total + row.liveRows, 0);
  const metrics = [
    {
      label: "Dead tuples",
      value: totalDead.toLocaleString(),
      detail: `${((totalDead / Math.max(1, totalLive + totalDead)) * 100).toFixed(1)}% weighted ratio in this page`,
      trend: 0,
      tone: "rose" as const,
      points: [],
    },
    {
      label: "Tables at risk",
      value: String(rows.filter((row) => row.risk !== "low").length),
      detail: `${rows.filter((row) => row.risk === "high").length} high · ${rows.filter((row) => row.risk === "medium").length} medium`,
      trend: 0,
      tone: "amber" as const,
      points: [],
    },
    {
      label: "Oldest freeze age",
      value: `${Math.round(Math.max(0, ...rows.map((row) => row.freezeAge)) / 1_000_000)}M`,
      detail: "Current transaction ID age",
      trend: 0,
      tone: "violet" as const,
      points: [],
    },
    {
      label: "Bloat exposure",
      value: String(rows.filter((row) => row.deadRatio >= 10).length),
      detail: `High dead-ratio relations · ${rows.length} loaded`,
      trend: 0,
      tone: "cyan" as const,
      points: [],
    },
  ];

  const copyCommand = async (operation: MaintenanceOperation) => {
    if (!selected) return;
    setActionStatus("Generating review-only command…");
    try {
      const response = await fetch("/api/maintenance/command", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schema: selected.schema,
          table: selected.table,
          operation,
        }),
      });
      const body = (await response.json()) as {
        sql?: string;
        error?: { message?: string };
      };
      if (!response.ok || !body.sql)
        throw new Error(body.error?.message ?? "Command generation failed");
      await navigator.clipboard?.writeText(body.sql);
      setActionStatus(`${body.sql} copied · review only`);
    } catch (caught) {
      setActionStatus(
        caught instanceof Error ? caught.message : "Command generation failed",
      );
    }
  };

  const runBloatCheck = async () => {
    if (!selected?.relationOid) return;
    setBloatResult("Running bounded check…");
    try {
      const response = await fetch("/api/maintenance/bloat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: sourceKey,
          relationOid: selected.relationOid,
          acknowledgement: "RUN EXPENSIVE BLOAT CHECK",
        }),
      });
      const body = (await response.json()) as {
        result?: { deadTuplePercent?: number; freePercent?: number };
        error?: { message?: string };
      };
      if (!response.ok || !body.result)
        throw new Error(body.error?.message ?? "Check failed");
      setBloatResult(
        `${body.result.deadTuplePercent?.toFixed(2)}% dead · ${body.result.freePercent?.toFixed(2)}% free`,
      );
    } catch (caught) {
      setBloatResult(caught instanceof Error ? caught.message : "Check failed");
    }
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="Table health and lifecycle"
        title="Maintenance"
        description="Understand vacuum urgency, statistics freshness, freeze exposure, and bloat risk without turning the dashboard into an unsafe operations console."
        actions={
          <>
            <DataSourceBadge source={source} />
            <button className="button" onClick={() => window.location.reload()}>
              <RefreshCw /> Refresh view
            </button>
            <button
              className="button primary"
              onClick={() => {
                setTab("tables");
                setRisk("high");
              }}
            >
              <Gauge /> Review highest risk
            </button>
          </>
        }
      />
      <div className="metric-grid" style={{ marginBottom: 12 }}>
        {metrics.map((metric) => (
          <MetricCard metric={metric} key={metric.label} />
        ))}
      </div>
      <div className="section-tabs">
        <button
          className={`section-tab${tab === "tables" ? " active" : ""}`}
          onClick={() => setTab("tables")}
        >
          Table health
        </button>
        <button
          className={`section-tab${tab === "progress" ? " active" : ""}`}
          onClick={() => setTab("progress")}
        >
          Live progress <Badge tone="cyan">{progress.length}</Badge>
        </button>
      </div>
      {tab === "tables" ? (
        <>
          <div className="toolbar">
            <label className="search-field">
              <Search />
              <span className="sr-only">Search maintenance relations</span>
              <input
                className="search-input"
                placeholder="Search schema or table…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <select
              className="context-select compact"
              aria-label="Maintenance risk filter"
              value={risk}
              onChange={(event) => setRisk(event.target.value as RiskFilter)}
            >
              <option value="all">All risks on page</option>
              <option value="high">High risk</option>
              <option value="medium">Medium risk</option>
              <option value="low">Low risk</option>
            </select>
          </div>
          <section className="card data-card" aria-busy={loading}>
            {error ? (
              <div className="privacy-note" role="alert">
                {error}
              </div>
            ) : null}
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Relation</th>
                    <th>Risk</th>
                    <th>Total size</th>
                    <th>Live rows</th>
                    <th>Dead rows</th>
                    <th>Dead ratio</th>
                    <th>Last vacuum</th>
                    <th>Last analyze</th>
                    <th>Freeze age</th>
                  </tr>
                </thead>
                <tbody style={{ opacity: loading ? 0.55 : 1 }}>
                  {visibleRows.map((row) => (
                    <tr
                      key={`${row.schema}.${row.table}`}
                      className={
                        selectedKey === `${row.schema}.${row.table}`
                          ? "selected-row"
                          : undefined
                      }
                      tabIndex={0}
                      onClick={() =>
                        setSelectedKey(`${row.schema}.${row.table}`)
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ")
                          setSelectedKey(`${row.schema}.${row.table}`);
                      }}
                    >
                      <td>
                        <span className="table-primary mono">
                          {row.schema}.{row.table}
                        </span>
                      </td>
                      <td>
                        <Badge
                          tone={
                            row.risk === "high"
                              ? "rose"
                              : row.risk === "medium"
                                ? "amber"
                                : "green"
                          }
                        >
                          {row.risk}
                        </Badge>
                      </td>
                      <td className="number">{row.totalSize}</td>
                      <td className="number">
                        {row.liveRows.toLocaleString()}
                      </td>
                      <td className="number">
                        {row.deadRows.toLocaleString()}
                      </td>
                      <td>
                        <div
                          className={`risk-meter severity-${row.deadRatio > 10 ? "critical" : row.deadRatio > 2 ? "warning" : "success"}`}
                        >
                          <div className="risk-bar">
                            <span
                              style={{
                                width: `${Math.min(row.deadRatio * 4, 100)}%`,
                              }}
                            />
                          </div>
                          <span className="number">{row.deadRatio}%</span>
                        </div>
                      </td>
                      <td className="number">{row.lastVacuum}</td>
                      <td className="number">{row.lastAnalyze}</td>
                      <td className="number">
                        {Math.round(row.freezeAge / 1_000_000)}M
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {visibleRows.length === 0 ? (
                <div className="empty-state">
                  <div>
                    <h2>No matching relations</h2>
                    <p>Adjust the API search or page-level risk filter.</p>
                  </div>
                </div>
              ) : null}
            </div>
            <footer className="table-footer">
              <span>
                Page {page + 1} · {rows.length} bounded rows · sorted by
                maintenance risk
              </span>
              <nav className="pagination" aria-label="Maintenance pages">
                <button
                  className="page-button"
                  aria-label="Previous maintenance page"
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
                  aria-label="Next maintenance page"
                  disabled={!hasMore || loading}
                  onClick={() => setPage((value) => value + 1)}
                >
                  <ChevronRight size={13} />
                </button>
              </nav>
            </footer>
          </section>
        </>
      ) : (
        <ProgressView progress={progress} />
      )}
      <div className="content-grid">
        <Card>
          <CardHeader
            title="Recommended maintenance"
            subtitle={
              selected
                ? `${selected.schema}.${selected.table}`
                : "No relation selected"
            }
            action={
              <Badge
                tone={
                  selected?.risk === "high"
                    ? "rose"
                    : selected?.risk === "medium"
                      ? "amber"
                      : "green"
                }
              >
                {selected?.risk ?? "clear"}
              </Badge>
            }
          />
          <CardBody>
            <div style={{ display: "flex", gap: 11 }}>
              <span
                className="error-state-icon"
                style={{
                  margin: 0,
                  color: "var(--amber)",
                  background: "var(--amber-soft)",
                }}
              >
                <AlertTriangle />
              </span>
              <div>
                <strong style={{ fontSize: 12 }}>
                  {selected
                    ? `${selected.deadRows.toLocaleString()} dead tuples observed`
                    : "No material maintenance pressure"}
                </strong>
                <p style={{ color: "var(--muted)", fontSize: 10 }}>
                  {selected
                    ? `${selected.deadRatio}% dead ratio · vacuum ${selected.lastVacuum} · analyze ${selected.lastAnalyze}.`
                    : "The bounded catalog inventory has no rows."}
                </p>
                {selected ? (
                  <div className="info-grid" style={{ marginTop: 10 }}>
                    <div className="info-cell">
                      <span>Heap / total</span>
                      <strong>
                        {selected.relationSize ?? "unknown"} /{" "}
                        {selected.totalSize}
                      </strong>
                    </div>
                    <div className="info-cell">
                      <span>Seq / index scans</span>
                      <strong>
                        {(selected.sequentialScans ?? 0).toLocaleString()} /{" "}
                        {(selected.indexScans ?? 0).toLocaleString()}
                      </strong>
                    </div>
                    <div className="info-cell">
                      <span>Mutations I/U/D</span>
                      <strong>
                        {(selected.inserted ?? 0).toLocaleString()} /{" "}
                        {(selected.updated ?? 0).toLocaleString()} /{" "}
                        {(selected.deleted ?? 0).toLocaleString()}
                      </strong>
                    </div>
                    <div className="info-cell">
                      <span>Changes since analyze</span>
                      <strong>
                        {(
                          selected.modificationsSinceAnalyze ?? 0
                        ).toLocaleString()}
                      </strong>
                    </div>
                    <div className="info-cell">
                      <span>Manual / auto vacuum</span>
                      <strong>
                        {selected.lastManualVacuum} / {selected.lastAutovacuum}
                      </strong>
                    </div>
                    <div className="info-cell">
                      <span>Manual / auto analyze</span>
                      <strong>
                        {selected.lastManualAnalyze} /{" "}
                        {selected.lastAutoanalyze}
                      </strong>
                    </div>
                    <div className="info-cell" style={{ gridColumn: "1 / -1" }}>
                      <span>Relation settings</span>
                      <strong className="mono">
                        {selected.relationOptions?.join(", ") || "defaults"}
                      </strong>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="query-panel" style={{ marginTop: 12 }}>
              VACUUM (ANALYZE){" "}
              <span>
                {selected
                  ? `${selected.schema}.${selected.table}`
                  : "schema.table"}
              </span>
              ;
            </div>
            <div
              style={{
                display: "flex",
                gap: 8,
                marginTop: 11,
                flexWrap: "wrap",
              }}
            >
              <button
                className="button"
                disabled={!selected}
                onClick={() => void copyCommand("vacuum")}
              >
                <Copy /> Vacuum
              </button>
              <button
                className="button"
                disabled={!selected}
                onClick={() => void copyCommand("analyze")}
              >
                <Copy /> Analyze
              </button>
              <button
                className="button"
                disabled={!selected}
                onClick={() => void copyCommand("vacuum_analyze")}
              >
                <Copy /> Vacuum + analyze
              </button>
              {selected ? (
                <a
                  className="button"
                  href={contextualHref("/advisor", {
                    source: sourceKey,
                    schema,
                    parameters: {
                      relationSchema: selected.schema,
                      relationTable: selected.table,
                      findingType: "maintenance",
                    },
                  })}
                >
                  <Bot /> Analyze with AI
                </a>
              ) : null}
              <Badge tone="amber">Review only · copy only</Badge>
            </div>
            {actionStatus ? (
              <p className="card-subtitle" role="status">
                {actionStatus}
              </p>
            ) : null}
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Exact bloat check"
            action={
              <Badge tone={pgstattupleAvailable ? "green" : "amber"}>
                {pgstattupleAvailable ? "Available" : "Capability gated"}
              </Badge>
            }
          />
          <CardBody>
            <p style={{ marginTop: 0, color: "var(--muted)", fontSize: 11 }}>
              The lightweight catalog estimate is always available. An exact{" "}
              <span className="mono">pgstattuple</span> scan can be expensive
              and requires explicit confirmation.
            </p>
            <button
              className="button"
              disabled={!pgstattupleAvailable || !selected?.relationOid}
              onClick={() => void runBloatCheck()}
            >
              <Play />{" "}
              {pgstattupleAvailable
                ? "Run exact check"
                : "Exact check unavailable"}
            </button>
            {bloatResult ? (
              <p className="card-subtitle" role="status">
                {bloatResult}
              </p>
            ) : null}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function ProgressView({ progress }: { progress: ProgressOperation[] }) {
  if (progress.length === 0)
    return (
      <div className="empty-state">
        <div>
          <h2>No maintenance operations in progress</h2>
          <p>
            PostgreSQL reports no active vacuum or index-build progress rows.
          </p>
        </div>
      </div>
    );
  return (
    <div className="content-grid equal" style={{ marginTop: 0 }}>
      {progress.map((operation) => {
        const percentage =
          operation.total > 0
            ? Math.min(100, (operation.completed / operation.total) * 100)
            : 0;
        return (
          <Card key={`${operation.operation}:${operation.processId}`}>
            <CardHeader
              title={`${operation.operation.replace("_", " ").toUpperCase()} · PID ${operation.processId}`}
              action={<Badge tone="cyan">{operation.phase}</Badge>}
            />
            <CardBody>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  color: "var(--muted)",
                  fontSize: 10,
                  marginBottom: 8,
                }}
              >
                <span>
                  {operation.completed.toLocaleString()} of{" "}
                  {operation.total.toLocaleString()} units
                </span>
                <span className="number">{percentage.toFixed(1)}%</span>
              </div>
              <div className="progress-track">
                <span style={{ width: `${percentage}%` }} />
              </div>
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}
