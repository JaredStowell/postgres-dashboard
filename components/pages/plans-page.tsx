import { BookOpen, Download } from "lucide-react";
import { demoRepository } from "@/lib/demo/data";
import { PlanLab } from "@/components/plans/plan-lab";
import { PageHeader } from "@/components/ui/page-header";

export function PlansPage() {
  return (
    <div className="page">
      <PageHeader
        eyebrow="Safe execution workspace"
        title="EXPLAIN Lab"
        description="Inspect planner decisions, run a guarded ANALYZE, compare saved plans, and export a sanitized report. Statements are classified before they reach PostgreSQL."
        actions={
          <>
            <button className="button">
              <BookOpen />
              Plan history
            </button>
            <button className="button">
              <Download />
              Export report
            </button>
          </>
        }
      />
      <PlanLab plan={demoRepository.plan()} />
    </div>
  );
}
