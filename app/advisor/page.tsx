import { AdvisorPage } from "@/components/pages/advisor-page";
import {
  loadAdvisorPageData,
  unavailableSource,
} from "@/lib/server/dashboard-data";

export const metadata = { title: "AI Advisor" };
export default async function Page() {
  try {
    const data = await loadAdvisorPageData();
    return <AdvisorPage analyses={data.analyses} source={data.source} />;
  } catch (error) {
    return <AdvisorPage source={unavailableSource(error)} />;
  }
}
