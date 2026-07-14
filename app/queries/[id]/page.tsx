import { QueryDetailPage } from "@/components/pages/query-detail-page";
import {
  loadQueryDetailData,
  unavailableSource,
} from "@/lib/server/dashboard-data";
import {
  readDashboardContext,
  type DashboardSearchParams,
} from "@/lib/server/page-context";

export const metadata = { title: "Query detail" };
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: DashboardSearchParams;
}) {
  const { id } = await params;
  const { source, schema } = await readDashboardContext(searchParams);
  try {
    const data = await loadQueryDetailData(id, source);
    return (
      <QueryDetailPage
        id={id}
        query={data.query}
        context={data.context}
        source={data.source}
        sourceKey={source}
        schema={schema}
      />
    );
  } catch (error) {
    return (
      <QueryDetailPage
        id={id}
        source={unavailableSource(error)}
        sourceKey={source}
        schema={schema}
      />
    );
  }
}
