import { ArrowLeft, Bot, Copy, FlaskConical } from "lucide-react";
import { demoRepository } from "@/lib/demo/data";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FindingsList } from "@/components/ui/findings-list";
import { PageHeader } from "@/components/ui/page-header";
import { TrendChart } from "@/components/ui/sparkline";

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

export function QueryDetailPage({ id }: { id: string }) {
  const query = demoRepository.query(id);
  return (
    <div className="page">
      <a href="/queries" className="page-eyebrow" style={{ marginBottom: 12 }}>
        <ArrowLeft size={12} />
        Back to queries
      </a>
      <PageHeader
        eyebrow={`Query ${query.id}`}
        title="Checkout order lookup"
        description={`${query.database} · ${query.user} · seen in ${query.tables.join(", ")}`}
        actions={
          <>
            <button className="button">
              <Copy />
              Copy SQL
            </button>
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
            "+63.1% vs baseline",
            "rose",
          ],
          ["p95 time", "441.2 ms", "+72.8% vs baseline", "rose"],
          ["Calls", query.calls.toLocaleString(), "+8.1% in window", "cyan"],
          ["Shared reads", "14.8k / call", "91.2% cache hit", "amber"],
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
              subtitle="7 days · 15 minute rollups"
              action={<Badge tone="rose">Regression detected</Badge>}
            />
            <CardBody>
              <TrendChart
                values={[
                  32, 31, 34, 36, 33, 38, 42, 40, 44, 48, 51, 49, 54, 58, 57,
                  61, 59, 66, 72, 74, 80, 79, 88, 92, 96, 100,
                ]}
                label="Mean execution time over seven days"
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
                  <strong>252.4 s</strong>
                </div>
                <div className="info-cell">
                  <span>Rows / call</span>
                  <strong>25.0</strong>
                </div>
                <div className="info-cell">
                  <span>Temp I/O</span>
                  <strong>1.8 GB</strong>
                </div>
                <div className="info-cell">
                  <span>WAL</span>
                  <strong>0 B</strong>
                </div>
                <div className="info-cell">
                  <span>Plans saved</span>
                  <strong>4</strong>
                </div>
                <div className="info-cell">
                  <span>Last planned</span>
                  <strong>12m ago</strong>
                </div>
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Related finding" />
            <FindingsList
              findings={demoRepository.findings().slice(0, 1)}
              detailed
            />
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
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
