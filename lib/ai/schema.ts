import { z } from "zod";

export const aiSeveritySchema = z.enum([
  "info",
  "low",
  "medium",
  "high",
  "critical",
]);

export const aiEvidenceSchema = z
  .object({
    claim: z.string().min(1).max(2_000),
    source: z.enum([
      "query",
      "plan",
      "table",
      "index",
      "statistic",
      "setting",
      "finding",
    ]),
    reference: z.string().min(1).max(500),
  })
  .strict();

export const aiRecommendationSchema = z
  .object({
    title: z.string().min(1).max(200),
    rationale: z.string().min(1).max(4_000),
    risk: aiSeveritySchema,
    confidence: z.number().min(0).max(1),
    validationSteps: z.array(z.string().min(1).max(1_000)).min(1).max(12),
    migrationSql: z.string().min(1).max(20_000).nullable(),
  })
  .strict();

export const aiAnalysisResponseSchema = z
  .object({
    summary: z.string().min(1).max(4_000),
    severity: aiSeveritySchema,
    confidence: z.number().min(0).max(1),
    evidence: z.array(aiEvidenceSchema).max(30),
    caveats: z.array(z.string().min(1).max(2_000)).max(20),
    recommendations: z.array(aiRecommendationSchema).max(20),
  })
  .strict();

export type AiAnalysisResponse = z.infer<typeof aiAnalysisResponseSchema>;
export type AiEvidence = z.infer<typeof aiEvidenceSchema>;
export type AiRecommendation = z.infer<typeof aiRecommendationSchema>;

export function parseAiAnalysisResponse(value: unknown): AiAnalysisResponse {
  return aiAnalysisResponseSchema.parse(value);
}
