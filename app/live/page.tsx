import { LivePage } from "@/components/pages/live-page";
import {
  loadLivePageData,
  unavailableSource,
} from "@/lib/server/dashboard-data";

export const metadata = { title: "Live activity" };
export default async function Page() {
  try {
    const data = await loadLivePageData();
    return <LivePage initialSessions={data.sessions} source={data.source} />;
  } catch (error) {
    return <LivePage source={unavailableSource(error)} />;
  }
}
