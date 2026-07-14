"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import {
  Activity,
  Bell,
  Bot,
  Braces,
  ChartNoAxesCombined,
  CircleGauge,
  Command,
  Database,
  FileWarning,
  Hammer,
  Layers3,
  Menu,
  Search,
  Sparkles,
  TableProperties,
  X,
} from "lucide-react";

const navigation = [
  { href: "/", label: "Fleet", icon: CircleGauge },
  { href: "/queries", label: "Queries", icon: Braces },
  { href: "/plans", label: "EXPLAIN Lab", icon: ChartNoAxesCombined },
  { href: "/indexes", label: "Indexes", icon: Layers3 },
  { href: "/maintenance", label: "Maintenance", icon: Hammer },
  { href: "/live", label: "Live activity", icon: Activity },
  { href: "/advisor", label: "AI Advisor", icon: Sparkles },
  { href: "/findings", label: "Findings", icon: FileWarning },
];

interface SourceOption {
  key: string;
  label: string;
  database: string;
  schemas: string[];
  serverVersion: number | null;
  available: boolean;
  collectionStatus: string;
  collectedAt: string | null;
}

function contextHref(href: string, source: string, schema: string): string {
  const params = new URLSearchParams();
  if (source) params.set("source", source);
  if (schema) params.set("schema", schema);
  const query = params.toString();
  return query ? `${href}?${query}` : href;
}

function postgresVersion(version: number | null | undefined): string {
  if (!version) return "?";
  const major = Math.floor(version / 10_000);
  const release = version % 10_000;
  return `${major}.${release}`;
}

