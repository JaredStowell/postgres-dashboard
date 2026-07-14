import { History } from "lucide-react";
import { AdvisorWorkspace } from "@/components/advisor/advisor-workspace";
import { PageHeader } from "@/components/ui/page-header";
import { DataSourceBadge } from "@/components/ui/data-source-badge";
import type { Analysis } from "@/lib/demo/types";
import type { DataSourceState } from "@/lib/server/dashboard-data";

export function AdvisorPage({
  analyses,
  sourceKey,
  queryId,
  findingId,
  planId,
  relationSchema,
  relationTable,
  index,
  source = {
    mode: "unavailable",
    label: "Sample preview",
    detail: "No database data was supplied.",
  },
}: {
  analyses?: Analysis[];
  source?: DataSourceState;
  sourceKey?: string;
  queryId?: string;
  findingId?: string;
  planId?: string;
  relationSchema?: string;
  relationTable?: string;
  index?: string;
}) {
  return (
    <div className="page">
      <PageHeader
        eyebrow="Privacy-conscious expert analysis"
        title="AI Advisor"
        description="Ground model recommendations in actual query plans, workload history, schema metadata, and PostgreSQL settings—then validate each suggestion yourself."
        actions={
          <>
            <DataSourceBadge source={source} />
            <a className="button" href="#analysis-history">
              <History />
              History
            </a>
          </>
        }
      />
      <AdvisorWorkspace
        analyses={analyses}
        sourceKey={sourceKey}
        queryId={queryId}
        findingId={findingId}
        planId={planId}
        relationSchema={relationSchema}
        relationTable={relationTable}
        index={index}
      />
    </div>
  );
}
