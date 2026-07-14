import type { DataSourceState } from "@/lib/server/dashboard-data";
import { Badge } from "./badge";

export function DataSourceBadge({ source }: { source: DataSourceState }) {
  return (
    <span
      className="button"
      style={{ cursor: "default" }}
      title={source.detail}
    >
      <span className={source.mode === "live" ? "live-pulse" : undefined} />
      <Badge tone={source.mode === "live" ? "green" : "amber"}>
        {source.label}
      </Badge>
    </span>
  );
}
