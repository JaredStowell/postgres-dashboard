"use client";

import { useState } from "react";
import { AlertTriangle, Copy, Gauge, Play, RefreshCw } from "lucide-react";
import { demoRepository } from "@/lib/demo/data";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { MetricCard } from "@/components/ui/metric-card";
import { PageHeader } from "@/components/ui/page-header";

export function MaintenancePage() {
  const [tab, setTab] = useState<"tables" | "progress">("tables");
  const rows = demoRepository.maintenance();
  const metrics = [
    {
      label: "Dead tuples",
      value: "4.1M",
      detail: "6.8% weighted ratio",
      trend: 4.2,
      tone: "rose" as const,
      points: [32, 34, 37, 39, 42, 45, 49, 52, 57, 61, 66, 70],
    },
    {
      label: "Tables at risk",
      value: "3",
      detail: "1 high · 2 medium",
      trend: 50,
      tone: "amber" as const,
      points: [18, 18, 18, 25, 25, 25, 33, 33, 43, 50, 58, 65],
    },
    {
      label: "Oldest freeze age",
      value: "288M",
      detail: "14.4% of wraparound",
      trend: 2.9,
      tone: "violet" as const,
      points: [40, 42, 43, 46, 47, 49, 52, 54, 57, 59, 62, 65],
    },
    {
      label: "Bloat exposure",
      value: "9.2 GB",
      detail: "Estimated · 5 relations",
      trend: 6.1,
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
            <button className="button">
              <RefreshCw />
              Collect now
            </button>
            <button className="button primary">
              <Gauge />
              Run bounded check
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
          Live progress <Badge tone="cyan">2</Badge>
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
            5 of 1,010 tables · sorted by maintenance risk
          </div>
        </section>
      ) : (
        <ProgressView />
      )}
      <div className="content-grid">
        <Card>
          <CardHeader
            title="Recommended maintenance"
            subtitle="audit.events"
            action={<Badge tone="rose">High urgency</Badge>}
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
                  Autovacuum is not keeping pace
                </strong>
                <p style={{ color: "var(--muted)", fontSize: 10 }}>
                  2.4M dead tuples accumulated in 17 hours. The table’s mutation
                  rate is 3.7× above the previous window.
                </p>
              </div>
            </div>
            <div className="query-panel" style={{ marginTop: 12 }}>
              <span className="token-keyword">VACUUM</span> (VERBOSE, ANALYZE){" "}
              <span className="token-table">audit.events</span>;
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 11 }}>
              <button className="button">
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
            action={<Badge tone="amber">Capability gated</Badge>}
          />
          <CardBody>
            <p style={{ marginTop: 0, color: "var(--muted)", fontSize: 11 }}>
              The lightweight catalog estimate is available. An exact scan
              requires <span className="mono">pgstattuple</span>, which is not
              installed, and can be expensive on large relations.
            </p>
            <button className="button" disabled>
              <Play />
              Exact check unavailable
            </button>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function ProgressView() {
  return (
    <div className="content-grid equal" style={{ marginTop: 0 }}>
      <Card>
        <CardHeader
          title="VACUUM · audit.events"
          action={<Badge tone="cyan">scanning heap</Badge>}
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
            <span>24,819 of 48,210 blocks</span>
            <span className="number">51.5%</span>
          </div>
          <div className="progress-track">
            <span style={{ width: "51.5%" }} />
          </div>
          <div className="info-grid" style={{ marginTop: 13 }}>
            <div className="info-cell">
              <span>Tuples removed</span>
              <strong>1.18M</strong>
            </div>
            <div className="info-cell">
              <span>Elapsed</span>
              <strong>04:18</strong>
            </div>
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title="CREATE INDEX · orders"
          action={<Badge tone="violet">building</Badge>}
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
            <span>index validation: scanning index</span>
            <span className="number">84%</span>
          </div>
          <div className="progress-track">
            <span style={{ width: "84%" }} />
          </div>
          <div className="info-grid" style={{ marginTop: 13 }}>
            <div className="info-cell">
              <span>Lockers done</span>
              <strong>38 / 38</strong>
            </div>
            <div className="info-cell">
              <span>Elapsed</span>
              <strong>12:51</strong>
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
