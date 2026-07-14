"use client";

import { useState } from "react";
import { AlertTriangle, Copy, Gauge, Play, RefreshCw } from "lucide-react";
import { demoRepository } from "@/lib/demo/data";
import type { MaintenanceRecord } from "@/lib/demo/types";
import type { ProgressOperation } from "@/lib/db/maintenance";
import type { DataSourceState } from "@/lib/server/dashboard-data";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { MetricCard } from "@/components/ui/metric-card";
import { PageHeader } from "@/components/ui/page-header";
import { DataSourceBadge } from "@/components/ui/data-source-badge";

export function MaintenancePage({
  maintenance = demoRepository.maintenance(),
  progress = [],
  pgstattupleAvailable = false,
  source = {
    mode: "unavailable",
    label: "Sample preview",
    detail: "No database data was supplied.",
  },
}: {
  maintenance?: MaintenanceRecord[];
  progress?: ProgressOperation[];
  pgstattupleAvailable?: boolean;
  source?: DataSourceState;
}) {
  const [tab, setTab] = useState<"tables" | "progress">("tables");
  const [bloatResult, setBloatResult] = useState<string | null>(null);
  const rows = maintenance;
  const recommended = rows[0];
  const totalDead = rows.reduce((total, row) => total + row.deadRows, 0);
  const totalLive = rows.reduce((total, row) => total + row.liveRows, 0);
  const metrics = [
    {
      label: "Dead tuples",
      value: totalDead.toLocaleString(),
      detail: `${((totalDead / Math.max(1, totalLive + totalDead)) * 100).toFixed(1)}% weighted ratio`,
      trend: 0,
      tone: "rose" as const,
      points: [32, 34, 37, 39, 42, 45, 49, 52, 57, 61, 66, 70],
    },
    {
      label: "Tables at risk",
      value: String(rows.filter((row) => row.risk !== "low").length),
      detail: `${rows.filter((row) => row.risk === "high").length} high · ${rows.filter((row) => row.risk === "medium").length} medium`,
      trend: 0,
      tone: "amber" as const,
      points: [18, 18, 18, 25, 25, 25, 33, 33, 43, 50, 58, 65],
    },
    {
      label: "Oldest freeze age",
      value: `${Math.round(Math.max(0, ...rows.map((row) => row.freezeAge)) / 1_000_000)}M`,
      detail: "Transaction ID age",
      trend: 0,
      tone: "violet" as const,
      points: [40, 42, 43, 46, 47, 49, 52, 54, 57, 59, 62, 65],
    },
    {
      label: "Bloat exposure",
      value: String(rows.filter((row) => row.deadRatio >= 10).length),
      detail: `High dead-ratio relations · ${rows.length} loaded`,
      trend: 0,
      tone: "cyan" as const,
      points: [35, 38, 36, 40, 42, 46, 45, 51, 54, 57, 61, 64],
    },
  ];
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
              <RefreshCw />
              Refresh view
            </button>
            <button className="button primary" onClick={() => setTab("tables")}>
              <Gauge />
              Review highest risk
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
        <section className="card data-card">
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
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.schema}.${row.table}`}>
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
                    <td className="number">{row.liveRows.toLocaleString()}</td>
                    <td className="number">{row.deadRows.toLocaleString()}</td>
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
          </div>
          <div className="table-footer">
            {rows.length} bounded table rows · sorted by maintenance risk
          </div>
        </section>
      ) : (
        <ProgressView progress={progress} />
      )}
      <div className="content-grid">
        <Card>
          <CardHeader
            title="Recommended maintenance"
            subtitle={
              recommended
                ? `${recommended.schema}.${recommended.table}`
                : "No relation selected"
            }
            action={
              <Badge
                tone={
                  recommended?.risk === "high"
                    ? "rose"
                    : recommended?.risk === "medium"
                      ? "amber"
                      : "green"
                }
              >
                {recommended?.risk ?? "clear"}
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
                  {recommended
                    ? `${recommended.deadRows.toLocaleString()} dead tuples observed`
                    : "No material maintenance pressure"}
                </strong>
                <p style={{ color: "var(--muted)", fontSize: 10 }}>
                  {recommended
                    ? `${recommended.deadRatio}% dead ratio · vacuum ${recommended.lastVacuum} · analyze ${recommended.lastAnalyze}.`
                    : "The bounded catalog inventory has no rows."}
                </p>
              </div>
            </div>
            <div className="query-panel" style={{ marginTop: 12 }}>
              <span className="token-keyword">VACUUM</span> (ANALYZE){" "}
              <span className="token-table">
                {recommended
                  ? `${recommended.schema}.${recommended.table}`
                  : "schema.table"}
              </span>
              ;
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 11 }}>
              <button
                className="button"
                disabled={!recommended}
                onClick={() => {
                  if (!recommended) return;
                  void fetch("/api/maintenance/command", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                      schema: recommended.schema,
                      table: recommended.table,
                      operation: "vacuum_analyze",
                    }),
                  }).then(async (response) => {
                    const body = (await response.json()) as { sql?: string };
                    if (body.sql)
                      await navigator.clipboard?.writeText(body.sql);
                  });
                }}
              >
                <Copy />
                Copy command
              </button>
              <Badge tone="amber">Review only</Badge>
            </div>
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
              The lightweight catalog estimate is always available. An exact
              scan uses <span className="mono">pgstattuple</span>, can be
              expensive, and requires explicit confirmation.
            </p>
            <button
              className="button"
              disabled={!pgstattupleAvailable || !recommended?.relationOid}
              onClick={() => {
                if (!recommended?.relationOid) return;
                setBloatResult("Running bounded check…");
                void fetch("/api/maintenance/bloat", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    relationOid: recommended.relationOid,
                    acknowledgement: "RUN EXPENSIVE BLOAT CHECK",
                  }),
                }).then(async (response) => {
                  const body = (await response.json()) as {
                    result?: {
                      deadTuplePercent?: number;
                      freePercent?: number;
                    };
                    error?: { message?: string };
                  };
                  setBloatResult(
                    body.result
                      ? `${body.result.deadTuplePercent?.toFixed(2)}% dead · ${body.result.freePercent?.toFixed(2)}% free`
                      : (body.error?.message ?? "Check failed"),
                  );
                });
              }}
            >
              <Play />
              {pgstattupleAvailable
                ? "Run exact check"
                : "Exact check unavailable"}
            </button>
            {bloatResult ? (
              <p className="card-subtitle">{bloatResult}</p>
            ) : null}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function ProgressView({ progress }: { progress: ProgressOperation[] }) {
  if (progress.length === 0) {
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
  }
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
              <div className="info-grid" style={{ marginTop: 13 }}>
                <div className="info-cell">
                  <span>Relation OID</span>
                  <strong>{operation.relationOid}</strong>
                </div>
                <div className="info-cell">
                  <span>Phase</span>
                  <strong>{operation.phase}</strong>
                </div>
              </div>
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}
