import { CircleOff, CloudOff } from "lucide-react";

export function EmptyState({
  title = "Nothing to show",
  detail = "No records match the current context and filters.",
}: {
  title?: string;
  detail?: string;
}) {
  return (
    <div className="empty-state">
      <div>
        <span className="empty-state-icon">
          <CircleOff />
        </span>
        <h2>{title}</h2>
        <p>{detail}</p>
        <button className="button">Clear filters</button>
      </div>
    </div>
  );
}

export function ErrorState({ retry }: { retry?: () => void }) {
  return (
    <div className="error-state">
      <div>
        <span className="error-state-icon">
          <CloudOff />
        </span>
        <h2>Couldn’t reach the database</h2>
        <p>
          Hyperdrive did not return a response. Your saved history is still
          available.
        </p>
        {retry ? (
          <button className="button primary" onClick={retry}>
            Try again
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="page" aria-label="Loading">
      <div
        className="skeleton"
        style={{ width: 240, height: 30, marginBottom: 24 }}
      />
      <div className="metric-grid">
        {Array.from({ length: 4 }).map((_, index) => (
          <div className="skeleton" style={{ height: 154 }} key={index} />
        ))}
      </div>
      <div className="skeleton" style={{ height: 420, marginTop: 12 }} />
    </div>
  );
}
