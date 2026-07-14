import type { Finding } from "@/lib/demo/types";
import { Badge } from "./badge";

export function FindingsList({
  findings,
  detailed = false,
  selectedId,
  onSelect,
}: {
  findings: Finding[];
  detailed?: boolean;
  selectedId?: string;
  onSelect?: (finding: Finding) => void;
}) {
  return (
    <ul className="finding-list">
      {findings.map((finding) => (
        <li key={finding.id}>
          <a
            className={`finding-item severity-${finding.severity}${selectedId === finding.id ? " selected" : ""}`}
            href={finding.href}
            aria-current={selectedId === finding.id ? "true" : undefined}
            onClick={
              onSelect
                ? (event) => {
                    event.preventDefault();
                    onSelect(finding);
                  }
                : undefined
            }
          >
            <span className="severity-mark" />
            <span className="finding-copy">
              <strong>{finding.title}</strong>
              <p>{finding.description}</p>
              {detailed ? <p className="mono">{finding.evidence}</p> : null}
            </span>
            <span className="finding-meta">
              {detailed ? (
                <Badge
                  tone={
                    finding.status === "resolved"
                      ? "green"
                      : finding.status === "acknowledged"
                        ? "amber"
                        : ""
                  }
                >
                  {finding.status}
                </Badge>
              ) : (
                finding.lastSeen
              )}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
