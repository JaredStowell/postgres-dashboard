"use client";

import { useState } from "react";
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
import { analyses as demoAnalyses, queries } from "@/lib/demo/data";
import type { AiAnalysisResponse } from "@/lib/ai/schema";
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

export function AdvisorWorkspace({
  analyses = demoAnalyses,
}: {
  analyses?: Analysis[];
}) {
  const [mode, setMode] = useState<"balanced" | "deep">("balanced");
  const [showPayload, setShowPayload] = useState(false);
  const [state, setState] = useState<"ready" | "working" | "done">("ready");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [analysis, setAnalysis] = useState<AiAnalysisResponse | null>(null);
  const [metadata, setMetadata] = useState<{
    model?: string;
    providerRequestId?: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const requestInput = async () => {
    const [queryResponse, indexResponse, healthResponse] = await Promise.all([
      fetch("/api/queries?limit=1", { cache: "no-store" }),
      fetch("/api/indexes?limit=100", { cache: "no-store" }),
      fetch("/api/health", { cache: "no-store" }),
    ]);
    const queryBody = (await queryResponse.json()) as {
      queries?: Array<Record<string, unknown>>;
    };
    const indexBody = (await indexResponse.json()) as {
      indexes?: Array<Record<string, unknown>>;
    };
    const healthBody = (await healthResponse.json()) as {
      database?: string;
      sourceDatabaseId?: number | null;
      capabilities?: { settings?: Record<string, string | null> };
    };
    const query = queryBody.queries?.[0];
    return {
      query: typeof query?.query === "string" ? query.query : queries[0]!.query,
      indexes: (indexBody.indexes ?? []).map((index) => ({
        schema: String(index.schema ?? "public"),
        table: String(index.table ?? "unknown"),
        name: String(index.name ?? "unknown"),
        definition: String(index.definition ?? ""),
        scans: Number(index.scans ?? 0),
        sizeBytes: Number(index.sizeBytes ?? 0),
      })),
      settings: healthBody.capabilities?.settings ?? {},
      context: {
        database: healthBody.database,
        sourceLabel: "selected target",
      },
      sourceDatabaseId: healthBody.sourceDatabaseId ?? undefined,
      mode,
    };
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
  return (
    <>
      <section className="card advisor-hero">
        <div>
          <h2 className="advisor-title">
            <Sparkles size={21} />
            Ask the advisor about your workload
          </h2>
          <p className="advisor-copy">
            Combine query history, the saved plan, relation statistics, indexes,
            and database settings into a structured analysis. You see the exact
            sanitized payload before anything leaves your account.
          </p>
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
              {state === "working" ? "Analyzing…" : "Analyze checkout query"}
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
      <div
        className="content-grid"
        style={{ gridTemplateColumns: "minmax(0,1fr) minmax(330px,.55fr)" }}
      >
        <div id="analysis-history">
          <Card>
            <CardHeader
              title="Analysis history"
              subtitle="Saved, structured responses"
              action={<Badge tone="violet">3 analyses</Badge>}
            />
            <CardBody>
              <div className="analysis-list">
                {analyses.map((analysis) => (
                  <div
                    className={`analysis-card severity-${analysis.severity}`}
                    key={analysis.id}
                  >
                    <div className="analysis-head">
                      <span className="severity-mark" />
                      <strong>{analysis.title}</strong>
                      <span className="analysis-time">
                        {analysis.createdAt}
                      </span>
                    </div>
                    <p className="analysis-summary">{analysis.summary}</p>
                    <div className="analysis-meta">
                      <span>{analysis.model}</span>
                      <span>{analysis.confidence}% confidence</span>
                      <span>{analysis.tokens.toLocaleString()} tokens</span>
                      <ChevronRight size={11} style={{ marginLeft: "auto" }} />
                    </div>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
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
}: {
  analysis: AiAnalysisResponse;
  metadata: { model?: string; providerRequestId?: string | null } | null;
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
        title="Fresh analysis"
        subtitle={`${metadata?.model ?? "configured model"} · ${metadata?.providerRequestId ?? "local response"}`}
        action={
          <Badge tone="violet">
            {Math.round(analysis.confidence * 100)}% confidence
          </Badge>
        }
      />
      <CardBody>
        <div
          style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 12 }}
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
            <div className="privacy-note">
              <Check />
              {analysis.recommendations[0]?.validationSteps.join(" → ") ??
                "No automated change is proposed."}
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
