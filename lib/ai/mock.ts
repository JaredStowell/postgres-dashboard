import type { AiAdvisorPayload } from "./payload";
import type { AiAnalysisResponse } from "./schema";
import { aiAnalysisResponseSchema } from "./schema";

const severityOrder = ["info", "low", "medium", "high", "critical"] as const;

export function createMockAiAnalysis(
  payload: AiAdvisorPayload,
): AiAnalysisResponse {
  const warnings = payload.planSummary?.warnings ?? [];
  const mostSevere = warnings.reduce<(typeof severityOrder)[number]>(
    (current, item) =>
      severityOrder.indexOf(item.severity) > severityOrder.indexOf(current)
        ? item.severity
        : current,
    "info",
  );
  const topWarning = warnings[0];
  const response: AiAnalysisResponse = {
    summary: topWarning
      ? `Mock analysis found ${warnings.length} evidence-backed plan warning${warnings.length === 1 ? "" : "s"}; the first is ${topWarning.code}.`
      : "Mock analysis found no material warning in the supplied, sanitized context.",
    severity: mostSevere,
    confidence: payload.plan ? 0.82 : 0.45,
    evidence: warnings.slice(0, 10).map((item) => ({
      claim: item.message,
      source: "plan" as const,
      reference: `plan node ${item.path}`,
    })),
    caveats: [
      "This deterministic mock does not contact an AI service.",
      "Validate recommendations against representative parameters and production-like statistics.",
    ],
    recommendations: topWarning
      ? [
          {
            title: `Investigate ${topWarning.code.replaceAll("_", " ")}`,
            rationale: `${topWarning.message} Review the referenced plan node and compare a fresh plan after any change.`,
            risk: topWarning.severity,
            confidence: 0.75,
            validationSteps: [
              "Reproduce with representative bind parameters.",
              "Compare EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) before and after the candidate change.",
            ],
            migrationSql: null,
          },
        ]
      : [],
  };
  return aiAnalysisResponseSchema.parse(response);
}

export const mockAiAnalysis = createMockAiAnalysis;
