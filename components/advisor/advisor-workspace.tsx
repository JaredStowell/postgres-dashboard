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
import { analyses, plan, queries } from "@/lib/demo/data";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";

const payload = {
  query: queries[0]!.query,
  parameters: {
    $1: "[REDACTED_UUID]",
    $2: "[REDACTED_TEXT]",
    $3: "[REDACTED_INT]",
  },
  plan: {
    node: plan.name,
    actual_time_ms: plan.time,
    children: ["Sort", "Nested Loop", "Bitmap Heap Scan", "Index Scan"],
  },
  relations: [
    {
      name: "public.orders",
      rows_estimate: 42420918,
      total_size: "31.4 GB",
      indexes: ["orders_store_status_created_idx", "orders_customer_id_idx"],
    },
    {
      name: "public.customers",
      rows_estimate: 12800921,
      total_size: "11.2 GB",
      indexes: ["customers_pkey"],
    },
  ],
  settings: {
    random_page_cost: "1.1",
    effective_cache_size: "24GB",
    work_mem: "16MB",
  },
};

export function AdvisorWorkspace() {
  const [mode, setMode] = useState<"balanced" | "deep">("balanced");
  const [showPayload, setShowPayload] = useState(false);
  const [state, setState] = useState<"ready" | "working" | "done">("ready");
  const start = () => {
    setState("working");
    window.setTimeout(() => setState("done"), 700);
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
              onClick={() => setShowPayload((value) => !value)}
            >
              <Eye />
              {showPayload ? "Hide" : "Preview"} payload
            </button>
            <button
              className="button primary"
              onClick={start}
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
      {showPayload ? <PayloadPreview /> : null}
      {state === "done" ? <AnalysisResult /> : null}
      <div
        className="content-grid"
        style={{ gridTemplateColumns: "minmax(0,1fr) minmax(330px,.55fr)" }}
      >
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
                    <span className="analysis-time">{analysis.createdAt}</span>
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

function PayloadPreview() {
  return (
    <Card
      className="payload-preview"
      style={{ marginTop: 12 } as React.CSSProperties}
    >
      <CardHeader
        title="Payload preview"
        subtitle="Exactly what will be transmitted"
        action={<Badge tone="green">18.7 kB · within limit</Badge>}
      />
      <pre className="payload-code">{JSON.stringify(payload, null, 2)}</pre>
      <div className="payload-footer">
        <ShieldCheck
          size={12}
          color="var(--green)"
          style={{ marginRight: 6 }}
        />
        3 literals redacted · 0 result rows · comments stripped
        <span style={{ marginLeft: "auto" }}>store: false</span>
      </div>
    </Card>
  );
}

function AnalysisResult() {
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
        subtitle="gpt-5.6-terra · req_7f92…1c11"
        action={<Badge tone="violet">94% confidence</Badge>}
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
            <strong style={{ fontSize: 13 }}>
              The workload shift invalidated the planner’s selectivity
              assumption
            </strong>
            <p style={{ color: "var(--muted)", fontSize: 10 }}>
              The current composite index matches the predicate and sort, but
              status skew has grown enough that PostgreSQL underestimates result
              rows by 4.5×. Refresh extended statistics first; only then
              evaluate the covering index candidate.
            </p>
            <div className="privacy-note">
              <Check />
              Validation order: ANALYZE table → create dependency statistics →
              capture a new plan → compare shared reads → review covering index.
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
