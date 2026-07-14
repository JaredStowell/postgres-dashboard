import { MaintenancePage } from "@/components/pages/maintenance-page";
import {
  loadMaintenancePageData,
  unavailableSource,
} from "@/lib/server/dashboard-data";

export const metadata = { title: "Maintenance" };
export default async function Page() {
  try {
    const data = await loadMaintenancePageData();
    return (
      <MaintenancePage
        maintenance={data.maintenance}
        progress={data.progress}
        pgstattupleAvailable={data.pgstattupleAvailable}
        source={data.source}
      />
    );
  } catch (error) {
    return <MaintenancePage source={unavailableSource(error)} />;
  }
}
