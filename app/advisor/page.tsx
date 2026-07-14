import { AdvisorPage } from "@/components/pages/advisor-page";
import {
  loadAdvisorPageData,
  unavailableSource,
} from "@/lib/server/dashboard-data";
import {
  readDashboardContext,
  type DashboardSearchParams,
} from "@/lib/server/page-context";

export const metadata = { title: "AI Advisor" };
export default async function Page({
  searchParams,
}: {
  searchParams: DashboardSearchParams;
}) {
  const { source } = await readDashboardContext(searchParams);
  const values = await searchParams;
  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;
  const selection = {
    queryId: first(values.queryId) ?? first(values.query),
    findingId: first(values.findingId) ?? first(values.finding),
    planId: first(values.planId) ?? first(values.plan),
    relationSchema: first(values.relationSchema),
    relationTable: first(values.relationTable),
    index: first(values.index),
  };
  try {
    const data = await loadAdvisorPageData(source);
    return (
      <AdvisorPage
        analyses={data.analyses}
        source={data.source}
        sourceKey={source}
        {...selection}
      />
    );
  } catch (error) {
    return (
      <AdvisorPage
        source={unavailableSource(error)}
        sourceKey={source}
        {...selection}
      />
    );
  }
}
