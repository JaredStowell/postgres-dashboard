import { ArrowLeft, Bot, FlaskConical } from "lucide-react";
import { demoRepository } from "@/lib/demo/data";
import type { QueryStat } from "@/lib/demo/types";
import type { DataSourceState } from "@/lib/server/dashboard-data";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { TrendChart } from "@/components/ui/sparkline";
import { DataSourceBadge } from "@/components/ui/data-source-badge";

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
  source = {
    mode: "unavailable",
    label: "Sample preview",
    detail: "No database data was supplied.",
  },
}: {
  id: string;
  query?: QueryStat | null;
  source?: DataSourceState;
}) {
  const query = suppliedQuery ?? demoRepository.query(id);
  return (
    <div className="page">
      <a href="/queries" className="page-eyebrow" style={{ marginBottom: 12 }}>
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
            <a href="/plans" className="button">
              <FlaskConical />
              Explain
            </a>
            <a href="/advisor" className="button primary">
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
              subtitle="Collected reset-aware points"
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
    </div>
  );
}
