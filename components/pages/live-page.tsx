"use client";

import { useEffect, useState } from "react";
import { Copy, Pause, Play, RefreshCw } from "lucide-react";
import { demoRepository } from "@/lib/demo/data";
import type { Session } from "@/lib/demo/types";
import type { DataSourceState } from "@/lib/server/dashboard-data";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { MetricCard } from "@/components/ui/metric-card";
import { PageHeader } from "@/components/ui/page-header";
import { DataSourceBadge } from "@/components/ui/data-source-badge";

export function LivePage({
  initialSessions = demoRepository.sessions(),
  source = {
    mode: "unavailable",
    label: "Sample preview",
    detail: "No database data was supplied.",
  },
}: {
  initialSessions?: Session[];
  source?: DataSourceState;
}) {
  const [paused, setPaused] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [sessions, setSessions] = useState(initialSessions);
  useEffect(() => {
    if (paused) return;
    const interval = window.setInterval(() => {
      setSeconds((value) => {
        const next = (value + 1) % 5;
        if (next === 0 && source.mode === "live") {
          void fetch("/api/activity?limit=250", { cache: "no-store" })
            .then(
              async (response) =>
                (await response.json()) as {
                  sessions?: Array<Record<string, unknown>>;
                },
            )
            .then((body) => {
              if (!body.sessions) return;
              setSessions(
                body.sessions.map((row) => ({
                  pid: Number(row.processId),
                  database: initialSessions[0]?.database ?? "configured target",
                  user: String(row.userName ?? "system"),
                  application: String(
                    row.applicationName ?? row.backendType ?? "postgres",
                  ),
                  client: String(row.clientAddress ?? "local"),
                  state:
                    row.state === "active" ||
                    row.state === "idle in transaction"
                      ? row.state
                      : "idle",
                  wait: row.waitEvent
                    ? `${String(row.waitEventType ?? "Wait")} · ${String(row.waitEvent)}`
                    : "—",
                  duration: `${Math.floor(
                    Math.max(
                      Number(row.transactionAgeSeconds ?? 0),
                      Number(row.queryAgeSeconds ?? 0),
                    ) / 60,
                  )
                    .toString()
                    .padStart(2, "0")}:${Math.round(
                    Math.max(
                      Number(row.transactionAgeSeconds ?? 0),
                      Number(row.queryAgeSeconds ?? 0),
                    ) % 60,
                  )
                    .toString()
                    .padStart(2, "0")}`,
                  query: String(row.queryPreview ?? ""),
                  blockedBy: Array.isArray(row.blockingProcessIds)
                    ? Number(row.blockingProcessIds[0]) || undefined
                    : undefined,
                })),
              );
            })
            .catch(() => undefined);
        }
        return next;
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [initialSessions, paused, source.mode]);
  const active = sessions.filter((session) => session.state === "active");
  const waiting = sessions.filter((session) => session.wait !== "—");
  const blocked = sessions.filter((session) => session.blockedBy !== undefined);
  const blockedSession = blocked[0];
  const blockerSession = blockedSession
    ? sessions.find((session) => session.pid === blockedSession.blockedBy)
    : undefined;
  const oldest = [...sessions].sort((left, right) =>
    right.duration.localeCompare(left.duration),
  )[0];
  const metrics = [
    {
      label: "Active",
      value: String(active.length),
      detail: `of ${sessions.length} visible sessions`,
      trend: 0,
      tone: "cyan" as const,
      points: [24, 26, 25, 28, 31, 29, 33, 35, 32, 36, 34, 35],
    },
    {
      label: "Waiting",
      value: String(waiting.length),
      detail: `${waiting.filter((session) => session.wait.startsWith("Lock")).length} lock · ${waiting.filter((session) => session.wait.startsWith("IO")).length} I/O`,
      trend: 0,
      tone: "amber" as const,
      points: [10, 10, 14, 14, 18, 20, 24, 28, 32, 38, 44, 50],
    },
    {
      label: "Blocked",
      value: String(blocked.length),
      detail: blockedSession
        ? `Oldest ${blockedSession.duration}`
        : "No blocking edges",
      trend: 0,
      tone: "rose" as const,
      points: [0, 0, 0, 0, 0, 0, 10, 10, 10, 40, 50, 60],
    },
    {
      label: "Oldest transaction",
      value: oldest?.duration ?? "00:00",
      detail: oldest?.state ?? "No sessions",
      trend: 0,
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
            <DataSourceBadge source={source} />
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
            subtitle={`${blocked.length} edge${blocked.length === 1 ? "" : "s"} · ${sessions.length} sessions`}
            action={
              <Badge tone={blocked.length > 0 ? "rose" : "green"}>
                {blocked.length > 0 ? "Active incident" : "Clear"}
              </Badge>
            }
          />
          {blockedSession ? (
            <div
              className="blocking-graph"
              aria-label={`PID ${blockedSession.blockedBy} is blocking PID ${blockedSession.pid}`}
            >
              <span className="block-line" />
              <div className="session-node blocker">
                <Badge tone="amber">Blocker</Badge>
                <strong style={{ marginTop: 8 }}>
                  PID {blockedSession.blockedBy}
                </strong>
                <span>
                  {blockerSession?.user ?? "not visible"} ·{" "}
                  {blockerSession?.duration ?? "unknown"}
                </span>
                <span>{blockerSession?.state ?? "outside current result"}</span>
              </div>
              <div className="session-node blocked">
                <Badge tone="rose">Blocked</Badge>
                <strong style={{ marginTop: 8 }}>
                  PID {blockedSession.pid}
                </strong>
                <span>
                  {blockedSession.user} · {blockedSession.duration}
                </span>
                <span>{blockedSession.wait}</span>
              </div>
            </div>
          ) : (
            <div className="empty-state">
              <div>
                <h2>No blocking chain</h2>
                <p>pg_blocking_pids() reports no current blockers.</p>
              </div>
            </div>
          )}
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
                  <strong>
                    {blockedSession
                      ? `PID ${blockedSession.blockedBy} is holding a lock`
                      : "No lock incident is active"}
                  </strong>
                </div>
                <p className="analysis-summary">
                  {blockedSession
                    ? `The visible evidence shows PID ${blockedSession.pid} waiting on PID ${blockedSession.blockedBy}. Inspect application ownership and transaction state before acting.`
                    : "The current bounded activity snapshot contains no blocking edge."}
                </p>
                <div className="analysis-meta">
                  <span>blocked age {blockedSession?.duration ?? "—"}</span>
                  <span>client {blockerSession?.client ?? "—"}</span>
                </div>
              </div>
              <div className="privacy-note">
                <RefreshCw />
                No cancel or terminate controls are exposed. Validate
                application ownership before acting outside this tool.
              </div>
              <button
                className="button"
                style={{ marginTop: 10 }}
                onClick={() =>
                  void navigator.clipboard?.writeText(
                    "SELECT pid, usename, state, wait_event_type, wait_event, pg_blocking_pids(pid) AS blocked_by, query FROM pg_stat_activity WHERE datid = (SELECT oid FROM pg_database WHERE datname = current_database());",
                  )
                }
              >
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
          {sessions.length} bounded sessions · sampled just now
        </div>
      </section>
    </div>
  );
}
