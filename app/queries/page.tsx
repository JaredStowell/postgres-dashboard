import { QueriesPage } from "@/components/pages/queries-page";
import {
  loadQueriesPageData,
  unavailableSource,
} from "@/lib/server/dashboard-data";
import {
  readDashboardContext,
  type DashboardSearchParams,
} from "@/lib/server/page-context";

export const metadata = { title: "Queries" };
export default async function Page({
  searchParams,
}: {
  searchParams: DashboardSearchParams;
}) {
  const { source, schema } = await readDashboardContext(searchParams);
  try {
    const data = await loadQueriesPageData(source);
    return (
      <QueriesPage
        queries={data.queries}
        initialHasMore={data.hasMore}
        source={data.source}
        sourceKey={source}
        schema={schema}
      />
    );
  } catch (error) {
    return (
      <QueriesPage
        source={unavailableSource(error)}
        sourceKey={source}
        schema={schema}
      />
    );
  }
}
