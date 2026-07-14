import { Download, FlaskConical } from "lucide-react";
import { demoRepository } from "@/lib/demo/data";
import { QueryTable } from "@/components/queries/query-table";
import { MetricCard } from "@/components/ui/metric-card";
import { PageHeader } from "@/components/ui/page-header";

export function QueriesPage() {
  const queryMetrics = [
    {
      label: "Total execution",
      value: "789.3 s",
      detail: "Current 15-minute window",
      trend: 12.4,
      tone: "cyan" as const,
      points: [32, 40, 38, 44, 48, 51, 58, 55, 61, 68, 66, 72],
    },
    {
      label: "Regressions",
      value: "12",
      detail: "2 exceed critical threshold",
      trend: 20.0,
      tone: "rose" as const,
      points: [19, 21, 18, 24, 22, 28, 31, 39, 47, 53, 58, 65],
    },
    {
      label: "Mean latency",
      value: "42.8 ms",
      detail: "Weighted by calls",
      trend: 7.8,
      tone: "amber" as const,
      points: [43, 41, 42, 46, 45, 47, 51, 49, 53, 57, 55, 59],
    },
    {
      label: "Cache hit",
      value: "98.42%",
      detail: "16.8 GB blocks read",
      trend: -0.7,
      tone: "violet" as const,
      points: [78, 79, 81, 80, 77, 76, 74, 75, 72, 73, 70, 69],
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
            <button className="button">
              <Download />
              Export CSV
            </button>
            <a href="/plans" className="button primary">
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
      <QueryTable queries={demoRepository.queries()} />
    </div>
  );
}
