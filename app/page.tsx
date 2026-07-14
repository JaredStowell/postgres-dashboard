import { FleetPage } from "@/components/pages/fleet-page";
import { demoRepository } from "@/lib/demo/data";
import {
  loadFleetPageData,
  unavailableSource,
} from "@/lib/server/dashboard-data";
import {
  readDashboardContext,
  type DashboardSearchParams,
} from "@/lib/server/page-context";

export default async function Page({
  searchParams,
}: {
  searchParams: DashboardSearchParams;
}) {
  const context = await readDashboardContext(searchParams);
  try {
    return (
      <FleetPage
        data={await loadFleetPageData(context.source, context.schema)}
        sourceKey={context.source}
        schema={context.schema}
      />
    );
  } catch (error) {
    return (
      <FleetPage
        data={{
          metrics: demoRepository.metrics(),
          findings: demoRepository.findings(),
          capabilities: demoRepository.capabilities(),
          coverage: {
            databases: 0,
            discoveredDatabases: 0,
            schemas: 0,
            queries: 0,
            tables: 0,
          },
          source: unavailableSource(error),
          targets: [],
        }}
        sourceKey={context.source}
        schema={context.schema}
      />
    );
  }
}
