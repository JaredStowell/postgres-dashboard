import { ZodError, type ZodType } from "zod";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function jsonResponse<T>(body: T, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return jsonResponse<ApiErrorBody>(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      },
      { status: error.status },
    );
  }

  if (error instanceof ZodError) {
    return jsonResponse<ApiErrorBody>(
      {
        error: {
          code: "validation_failed",
          message: "The request did not match the expected shape.",
          details: error.flatten(),
        },
      },
      { status: 400 },
    );
  }

  const message =
    error instanceof Error ? error.message : "Unexpected server error";
  return jsonResponse<ApiErrorBody>(
    { error: { code: "internal_error", message } },
    { status: 500 },
  );
}

export async function parseJson<T>(
  request: Request,
  schema: ZodType<T>,
  options: { maxBytes?: number } = {},
): Promise<T> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new ApiError(
      415,
      "unsupported_media_type",
      "Expected an application/json request.",
    );
  }

  const maxBytes = Math.min(
    Math.max(options.maxBytes ?? 1_048_576, 1_024),
    2_097_152,
  );
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ApiError(
      413,
      "payload_too_large",
      `The request body exceeds ${maxBytes} bytes.`,
    );
  }

  let input: unknown;
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > maxBytes) {
      throw new ApiError(
        413,
        "payload_too_large",
        `The request body exceeds ${maxBytes} bytes.`,
      );
    }
    input = JSON.parse(body);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      400,
      "invalid_json",
      "The request body is not valid JSON.",
    );
  }
  return schema.parse(input);
}

export function boundedInteger(
  value: string | null,
  fallback: number,
  options: { min: number; max: number; name: string },
): number {
  if (value === null || value === "") return fallback;
  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < options.min ||
    parsed > options.max
  ) {
    throw new ApiError(
      400,
      "invalid_parameter",
      `${options.name} must be an integer between ${options.min} and ${options.max}.`,
    );
  }
  return parsed;
}

export function route<TArgs extends unknown[]>(
  handler: (...args: TArgs) => Promise<Response>,
): (...args: TArgs) => Promise<Response> {
  return async (...args: TArgs): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (error) {
      return errorResponse(error);
    }
  };
}
