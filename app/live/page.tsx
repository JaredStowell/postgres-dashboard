import { LivePage } from "@/components/pages/live-page";
import {
  loadLivePageData,
  unavailableSource,
} from "@/lib/server/dashboard-data";
import {
  readDashboardContext,
  type DashboardSearchParams,
} from "@/lib/server/page-context";

export const metadata = { title: "Live activity" };
export default async function Page({
  searchParams,
}: {
  searchParams: DashboardSearchParams;
}) {
  const { source } = await readDashboardContext(searchParams);
  try {
    const data = await loadLivePageData(source);
    return (
      <LivePage
        initialSessions={data.sessions}
        source={data.source}
        sourceKey={source}
      />
    );
  } catch (error) {
    return <LivePage source={unavailableSource(error)} />;
  }
}
