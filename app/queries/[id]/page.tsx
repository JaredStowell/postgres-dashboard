import { QueryDetailPage } from "@/components/pages/query-detail-page";
import {
  loadQueryDetailData,
  unavailableSource,
} from "@/lib/server/dashboard-data";

export const metadata = { title: "Query detail" };
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  try {
    const data = await loadQueryDetailData(id);
    return <QueryDetailPage id={id} query={data.query} source={data.source} />;
  } catch (error) {
    return <QueryDetailPage id={id} source={unavailableSource(error)} />;
  }
}
