"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Bot,
  Check,
  ChevronRight,
  Eye,
  LockKeyhole,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { AiAnalysisResponse } from "@/lib/ai/schema";
import type { AiPayloadInput } from "@/lib/ai/payload";
import type { Analysis } from "@/lib/demo/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";

type Preview = {
  payload: unknown;
  preview: string;
  bytes: number;
  limitBytes: number;
  truncated: boolean;
  omissions: string[];
  canSubmit: boolean;
  model: string;
};

type AdvisorContext = {
  ready: boolean;
  source: { key: string; label: string; database: string };
  sourceDatabaseId: number | null;
  selection: {
    queryId?: string;
    findingId?: number;
    planId?: string;
    relation?: string;
    index?: string;
  };
  evidence: {
    queryOrigin: "live" | "history" | "plan" | null;
    historySamples: number;
    planMatch: "explicit" | "query-shape" | null;
    tables: string[];
    indexes: number;
    settings: number;
  };
  omissions: string[];
  input: AiPayloadInput & {
    source?: string;
    sourceDatabaseId?: number;
    explainRunId?: string;
  };
};

export function AdvisorWorkspace({
  analyses = [],
  sourceKey,
  queryId,
  findingId,
  planId,
  relationSchema,
  relationTable,
  index,
}: {
  analyses?: Analysis[];
  sourceKey?: string;
  queryId?: string;
  findingId?: string;
  planId?: string;
  relationSchema?: string;
  relationTable?: string;
  index?: string;
}) {
  const [mode, setMode] = useState<"balanced" | "deep">("balanced");
  const [showPayload, setShowPayload] = useState(false);
  const [state, setState] = useState<"ready" | "working" | "done">("ready");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [analysis, setAnalysis] = useState<AiAnalysisResponse | null>(null);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(
    null,
  );
  const [metadata, setMetadata] = useState<{
    model?: string;
    providerRequestId?: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [advisorContext, setAdvisorContext] = useState<AdvisorContext | null>(
    null,
  );
  const [contextState, setContextState] = useState<
    "loading" | "ready" | "missing" | "error"
  >("loading");

  const loadContext = useCallback(async (): Promise<AdvisorContext> => {
    const search = new URLSearchParams();
    if (sourceKey) search.set("source", sourceKey);
    if (queryId) search.set("queryId", queryId);
    if (findingId) search.set("findingId", findingId);
    if (planId) search.set("planId", planId);
    if (relationSchema) search.set("relationSchema", relationSchema);
    if (relationTable) search.set("relationTable", relationTable);
    if (index) search.set("index", index);
    if (
      !queryId &&
      !findingId &&
      !planId &&
      !(relationSchema && relationTable)
    ) {
      setContextState("missing");
      throw new Error(
        "Select a query, finding, saved plan, or catalog relation before requesting analysis.",
      );
    }
    setContextState("loading");
    const response = await fetch(`/api/advisor/context?${search.toString()}`, {
      cache: "no-store",
    });
    const body = (await response.json()) as AdvisorContext & {
      error?: { message?: string };
    };
    if (!response.ok || !body.input)
      throw new Error(
        body.error?.message ?? "Advisor evidence could not be assembled.",
      );
    setAdvisorContext(body);
    setContextState(body.ready ? "ready" : "missing");
    return body;
  }, [
    findingId,
    index,
    planId,
    queryId,
    relationSchema,
    relationTable,
    sourceKey,
  ]);

  useEffect(() => {
    if (
      !queryId &&
      !findingId &&
      !planId &&
      !(relationSchema && relationTable)
    ) {
      setContextState("missing");
      return;
    }
    void loadContext().catch((caught) => {
      setContextState("error");
      setError(
        caught instanceof Error
          ? caught.message
          : "Advisor evidence could not be assembled.",
      );
    });
  }, [findingId, loadContext, planId, queryId, relationSchema, relationTable]);

  const requestInput = async () => {
    const context = advisorContext ?? (await loadContext());
    if (!context.ready)
      throw new Error("The selected evidence is not sufficient for analysis.");
    return { ...context.input, mode };
  };

  const previewPayload = async () => {
    setError(null);
    try {
      const input = await requestInput();
      const response = await fetch("/api/advisor", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const body = (await response.json()) as {
        preview?: Preview;
        error?: { message?: string };
      };
      if (!response.ok || !body.preview)
        throw new Error(body.error?.message ?? "Payload preview failed");
      setPreview(body.preview);
      setShowPayload(true);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Payload preview failed",
      );
    }
  };

  const start = async () => {
    setState("working");
    setError(null);
    try {
      const input = await requestInput();
      const response = await fetch("/api/advisor", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...input,
          submit: true,
          persist: Boolean(input.sourceDatabaseId),
        }),
      });
      const body = (await response.json()) as {
        preview?: Preview;
        analysis?: AiAnalysisResponse;
        metadata?: { model?: string; providerRequestId?: string | null };
        error?: { message?: string };
      };
      if (!response.ok || !body.analysis)
        throw new Error(body.error?.message ?? "Analysis failed");
      setPreview(body.preview ?? null);
      setAnalysis(body.analysis);
      setMetadata(body.metadata ?? null);
      setState("done");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Analysis failed");
      setState("ready");
    }
  };
  const selectedHistory = analyses.find(
    (saved) => saved.id === selectedHistoryId && saved.result,
  );
  return (
    <>
      <section className="card advisor-hero">
        <div>
          <h2 className="advisor-title">
            <Sparkles size={21} />
            Ask the advisor about your workload
          </h2>
          <p className="advisor-copy">
            Combine only the selected query, finding, saved plan, or catalog
            relation with verifiable workload history, relation statistics,
            indexes, and database settings. You see the exact sanitized payload
            before anything leaves your account.
          </p>
          <ContextSummary state={contextState} context={advisorContext} />
          <div className="mode-selector">
            <button
              className={`mode-card${mode === "balanced" ? " active" : ""}`}
              onClick={() => setMode("balanced")}
            >
              <strong>Balanced</strong>
              <span>Fast, focused recommendations · gpt-5.6-terra</span>
            </button>
            <button
              className={`mode-card${mode === "deep" ? " active" : ""}`}
              onClick={() => setMode("deep")}
            >
              <strong>Deep analysis</strong>
              <span>Broader hypothesis exploration · gpt-5.6-sol</span>
            </button>
          </div>
          <div
            style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}
          >
            <button
              className="button"
              onClick={() =>
                showPayload ? setShowPayload(false) : void previewPayload()
              }
            >
              <Eye />
              {showPayload ? "Hide" : "Preview"} payload
            </button>
            <button
              className="button primary"
              onClick={() => void start()}
              disabled={state === "working"}
            >
              {state === "working" ? <RotateCcw /> : <Send />}
              {state === "working" ? "Analyzing…" : "Analyze selected evidence"}
            </button>
          </div>
        </div>
        <div className="advisor-orb">
          <div className="orb">
            <Bot size={42} />
          </div>
        </div>
      </section>
      {error ? (
        <div
          className="privacy-note"
          style={{ marginTop: 12, color: "var(--rose)" }}
        >
          {error}
        </div>
      ) : null}
      {showPayload && preview ? <PayloadPreview preview={preview} /> : null}
      {state === "done" && analysis ? (
        <AnalysisResult analysis={analysis} metadata={metadata} />
      ) : null}
      <div className="content-grid advisor-history-grid">
        <div id="analysis-history">
          <Card>
            <CardHeader
              title="Analysis history"
              subtitle="Saved, structured responses"
              action={
                <Badge tone="violet">
                  {analyses.length}{" "}
                  {analyses.length === 1 ? "analysis" : "analyses"}
                </Badge>
              }
            />
            <CardBody>
              <div className="analysis-list">
                {analyses.map((saved) => (
                  <button
                    type="button"
                    className={`analysis-card severity-${saved.severity}`}
                    key={saved.id}
                    aria-expanded={selectedHistoryId === saved.id}
                    disabled={!saved.result}
                    onClick={() =>
                      setSelectedHistoryId((current) =>
                        current === saved.id ? null : saved.id,
                      )
                    }
                    style={{
                      width: "100%",
                      textAlign: "left",
                      cursor: saved.result ? "pointer" : "default",
                    }}
                  >
                    <div className="analysis-head">
                      <span className="severity-mark" />
                      <strong>{saved.title}</strong>
                      <span className="analysis-time">{saved.createdAt}</span>
                    </div>
                    <p className="analysis-summary">{saved.summary}</p>
                    <div className="analysis-meta">
                      <span>{saved.model}</span>
                      <span>{saved.confidence}% confidence</span>
                      <span>{saved.tokens.toLocaleString()} tokens</span>
                      <span>
                        {saved.result ? "Open details" : "Unavailable"}
                      </span>
                      <ChevronRight size={11} style={{ marginLeft: "auto" }} />
                    </div>
                  </button>
                ))}
                {analyses.length === 0 ? (
                  <div className="empty-state">
                    <div>
                      <h2>No saved analyses</h2>
                      <p>
                        Select real evidence and run the advisor to create the
                        first persisted analysis.
                      </p>
                    </div>
                  </div>
                ) : null}
              </div>
            </CardBody>
          </Card>
          {selectedHistory?.result ? (
            <AnalysisResult
              title="Saved analysis"
              analysis={selectedHistory.result}
              metadata={{
                model: selectedHistory.model,
                providerRequestId: selectedHistory.requestId,
              }}
            />
          ) : null}
        </div>
        <Card>
          <CardHeader title="Privacy controls" />
          <CardBody>
            <div className="analysis-list">
              <Privacy
                icon={<ShieldCheck />}
                title="Literals redacted"
                detail="Parameter values and comments are replaced by typed placeholders."
              />
              <Privacy
                icon={<LockKeyhole />}
                title="No result rows"
                detail="Only plans, statistics, schema metadata, and settings are included."
              />
              <Privacy
                icon={<Check />}
                title="Response storage off"
                detail="OpenAI requests are made with store: false."
              />
            </div>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function ContextSummary({
  state,
  context,
}: {
  state: "loading" | "ready" | "missing" | "error";
  context: AdvisorContext | null;
}) {
  if (state === "loading")
    return <div className="privacy-note">Assembling selected evidence…</div>;
  if (!context)
    return (
      <div className="privacy-note">
        Open the advisor with <span className="mono">queryId</span>,{" "}
        <span className="mono">findingId</span>, or{" "}
        <span className="mono">planId</span>, or catalog relation in the URL. No
        demo query or unrelated top statement will be substituted.
      </div>
    );
  return (
    <div className="privacy-note" data-testid="advisor-context-summary">
      <ShieldCheck />
      <span>
        <strong>
          {context.source.label} · {context.source.database}
        </strong>
        {" · "}
        {context.selection.queryId
          ? `query ${context.selection.queryId}`
          : context.selection.findingId
            ? `finding ${context.selection.findingId}`
            : context.selection.planId
              ? `plan ${context.selection.planId}`
              : `${context.selection.relation}${context.selection.index ? ` · index ${context.selection.index}` : ""}`}
        {" · "}
        {context.evidence.historySamples} history samples ·{" "}
        {context.evidence.tables.length} tables · {context.evidence.indexes}{" "}
        indexes · {context.evidence.settings} settings
        {context.evidence.planMatch
          ? ` · ${context.evidence.planMatch === "explicit" ? "selected" : "safely matched"} plan`
          : " · no matched plan"}
        {context.omissions.length > 0 ? (
          <span style={{ display: "block", marginTop: 4 }}>
            Omitted: {context.omissions.join(" ")}
          </span>
        ) : null}
      </span>
    </div>
  );
}

