"use client";

import { useMemo, useState } from "react";
import {
  CheckCircle2,
  Download,
  Filter,
  Search,
  Settings2,
} from "lucide-react";
import { demoRepository } from "@/lib/demo/data";
import type { Severity } from "@/lib/demo/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FindingsList } from "@/components/ui/findings-list";
import { MetricCard } from "@/components/ui/metric-card";
import { PageHeader } from "@/components/ui/page-header";

export function FindingsPage() {
  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState<Severity | "all">("all");
  const findings = demoRepository.findings();
  const filtered = useMemo(
    () =>
      findings.filter(
        (finding) =>
          `${finding.title} ${finding.description} ${finding.evidence}`
            .toLowerCase()
            .includes(search.toLowerCase()) &&
          (severity === "all" || finding.severity === severity),
      ),
    [findings, search, severity],
  );
  const metrics = [
    {
      label: "Open findings",
      value: "7",
      detail: "2 critical · 3 warning",
      trend: -12.5,
      tone: "rose" as const,
      points: [72, 70, 68, 64, 66, 61, 58, 56, 52, 49, 46, 43],
    },
    {
      label: "New today",
      value: "3",
      detail: "Across 2 databases",
      trend: 50,
      tone: "amber" as const,
      points: [10, 10, 10, 18, 18, 25, 25, 33, 40, 48, 55, 62],
    },
    {
      label: "Resolved · 7d",
      value: "24",
      detail: "Median time 5h 14m",
      trend: 20,
      tone: "green" as const,
      points: [20, 24, 29, 32, 38, 41, 47, 51, 55, 60, 66, 72],
    },
    {
      label: "Rules enabled",
      value: "11",
      detail: "1 currently muted",
      trend: 0,
      tone: "violet" as const,
      points: [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50],
    },
  ];
  return (
    <div className="page">
      <PageHeader
        eyebrow="Evidence and follow-through"
        title="Findings"
        description="A durable, deduplicated queue of workload regressions, plan changes, maintenance risks, index signals, and live incidents."
        actions={
          <>
            <button className="button">
              <Download />
              Export
            </button>
            <button className="button primary">
              <Settings2 />
              Manage rules
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
          <span className="sr-only">Search findings</span>
          <input
            className="search-input"
            placeholder="Search findings and evidence…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <button className="filter-button">
          <Filter />
          Status: active
        </button>
        <select
          className="context-select compact"
          aria-label="Severity filter"
          value={severity}
          onChange={(event) =>
            setSeverity(event.target.value as Severity | "all")
          }
        >
          <option value="all">All severity</option>
          <option value="critical">Critical</option>
          <option value="warning">Warning</option>
          <option value="info">Info</option>
          <option value="success">Resolved</option>
        </select>
      </div>
      <div className="content-grid">
        <Card>
          <CardHeader
            title="Active queue"
            subtitle={`${filtered.length} visible`}
          />
          <FindingsList findings={filtered} detailed />
        </Card>
        <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
          <Card>
            <CardHeader
              title="Selected finding"
              action={<Badge tone="rose">Critical</Badge>}
            />
            <CardBody>
              <h3 style={{ margin: 0, fontSize: 13 }}>
                Checkout lookup regressed 63%
              </h3>
              <p style={{ color: "var(--muted)", fontSize: 10 }}>
                Mean execution time moved from 84 ms to 137 ms while calls
                remained above the minimum guard.
              </p>
              <div className="info-grid">
                <div className="info-cell">
                  <span>First seen</span>
                  <strong>2h ago</strong>
                </div>
                <div className="info-cell">
                  <span>Occurrences</span>
                  <strong>7</strong>
                </div>
                <div className="info-cell">
                  <span>Baseline</span>
                  <strong>84.1ms</strong>
                </div>
                <div className="info-cell">
                  <span>Current</span>
                  <strong>137.0ms</strong>
                </div>
              </div>
              <textarea
                className="textarea"
                rows={3}
                placeholder="Add an operator note…"
                style={{ marginTop: 12, padding: 10, resize: "vertical" }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 9 }}>
                <button className="button">
                  <CheckCircle2 />
                  Acknowledge
                </button>
                <button className="button">Dismiss</button>
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Deduplication evidence" />
            <CardBody>
              <p
                className="mono"
                style={{
                  color: "var(--subtle)",
                  fontSize: 9,
                  overflowWrap: "anywhere",
                }}
              >
                sha256:query_regression:commerce_prod:8839172:mean_exec_time
              </p>
              <p
                style={{ color: "var(--muted)", fontSize: 10, marginBottom: 0 }}
              >
                Stable fingerprints update last seen, occurrence count, and
                evidence without producing alert noise.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
