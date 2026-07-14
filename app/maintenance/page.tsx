import { MaintenancePage } from "@/components/pages/maintenance-page";
import {
  loadMaintenancePageData,
  unavailableSource,
} from "@/lib/server/dashboard-data";
import {
  readDashboardContext,
  type DashboardSearchParams,
} from "@/lib/server/page-context";

export const metadata = { title: "Maintenance" };
export default async function Page({
  searchParams,
}: {
  searchParams: DashboardSearchParams;
}) {
  const { source, schema } = await readDashboardContext(searchParams);
  try {
    const data = await loadMaintenancePageData(source, schema);
    return (
      <MaintenancePage
        maintenance={data.maintenance}
        initialHasMore={data.hasMore}
        progress={data.progress}
        pgstattupleAvailable={data.pgstattupleAvailable}
        source={data.source}
        sourceKey={source}
        schema={schema}
      />
    );
  } catch (error) {
    return (
      <MaintenancePage
        source={unavailableSource(error)}
        sourceKey={source}
        schema={schema}
      />
    );
  }
}