function Privacy({
  icon,
  title,
  detail,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <div style={{ display: "flex", gap: 10 }}>
      <span style={{ color: "var(--green)", marginTop: 1 }}>{icon}</span>
      <span>
        <strong style={{ display: "block", fontSize: 10 }}>{title}</strong>
        <span style={{ color: "var(--subtle)", fontSize: 9 }}>{detail}</span>
      </span>
    </div>
  );
}

function PayloadPreview({ preview }: { preview: Preview }) {
  return (
    <Card
      className="payload-preview"
      style={{ marginTop: 12 } as React.CSSProperties}
    >
      <CardHeader
        title="Payload preview"
        subtitle="Exactly what will be transmitted"
        action={
          <Badge tone={preview.bytes <= preview.limitBytes ? "green" : "rose"}>
            {(preview.bytes / 1024).toFixed(1)} kB ·{" "}
            {preview.canSubmit ? "ready" : "provider disabled"}
          </Badge>
        }
      />
      <pre className="payload-code">{preview.preview}</pre>
      <div className="payload-footer">
        <ShieldCheck
          size={12}
          color="var(--green)"
          style={{ marginRight: 6 }}
        />
        Literals redacted · 0 result rows · comments stripped
        {preview.truncated ? ` · omitted: ${preview.omissions.join(", ")}` : ""}
        <span style={{ marginLeft: "auto" }}>store: false</span>
      </div>
    </Card>
  );
}

