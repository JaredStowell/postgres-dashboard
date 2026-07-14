import { FindingsPage } from "@/components/pages/findings-page";
import {
  loadFindingsPageData,
  unavailableSource,
} from "@/lib/server/dashboard-data";
import {
  readDashboardContext,
  type DashboardSearchParams,
} from "@/lib/server/page-context";

export const metadata = { title: "Findings" };
export default async function Page({
  searchParams,
}: {
  searchParams: DashboardSearchParams;
}) {
  const { source, schema } = await readDashboardContext(searchParams);
  try {
    const data = await loadFindingsPageData(source);
    return (
      <FindingsPage
        findings={data.findings}
        enabledRules={data.enabledRules}
        source={data.source}
        sourceKey={source}
        schema={schema}
      />
    );
  } catch (error) {
    return (
      <FindingsPage
        source={unavailableSource(error)}
        sourceKey={source}
        schema={schema}
      />
    );
  }
}
