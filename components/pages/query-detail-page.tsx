import { ArrowLeft, Bot, FlaskConical } from "lucide-react";
import { demoRepository } from "@/lib/demo/data";
import type { QueryStat } from "@/lib/demo/types";
import type { DataSourceState } from "@/lib/server/dashboard-data";
import type { QueryDetailContext } from "@/lib/server/dashboard-data";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { TrendChart } from "@/components/ui/sparkline";
import { DataSourceBadge } from "@/components/ui/data-source-badge";
import { EmptyState } from "@/components/ui/states";
import { contextualHref } from "@/lib/presentation/inventory";

function colorSql(sql: string) {
  const chunks = sql.split(
    /(SELECT|FROM|JOIN|ON|WHERE|AND|ORDER BY|DESC|LIMIT|\$\d+|orders|customers)/g,
  );
  return chunks.map((chunk, index) => {
    if (/^(SELECT|FROM|JOIN|ON|WHERE|AND|ORDER BY|DESC|LIMIT)$/.test(chunk))
      return (
        <span className="token-keyword" key={index}>
          {chunk}
        </span>
      );
    if (/^(orders|customers)$/.test(chunk))
      return (
        <span className="token-table" key={index}>
          {chunk}
        </span>
      );
    if (/^\$\d+$/.test(chunk))
      return (
        <span className="token-param" key={index}>
          {chunk}
        </span>
      );
    return chunk;
  });
}

