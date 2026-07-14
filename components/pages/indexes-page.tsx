"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Filter,
  Search,
  Sparkles,
} from "lucide-react";
import { demoRepository } from "@/lib/demo/data";
import type { IndexRecord } from "@/lib/demo/types";
import type { DataSourceState } from "@/lib/server/dashboard-data";
import type { MissingIndexView } from "@/lib/server/dashboard-data";
import { contextualHref } from "@/lib/presentation/inventory";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { MetricCard } from "@/components/ui/metric-card";
import { PageHeader } from "@/components/ui/page-header";
import { DataSourceBadge } from "@/components/ui/data-source-badge";

const PAGE_SIZE = 25;

function formatBytes(bytes: number) {
  return bytes >= 1_073_741_824
    ? `${(bytes / 1_073_741_824).toFixed(1)} GB`
    : `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function inferredColumns(index: IndexRecord): string[] {
  if (index.keyColumns?.length)
    return index.keyColumns
      .map((column) => column.trim())
      .filter(
        (column) =>
          /^[_\p{L}][_$\p{L}\p{N}]*$/u.test(column) ||
          /^"(?:[^"]|"")+"$/.test(column),
      )
      .map((column) =>
        column.startsWith('"')
          ? column.slice(1, -1).replaceAll('""', '"')
          : column,
      );
  const match = index.definition.match(/\(([^)]+)\)/);
  return (
    match?.[1]
      ?.split(",")
      .map((column) => column.trim().replace(/^"|"$/g, ""))
      .filter(Boolean) ?? []
  );
}

function indexKey(index: IndexRecord): string {
  return `${index.schema}.${index.name}`;
}

export function IndexesPage({
  indexes: initialIndexes = demoRepository.indexes(),
  initialHasMore = false,
  relationshipAnalysisTruncated = false,
  hypopgAvailable = false,
  missingCandidates = [],
  sourceKey,
  schema,
  source = {
    mode: "unavailable",
    label: "Sample preview",
    detail: "No database data was supplied.",
  },
}: {
  indexes?: IndexRecord[];
  initialHasMore?: boolean;
  relationshipAnalysisTruncated?: boolean;
  hypopgAvailable?: boolean;
  missingCandidates?: MissingIndexView[];
  sourceKey?: string;
  schema?: string;
  source?: DataSourceState;
}) {
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [candidateOnly, setCandidateOnly] = useState(false);
  const [indexes, setIndexes] = useState(initialIndexes);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [relationshipTruncated, setRelationshipTruncated] = useState(
    relationshipAnalysisTruncated,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(
    initialIndexes.find((index) => index.status !== "healthy")
      ? indexKey(initialIndexes.find((index) => index.status !== "healthy")!)
      : initialIndexes[0]
        ? indexKey(initialIndexes[0])
        : null,
  );
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [selectedCandidateId, setSelectedCandidateId] = useState(
    missingCandidates[0]?.id ?? "",
  );
  const [hypotheticalQuery, setHypotheticalQuery] = useState(
    missingCandidates[0]?.query ?? "",
  );
  const [hypotheticalIndexSql, setHypotheticalIndexSql] = useState(() =>
    missingCandidates[0] ? candidateSql(missingCandidates[0]) : "",
  );
  const [hypotheticalStatus, setHypotheticalStatus] = useState<string | null>(
    null,
  );
  const [hypotheticalState, setHypotheticalState] = useState<
    "idle" | "running" | "success" | "error"
  >("idle");
  const skippedInitialRequest = useRef(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setPage(0);
      setAppliedSearch(search.trim());
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    if (!skippedInitialRequest.current) {
      skippedInitialRequest.current = true;
      return;
    }
    const controller = new AbortController();
    const parameters = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
    });
    if (sourceKey) parameters.set("source", sourceKey);
    if (schema) parameters.set("schema", schema);
    if (appliedSearch) parameters.set("search", appliedSearch);
    setLoading(true);
    setError(null);
    void fetch(`/api/indexes?${parameters}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json()) as {
          indexViews?: IndexRecord[];
          pagination?: { hasMore?: boolean };
          relationshipAnalysis?: { truncated?: boolean };
          error?: { message?: string };
        };
        if (!response.ok || !body.indexViews)
          throw new Error(body.error?.message ?? "Index inventory failed");
        setIndexes(body.indexViews);
        setHasMore(Boolean(body.pagination?.hasMore));
        setRelationshipTruncated(Boolean(body.relationshipAnalysis?.truncated));
        const candidate =
          body.indexViews.find((index) => index.status !== "healthy") ??
          body.indexViews[0];
        setSelectedKey(candidate ? indexKey(candidate) : null);
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError")
          return;
        setError(
          caught instanceof Error ? caught.message : "Index inventory failed",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [appliedSearch, page, schema, sourceKey]);

  const filtered = useMemo(
    () =>
      candidateOnly
        ? indexes.filter((index) => index.status !== "healthy")
        : indexes,
    [candidateOnly, indexes],
  );
  const selected =
    indexes.find((index) => indexKey(index) === selectedKey) ?? indexes[0];
  const selectedCandidate = missingCandidates.find(
    (candidate) => candidate.id === selectedCandidateId,
  );
  const footprint = indexes.reduce(
    (total, index) => total + (index.sizeBytes ?? 0),
    0,
  );
  const metrics = [
    {
      label: "Index footprint",
      value: formatBytes(footprint),
      detail: `${indexes.length} rows in this bounded API page`,
      trend: 0,
      tone: "cyan" as const,
      points: [],
    },
    {
      label: "Unused candidates",
      value: String(
        indexes.filter((index) => index.status === "unused").length,
      ),
      detail: "Zero scans · current page and stats window",
      trend: 0,
      tone: "amber" as const,
      points: [],
    },
    {
      label: "Overlap",
      value: String(
        indexes.filter(
          (index) => index.status === "duplicate" || index.status === "overlap",
        ).length,
      ),
      detail: "Exact and prefix evidence in the current page",
      trend: 0,
      tone: "rose" as const,
      points: [],
    },
    {
      label: "Avoidable writes",
      value: String(
        indexes.filter((index) => index.writeCost === "high").length,
      ),
      detail: "High write-cost signals in the current page",
      trend: 0,
      tone: "violet" as const,
      points: [],
    },
  ];

  const downloadInventory = () => {
    const csv = [
      [
        "schema",
        "table",
        "index",
        "status",
        "method",
        "size",
        "scans",
        "definition",
      ],
      ...indexes.map((index) => [
        index.schema,
        index.table,
        index.name,
        index.status,
        index.type,
        index.size,
        String(index.scans),
        index.definition,
      ]),
    ]
      .map((row) =>
        row.map((value) => `"${value.replaceAll('"', '""')}"`).join(","),
      )
      .join("\n");
    downloadText(
      csv,
      `index-analyzer-indexes-page-${page + 1}.csv`,
      "text/csv",
    );
  };

  const requestRecommendation = async (): Promise<string> => {
    if (!selected) throw new Error("Select an index first");
    const columns = inferredColumns(selected);
    if (columns.length === 0)
      throw new Error("No key columns are available for this index");
    const response = await fetch("/api/indexes/recommendation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        schema: selected.schema,
        table: selected.table,
        columns,
        include: selected.includedColumns ?? [],
        unique: Boolean(selected.unique),
        name: `${selected.name}_candidate`.slice(0, 63),
      }),
    });
    const body = (await response.json()) as {
      sql?: string;
      error?: { message?: string };
    };
    if (!response.ok || !body.sql)
      throw new Error(
        body.error?.message ?? "Recommendation generation failed",
      );
    return body.sql;
  };

  const handleRecommendation = async (mode: "copy" | "export") => {
    setActionStatus("Generating review-only SQL…");
    try {
      const sql = await requestRecommendation();
      if (mode === "copy") await navigator.clipboard?.writeText(sql);
      else
        downloadText(
          sql,
          `${selected?.name ?? "index"}-candidate.sql`,
          "text/sql",
        );
      setActionStatus(
        mode === "copy" ? "Review-only SQL copied" : "Review-only SQL exported",
      );
    } catch (caught) {
      setActionStatus(
        caught instanceof Error ? caught.message : "Recommendation failed",
      );
    }
  };

  const selectCandidate = (candidate: MissingIndexView) => {
    setSelectedCandidateId(candidate.id);
    setHypotheticalQuery(candidate.query);
    setHypotheticalIndexSql(candidateSql(candidate));
    setHypotheticalStatus(null);
    setHypotheticalState("idle");
  };

  const runHypothetical = async () => {
    setHypotheticalState("running");
    setHypotheticalStatus("Running baseline and hypothetical EXPLAIN…");
    try {
      const response = await fetch("/api/indexes/hypothetical", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: sourceKey,
          schema: selectedCandidate?.schema ?? schema,
          sql: hypotheticalQuery,
          indexSql: hypotheticalIndexSql,
          statementTimeoutMs: 5_000,
        }),
      });
      const body = (await response.json()) as {
        costChangePercent?: number | null;
        baseline?: { metrics?: { totalCost?: number | null } };
        hypothetical?: { metrics?: { totalCost?: number | null } };
        error?: { message?: string };
      };
      if (!response.ok)
        throw new Error(body.error?.message ?? "HypoPG experiment failed");
      setHypotheticalStatus(
        `Baseline cost ${body.baseline?.metrics?.totalCost ?? "unknown"} → hypothetical ${body.hypothetical?.metrics?.totalCost ?? "unknown"}${typeof body.costChangePercent === "number" ? ` (${body.costChangePercent.toFixed(1)}%)` : ""}. Planner estimates only.`,
      );
      setHypotheticalState("success");
    } catch (caught) {
      setHypotheticalStatus(
        caught instanceof Error ? caught.message : "HypoPG experiment failed",
      );
      setHypotheticalState("error");
    }
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="Storage and write economics"
        title="Indexes"
        description="Inventory every schema, surface duplicates and left-prefix overlap, and weigh read evidence against write amplification before suggesting a change."
        actions={
          <>
            <DataSourceBadge source={source} />
            <button className="button" onClick={downloadInventory}>
              <Download /> Export current page
            </button>
            <a
              className="button primary"
              href={contextualHref("/plans", { source: sourceKey, schema })}
            >
              <Sparkles /> Analyze a plan
            </a>
          </>
        }
      />
      <div className="metric-grid" style={{ marginBottom: 12 }}>
        {metrics.map((metric) => (
          <MetricCard metric={metric} key={metric.label} />
        ))}
      </div>
      <div className="toolbar">
        <label className="search-field">
          <Search />
          <span className="sr-only">Search indexes</span>
          <input
            className="search-input"
            placeholder="Search index or table…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <button
          className={`filter-button${candidateOnly ? " active" : ""}`}
          aria-pressed={candidateOnly}
          onClick={() => setCandidateOnly((value) => !value)}
          title="Candidate signals in the current API page"
        >
          <Filter /> Candidates on page
        </button>
      </div>
      {relationshipTruncated ? (
        <div className="privacy-note" role="status">
          Duplicate and prefix analysis inspected the first 5,000 matching
          indexes. Narrow by schema or search to obtain complete relationship
          evidence for this catalog.
        </div>
      ) : null}
      <section className="card data-card" aria-busy={loading}>
        {error ? (
          <div className="privacy-note" role="alert">
            {error}
          </div>
        ) : null}
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Index</th>
                <th>Status</th>
                <th>Method</th>
                <th>Size</th>
                <th>Scans</th>
                <th>Write cost</th>
                <th>Definition</th>
              </tr>
            </thead>
            <tbody style={{ opacity: loading ? 0.55 : 1 }}>
              {filtered.map((index) => (
                <tr
                  key={`${index.schema}.${index.table}.${index.name}`}
                  className={
                    indexKey(selected ?? index) === indexKey(index) && selected
                      ? "selected-row"
                      : undefined
                  }
                  tabIndex={0}
                  onClick={() => setSelectedKey(indexKey(index))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ")
                      setSelectedKey(indexKey(index));
                  }}
                >
                  <td>
                    <span className="table-primary mono">{index.name}</span>
                    <span className="query-id">
                      {index.schema}.{index.table}
                    </span>
                  </td>
                  <td>
                    <Badge
                      tone={
                        index.status === "healthy"
                          ? "green"
                          : index.status === "unused"
                            ? "amber"
                            : "rose"
                      }
                    >
                      {index.status}
                    </Badge>
                  </td>
                  <td>
                    <Badge>{index.type}</Badge>
                  </td>
                  <td className="number">{index.size}</td>
                  <td className="number">{index.scans.toLocaleString()}</td>
                  <td>
                    <Badge
                      tone={
                        index.writeCost === "high"
                          ? "rose"
                          : index.writeCost === "medium"
                            ? "amber"
                            : "green"
                      }
                    >
                      {index.writeCost}
                    </Badge>
                  </td>
                  <td className="query-cell">
                    <span className="query-snippet">{index.definition}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 ? (
            <div className="empty-state">
              <div>
                <h2>No matching indexes</h2>
                <p>Adjust the search or page-level candidate filter.</p>
              </div>
            </div>
          ) : null}
        </div>
        <footer className="table-footer">
          <span>
            Page {page + 1} · {indexes.length} bounded rows ·{" "}
            {new Set(indexes.map((index) => index.schema)).size} schemas
            represented
          </span>
          <nav className="pagination" aria-label="Index pages">
            <button
              className="page-button"
              aria-label="Previous index page"
              disabled={page === 0 || loading}
              onClick={() => setPage((value) => Math.max(0, value - 1))}
            >
              <ChevronLeft size={13} />
            </button>
            <span className="page-button active" aria-current="page">
              {page + 1}
            </span>
            <button
              className="page-button"
              aria-label="Next index page"
              disabled={!hasMore || loading}
              onClick={() => setPage((value) => value + 1)}
            >
              <ChevronRight size={13} />
            </button>
          </nav>
        </footer>
      </section>
      <div className="content-grid">
        <Card>
          <CardHeader
            title="Selected catalog evidence"
            subtitle={
              selected
                ? `${selected.schema}.${selected.table}`
                : "No index selected"
            }
            action={
              <Badge tone={selected?.status === "healthy" ? "green" : "amber"}>
                {selected?.status ?? "empty"}
              </Badge>
            }
          />
          <CardBody>
            <div className="query-panel">
              {selected?.definition ?? "No index definition is available."}
            </div>
            <div className="privacy-note" style={{ marginTop: 11 }}>
              <Sparkles /> Evidence: {selected?.scans.toLocaleString() ?? 0}{" "}
              scans · {(selected?.tuplesRead ?? 0).toLocaleString()} tuples read
              · {(selected?.tuplesFetched ?? 0).toLocaleString()} fetched ·{" "}
              {selected?.unique ? "unique" : "non-unique"} ·{" "}
              {selected?.valid && selected?.ready
                ? "valid and ready"
                : "not ready/valid"}{" "}
              · {selected?.size ?? "0 B"} · {selected?.writeCost ?? "low"}{" "}
              write-cost signal
              {selected?.writeCostScore !== undefined
                ? ` (${selected.writeCostScore}/100)`
                : ""}
              . Generated DDL is never executed.
              {selected?.writeCostReasons?.length ? (
                <span style={{ display: "block", marginTop: 5 }}>
                  Signal inputs: {selected.writeCostReasons.join(" ")}
                </span>
              ) : null}
            </div>
            <div
              style={{
                display: "flex",
                gap: 8,
                marginTop: 12,
                flexWrap: "wrap",
              }}
            >
              <button
                className="button"
                disabled={!selected}
                onClick={() => void handleRecommendation("copy")}
              >
                <Copy /> Copy candidate SQL
              </button>
              <button
                className="button"
                disabled={!selected}
                onClick={() => void handleRecommendation("export")}
              >
                <Download /> Export .sql
              </button>
              {selected ? (
                <a
                  className="button"
                  href={contextualHref("/advisor", {
                    source: sourceKey,
                    schema,
                    parameters: {
                      index: selected.name,
                      relationSchema: selected.schema,
                      relationTable: selected.table,
                    },
                  })}
                >
                  <Bot /> Analyze with AI
                </a>
              ) : null}
              <Badge tone="amber">Review only</Badge>
            </div>
            {actionStatus ? (
              <p className="card-subtitle" role="status">
                {actionStatus}
              </p>
            ) : null}
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Hypothetical indexes"
            action={
              <Badge tone={hypopgAvailable ? "green" : "amber"}>
                {hypopgAvailable ? "Available" : "Unavailable"}
              </Badge>
            }
          />
          <CardBody>
            <div className="analysis-list" style={{ marginBottom: 12 }}>
              {missingCandidates.map((candidate) => (
                <button
                  className={`analysis-card${selectedCandidateId === candidate.id ? " selected" : ""}`}
                  onClick={() => selectCandidate(candidate)}
                  key={candidate.id}
                >
                  <div className="analysis-head">
                    <strong>{candidate.title}</strong>
                    <Badge
                      tone={candidate.confidence === "high" ? "rose" : "amber"}
                    >
                      score {candidate.score.toFixed(0)}
                    </Badge>
                  </div>
                  <p className="analysis-summary">{candidate.summary}</p>
                  <span className="mono">
                    ({candidate.columns.join(", ")}) · plan{" "}
                    {candidate.planId.slice(0, 8)}
                  </span>
                </button>
              ))}
              {missingCandidates.length === 0 ? (
                <div className="privacy-note">
                  No plan-derived missing-index findings have been collected
                  yet.
                </div>
              ) : null}
            </div>
            <p style={{ color: "var(--muted)", fontSize: 11, marginTop: 0 }}>
              {hypopgAvailable
                ? "HypoPG is detected. Use it to validate cost changes before considering real DDL."
                : "HypoPG is not installed, so no hypothetical cost improvement is claimed."}
            </p>
            <label className="card-subtitle" htmlFor="hypothetical-query">
              Read-only query
            </label>
            <textarea
              id="hypothetical-query"
              className="input mono"
              rows={5}
              value={hypotheticalQuery}
              onChange={(event) => setHypotheticalQuery(event.target.value)}
              placeholder="Paste a single read-only query. Replace redacted ? markers with PostgreSQL parameters or harmless literals."
              style={{ width: "100%", marginTop: 6, resize: "vertical" }}
            />
            <label className="card-subtitle" htmlFor="hypothetical-index">
              Review-only candidate
            </label>
            <textarea
              id="hypothetical-index"
              className="input mono"
              rows={3}
              value={hypotheticalIndexSql}
              onChange={(event) => setHypotheticalIndexSql(event.target.value)}
              placeholder="CREATE INDEX candidate ON schema.table (column)"
              style={{ width: "100%", marginTop: 6, resize: "vertical" }}
            />
            <button
              className="button primary"
              disabled={
                !hypopgAvailable ||
                hypotheticalState === "running" ||
                !hypotheticalQuery.trim() ||
                !hypotheticalIndexSql.trim()
              }
              onClick={() => void runHypothetical()}
              style={{ marginTop: 10 }}
            >
              <Sparkles /> Compare planner costs
            </button>
            {hypotheticalStatus ? (
              <div
                className="privacy-note"
                role={hypotheticalState === "error" ? "alert" : "status"}
                style={{ marginTop: 10 }}
              >
                {hypotheticalStatus}
              </div>
            ) : null}
            <button
              className="button"
              aria-expanded={showGuide}
              onClick={() => setShowGuide((value) => !value)}
            >
              {showGuide ? "Hide" : "View"} enablement guide
            </button>
            {showGuide ? (
              <div className="privacy-note" style={{ marginTop: 10 }}>
                Ask a privileged operator to review{" "}
                <span className="mono">CREATE EXTENSION hypopg;</span>. The
                dashboard never installs extensions or runs DDL.
              </div>
            ) : null}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function candidateSql(candidate: MissingIndexView): string {
  const name =
    `${candidate.table}_${candidate.columns.join("_")}_candidate`.slice(0, 63);
  return `CREATE INDEX ${quoteIdentifier(name)} ON ${quoteIdentifier(candidate.schema)}.${quoteIdentifier(candidate.table)} (${candidate.columns.map(quoteIdentifier).join(", ")})`;
}

function downloadText(contents: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
