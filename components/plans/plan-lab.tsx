"use client";

import { lazy, Suspense, useState } from "react";
import {
  Braces,
  Bot,
  Check,
  ChevronDown,
  Clock3,
  Download,
  Play,
  ShieldAlert,
  Sparkles,
  X,
} from "lucide-react";
import type { PlanNode } from "@/lib/demo/types";
import type { PlanDiff as PlanDiffResult } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { contextualHref } from "@/lib/presentation/inventory";
import { PlanTree } from "./plan-tree";

const LazySqlEditor = lazy(async () => ({
  default: (await import("./sql-editor")).SqlEditor,
}));

const starterSql =
  "SELECT *\nFROM sales.orders\nWHERE id > 0\nORDER BY id DESC\nLIMIT 25";

function numberValue(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toPlanNode(value: unknown, path = "root"): PlanNode | null {
  const document = Array.isArray(value) ? value[0] : value;
  if (!document || typeof document !== "object") return null;
  const record = document as Record<string, unknown>;
  const planValue = record.Plan ?? record;
  if (!planValue || typeof planValue !== "object") return null;
  const node = planValue as Record<string, unknown>;
  const name = String(node["Node Type"] ?? "Plan node");
  const actualRows = numberValue(node, "Actual Rows");
  const estimate = numberValue(node, "Plan Rows");
  const loops = Math.max(1, numberValue(node, "Actual Loops"));
  const estimateRatio =
    estimate > 0
      ? Math.max(actualRows / estimate, estimate / Math.max(1, actualRows))
      : 1;
  const critical = name.includes("Seq Scan") || estimateRatio >= 10;
  const warning =
    name.includes("Sort") || name.includes("Nested Loop") || estimateRatio >= 3;
  const children = Array.isArray(node.Plans)
    ? node.Plans.map((child, index) =>
        toPlanNode(child, `${path}.${index}`),
      ).filter((child): child is PlanNode => child !== null)
    : undefined;
  return {
    id: path,
    name,
    relation:
      typeof node["Relation Name"] === "string"
        ? `${typeof node.Schema === "string" ? `${node.Schema}.` : ""}${node["Relation Name"]}`
        : undefined,
    time: numberValue(node, "Actual Total Time"),
    cost: numberValue(node, "Total Cost"),
    rows: actualRows || estimate,
    estimate,
    loops,
    tone: critical ? "critical" : warning ? "warning" : "info",
    detail:
      [
        typeof node["Index Name"] === "string"
          ? `index ${node["Index Name"]}`
          : null,
        typeof node.Filter === "string" ? `filter ${node.Filter}` : null,
        estimate > 0 && estimateRatio >= 2
          ? `${estimateRatio.toFixed(1)}× estimate error`
          : null,
      ]
        .filter(Boolean)
        .join(" · ") ||
      `${actualRows || estimate} rows · ${loops} loop${loops === 1 ? "" : "s"}`,
    children,
  };
}

export function PlanLab({
  plan,
  sourceKey,
  schema,
  initialSql,
}: {
  plan?: PlanNode;
  sourceKey?: string;
  schema?: string;
  initialSql?: string;
}) {
  const [sql, setSql] = useState(initialSql ?? starterSql);
  const [parameters, setParameters] = useState(["", "", ""]);
  const [view, setView] = useState<"tree" | "diff">("tree");
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState(
    "Ready · plain EXPLAIN does not execute the query",
  );
  const [currentPlan, setCurrentPlan] = useState<PlanNode | null>(plan ?? null);
  const [runId, setRunId] = useState<string | null>(null);
  const [exportJson, setExportJson] = useState<string | null>(null);
  const [exportMarkdown, setExportMarkdown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<
    Array<{ code: string; severity: string; message: string }>
  >([]);
  const [history, setHistory] = useState<
    Array<{
      id: string;
      created_at?: string;
      execution_time_ms?: number | null;
    }>
  >([]);
  const [baselineRunId, setBaselineRunId] = useState("");
  const [candidateRunId, setCandidateRunId] = useState("");
  const [planDiff, setPlanDiff] = useState<PlanDiffResult | null>(null);

  const execute = async (analyze: boolean) => {
    setError(null);
    setStatus(
      analyze ? "Running guarded EXPLAIN ANALYZE…" : "Running safe EXPLAIN…",
    );
    try {
      const maximumParameter = [...sql.matchAll(/\$(\d+)/g)].reduce(
        (maximum, match) => Math.max(maximum, Number(match[1])),
        0,
      );
      const boundParameters = parameters.slice(0, maximumParameter);
      let confirmationToken: string | undefined;
      if (analyze) {
        const confirmation = await fetch("/api/explain/confirm", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sql,
            source: sourceKey,
            schema,
            parameters: boundParameters,
            acknowledgement: "RUN EXPLAIN ANALYZE",
          }),
        });
        const confirmationBody = (await confirmation.json()) as {
          token?: string;
          error?: { message?: string };
        };
        if (!confirmation.ok || !confirmationBody.token)
          throw new Error(
            confirmationBody.error?.message ?? "Confirmation failed",
          );
        confirmationToken = confirmationBody.token;
      }
      const response = await fetch("/api/explain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sql,
          source: sourceKey,
          schema,
          parameters: boundParameters,
          analyze,
          confirmationToken,
          statementTimeoutMs: 3_000,
          lockTimeoutMs: 500,
          persist: true,
        }),
      });
      const body = (await response.json()) as {
        plan?: unknown;
        runId?: string | null;
        exports?: { json?: string; markdown?: string };
        metrics?: {
          executionTimeMs?: number | null;
          planningTimeMs?: number | null;
        };
        warnings?: Array<{ code: string; severity: string; message: string }>;
        error?: { message?: string };
      };
      if (!response.ok || !body.plan)
        throw new Error(body.error?.message ?? "EXPLAIN failed");
      const mapped = toPlanNode(body.plan);
      if (mapped) setCurrentPlan(mapped);
      setRunId(body.runId ?? null);
      setExportJson(body.exports?.json ?? null);
      setExportMarkdown(body.exports?.markdown ?? null);
      setWarnings(body.warnings ?? []);
      const elapsed = analyze
        ? body.metrics?.executionTimeMs
        : body.metrics?.planningTimeMs;
      setStatus(
        `${analyze ? "Guarded ANALYZE" : "EXPLAIN"} completed${typeof elapsed === "number" ? ` in ${elapsed.toFixed(2)} ms` : ""}`,
      );
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "EXPLAIN failed";
      setError(message);
      setStatus("Request failed safely");
    } finally {
      setConfirming(false);
    }
  };

  const download = (format: "json" | "markdown") => {
    const content = format === "json" ? exportJson : exportMarkdown;
    if (!content) return;
    const url = URL.createObjectURL(
      new Blob([content], {
        type: format === "json" ? "application/json" : "text/markdown",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `index-analyzer-plan-${runId ?? "latest"}.${format === "json" ? "json" : "md"}`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const loadHistory = async () => {
    try {
      const sourceQuery = sourceKey
        ? `?source=${encodeURIComponent(sourceKey)}`
        : "";
      const healthResponse = await fetch(`/api/health${sourceQuery}`, {
        cache: "no-store",
      });
      const health = (await healthResponse.json()) as {
        sourceDatabaseId?: number | null;
      };
      const parameters = new URLSearchParams({ limit: "50" });
      if (health.sourceDatabaseId)
        parameters.set("sourceDatabaseId", String(health.sourceDatabaseId));
      const response = await fetch(`/api/plans?${parameters}`, {
        cache: "no-store",
      });
      const body = (await response.json()) as {
        plans?: Array<{
          id: string;
          created_at?: string;
          execution_time_ms?: number | null;
        }>;
        error?: { message?: string };
      };
      if (!response.ok)
        throw new Error(body.error?.message ?? "Plan history failed");
      const plans = body.plans ?? [];
      setHistory(plans);
      setCandidateRunId(plans[0]?.id ?? "");
      setBaselineRunId(plans[1]?.id ?? plans[0]?.id ?? "");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Plan history failed",
      );
    }
  };

  const compare = async () => {
    if (!baselineRunId || !candidateRunId || baselineRunId === candidateRunId)
      return;
    setError(null);
    try {
      const response = await fetch("/api/plans/compare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baselineRunId, candidateRunId }),
      });
      const body = (await response.json()) as {
        diff?: PlanDiffResult;
        error?: { message?: string };
      };
      if (!response.ok || !body.diff)
        throw new Error(body.error?.message ?? "Plan comparison failed");
      setPlanDiff(body.diff);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Plan comparison failed",
      );
    }
  };

  return (
    <>
      <div className="lab-layout">
        <section className="editor-shell">
          <div className="editor-toolbar">
            <Braces size={14} color="var(--cyan)" />
            <strong style={{ fontSize: 11 }}>SQL statement</strong>
            <span style={{ marginLeft: "auto" }}>
              <Badge tone="green">Single read-only statement</Badge>
            </span>
          </div>
          <div className="editor-body">
            <Suspense
              fallback={
                <div className="editor-placeholder">Loading SQL editor…</div>
              }
            >
              <LazySqlEditor value={sql} onChange={setSql} />
            </Suspense>
          </div>
          <div className="parameters">
            <div style={{ display: "flex", alignItems: "center" }}>
              <strong style={{ fontSize: 10 }}>Parameters</strong>
              <span
                style={{ color: "var(--subtle)", fontSize: 9, marginLeft: 7 }}
              >
                Values are not persisted
              </span>
            </div>
            <div className="parameter-row">
              <span className="parameter-label">$1</span>
              <select
                className="context-select compact"
                aria-label="Parameter 1 type"
              >
                <option>uuid</option>
              </select>
              <input
                className="input mono"
                aria-label="Parameter 1"
                value={parameters[0]}
                placeholder="optional value"
                onChange={(event) =>
                  setParameters((values) => [
                    event.target.value,
                    values[1] ?? "",
                    values[2] ?? "",
                  ])
                }
              />
            </div>
            <div className="parameter-row">
              <span className="parameter-label">$2</span>
              <select
                className="context-select compact"
                aria-label="Parameter 2 type"
              >
                <option>text</option>
              </select>
              <input
                className="input mono"
                aria-label="Parameter 2"
                value={parameters[1]}
                placeholder="optional value"
                onChange={(event) =>
                  setParameters((values) => [
                    values[0] ?? "",
                    event.target.value,
                    values[2] ?? "",
                  ])
                }
              />
            </div>
            <div className="parameter-row">
              <span className="parameter-label">$3</span>
              <select
                className="context-select compact"
                aria-label="Parameter 3 type"
              >
                <option>int4</option>
              </select>
              <input
                className="input mono"
                aria-label="Parameter 3"
                value={parameters[2]}
                placeholder="optional value"
                onChange={(event) =>
                  setParameters((values) => [
                    values[0] ?? "",
                    values[1] ?? "",
                    event.target.value,
                  ])
                }
              />
            </div>
          </div>
          <div
            className="editor-toolbar"
            style={{ borderTop: "1px solid var(--border)", borderBottom: 0 }}
          >
            <button
              className="button primary"
              onClick={() => void execute(false)}
            >
              <Play />
              Run EXPLAIN
            </button>
            {runId ? (
              <a
                className="icon-button"
                aria-label="Analyze saved plan with AI"
                href={contextualHref("/advisor", {
                  source: sourceKey,
                  schema,
                  parameters: { planId: runId },
                })}
              >
                <Bot />
              </a>
            ) : null}
            <button
              className="button danger"
              onClick={() => setConfirming(true)}
            >
              <ShieldAlert />
              ANALYZE
            </button>
            <span
              style={{
                marginLeft: "auto",
                color: "var(--subtle)",
                fontSize: 9,
              }}
            >
              <Clock3 size={11} style={{ verticalAlign: -2, marginRight: 4 }} />
              3s timeout
            </span>
          </div>
        </section>

        <section className="card plan-panel" id="plan-workspace">
          <div className="plan-toolbar">
            <div className="section-tabs" style={{ margin: 0 }}>
              <button
                className={`section-tab${view === "tree" ? " active" : ""}`}
                onClick={() => setView("tree")}
              >
                Plan tree
              </button>
              <button
                className={`section-tab${view === "diff" ? " active" : ""}`}
                onClick={() => {
                  setView("diff");
                  if (history.length === 0) void loadHistory();
                }}
              >
                Compare
              </button>
            </div>
            <span className="plan-legend">
              <span>
                <i
                  className="legend-dot"
                  style={{ background: "var(--rose)" }}
                />
                critical path
              </span>
              <span>
                <i
                  className="legend-dot"
                  style={{ background: "var(--amber)" }}
                />
                warning
              </span>
            </span>
            <button
              className="icon-button"
              style={{ marginLeft: 4 }}
              aria-label="Export plan as JSON"
              onClick={() => download("json")}
              disabled={!exportJson}
            >
              <Download />
            </button>
            <button
              className="icon-button"
              aria-label="Export plan as Markdown"
              onClick={() => download("markdown")}
              disabled={!exportMarkdown}
            >
              <Download />
            </button>
          </div>
          {view === "tree" ? (
            currentPlan ? (
              <PlanTree root={currentPlan} />
            ) : (
              <div className="empty-state">
                <div>
                  <h2>No plan has been executed</h2>
                  <p>
                    Run a plain EXPLAIN to load measured planner evidence from
                    {schema ? ` the ${schema} schema` : " the selected target"}.
                  </p>
                </div>
              </div>
            )
          ) : (
            <div id="plan-history">
              <PlanDiff
                history={history}
                baselineRunId={baselineRunId}
                candidateRunId={candidateRunId}
                setBaselineRunId={setBaselineRunId}
                setCandidateRunId={setCandidateRunId}
                compare={() => void compare()}
                diff={planDiff}
              />
            </div>
          )}
          <div className="payload-footer">
            <Check size={12} color="var(--green)" style={{ marginRight: 6 }} />
            {status}
            <span style={{ marginLeft: "auto" }}>
              {runId ? `Plan run ${runId}` : "Unsaved preview"} · JSON format
            </span>
          </div>
          {error ? (
            <div className="privacy-note" style={{ color: "var(--rose)" }}>
              {error}
            </div>
          ) : null}
        </section>
      </div>
      <div className="content-grid equal">
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">Plan signals</h2>
            <Badge tone={warnings.length > 0 ? "rose" : "green"}>
              {warnings.length} material
            </Badge>
          </div>
          <div className="card-body">
            <div className="analysis-list">
              {warnings.length > 0 ? (
                warnings.map((warning) => (
                  <Signal
                    key={`${warning.code}:${warning.message}`}
                    tone={
                      warning.severity === "critical" ||
                      warning.severity === "high"
                        ? "rose"
                        : "amber"
                    }
                    title={warning.code.replaceAll("_", " ")}
                    detail={warning.message}
                  />
                ))
              ) : (
                <div className="empty-state">
                  <div>
                    <h2>Run EXPLAIN to populate live signals</h2>
                    <p>
                      Warnings are derived from the returned PostgreSQL JSON
                      plan, not from generic advice.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">What changed</h2>
            <span className="card-subtitle">Persisted comparison</span>
          </div>
          <div className="card-body">
            {planDiff ? (
              <div className="analysis-list">
                {(planDiff.summary.length > 0
                  ? planDiff.summary
                  : ["No material plan change was detected."]
                ).map((summary) => (
                  <div className="privacy-note" key={summary}>
                    <Sparkles />
                    {summary}
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <div>
                  <h2>No comparison selected</h2>
                  <p>
                    Open Compare, select two persisted runs, and match their
                    plan nodes.
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      {confirming ? (
        <div className="command-backdrop" role="presentation">
          <div
            className="command-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="analyze-title"
          >
            <div className="card-body" style={{ padding: 22 }}>
              <div style={{ display: "flex", gap: 12 }}>
                <span
                  className="error-state-icon"
                  style={{
                    margin: 0,
                    color: "var(--rose)",
                    background: "var(--rose-soft)",
                  }}
                >
                  <ShieldAlert />
                </span>
                <div>
                  <h2 id="analyze-title" style={{ margin: 0, fontSize: 16 }}>
                    Execute with EXPLAIN ANALYZE?
                  </h2>
                  <p style={{ color: "var(--muted)", fontSize: 11 }}>
                    PostgreSQL will execute this query. It will run in a
                    read-only transaction with a 3 second statement timeout, 500
                    ms lock timeout, and mandatory rollback.
                  </p>
                  <div className="privacy-note">
                    <Check />
                    Statement classification passed: one SELECT, no volatile
                    functions detected.
                  </div>
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: 8,
                  marginTop: 20,
                }}
              >
                <button className="button" onClick={() => setConfirming(false)}>
                  <X />
                  Cancel
                </button>
                <button
                  className="button danger"
                  onClick={() => void execute(true)}
                >
                  <Play />
                  Run guarded ANALYZE
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Signal({
  tone,
  title,
  detail,
}: {
  tone: "rose" | "amber";
  title: string;
  detail: string;
}) {
  return (
    <div
      className={`analysis-card severity-${tone === "rose" ? "critical" : "warning"}`}
    >
      <div className="analysis-head">
        <span className="severity-mark" />
        <strong>{title}</strong>
      </div>
      <p className="analysis-summary">{detail}</p>
    </div>
  );
}

function PlanDiff({
  history,
  baselineRunId,
  candidateRunId,
  setBaselineRunId,
  setCandidateRunId,
  compare,
  diff,
}: {
  history: Array<{
    id: string;
    created_at?: string;
    execution_time_ms?: number | null;
  }>;
  baselineRunId: string;
  candidateRunId: string;
  setBaselineRunId: (id: string) => void;
  setCandidateRunId: (id: string) => void;
  compare: () => void;
  diff: PlanDiffResult | null;
}) {
  return (
    <div className="card-body">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 12,
        }}
      >
        <select
          className="context-select"
          aria-label="Baseline plan"
          value={baselineRunId}
          onChange={(event) => setBaselineRunId(event.target.value)}
        >
          <option value="">Select baseline</option>
          {history.map((run) => (
            <option value={run.id} key={run.id}>
              {run.id.slice(0, 8)} · {run.created_at ?? "saved run"}
            </option>
          ))}
        </select>
        <span style={{ color: "var(--subtle)" }}>→</span>
        <select
          className="context-select"
          aria-label="Candidate plan"
          value={candidateRunId}
          onChange={(event) => setCandidateRunId(event.target.value)}
        >
          <option value="">Select candidate</option>
          {history.map((run) => (
            <option value={run.id} key={run.id}>
              {run.id.slice(0, 8)} · {run.created_at ?? "saved run"}
            </option>
          ))}
        </select>
        <button
          className="button"
          style={{ marginLeft: "auto" }}
          disabled={
            !baselineRunId ||
            !candidateRunId ||
            baselineRunId === candidateRunId
          }
          onClick={compare}
        >
          <ChevronDown />
          Match nodes
        </button>
      </div>
      {history.length < 2 ? (
        <div className="empty-state">
          <div>
            <h2>Capture at least two plans</h2>
            <p>
              Persisted runs will appear here after successful EXPLAIN calls.
            </p>
          </div>
        </div>
      ) : diff ? (
        <div className="analysis-list">
          <div className="info-grid">
            <div className="info-cell">
              <span>Matched nodes</span>
              <strong>{diff.matches.length}</strong>
            </div>
            <div className="info-cell">
              <span>Material node changes</span>
              <strong>
                {
                  diff.nodes.filter((node) => node.status !== "unchanged")
                    .length
                }
              </strong>
            </div>
            <div className="info-cell">
              <span>Execution delta</span>
              <strong>
                {diff.executionTimeChangeMs == null
                  ? "not measured"
                  : `${diff.executionTimeChangeMs.toFixed(2)} ms`}
              </strong>
            </div>
          </div>
          {diff.summary.map((summary) => (
            <div className="privacy-note" key={summary}>
              <Sparkles />
              {summary}
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <div>
            <h2>Select two runs</h2>
            <p>
              The comparison is computed and persisted by the control plane.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
