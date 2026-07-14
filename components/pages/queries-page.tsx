import { Download, FlaskConical } from "lucide-react";
import { demoRepository } from "@/lib/demo/data";
import type { QueryStat } from "@/lib/demo/types";
import type { DataSourceState } from "@/lib/server/dashboard-data";
import { QueryTable } from "@/components/queries/query-table";
import { MetricCard } from "@/components/ui/metric-card";
import { PageHeader } from "@/components/ui/page-header";
import { DataSourceBadge } from "@/components/ui/data-source-badge";
import { contextualHref } from "@/lib/presentation/inventory";

export function QueriesPage({
  queries = demoRepository.queries(),
  source = {
    mode: "unavailable",
    label: "Sample preview",
    detail: "No database data was supplied.",
  },
  initialHasMore = false,
  sourceKey,
  schema,
}: {
  queries?: QueryStat[];
  source?: DataSourceState;
  initialHasMore?: boolean;
  sourceKey?: string;
  schema?: string;
}) {
  const totalExecution = queries.reduce(
    (total, query) => total + query.totalTime,
    0,
  );
  const totalCalls = queries.reduce((total, query) => total + query.calls, 0);
  const weightedLatency = totalCalls > 0 ? totalExecution / totalCalls : 0;
  const weightedCacheHit =
    totalCalls > 0
      ? queries.reduce(
          (total, query) => total + query.cacheHit * query.calls,
          0,
        ) / totalCalls
      : 100;
  const queryMetrics = [
    {
      label: "Total execution",
      value: `${(totalExecution / 1000).toFixed(1)} s`,
      detail: "Current cumulative statistics",
      trend: 0,
      tone: "cyan" as const,
      points: [],
    },
    {
      label: "Regressions",
      value: String(
        queries.filter((query) => query.status === "regressed").length,
      ),
      detail: "Reset-aware collected signals",
      trend: 0,
      tone: "rose" as const,
      points: [],
    },
    {
      label: "Mean latency",
      value: `${weightedLatency.toFixed(2)} ms`,
      detail: `Weighted by ${totalCalls.toLocaleString()} calls`,
      trend: 0,
      tone: "amber" as const,
      points: [],
    },
    {
      label: "Cache hit",
      value: `${weightedCacheHit.toFixed(2)}%`,
      detail: `${queries.length} bounded statements`,
      trend: 0,
      tone: "violet" as const,
      points: [],
    },
  ];
  return (
    <div className="page">
      <PageHeader
        eyebrow="Workload intelligence"
        title="Queries"
        description="Find the statements consuming time, I/O, memory, and WAL. Deltas are reset-aware and compare the latest window with its baseline."
        actions={
          <>
            <DataSourceBadge source={source} />
            <a
              className="button"
              href={contextualHref("/api/queries?limit=250", {
                source: sourceKey,
              })}
            >
              <Download />
              Export JSON
            </a>
            <a
              href={contextualHref("/plans", { source: sourceKey, schema })}
              className="button primary"
            >
              <FlaskConical />
              Open EXPLAIN Lab
            </a>
          </>
        }
      />
      <div className="metric-grid" style={{ marginBottom: 12 }}>
        {queryMetrics.map((metric) => (
          <MetricCard metric={metric} key={metric.label} />
        ))}
      </div>
      <QueryTable
        queries={queries}
        initialHasMore={initialHasMore}
        source={sourceKey}
        schema={schema}
      />
    </div>
  );
}
