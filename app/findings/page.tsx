import { FindingsPage } from "@/components/pages/findings-page";
import {
  loadFindingsPageData,
  unavailableSource,
} from "@/lib/server/dashboard-data";

export const metadata = { title: "Findings" };
export default async function Page() {
  try {
    const data = await loadFindingsPageData();
    return <FindingsPage findings={data.findings} source={data.source} />;
  } catch (error) {
    return <FindingsPage source={unavailableSource(error)} />;
  }
}
