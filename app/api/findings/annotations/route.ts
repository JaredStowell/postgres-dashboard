import { addFindingAnnotation } from "@/lib/db/findings";
import { jsonResponse, parseJson, route } from "@/lib/http/api";
import { getControlDatabase } from "@/lib/server/context";
import { z } from "zod";

const requestSchema = z
  .object({
    findingId: z.number().int().positive(),
    body: z.string().trim().min(1).max(4_000),
  })
  .strict();

export const POST = route(async (request: Request) => {
  const input = await parseJson(request, requestSchema);
  const annotationId = await addFindingAnnotation(
    await getControlDatabase(),
    input.findingId,
    input.body,
    "dashboard",
  );
  return jsonResponse({ annotationId }, { status: 201 });
});
