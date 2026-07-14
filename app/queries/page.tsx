import { QueriesPage } from "@/components/pages/queries-page";
import {
  loadQueriesPageData,
  unavailableSource,
} from "@/lib/server/dashboard-data";

export const metadata = { title: "Queries" };
export default async function Page() {
  try {
    const data = await loadQueriesPageData();
    return <QueriesPage queries={data.queries} source={data.source} />;
  } catch (error) {
    return <QueriesPage source={unavailableSource(error)} />;
  }
}
