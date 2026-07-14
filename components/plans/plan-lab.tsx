"use client";

import { lazy, Suspense, useState } from "react";
import {
  Braces,
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
import { Badge } from "@/components/ui/badge";
import { PlanTree } from "./plan-tree";

const LazySqlEditor = lazy(async () => ({
  default: (await import("./sql-editor")).SqlEditor,
}));

const initialSql =
  "SELECT o.id, o.total, c.email\nFROM orders o\nJOIN customers c ON c.id = o.customer_id\nWHERE o.store_id = $1 AND o.status = $2\nORDER BY o.created_at DESC\nLIMIT $3";

export function PlanLab({ plan }: { plan: PlanNode }) {
  const [sql, setSql] = useState(initialSql);
  const [view, setView] = useState<"tree" | "diff">("tree");
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState("Completed in 141 ms");

  const runExplain = () => {
    setStatus("Running safe EXPLAIN…");
    window.setTimeout(() => setStatus("Completed in 141 ms"), 450);
  };
  const runAnalyze = () => {
    setConfirming(false);
    setStatus("ANALYZE completed in read-only transaction · 141 ms");
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
                defaultValue="85b4…f229"
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
                defaultValue="paid"
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
                defaultValue="25"
              />
            </div>
          </div>
          <div
            className="editor-toolbar"
            style={{ borderTop: "1px solid var(--border)", borderBottom: 0 }}
          >
            <button className="button primary" onClick={runExplain}>
              <Play />
              Run EXPLAIN
            </button>
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

        <section className="card plan-panel">
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
                onClick={() => setView("diff")}
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
              aria-label="Export plan"
            >
              <Download />
            </button>
          </div>
          {view === "tree" ? <PlanTree root={plan} /> : <PlanDiff />}
          <div className="payload-footer">
            <Check size={12} color="var(--green)" style={{ marginRight: 6 }} />
            {status}
            <span style={{ marginLeft: "auto" }}>
              Plan run #run_0291 · JSON format
            </span>
          </div>
        </section>
      </div>
      <div className="content-grid equal">
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">Plan signals</h2>
            <Badge tone="rose">3 material</Badge>
          </div>
          <div className="card-body">
            <div className="analysis-list">
              <Signal
                tone="rose"
                title="Heap scan dominates I/O"
                detail="14,821 shared blocks read from public.orders account for 82% of plan I/O."
              />
              <Signal
                tone="amber"
                title="Row estimate is 4.5× low"
                detail="Cardinality error amplifies the nested-loop choice and understates sort cost."
              />
              <Signal
                tone="amber"
                title="Nested loop repeats 2,219 times"
                detail="The inner customer lookup is cheap per call but contributes 39.9 ms in aggregate."
              />
            </div>
          </div>
        </section>
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">What changed</h2>
            <span className="card-subtitle">vs plan #run_0284</span>
          </div>
          <div className="card-body">
            <div className="diff-grid" style={{ marginTop: 0 }}>
              <div className="diff-side">
                <Badge>Baseline · 2d ago</Badge>
                <div className="diff-metric">
                  <span>Execution</span>
                  <strong className="number">84.1 ms</strong>
                </div>
                <div className="diff-metric">
                  <span>Shared reads</span>
                  <strong className="number">7,892</strong>
                </div>
                <div className="diff-metric">
                  <span>Plan shape</span>
                  <strong>Index scan</strong>
                </div>
              </div>
              <div className="diff-side">
                <Badge tone="rose">Current</Badge>
                <div className="diff-metric">
                  <span>Execution</span>
                  <strong className="number delta-up">137.0 ms</strong>
                </div>
                <div className="diff-metric">
                  <span>Shared reads</span>
                  <strong className="number delta-up">14,821</strong>
                </div>
                <div className="diff-metric">
                  <span>Plan shape</span>
                  <strong>Bitmap heap</strong>
                </div>
              </div>
            </div>
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
                <button className="button danger" onClick={runAnalyze}>
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

function PlanDiff() {
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
        <select className="context-select">
          <option>#run_0284 · 2d ago</option>
        </select>
        <span style={{ color: "var(--subtle)" }}>→</span>
        <select className="context-select">
          <option>#run_0291 · current</option>
        </select>
        <button className="button" style={{ marginLeft: "auto" }}>
          <ChevronDown />
          Match nodes
        </button>
      </div>
      <div className="diff-grid">
        <div className="diff-side">
          <Badge>Baseline</Badge>
          <div className="diff-metric">
            <span>Root time</span>
            <strong className="number">84.1 ms</strong>
          </div>
          <div className="diff-metric">
            <span>Shared reads</span>
            <strong className="number">7,892</strong>
          </div>
          <div className="diff-metric">
            <span>Estimate error</span>
            <strong className="number">1.8×</strong>
          </div>
          <div className="diff-metric">
            <span>Critical node</span>
            <strong>Index Scan</strong>
          </div>
        </div>
        <div className="diff-side">
          <Badge tone="rose">Current · +63%</Badge>
          <div className="diff-metric">
            <span>Root time</span>
            <strong className="number delta-up">137.0 ms</strong>
          </div>
          <div className="diff-metric">
            <span>Shared reads</span>
            <strong className="number delta-up">14,821</strong>
          </div>
          <div className="diff-metric">
            <span>Estimate error</span>
            <strong className="number delta-up">4.5×</strong>
          </div>
          <div className="diff-metric">
            <span>Critical node</span>
            <strong>Bitmap Heap</strong>
          </div>
        </div>
      </div>
      <div className="privacy-note" style={{ marginTop: 11 }}>
        <Sparkles />
        Material change: public.orders moved from an index scan to a bitmap heap
        scan after selectivity shifted.
      </div>
    </div>
  );
}