function AnalysisResult({
  analysis,
  metadata,
  title = "Fresh analysis",
}: {
  analysis: AiAnalysisResponse;
  metadata: { model?: string; providerRequestId?: string | null } | null;
  title?: string;
}) {
  return (
    <Card
      style={
        {
          marginTop: 12,
          borderColor: "rgba(169,139,255,.25)",
        } as React.CSSProperties
      }
    >
      <CardHeader
        title={title}
        subtitle={`${metadata?.model ?? "configured model"} · ${metadata?.providerRequestId ?? "local response"}`}
        action={
          <Badge tone="violet">
            {Math.round(analysis.confidence * 100)}% confidence
          </Badge>
        }
      />
      <CardBody>
        <div style={{ display: "grid", gap: 14 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              gap: 12,
            }}
          >
            <span
              className="empty-state-icon"
              style={{
                margin: 0,
                color: "var(--violet)",
                background: "var(--violet-soft)",
              }}
            >
              <Sparkles />
            </span>
            <div>
              <strong style={{ fontSize: 13 }}>{analysis.summary}</strong>
              <p style={{ color: "var(--muted)", fontSize: 10 }}>
                {analysis.caveats.join(" ") ||
                  "Review the evidence and validate every recommendation in a non-production environment."}
              </p>
            </div>
          </div>
          <div>
            <strong className="card-subtitle">Evidence</strong>
            <div className="analysis-list" style={{ marginTop: 8 }}>
              {analysis.evidence.map((evidence, index) => (
                <div
                  className="privacy-note"
                  key={`${evidence.reference}:${index}`}
                >
                  <Check />
                  <span>
                    {evidence.claim}{" "}
                    <span className="mono">
                      [{evidence.source}: {evidence.reference}]
                    </span>
                  </span>
                </div>
              ))}
              {analysis.evidence.length === 0 ? (
                <div className="privacy-note">No evidence claims returned.</div>
              ) : null}
            </div>
          </div>
          <div>
            <strong className="card-subtitle">Recommendations</strong>
            <div className="analysis-list" style={{ marginTop: 8 }}>
              {analysis.recommendations.map((recommendation, index) => (
                <div
                  className="analysis-card"
                  key={`${recommendation.title}:${index}`}
                >
                  <div className="analysis-head">
                    <strong>{recommendation.title}</strong>
                    <Badge
                      tone={
                        recommendation.risk === "critical" ||
                        recommendation.risk === "high"
                          ? "rose"
                          : recommendation.risk === "medium"
                            ? "amber"
                            : "green"
                      }
                    >
                      {recommendation.risk} ·{" "}
                      {Math.round(recommendation.confidence * 100)}%
                    </Badge>
                  </div>
                  <p className="analysis-summary">{recommendation.rationale}</p>
                  <ol
                    style={{
                      color: "var(--muted)",
                      fontSize: 10,
                      paddingLeft: 18,
                    }}
                  >
                    {recommendation.validationSteps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                  {recommendation.migrationSql ? (
                    <div>
                      <div className="analysis-head" style={{ marginTop: 10 }}>
                        <Badge tone="amber">Review-only SQL</Badge>
                        <button
                          className="button"
                          onClick={() =>
                            void navigator.clipboard?.writeText(
                              recommendation.migrationSql ?? "",
                            )
                          }
                        >
                          Copy SQL
                        </button>
                      </div>
                      <pre className="payload-code">
                        {recommendation.migrationSql}
                      </pre>
                    </div>
                  ) : null}
                </div>
              ))}
              {analysis.recommendations.length === 0 ? (
                <div className="privacy-note">
                  No automated change is proposed.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
