import { PlansPage } from "@/components/pages/plans-page";
import { loadQueryDetailData } from "@/lib/server/dashboard-data";
import {
  readDashboardContext,
  type DashboardSearchParams,
} from "@/lib/server/page-context";

export const metadata = { title: "EXPLAIN Lab" };
export default async function Page({
  searchParams,
}: {
  searchParams: DashboardSearchParams;
}) {
  const context = await readDashboardContext(searchParams);
  const values = await searchParams;
  const rawQueryId = Array.isArray(values.queryId)
    ? values.queryId[0]
    : values.queryId;
  let initialSql: string | undefined;
  if (rawQueryId && /^-?\d{1,20}$/.test(rawQueryId)) {
    try {
      initialSql =
        (await loadQueryDetailData(rawQueryId, context.source)).query?.query ??
        undefined;
    } catch {
      // The lab remains usable with its safe starter query.
    }
  }
  return (
    <PlansPage
      sourceKey={context.source}
      schema={context.schema}
      initialSql={initialSql}
    />
  );
}
