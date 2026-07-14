import {
  calculatePlanMetrics,
  detectPlanWarnings,
  sanitizeExplainPlan,
} from "@/lib/analysis/plans";
import { redactSql } from "@/lib/analysis/sql-safety";

export interface AiColumnContext {
  name: string;
  dataType: string;
  nullable?: boolean;
  statistics?: Record<string, number | string | boolean | null>;
}

export interface AiTableContext {
  schema: string;
  name: string;
  estimatedRows?: number;
  totalBytes?: number;
  columns: AiColumnContext[];
}

export interface AiIndexContext {
  schema: string;
  table: string;
  name: string;
  definition: string;
  scans?: number;
  sizeBytes?: number;
}

export interface AiPayloadInput {
  query?: string;
  plan?: unknown;
  tables?: AiTableContext[];
  indexes?: AiIndexContext[];
  settings?: Record<string, string | number | boolean | null>;
  statistics?: Record<string, number | string | boolean | null>;
  context?: {
    database?: string;
    schema?: string;
    sourceLabel?: string;
    queryId?: string;
    planId?: string;
    relation?: string;
    index?: string;
    finding?: {
      id: string;
      category: string;
      severity: string;
      title: string;
      summary: string;
    };
  };
}

export interface AiAdvisorPayload {
  version: 1;
  privacy: {
    literalsRedacted: true;
    commentsRemoved: true;
    resultRowsIncluded: false;
  };
  context: {
    database?: string;
    schema?: string;
    sourceLabel?: string;
    queryId?: string;
    planId?: string;
    relation?: string;
    index?: string;
    finding?: {
      id: string;
      category: string;
      severity: string;
      title: string;
      summary: string;
    };
  };
  query: string | null;
  plan: unknown | null;
  planSummary: {
    metrics: ReturnType<typeof calculatePlanMetrics>;
    warnings: ReturnType<typeof detectPlanWarnings>;
  } | null;
  tables: AiTableContext[];
  indexes: AiIndexContext[];
  settings: Record<string, string | number | boolean | null>;
  statistics: Record<string, number | string | boolean | null>;
}

export interface AiPayloadLimits {
  maxBytes?: number;
  maxQueryCharacters?: number;
  maxTables?: number;
  maxColumnsPerTable?: number;
  maxIndexes?: number;
  maxSettings?: number;
  maxStatistics?: number;
}

export interface AiPayloadBuildResult {
  payload: AiAdvisorPayload;
  bytes: number;
  truncated: boolean;
  omissions: string[];
  preview: string;
}

const allowedSettingPattern =
  /^(?:application_name|effective_cache_size|enable_[a-z_]+|jit|join_collapse_limit|max_parallel_workers_per_gather|random_page_cost|seq_page_cost|shared_buffers|temp_buffers|work_mem|maintenance_work_mem|default_statistics_target|plan_cache_mode)$/;

function utf8Bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function limitedRecord(
  record: Record<string, string | number | boolean | null> | undefined,
  maximum: number,
  keyFilter: (key: string) => boolean = () => true,
): Record<string, string | number | boolean | null> {
  return Object.fromEntries(
    Object.entries(record ?? {})
      .filter(
        ([key, value]) =>
          keyFilter(key) &&
          (value == null ||
            ["string", "number", "boolean"].includes(typeof value)),
      )
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(0, maximum),
  );
}

function truncateString(value: string, maxCharacters: number): string {
  if (value.length <= maxCharacters) return value;
  return `${value.slice(0, Math.max(0, maxCharacters - 14))}…[truncated]`;
}

function redactDefinition(definition: string): string {
  return redactSql(definition);
}

function compactPlan(plan: unknown): unknown {
  if (!plan || typeof plan !== "object") return null;
  const sanitized = sanitizeExplainPlan(plan);
  const retain = new Set([
    "Plan",
    "Planning Time",
    "Execution Time",
    "Settings",
    "JIT",
    "Node Type",
    "Plans",
    "Schema",
    "Relation Name",
    "Alias",
    "Index Name",
    "Join Type",
    "Plan Rows",
    "Plan Width",
    "Startup Cost",
    "Total Cost",
    "Actual Startup Time",
    "Actual Total Time",
    "Actual Rows",
    "Actual Loops",
    "Filter",
    "Index Cond",
    "Hash Cond",
    "Join Filter",
    "Rows Removed by Filter",
    "Rows Removed by Join Filter",
    "Shared Hit Blocks",
    "Shared Read Blocks",
    "Temp Read Blocks",
    "Temp Written Blocks",
    "Sort Method",
    "Sort Space Used",
    "Workers Planned",
    "Workers Launched",
  ]);
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => retain.has(key))
        .map(([key, child]) => [key, visit(child)]),
    );
  };
  return visit(sanitized);
}