export function QueryDetailPage({
  id,
  query: suppliedQuery,
  context = { plans: [], findings: [], relations: [], indexes: [] },
  source = {
    mode: "unavailable",
    label: "Sample preview",
    detail: "No database data was supplied.",
  },
  sourceKey,
  schema,
}: {
  id: string;
  query?: QueryStat | null;
  context?: QueryDetailContext;
  source?: DataSourceState;
  sourceKey?: string;
  schema?: string;
}) {
  const query =
    suppliedQuery ??
    (source.mode === "unavailable" ? demoRepository.query(id) : null);
  if (!query) {
    return (
      <div className="page">
        <a
          href={contextualHref("/queries", { source: sourceKey, schema })}
          className="page-eyebrow"
        >
          <ArrowLeft size={12} /> Back to queries
        </a>
        <PageHeader
          eyebrow={`Query ${id}`}
          title="Query not found"
          description="This query ID is not present in the current pg_stat_statements window for the selected database."
          actions={<DataSourceBadge source={source} />}
        />
        <EmptyState
          title="No matching statement"
          detail="The statistics window may have reset, or the query belongs to another configured database target."
        />
      </div>
    );
  }
  return (
    <div className="page">
      <a
        href={contextualHref("/queries", { source: sourceKey, schema })}
        className="page-eyebrow"
        style={{ marginBottom: 12 }}
      >
        <ArrowLeft size={12} />
        Back to queries
      </a>
      <PageHeader
        eyebrow={`Query ${query.id}`}
        title="Normalized statement"
        description={`${query.database} · ${query.user} · cumulative pg_stat_statements evidence`}
        actions={
          <>
            <DataSourceBadge source={source} />
            <a
              href={contextualHref("/plans", {
                source: sourceKey,
                schema,
                parameters: { queryId: query.id },
              })}
              className="button"
            >
              <FlaskConical />
              Explain
            </a>
            <a
              href={contextualHref("/advisor", {
                source: sourceKey,
                schema,
                parameters: { queryId: query.id },
              })}
              className="button primary"
            >
              <Bot />
              Analyze with AI
            </a>
          </>
        }
      />
      <div className="metric-grid" style={{ marginBottom: 12 }}>
        {[
          [
            "Mean time",
            `${query.meanTime.toFixed(1)} ms`,
            `${query.status} in collected windows`,
            query.status === "regressed" ? "rose" : "cyan",
          ],
          [
            "Total execution",
            `${(query.totalTime / 1000).toFixed(1)} s`,
            "Current statistics window",
            "violet",
          ],
          [
            "Calls",
            query.calls.toLocaleString(),
            `${(query.rows / Math.max(1, query.calls)).toFixed(1)} rows / call`,
            "cyan",
          ],
          [
            "Cache hit",
            `${query.cacheHit}%`,
            `${query.tempIo} temp I/O`,
            "amber",
          ],
        ].map(([label, value, detail, tone]) => (
          <Card className="metric-card" key={label as string}>
            <div className="metric-label">{label}</div>
            <div className="metric-value-row">
              <span className="metric-value number">{value}</span>
            </div>
            <div
              className={`metric-detail ${tone === "rose" ? "delta-up" : ""}`}
            >
              {detail}
            </div>
          </Card>
        ))}
      </div>
      <div className="detail-grid">
        <div style={{ display: "grid", gap: 12 }}>
          <Card>
            <CardHeader
              title="Normalized query"
              action={<Badge tone="violet">Read only</Badge>}
            />
            <CardBody>
              <div className="query-panel">{colorSql(query.query)}</div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title="Mean execution time"
              subtitle={
                query.points.length > 1
                  ? "Collected reset-aware points"
                  : "No usable collection history yet"
              }
              action={
                <Badge tone={query.status === "regressed" ? "rose" : "green"}>
                  {query.status}
                </Badge>
              }
            />
            <CardBody>
              <TrendChart
                values={query.points}
                label="Mean execution time across available collection points"
              />
            </CardBody>
          </Card>
        </div>
        <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
          <Card>
            <CardHeader title="Workload context" />
            <CardBody>
              <div className="info-grid">
                <div className="info-cell">
                  <span>Total time</span>
                  <strong>{(query.totalTime / 1000).toFixed(1)} s</strong>
                </div>
                <div className="info-cell">
                  <span>Rows / call</span>
                  <strong>
                    {(query.rows / Math.max(1, query.calls)).toFixed(1)}
                  </strong>
                </div>
                <div className="info-cell">
                  <span>Temp I/O</span>
                  <strong>{query.tempIo}</strong>
                </div>
                <div className="info-cell">
                  <span>WAL</span>
                  <strong>{query.wal}</strong>
                </div>
                <div className="info-cell">
                  <span>Database</span>
                  <strong>{query.database}</strong>
                </div>
                <div className="info-cell">
                  <span>Role</span>
                  <strong>{query.user}</strong>
                </div>
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Reset-aware history" />
            <CardBody>
              <div className="privacy-note">
                Snapshot regressions require at least two usable collection
                intervals. Reset boundaries are excluded automatically.
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Referenced relations" />
            <CardBody>
              {query.tables.map((table) => (
                <div
                  key={table}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "9px 0",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  <span
                    className="mono"
                    style={{ color: "var(--cyan)", fontSize: 10 }}
                  >
                    {table}
                  </span>
                  <Badge>catalog</Badge>
                </div>
              ))}
              {query.tables.length === 0 ? (
                <div className="empty-state">
                  <div>
                    <h2>No relation hints extracted</h2>
                    <p>
                      Use EXPLAIN to resolve referenced relations precisely.
                    </p>
                  </div>
                </div>
              ) : null}
            </CardBody>
          </Card>
        </div>
      </div>
      <div className="content-grid equal">
        <Card id="plan-history">
          <CardHeader
            title="Saved plan history"
            subtitle="Safely matched normalized query shape"
            action={<Badge tone="violet">{context.plans.length}</Badge>}
          />
          <CardBody>
            <div className="analysis-list">
              {context.plans.map((plan) => (
                <a
                  className="analysis-card"
                  href={contextualHref("/advisor", {
                    source: sourceKey,
                    schema,
                    parameters: { planId: plan.id, queryId: query.id },
                  })}
                  key={plan.id}
                >
                  <div className="analysis-head">
                    <strong className="mono">{plan.id}</strong>
                    <span className="analysis-time">
                      {new Date(plan.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <span className="analysis-meta">Open in AI Advisor</span>
                </a>
              ))}
              {context.plans.length === 0 ? (
                <div className="privacy-note">
                  No safely matched saved plan yet.
                </div>
              ) : null}
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Related findings"
            subtitle="Query and proven relation evidence"
            action={<Badge tone="amber">{context.findings.length}</Badge>}
          />
          <CardBody>
            <div className="analysis-list">
              {context.findings.map((finding) => (
                <a
                  className="analysis-card"
                  href={finding.href}
                  key={finding.id}
                >
                  <div className="analysis-head">
                    <span className="severity-mark" />
                    <strong>{finding.title}</strong>
                    <span className="analysis-time">{finding.lastSeen}</span>
                  </div>
                  <p className="analysis-summary">{finding.description}</p>
                </a>
              ))}
              {context.findings.length === 0 ? (
                <div className="privacy-note">No related durable findings.</div>
              ) : null}
            </div>
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader
          title="Related index context"
          subtitle={`${context.relations.length} proven relations`}
          action={<Badge tone="cyan">{context.indexes.length} indexes</Badge>}
        />
        <CardBody>
          <div className="analysis-list">
            {context.indexes.map((index) => (
              <div
                className="privacy-note"
                key={`${index.schema}.${index.table}.${index.name}`}
              >
                <span className="mono">
                  {index.schema}.{index.table}.{index.name}
                </span>
                <span style={{ marginLeft: "auto" }}>
                  {(index.scans ?? 0).toLocaleString()} scans
                </span>
              </div>
            ))}
            {context.indexes.length === 0 ? (
              <div className="privacy-note">
                No related index context resolved.
              </div>
            ) : null}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
