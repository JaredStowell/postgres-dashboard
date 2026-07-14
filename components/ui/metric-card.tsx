import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { Metric } from "@/lib/demo/types";
import { Sparkline } from "./sparkline";

const toneColor = {
  cyan: ["var(--cyan)", "var(--cyan-soft)"],
  violet: ["var(--violet)", "var(--violet-soft)"],
  green: ["var(--green)", "var(--green-soft)"],
  amber: ["var(--amber)", "var(--amber-soft)"],
  rose: ["var(--rose)", "var(--rose-soft)"],
} as const;

export function MetricCard({ metric }: { metric: Metric }) {
  const [color, soft] = toneColor[metric.tone];
  const rising = metric.trend >= 0;
  const hasHistory = metric.points.length > 1;
  return (
    <article
      className="card metric-card"
      style={
        {
          "--metric-color": color,
          "--metric-soft": soft,
        } as React.CSSProperties
      }
    >
      <div className="metric-label">{metric.label}</div>
      <div className="metric-value-row">
        <span className="metric-value number">{metric.value}</span>
        {hasHistory ? (
          <span className="metric-trend">
            {rising ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
            {Math.abs(metric.trend)}%
          </span>
        ) : null}
      </div>
      <div className="metric-detail">{metric.detail}</div>
      {hasHistory ? (
        <Sparkline values={metric.points} label={`${metric.label} trend`} />
      ) : (
        <span className="metric-history-empty">
          Current snapshot · no trend history
        </span>
      )}
    </article>
  );
}
