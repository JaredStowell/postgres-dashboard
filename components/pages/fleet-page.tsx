import { ArrowRight, RefreshCw } from "lucide-react";
import { demoRepository } from "@/lib/demo/data";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FindingsList } from "@/components/ui/findings-list";
import { MetricCard } from "@/components/ui/metric-card";
import { PageHeader } from "@/components/ui/page-header";

export function FleetPage() {
  const metrics = demoRepository.metrics();
  const findings = demoRepository.findings();
  const capabilities = demoRepository.capabilities();
  return (
    <div className="page">
      <PageHeader
        eyebrow="Fleet overview"
        title="Good morning. Your database needs attention."
        description="A live, reset-aware view across every configured database and schema. Two high-impact issues account for most of today’s risk."
        actions={
          <>
            <button className="button">
              <RefreshCw />
              Collect now
            </button>
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
            subtitle="Last 24 hours"
            action={<Badge tone="amber">Needs attention</Badge>}
          />
          <CardBody>
            <div className="health-hero">
              <div className="score-ring">
                <div className="score-value">
                  <strong>78</strong>
                  <span>health score</span>
                </div>
              </div>
              <div className="health-summary">
                <h3>Healthy foundation, concentrated workload risk</h3>
                <p>
                  Connections and replication are stable. Query regression and
                  maintenance pressure on the events table are holding back the
                  fleet score.
                </p>
                <div className="health-bars">
                  {[
                    ["Queries", 68, "var(--rose)"],
                    ["Indexes", 82, "var(--cyan)"],
                    ["Maintenance", 71, "var(--amber)"],
                    ["Connections", 96, "var(--green)"],
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
          <CardHeader title="Capability matrix" subtitle="commerce_prod" />
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
            subtitle="7 open · ordered by impact"
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
                <strong>3 / 3</strong>
              </div>
              <div className="info-cell">
                <span>Schemas</span>
                <strong>12</strong>
              </div>
              <div className="info-cell">
                <span>Queries</span>
                <strong>18,421</strong>
              </div>
              <div className="info-cell">
                <span>Relations</span>
                <strong>1,294</strong>
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
                <span>Snapshot retention</span>
                <span className="number">82 / 90 days</span>
              </div>
              <div className="progress-track">
                <span style={{ width: "91%" }} />
              </div>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
