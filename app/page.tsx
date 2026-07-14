import { FleetPage } from "@/components/pages/fleet-page";
import { demoRepository } from "@/lib/demo/data";
import {
  loadFleetPageData,
  unavailableSource,
} from "@/lib/server/dashboard-data";

export default async function Page() {
  try {
    return <FleetPage data={await loadFleetPageData()} />;
  } catch (error) {
    return (
      <FleetPage
        data={{
          metrics: demoRepository.metrics(),
          findings: demoRepository.findings(),
          capabilities: demoRepository.capabilities(),
          coverage: { databases: 0, schemas: 0, queries: 0, tables: 0 },
          source: unavailableSource(error),
        }}
      />
    );
  }
}
