"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Download, Filter, Search } from "lucide-react";
import { demoRepository } from "@/lib/demo/data";
import type { Finding, Severity } from "@/lib/demo/types";
import type { DataSourceState } from "@/lib/server/dashboard-data";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FindingsList } from "@/components/ui/findings-list";
import { MetricCard } from "@/components/ui/metric-card";
import { PageHeader } from "@/components/ui/page-header";
import { DataSourceBadge } from "@/components/ui/data-source-badge";

export function FindingsPage({
  findings: initialFindings = demoRepository.findings(),
  source = {
    mode: "unavailable",
    label: "Sample preview",
    detail: "No database data was supplied.",
  },
}: {
  findings?: Finding[];
  source?: DataSourceState;
}) {
  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState<Severity | "all">("all");
  const [activeOnly, setActiveOnly] = useState(true);
  const [findings, setFindings] = useState(initialFindings);
  const [note, setNote] = useState("");
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const filtered = useMemo(
    () =>
      findings.filter(
        (finding) =>
          `${finding.title} ${finding.description} ${finding.evidence}`
            .toLowerCase()
            .includes(search.toLowerCase()) &&
          (severity === "all" || finding.severity === severity) &&
          (!activeOnly ||
            finding.status === "open" ||
            finding.status === "acknowledged"),
      ),
    [activeOnly, findings, search, severity],
  );
  const selected = filtered[0];
  const active = findings.filter(
    (finding) => finding.status === "open" || finding.status === "acknowledged",
  );
  const metrics = [
    {
      label: "Open findings",
      value: String(active.length),
      detail: `${active.filter((finding) => finding.severity === "critical").length} critical · ${active.filter((finding) => finding.severity === "warning").length} warning`,
      trend: 0,
      tone: "rose" as const,
      points: [72, 70, 68, 64, 66, 61, 58, 56, 52, 49, 46, 43],
    },
    {
      label: "New today",
      value: String(
        findings.filter(
          (finding) =>
            finding.firstSeen.includes("h") ||
            finding.firstSeen.includes("m") ||
            finding.firstSeen === "just now",
        ).length,
      ),
      detail: "Observed in the last day",
      trend: 0,
      tone: "amber" as const,
      points: [10, 10, 10, 18, 18, 25, 25, 33, 40, 48, 55, 62],
    },
    {
      label: "Resolved · 7d",
      value: String(
        findings.filter((finding) => finding.status === "resolved").length,
      ),
      detail: "In the loaded history",
      trend: 0,
      tone: "green" as const,
      points: [20, 24, 29, 32, 38, 41, 47, 51, 55, 60, 66, 72],
    },
    {
      label: "Rules enabled",
      value: "9",
      detail: "Seeded detection contracts",
      trend: 0,
      tone: "violet" as const,
      points: [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50],
    },
  ];
  const updateStatus = async (finding: Finding, status: Finding["status"]) => {
    setActionStatus("Saving…");
    try {
      const response = await fetch("/api/findings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          findingId: Number(finding.id),
          status,
          note: note || undefined,
        }),
      });
      if (!response.ok) {
        const body = (await response.json()) as {
          error?: { message?: string };
        };
        throw new Error(body.error?.message ?? "Finding update failed");
      }
      if (note.trim()) {
        await fetch("/api/findings/annotations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ findingId: Number(finding.id), body: note }),
        });
      }
      setFindings((current) =>
        current.map((item) =>
          item.id === finding.id ? { ...item, status } : item,
        ),
      );
      setNote("");
      setActionStatus("Saved");
    } catch (error) {
      setActionStatus(
        error instanceof Error ? error.message : "Finding update failed",
      );
    }
  };
  const downloadFindings = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(findings, null, 2)], {
        type: "application/json",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "index-analyzer-findings.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="page">
      <PageHeader
        eyebrow="Evidence and follow-through"
        title="Findings"
        description="A durable, deduplicated queue of workload regressions, plan changes, maintenance risks, index signals, and live incidents."
        actions={
          <>
            <DataSourceBadge source={source} />
            <button className="button" onClick={downloadFindings}>
              <Download />
              Export
            </button>
            <span className="button" style={{ cursor: "default" }}>
              <Badge tone="violet">9 rules enabled</Badge>
            </span>
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
        <button
          className={`filter-button${activeOnly ? " active" : ""}`}
          aria-pressed={activeOnly}
          onClick={() => setActiveOnly((value) => !value)}
        >
          <Filter />
          Status: {activeOnly ? "active" : "all"}
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
          {selected ? (
            <Card>
              <CardHeader
                title="Selected finding"
                action={
                  <Badge
                    tone={
                      selected.severity === "critical"
                        ? "rose"
                        : selected.severity === "warning"
                          ? "amber"
                          : "cyan"
                    }
                  >
                    {selected.severity}
                  </Badge>
                }
              />
              <CardBody>
                <h3 style={{ margin: 0, fontSize: 13 }}>{selected.title}</h3>
                <p style={{ color: "var(--muted)", fontSize: 10 }}>
                  {selected.description}
                </p>
                <div className="info-grid">
                  <div className="info-cell">
                    <span>First seen</span>
                    <strong>{selected.firstSeen}</strong>
                  </div>
                  <div className="info-cell">
                    <span>Occurrences</span>
                    <strong>{selected.occurrences}</strong>
                  </div>
                  <div className="info-cell">
                    <span>Status</span>
                    <strong>{selected.status}</strong>
                  </div>
                  <div className="info-cell">
                    <span>Last seen</span>
                    <strong>{selected.lastSeen}</strong>
                  </div>
                </div>
                <textarea
                  className="textarea"
                  rows={3}
                  placeholder="Add an operator note…"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  style={{ marginTop: 12, padding: 10, resize: "vertical" }}
                />
                <div style={{ display: "flex", gap: 8, marginTop: 9 }}>
                  <button
                    className="button"
                    onClick={() => void updateStatus(selected, "acknowledged")}
                  >
                    <CheckCircle2 />
                    Acknowledge
                  </button>
                  <button
                    className="button"
                    onClick={() => void updateStatus(selected, "dismissed")}
                  >
                    Dismiss
                  </button>
                </div>
                {actionStatus ? (
                  <p className="card-subtitle">{actionStatus}</p>
                ) : null}
              </CardBody>
            </Card>
          ) : (
            <Card>
              <CardBody>
                <div className="empty-state">
                  <div>
                    <h2>No matching findings</h2>
                    <p>Run the collector or adjust the current filters.</p>
                  </div>
                </div>
              </CardBody>
            </Card>
          )}
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
                {selected
                  ? `finding:${selected.id} · ${selected.source} · ${selected.database}`
                  : "No fingerprint selected"}
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
