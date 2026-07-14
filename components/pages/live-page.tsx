"use client";

import { useEffect, useState } from "react";
import { Copy, Pause, Play, RefreshCw } from "lucide-react";
import { demoRepository } from "@/lib/demo/data";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { MetricCard } from "@/components/ui/metric-card";
import { PageHeader } from "@/components/ui/page-header";

export function LivePage() {
  const [paused, setPaused] = useState(false);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (paused) return;
    const interval = window.setInterval(
      () => setSeconds((value) => (value + 1) % 5),
      1000,
    );
    return () => window.clearInterval(interval);
  }, [paused]);
  const sessions = demoRepository.sessions();
  const metrics = [
    {
      label: "Active",
      value: "34",
      detail: "of 120 connections",
      trend: 8.1,
      tone: "cyan" as const,
      points: [24, 26, 25, 28, 31, 29, 33, 35, 32, 36, 34, 35],
    },
    {
      label: "Waiting",
      value: "4",
      detail: "2 lock · 2 I/O",
      trend: 33.3,
      tone: "amber" as const,
      points: [10, 10, 14, 14, 18, 20, 24, 28, 32, 38, 44, 50],
    },
    {
      label: "Blocked",
      value: "2",
      detail: "Oldest 3m 42s",
      trend: 100,
      tone: "rose" as const,
      points: [0, 0, 0, 0, 0, 0, 10, 10, 10, 40, 50, 60],
    },
    {
      label: "Oldest transaction",
      value: "8m 17s",
      detail: "idle in transaction",
      trend: 4.8,
      tone: "violet" as const,
      points: [35, 38, 41, 44, 47, 50, 53, 56, 59, 62, 65, 68],
    },
  ];
  return (
    <div className="page">
      <PageHeader
        eyebrow="Real-time database activity"
        title="Live activity"
        description="See sessions, waits, long transactions, and blocking relationships. This view is intentionally observation-only."
        actions={
          <>
            <span className="button" style={{ cursor: "default" }}>
              <span className="live-pulse" />
              {paused ? "Paused" : `Refresh in ${5 - seconds}s`}
            </span>
            <button
              className="button primary"
              onClick={() => setPaused((value) => !value)}
            >
              {paused ? <Play /> : <Pause />}
              {paused ? "Resume" : "Pause"}
            </button>
          </>
        }
      />
      <div className="metric-grid" style={{ marginBottom: 12 }}>
        {metrics.map((metric) => (
          <MetricCard metric={metric} key={metric.label} />
        ))}
      </div>
      <div className="content-grid equal">
        <Card>
          <CardHeader
            title="Blocking graph"
            subtitle="1 chain · 2 sessions"
            action={<Badge tone="rose">Active incident</Badge>}
          />
          <div
            className="blocking-graph"
            aria-label="PID 20391 is blocking PID 20418"
          >
            <span className="block-line" />
            <div className="session-node blocker">
              <Badge tone="amber">Blocker</Badge>
              <strong style={{ marginTop: 8 }}>PID 20391</strong>
              <span>app_writer · 08:17</span>
              <span>idle in transaction</span>
            </div>
            <div className="session-node blocked">
              <Badge tone="rose">Blocked</Badge>
              <strong style={{ marginTop: 8 }}>PID 20418</strong>
              <span>reporting · 03:42</span>
              <span>transactionid lock</span>
            </div>
          </div>
        </Card>
        <Card>
          <CardHeader
            title="Incident guidance"
            subtitle="Evidence from pg_locks"
          />
          <CardBody>
            <div className="analysis-list">
              <div className="analysis-card severity-critical">
                <div className="analysis-head">
                  <span className="severity-mark" />
                  <strong>Checkout transaction is holding the lock</strong>
                </div>
                <p className="analysis-summary">
                  PID 20391 has been idle in a transaction for 8m 17s after
                  updating orders. It blocks reporting PID 20418.
                </p>
                <div className="analysis-meta">
                  <span>transaction age 08:17</span>
                  <span>client 10.0.2.14</span>
                </div>
              </div>
              <div className="privacy-note">
                <RefreshCw />
                No cancel or terminate controls are exposed. Validate
                application ownership before acting outside this tool.
              </div>
              <button className="button" style={{ marginTop: 10 }}>
                <Copy />
                Copy diagnostic SQL
              </button>
            </div>
          </CardBody>
        </Card>
      </div>
      <section className="card data-card" style={{ marginTop: 12 }}>
        <div className="card-header">
          <h2 className="card-title">Sessions</h2>
          <span className="card-subtitle">
            Filtered to active, waiting, and long transactions
          </span>
          <div className="card-header-action">
            <Badge tone={paused ? "amber" : "green"}>
              {paused ? "Paused" : "Live"}
            </Badge>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>PID</th>
                <th>State</th>
                <th>Duration</th>
                <th>User / app</th>
                <th>Wait event</th>
                <th>Query</th>
                <th>Client</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr key={session.pid}>
                  <td className="number">{session.pid}</td>
                  <td>
                    <Badge
                      tone={
                        session.state === "idle in transaction"
                          ? "rose"
                          : session.state === "active"
                            ? "green"
                            : ""
                      }
                    >
                      {session.state}
                    </Badge>
                  </td>
                  <td
                    className={`number ${session.duration > "03:00" ? "delta-up" : ""}`}
                  >
                    {session.duration}
                  </td>
                  <td>
                    <span className="table-primary">{session.user}</span>
                    <span className="query-id">{session.application}</span>
                  </td>
                  <td>
                    <span
                      style={{
                        color: session.wait.startsWith("Lock")
                          ? "var(--rose)"
                          : "var(--muted)",
                      }}
                    >
                      {session.wait}
                    </span>
                  </td>
                  <td className="query-cell">
                    <span className="query-snippet">{session.query}</span>
                    {session.blockedBy ? (
                      <span className="query-id delta-up">
                        blocked by PID {session.blockedBy}
                      </span>
                    ) : null}
                  </td>
                  <td className="mono">{session.client}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-footer">
          5 shown · 120 total connections · sampled just now
        </div>
      </section>
    </div>
  );
}
