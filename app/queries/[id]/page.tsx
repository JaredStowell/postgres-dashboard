import { QueryDetailPage } from "@/components/pages/query-detail-page";

export const metadata = { title: "Query detail" };
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <QueryDetailPage id={id} />;
}
