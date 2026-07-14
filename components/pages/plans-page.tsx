import { BookOpen } from "lucide-react";
import { PlanLab } from "@/components/plans/plan-lab";
import { PageHeader } from "@/components/ui/page-header";
import { DataSourceBadge } from "@/components/ui/data-source-badge";
import type { DataSourceState } from "@/lib/server/dashboard-data";

export function PlansPage({
  sourceKey,
  schema,
  initialSql,
  source = {
    mode: "live",
    label: "Database API",
    detail: "EXPLAIN executes against the selected target.",
  },
}: {
  sourceKey?: string;
  schema?: string;
  initialSql?: string;
  source?: DataSourceState;
}) {
  return (
    <div className="page">
      <PageHeader
        eyebrow="Safe execution workspace"
        title="EXPLAIN Lab"
        description="Inspect planner decisions, run a guarded ANALYZE, compare saved plans, and export a sanitized report. Statements are classified before they reach PostgreSQL."
        actions={
          <>
            <DataSourceBadge source={source} />
            <a className="button" href="#plan-workspace">
              <BookOpen />
              Plan workspace
            </a>
          </>
        }
      />
      <PlanLab sourceKey={sourceKey} schema={schema} initialSql={initialSql} />
    </div>
  );
}
