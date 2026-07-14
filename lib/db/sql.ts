const MAX_PAGE_SIZE = 250;

export interface PageInput {
  limit?: number;
  offset?: number;
}

export interface Page {
  limit: number;
  offset: number;
}

export function boundedPage(input: PageInput = {}): Page {
  const limit = input.limit ?? 50;
  const offset = input.offset ?? 0;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw new Error(`limit must be an integer between 1 and ${MAX_PAGE_SIZE}`);
  }
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) {
    throw new Error("offset must be an integer between 0 and 1000000");
  }
  return { limit, offset };
}

export function quoteIdentifier(identifier: string): string {
  if (
    identifier.length === 0 ||
    identifier.length > 63 ||
    identifier.includes("\0")
  ) {
    throw new Error("Invalid PostgreSQL identifier");
  }
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? null : date;
  }
  return null;
}

export function escapeLike(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}