export function buildAiPayload(
  input: AiPayloadInput,
  limits: AiPayloadLimits = {},
): AiPayloadBuildResult {
  const maxBytes = Math.max(4_096, limits.maxBytes ?? 128 * 1_024);
  const maxQueryCharacters = Math.max(256, limits.maxQueryCharacters ?? 20_000);
  const maxTables = Math.max(0, limits.maxTables ?? 30);
  const maxColumns = Math.max(0, limits.maxColumnsPerTable ?? 80);
  const maxIndexes = Math.max(0, limits.maxIndexes ?? 100);
  const maxSettings = Math.max(0, limits.maxSettings ?? 40);
  const maxStatistics = Math.max(0, limits.maxStatistics ?? 100);
  const omissions: string[] = [];
  const redactedQuery = input.query ? redactSql(input.query) : null;
  if (!redactedQuery) omissions.push("normalized query not available");
  if (redactedQuery && redactedQuery.length > maxQueryCharacters)
    omissions.push("query characters");
  if ((input.tables?.length ?? 0) > maxTables) omissions.push("tables");
  if ((input.indexes?.length ?? 0) > maxIndexes) omissions.push("indexes");

  let plan: unknown | null = null;
  let planSummary: AiAdvisorPayload["planSummary"] = null;
  if (input.plan != null) {
    try {
      plan = sanitizeExplainPlan(input.plan);
      planSummary = {
        metrics: calculatePlanMetrics(input.plan),
        warnings: detectPlanWarnings(input.plan),
      };
    } catch {
      omissions.push("invalid plan");
    }
  }

  const payload: AiAdvisorPayload = {
    version: 1,
    privacy: {
      literalsRedacted: true,
      commentsRemoved: true,
      resultRowsIncluded: false,
    },
    context: {
      database: input.context?.database,
      schema: input.context?.schema,
      sourceLabel: input.context?.sourceLabel,
      queryId: input.context?.queryId,
      planId: input.context?.planId,
      relation: input.context?.relation,
      index: input.context?.index,
      finding: input.context?.finding,
    },
    query: redactedQuery
      ? truncateString(redactedQuery, maxQueryCharacters)
      : null,
    plan,
    planSummary,
    tables: (input.tables ?? []).slice(0, maxTables).map((table) => ({
      schema: table.schema,
      name: table.name,
      estimatedRows: table.estimatedRows,
      totalBytes: table.totalBytes,
      columns: table.columns.slice(0, maxColumns).map((column) => ({
        name: column.name,
        dataType: column.dataType,
        nullable: column.nullable,
        statistics: limitedRecord(column.statistics, 20),
      })),
    })),
    indexes: (input.indexes ?? []).slice(0, maxIndexes).map((index) => ({
      schema: index.schema,
      table: index.table,
      name: index.name,
      definition: truncateString(redactDefinition(index.definition), 4_000),
      scans: index.scans,
      sizeBytes: index.sizeBytes,
    })),
    settings: limitedRecord(input.settings, maxSettings, (key) =>
      allowedSettingPattern.test(key),
    ),
    statistics: limitedRecord(input.statistics, maxStatistics),
  };

  if ((input.tables ?? []).some((table) => table.columns.length > maxColumns))
    omissions.push("table columns");
  const initialSettingCount = Object.keys(input.settings ?? {}).filter((key) =>
    allowedSettingPattern.test(key),
  ).length;
  if (initialSettingCount > maxSettings) omissions.push("settings");
  if (Object.keys(input.statistics ?? {}).length > maxStatistics)
    omissions.push("statistics");

  if (utf8Bytes(payload) > maxBytes && payload.plan != null) {
    payload.plan = compactPlan(payload.plan);
    omissions.push("verbose plan properties");
  }
  while (utf8Bytes(payload) > maxBytes && payload.indexes.length > 0) {
    payload.indexes.pop();
    if (!omissions.includes("indexes for byte limit"))
      omissions.push("indexes for byte limit");
  }
  while (utf8Bytes(payload) > maxBytes && payload.tables.length > 0) {
    const table = payload.tables[payload.tables.length - 1]!;
    if (table.columns.length > 0) table.columns.pop();
    else payload.tables.pop();
    if (!omissions.includes("table metadata for byte limit"))
      omissions.push("table metadata for byte limit");
  }
  if (utf8Bytes(payload) > maxBytes && payload.plan != null) {
    payload.plan = null;
    omissions.push("plan for byte limit");
  }
  while (
    utf8Bytes(payload) > maxBytes &&
    payload.query !== null &&
    payload.query.length > 256
  ) {
    payload.query = truncateString(
      payload.query,
      Math.max(256, Math.floor(payload.query.length * 0.75)),
    );
    if (!omissions.includes("query for byte limit"))
      omissions.push("query for byte limit");
  }
  if (utf8Bytes(payload) > maxBytes) {
    payload.statistics = {};
    payload.settings = {};
    omissions.push("settings and statistics for byte limit");
  }
  const bytes = utf8Bytes(payload);
  if (bytes > maxBytes)
    throw new Error(
      `AI payload cannot be reduced below the ${maxBytes}-byte limit.`,
    );
  const preview = JSON.stringify(payload, null, 2);
  return {
    payload,
    bytes,
    truncated: omissions.length > 0,
    omissions: [...new Set(omissions)],
    preview,
  };
}

export const createAiPayload = buildAiPayload;
