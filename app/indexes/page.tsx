import { IndexesPage } from "@/components/pages/indexes-page";
import {
  loadIndexesPageData,
  unavailableSource,
} from "@/lib/server/dashboard-data";

export const metadata = { title: "Indexes" };
export default async function Page() {
  try {
    const data = await loadIndexesPageData();
    return (
      <IndexesPage
        indexes={data.indexes}
        hypopgAvailable={data.hypopgAvailable}
        source={data.source}
      />
    );
  } catch (error) {
    return <IndexesPage source={unavailableSource(error)} />;
  }
}
