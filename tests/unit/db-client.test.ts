import {
  closeDatabasePools,
  getDatabasePool,
  runWithRequestDatabasePools,
} from "@/lib/db/client";
import { afterEach, describe, expect, it } from "vitest";

const connection =
  "postgres://request-scope:request-scope@127.0.0.1:1/request-scope";

afterEach(async () => {
  await closeDatabasePools();
});

describe("database pool request scoping", () => {
  it("reuses a pool inside one request but isolates overlapping requests", async () => {
    const first = await runWithRequestDatabasePools(() => {
      const initial = getDatabasePool(connection);
      return { initial, repeated: getDatabasePool(connection) };
    });
    const second = await runWithRequestDatabasePools(() =>
      getDatabasePool(connection),
    );

    expect(first.value.initial).toBe(first.value.repeated);
    expect(second.value).not.toBe(first.value.initial);

    await Promise.all([first.close(), second.close()]);
    await expect(first.value.initial.query("SELECT 1")).rejects.toThrow(
      /after calling end|ended/i,
    );
  });

  it("keeps the reusable Node pool cache when no request scope is active", () => {
    expect(getDatabasePool(connection)).toBe(getDatabasePool(connection));
  });

  it("automatically closes request pools when request work throws", async () => {
    await expect(
      runWithRequestDatabasePools(() => {
        getDatabasePool(connection);
        throw new Error("render failed");
      }),
    ).rejects.toThrow("render failed");

    const next = await runWithRequestDatabasePools(() =>
      getDatabasePool(connection),
    );
    await expect(next.close()).resolves.toBeUndefined();
  });
});
