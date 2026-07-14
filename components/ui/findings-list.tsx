import type { Finding } from "@/lib/demo/types";
import { Badge } from "./badge";

export function FindingsList({
  findings,
  detailed = false,
}: {
  findings: Finding[];
  detailed?: boolean;
}) {
  return (
    <ul className="finding-list">
      {findings.map((finding) => (
        <li key={finding.id}>
          <a
            className={`finding-item severity-${finding.severity}`}
            href={finding.href}
          >
            <span className="severity-mark" />
            <span className="finding-copy">
              <strong>{finding.title}</strong>
              <p>{detailed ? finding.description : finding.evidence}</p>
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
