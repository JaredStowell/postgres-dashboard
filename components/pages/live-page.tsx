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
  sourceKey,
  source = {
    mode: "unavailable",
    label: "Sample preview",
    detail: "No database data was supplied.",
  },
}: {
  initialSessions?: Session[];
  source?: DataSourceState;
  sourceKey?: string;
}) {
  const [paused, setPaused] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [sessions, setSessions] = useState(initialSessions);
  const [stateFilter, setStateFilter] = useState("all");
  const [userFilter, setUserFilter] = useState("");
  const [waitFilter, setWaitFilter] = useState("all");
  const [minimumAge, setMinimumAge] = useState(0);
  useEffect(() => {
    if (paused) return;
    let requestInFlight = false;
    const interval = window.setInterval(() => {
      setSeconds((value) => {
        const next = (value + 1) % 5;
        if (next === 0 && source.mode === "live" && !requestInFlight) {
          requestInFlight = true;
          const parameters = new URLSearchParams({ limit: "250" });
          if (sourceKey) parameters.set("source", sourceKey);
          void fetch(`/api/activity?${parameters}`, { cache: "no-store" })
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
                  ageSeconds: Math.max(
                    Number(row.transactionAgeSeconds ?? 0),
                    Number(row.queryAgeSeconds ?? 0),
                  ),
                  blockingPids: Array.isArray(row.blockingProcessIds)
                    ? row.blockingProcessIds.map(Number).filter(Number.isFinite)
                    : [],
                  blockedBy: Array.isArray(row.blockingProcessIds)
                    ? Number(row.blockingProcessIds[0]) || undefined
                    : undefined,
                })),
              );
            })
            .catch(() => undefined)
            .finally(() => {
              requestInFlight = false;
            });
        }
        return next;
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [initialSessions, paused, source.mode, sourceKey]);
  const visibleSessions = sessions.filter(
    (session) =>
      (stateFilter === "all" || session.state === stateFilter) &&
      (!userFilter ||
        `${session.user} ${session.application}`
          .toLowerCase()
          .includes(userFilter.toLowerCase())) &&
      (waitFilter === "all" ||
        (waitFilter === "waiting"
          ? session.wait !== "—"
          : session.wait === "—")) &&
      (session.ageSeconds ?? 0) >= minimumAge,
  );
  const active = sessions.filter((session) => session.state === "active");
  const waiting = sessions.filter((session) => session.wait !== "—");
  const blocked = sessions.filter((session) => session.blockedBy !== undefined);
  const blockedSession = blocked[0];
  const blockingEdges = sessions.flatMap((session) =>
    (
      session.blockingPids ?? (session.blockedBy ? [session.blockedBy] : [])
    ).map((blocker) => ({ blocker, blocked: session.pid, session })),
  );
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
      points: [],
    },
    {
      label: "Waiting",
      value: String(waiting.length),
      detail: `${waiting.filter((session) => session.wait.startsWith("Lock")).length} lock · ${waiting.filter((session) => session.wait.startsWith("IO")).length} I/O`,
      trend: 0,
      tone: "amber" as const,
      points: [],
    },
    {
      label: "Blocked",
      value: String(blocked.length),
      detail: blockedSession
        ? `Oldest ${blockedSession.duration}`
        : "No blocking edges",
      trend: 0,
      tone: "rose" as const,
      points: [],
    },
    {
      label: "Oldest transaction",
      value: oldest?.duration ?? "00:00",
      detail: oldest?.state ?? "No sessions",
      trend: 0,
      tone: "violet" as const,
      points: [],
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
            subtitle={`${blockingEdges.length} edge${blockingEdges.length === 1 ? "" : "s"} · ${sessions.length} sessions`}
            action={
              <Badge tone={blocked.length > 0 ? "rose" : "green"}>
                {blocked.length > 0 ? "Active incident" : "Clear"}
              </Badge>
            }
          />
          {blockingEdges.length > 0 ? (
            <div className="analysis-list" style={{ padding: 12 }}>
              {blockingEdges.map((edge) => (
                <div
                  className="privacy-note"
                  aria-label={`PID ${edge.blocker} is blocking PID ${edge.blocked}`}
                  key={`${edge.blocker}:${edge.blocked}`}
                >
                  <Badge tone="amber">PID {edge.blocker}</Badge>
                  <span>blocks</span>
                  <Badge tone="rose">PID {edge.blocked}</Badge>
                  <span style={{ marginLeft: "auto" }}>
                    {edge.session.wait}
                  </span>
                </div>
              ))}
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
            subtitle="Evidence from pg_blocking_pids()"
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
        <div className="toolbar">
          <select
            className="context-select"
            aria-label="Filter session state"
            value={stateFilter}
            onChange={(event) => setStateFilter(event.target.value)}
          >
            <option value="all">All states</option>
            <option value="active">Active</option>
            <option value="idle">Idle</option>
            <option value="idle in transaction">Idle in transaction</option>
          </select>
          <input
            className="input"
            aria-label="Filter session user or application"
            placeholder="User or application…"
            value={userFilter}
            onChange={(event) => setUserFilter(event.target.value)}
          />
          <select
            className="context-select"
            aria-label="Filter wait state"
            value={waitFilter}
            onChange={(event) => setWaitFilter(event.target.value)}
          >
            <option value="all">All waits</option>
            <option value="waiting">Waiting</option>
            <option value="not-waiting">Not waiting</option>
          </select>
          <input
            className="input"
            type="number"
            min="0"
            max="86400"
            aria-label="Minimum session age seconds"
            value={minimumAge}
            onChange={(event) => setMinimumAge(Number(event.target.value) || 0)}
          />
        </div>
        <div
          className="table-scroll"
          tabIndex={0}
          aria-label="Live sessions table, horizontally scrollable"
        >
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
              {visibleSessions.map((session) => (
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