export function AppShell({ children }: { children: ReactNode }) {
  const [pathname, setPathname] = useState("/");
  const [menuOpen, setMenuOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandSearch, setCommandSearch] = useState("");
  const [sources, setSources] = useState<SourceOption[]>([]);
  const [selectedSource, setSelectedSource] = useState("");
  const [selectedSchema, setSelectedSchema] = useState("");
  const [openFindings, setOpenFindings] = useState<number | null>(null);
  const commandTrigger = useRef<HTMLButtonElement>(null);
  const closeCommand = () => {
    setCommandOpen(false);
    setCommandSearch("");
    window.setTimeout(() => commandTrigger.current?.focus(), 0);
  };

  useEffect(() => {
    setPathname(window.location.pathname);
    const parameters = new URLSearchParams(window.location.search);
    setSelectedSource(parameters.get("source") ?? "");
    setSelectedSchema(parameters.get("schema") ?? "");
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((open) => !open);
      }
      if (event.key === "Escape") {
        closeCommand();
        setMenuOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!selectedSource || typeof fetch !== "function") return;
    let active = true;
    const query = `?source=${encodeURIComponent(selectedSource)}`;
    void fetch(`/api/health${query}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as { sourceDatabaseId?: number | null };
      })
      .then(async (health) => {
        if (!health?.sourceDatabaseId) return null;
        const parameters = new URLSearchParams({
          status: "open",
          limit: "250",
          sourceDatabaseId: String(health.sourceDatabaseId),
        });
        const response = await fetch(`/api/findings?${parameters}`, {
          cache: "no-store",
        });
        if (!response.ok) return null;
        return (await response.json()) as { findings?: unknown[] };
      })
      .then((body) => {
        if (active) setOpenFindings(body?.findings?.length ?? null);
      })
      .catch(() => {
        if (active) setOpenFindings(null);
      });
    return () => {
      active = false;
    };
  }, [selectedSource]);

  useEffect(() => {
    if (typeof fetch !== "function") return;
    let active = true;
    void fetch("/api/sources", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("source discovery failed");
        return (await response.json()) as {
          sources: SourceOption[];
        };
      })
      .then((body) => {
        if (!active) return;
        setSources(body.sources);
        setSelectedSource((current) => current || body.sources[0]?.key || "");
      })
      .catch(() => {
        if (active) setSources([]);
      });
    return () => {
      active = false;
    };
  }, []);

  const selected =
    sources.find((source) => source.key === selectedSource) ?? sources[0];
  const navigateContext = (source: string, schema: string) => {
    window.location.assign(contextHref(pathname, source, schema));
  };
  const commandItems = [
    { href: "/queries", label: "Search query workload", icon: Braces },
    { href: "/plans", label: "Open EXPLAIN Lab", icon: Command },
    { href: "/advisor", label: "Start AI analysis", icon: Bot },
    {
      href: "/indexes",
      label: "Inspect index inventory",
      icon: TableProperties,
    },
    { href: "/maintenance", label: "Review vacuum maintenance", icon: Hammer },
    { href: "/findings", label: "Review open findings", icon: FileWarning },
  ].filter((item) =>
    item.label.toLowerCase().includes(commandSearch.trim().toLowerCase()),
  );
  const collectionAge = selected?.collectedAt
    ? Math.max(
        0,
        Math.round(
          (Date.now() - new Date(selected.collectedAt).getTime()) / 60_000,
        ),
      )
    : null;
  const freshness =
    selected?.collectionStatus === "failed"
      ? "Latest collection failed"
      : collectionAge == null
        ? "Not collected yet"
        : `${collectionAge > 15 ? "Stale" : "Collected"} · ${collectionAge}m ago`;

  useEffect(() => setMenuOpen(false), [pathname]);

  return (
    <div className="app-frame">
      {menuOpen ? (
        <button
          className="mobile-backdrop"
          aria-label="Close navigation"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}
      <aside
        className={`sidebar${menuOpen ? " open" : ""}`}
        aria-label="Primary navigation"
      >
        <a
          className="brand"
          href={contextHref("/", selectedSource, selectedSchema)}
        >
          <span className="brand-mark">
            <Database size={16} aria-hidden="true" />
          </span>
          <span className="brand-copy">
            Index Analyzer<small>Postgres intelligence</small>
          </span>
        </a>
        <nav className="nav-section" aria-label="Primary navigation">
          <span className="nav-label">Workspace</span>
          <ul className="nav-list">
            {navigation.map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <a
                    className={`nav-link${active ? " active" : ""}`}
                    href={contextHref(
                      item.href,
                      selectedSource,
                      selectedSchema,
                    )}
                    aria-current={active ? "page" : undefined}
                  >
                    <Icon aria-hidden="true" />
                    {item.label}
                    {item.href === "/findings" && openFindings !== null ? (
                      <span
                        className="nav-count"
                        aria-label={`${openFindings} open`}
                      >
                        {openFindings}
                      </span>
                    ) : null}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="sidebar-footer">
          <div className="connection-card">
            <div className="connection-title">
              <span className="status-dot" />
              {selected?.available
                ? " Database connected"
                : " Target unavailable"}
            </div>
            <div className="connection-meta">
              {selected
                ? `${selected.label} · PostgreSQL ${postgresVersion(selected.serverVersion)}`
                : "Waiting for target discovery"}
              <br /> {freshness}
            </div>
          </div>
        </div>
      </aside>

      <main className="app-main">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            onClick={() => setMenuOpen(true)}
            aria-label="Open navigation"
          >
            <Menu />
          </button>
          <div className="context-selectors" aria-label="Database context">
            <select
              className="context-select"
              aria-label="Target"
              value={selectedSource}
              onChange={(event) => navigateContext(event.target.value, "")}
            >
              {sources.length === 0 ? (
                <option value="">Configured target</option>
              ) : null}
              {sources.map((source) => (
                <option key={source.key} value={source.key}>
                  {source.label}
                </option>
              ))}
            </select>
            <select className="context-select" aria-label="Database" disabled>
              <option>{selected?.database ?? "Configured database"}</option>
            </select>
            <select
              className="context-select compact"
              aria-label="Schema"
              value={selectedSchema}
              onChange={(event) =>
                navigateContext(selectedSource, event.target.value)
              }
            >
              <option value="">All schemas</option>
              {selected?.schemas.map((schema) => (
                <option key={schema} value={schema}>
                  {schema}
                </option>
              ))}
            </select>
          </div>
          <span className="topbar-divider" />
          <span className="freshness">
            <span className="status-dot" /> {freshness}
          </span>
          <div className="topbar-actions">
            <button
              ref={commandTrigger}
              className="command-trigger"
              onClick={() => {
                setCommandSearch("");
                setCommandOpen(true);
              }}
              aria-label="Open command menu"
            >
              <Search size={14} aria-hidden="true" />
              <span>Jump to workspace…</span>
              <kbd>⌘ K</kbd>
            </button>
            <a
              className="icon-button"
              aria-label="Open findings"
              href={contextHref("/findings", selectedSource, selectedSchema)}
            >
              <Bell />
            </a>
          </div>
        </header>
        {children}
      </main>

      {commandOpen ? (
        <div
          className="command-backdrop"
          role="presentation"
          onMouseDown={closeCommand}
        >
          <div
            className="command-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Command menu"
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key !== "Tab") return;
              const focusable = Array.from(
                event.currentTarget.querySelectorAll<HTMLElement>(
                  "a[href], button:not([disabled]), input:not([disabled])",
                ),
              );
              const first = focusable[0];
              const last = focusable.at(-1);
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
              }
            }}
          >
            <div className="command-input-wrap">
              <Search size={17} aria-hidden="true" />
              <input
                autoFocus
                aria-label="Search commands"
                placeholder="Filter workspaces and actions…"
                value={commandSearch}
                onChange={(event) => setCommandSearch(event.target.value)}
              />
              <button
                className="icon-button"
                onClick={closeCommand}
                aria-label="Close command menu"
              >
                <X />
              </button>
            </div>
            <div className="command-results">
              {commandItems.map((item) => {
                const Icon = item.icon;
                return (
                  <a
                    className="command-result"
                    href={contextHref(
                      item.href,
                      selectedSource,
                      selectedSchema,
                    )}
                    onClick={closeCommand}
                    key={item.href}
                  >
                    <Icon /> {item.label}
                  </a>
                );
              })}
              {commandItems.length === 0 ? (
                <div className="privacy-note" role="status">
                  No matching workspace or action.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
