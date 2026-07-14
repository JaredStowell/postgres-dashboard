import { describe, expect, it } from "vitest";

import type { RuntimeEnv } from "@/lib/config/env";
import { ApiError } from "@/lib/http/api";
import {
  resolveControlConnectionString,
  selectTarget,
} from "@/lib/server/context";

const env: RuntimeEnv = {
  DATABASE_URL: "postgres://local",
  SECONDARY: { connectionString: "postgres://secondary" },
  INDEX_ANALYZER_TARGETS:
    "local:Local database:DATABASE_URL,reporting:Reporting:SECONDARY",
};

describe("server database context", () => {
  it("selects the first target by default", () => {
    expect(selectTarget(env).key).toBe("local");
  });

  it("selects only allowlisted target keys", () => {
    expect(selectTarget(env, "reporting").connectionString).toBe(
      "postgres://secondary",
    );
    expect(() => selectTarget(env, "DATABASE_URL")).toThrow(ApiError);
  });

  it("prefers a native control binding", () => {
    expect(
      resolveControlConnectionString({
        ...env,
        CONTROL_DB: { connectionString: "postgres://control" },
      }),
    ).toBe("postgres://control");
  });

  it("falls back to the local database URL", () => {
    expect(resolveControlConnectionString(env)).toBe("postgres://local");
  });
});
