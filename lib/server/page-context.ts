export type DashboardSearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

export async function readDashboardContext(
  searchParams: DashboardSearchParams,
) {
  const values = await searchParams;
  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;
  return {
    source: first(values.source)?.slice(0, 63),
    schema: first(values.schema)?.slice(0, 255),
  };
}
