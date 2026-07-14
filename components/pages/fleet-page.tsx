import { ArrowRight, RefreshCw } from "lucide-react";
import { demoRepository } from "@/lib/demo/data";
import type {
  FleetPageData,
  DataSourceState,
} from "@/lib/server/dashboard-data";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FindingsList } from "@/components/ui/findings-list";
import { MetricCard } from "@/components/ui/metric-card";
import { PageHeader } from "@/components/ui/page-header";
import { DataSourceBadge } from "@/components/ui/data-source-badge";

export function FleetPage({ data }: { data?: FleetPageData }) {
  const metrics = data?.metrics ?? demoRepository.metrics();
  const findings = data?.findings ?? demoRepository.findings();
  const capabilities = data?.capabilities ?? demoRepository.capabilities();
  const source: DataSourceState = data?.source ?? {
    mode: "unavailable",
    label: "Sample preview",
    detail: "No database data was supplied.",
  };
  const critical = findings.filter(
    (finding) =>
      finding.severity === "critical" && finding.status !== "resolved",
  ).length;
  const warning = findings.filter(
    (finding) =>
      finding.severity === "warning" && finding.status !== "resolved",
  ).length;
  const healthScore = Math.max(0, 100 - critical * 18 - warning * 7);
  const coverage = data?.coverage ?? {
    databases: 0,
    schemas: 0,
    queries: 0,
    tables: 0,
  };
  const categoryScore = (category: string) =>
    Math.max(
      0,
      100 -
        findings.filter(
          (finding) =>
            finding.source.toLowerCase().includes(category) &&
            finding.status !== "resolved",
        ).length *
          15,
    );
  return (
    <div className="page">
      <PageHeader
        eyebrow="Fleet overview"
        title={
          critical + warning > 0
            ? "Your database needs attention."
            : "Your database looks clear."
        }
        description={`A reset-aware view of the selected database and every discovered schema. ${critical} critical and ${warning} warning findings are currently loaded.`}
        actions={
          <>
            <DataSourceBadge source={source} />
            <a className="button" href="/">
              <RefreshCw />
              Refresh view
            </a>
            <a className="button primary" href="/findings">
              Review findings <ArrowRight />
            </a>
          </>
        }
      />
      <div className="metric-grid">
        {metrics.map((metric) => (
          <MetricCard key={metric.label} metric={metric} />
        ))}
      </div>
      <div className="content-grid">
        <Card>
          <CardHeader
            title="Fleet health"
            subtitle="Current bounded sample"
            action={
              <Badge tone={healthScore >= 90 ? "green" : "amber"}>
                {healthScore >= 90 ? "Healthy" : "Needs attention"}
              </Badge>
            }
          />
          <CardBody>
            <div className="health-hero">
              <div className="score-ring">
                <div className="score-value">
                  <strong>{healthScore}</strong>
                  <span>health score</span>
                </div>
              </div>
              <div className="health-summary">
                <h3>
                  {healthScore >= 90
                    ? "No material risk is currently detected"
                    : "Measured findings are reducing the health score"}
                </h3>
                <p>
                  This score is a transparent summary of the durable finding
                  queue, not a substitute for reviewing the underlying evidence.
                </p>
                <div className="health-bars">
                  {[
                    ["Queries", categoryScore("query"), "var(--rose)"],
                    ["Indexes", categoryScore("index"), "var(--cyan)"],
                    [
                      "Maintenance",
                      categoryScore("maintenance"),
                      "var(--amber)",
                    ],
                    ["Connections", categoryScore("activity"), "var(--green)"],
                  ].map(([label, value, color]) => (
                    <div className="health-bar-row" key={String(label)}>
                      <span>{label}</span>
                      <div
                        className="health-bar"
                        style={{ "--bar-color": color } as React.CSSProperties}
                      >
                        <span style={{ width: `${value}%` }} />
                      </div>
                      <span className="number">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Capability matrix" subtitle={source.detail} />
          <ul className="capability-list">
            {capabilities.map((capability) => {
              const available = capability.status === "Available";
              return (
                <li className="capability-item" key={capability.label}>
                  <span>
                    <span className="capability-label">{capability.label}</span>
                    <span className="capability-detail">
                      {capability.detail}
                    </span>
                  </span>
                  <Badge tone={available ? "green" : "amber"}>
                    {capability.status}
                  </Badge>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
      <div className="content-grid">
        <Card>
          <CardHeader
            title="Priority findings"
            subtitle={`${findings.filter((finding) => finding.status === "open").length} open · ordered by impact`}
            action={
              <a className="badge cyan" href="/findings">
                View all <ArrowRight size={11} />
              </a>
            }
          />
          <FindingsList findings={findings.slice(0, 3)} />
        </Card>
        <Card>
          <CardHeader title="Collection coverage" subtitle="Last sample" />
          <CardBody>
            <div className="info-grid">
              <div className="info-cell">
                <span>Databases</span>
                <strong>{coverage.databases}</strong>
              </div>
              <div className="info-cell">
                <span>Schemas</span>
                <strong>{coverage.schemas}</strong>
              </div>
              <div className="info-cell">
                <span>Queries</span>
                <strong>{coverage.queries}</strong>
              </div>
              <div className="info-cell">
                <span>Relations</span>
                <strong>{coverage.tables}</strong>
              </div>
            </div>
            <div style={{ marginTop: 15 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: 7,
                  color: "var(--muted)",
                  fontSize: 10,
                }}
              >
                <span>Collection source</span>
                <span className="number">{source.label}</span>
              </div>
              <div className="progress-track">
                <span
                  style={{ width: source.mode === "live" ? "100%" : "20%" }}
                />
              </div>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
