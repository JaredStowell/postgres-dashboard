import { History, Settings2 } from "lucide-react";
import { AdvisorWorkspace } from "@/components/advisor/advisor-workspace";
import { PageHeader } from "@/components/ui/page-header";

export function AdvisorPage() {
  return (
    <div className="page">
      <PageHeader
        eyebrow="Privacy-conscious expert analysis"
        title="AI Advisor"
        description="Ground model recommendations in actual query plans, workload history, schema metadata, and PostgreSQL settings—then validate each suggestion yourself."
        actions={
          <>
            <button className="button">
              <History />
              History
            </button>
            <button className="button">
              <Settings2 />
              Models
            </button>
          </>
        }
      />
      <AdvisorWorkspace />
    </div>
  );
}
