import { IndexesPage } from "@/components/pages/indexes-page";
import {
  loadIndexesPageData,
  unavailableSource,
} from "@/lib/server/dashboard-data";
import {
  readDashboardContext,
  type DashboardSearchParams,
} from "@/lib/server/page-context";

export const metadata = { title: "Indexes" };
export default async function Page({
  searchParams,
}: {
  searchParams: DashboardSearchParams;
}) {
  const { source, schema } = await readDashboardContext(searchParams);
  try {
    const data = await loadIndexesPageData(source, schema);
    return (
      <IndexesPage
        indexes={data.indexes}
        initialHasMore={data.hasMore}
        relationshipAnalysisTruncated={data.relationshipAnalysisTruncated}
        hypopgAvailable={data.hypopgAvailable}
        missingCandidates={data.missingCandidates}
        source={data.source}
        sourceKey={source}
        schema={schema}
      />
    );
  } catch (error) {
    return (
      <IndexesPage
        source={unavailableSource(error)}
        sourceKey={source}
        schema={schema}
      />
    );
  }
}
