"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
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
  { href: "/findings", label: "Findings", icon: FileWarning, count: 7 },
];

export function AppShell({ children }: { children: ReactNode }) {
  const [pathname, setPathname] = useState("/");
  const [menuOpen, setMenuOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);

  useEffect(() => {
    setPathname(window.location.pathname);
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((open) => !open);
      }
      if (event.key === "Escape") {
        setCommandOpen(false);
        setMenuOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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
        <a className="brand" href="/">
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
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                  >
                    <Icon aria-hidden="true" />
                    {item.label}
                    {item.count ? (
                      <span
                        className="nav-count"
                        aria-label={`${item.count} open`}
                      >
                        {item.count}
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
              <span className="status-dot" /> Hyperdrive connected
            </div>
            <div className="connection-meta">
              iad1 · PostgreSQL 17.4
              <br />
              last sample 4m 12s ago
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
            <select className="context-select" aria-label="Target">
              <option>PlanetScale · prod</option>
              <option>Local development</option>
            </select>
            <select className="context-select" aria-label="Database">
              <option>commerce_prod</option>
              <option>analytics</option>
              <option>postgres</option>
            </select>
            <select className="context-select compact" aria-label="Schema">
              <option>All schemas</option>
              <option>public</option>
              <option>catalog</option>
              <option>audit</option>
            </select>
          </div>
          <span className="topbar-divider" />
          <span className="freshness">
            <span className="status-dot" /> Fresh · 4m ago
          </span>
          <div className="topbar-actions">
            <button
              className="command-trigger"
              onClick={() => setCommandOpen(true)}
              aria-label="Open command menu"
            >
              <Search size={14} aria-hidden="true" />
              <span>Search anything…</span>
              <kbd>⌘ K</kbd>
            </button>
            <button className="icon-button" aria-label="Notifications">
              <Bell />
            </button>
          </div>
        </header>
        {children}
      </main>

      {commandOpen ? (
        <div
          className="command-backdrop"
          role="presentation"
          onMouseDown={() => setCommandOpen(false)}
        >
          <div
            className="command-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Command menu"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="command-input-wrap">
              <Search size={17} aria-hidden="true" />
              <input
                autoFocus
                aria-label="Search commands"
                placeholder="Jump to a query, table, finding, or action…"
              />
              <button
                className="icon-button"
                onClick={() => setCommandOpen(false)}
                aria-label="Close command menu"
              >
                <X />
              </button>
            </div>
            <div className="command-results">
              <a
                className="command-result"
                href="/queries"
                onClick={() => setCommandOpen(false)}
              >
                <Braces /> Search query workload
              </a>
              <a
                className="command-result"
                href="/plans"
                onClick={() => setCommandOpen(false)}
              >
                <Command /> Open EXPLAIN Lab
              </a>
              <a
                className="command-result"
                href="/advisor"
                onClick={() => setCommandOpen(false)}
              >
                <Bot /> Start AI analysis
              </a>
              <a
                className="command-result"
                href="/indexes"
                onClick={() => setCommandOpen(false)}
              >
                <TableProperties /> Inspect index inventory
              </a>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
