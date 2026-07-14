import { describe, expect, it } from "vitest";
import { boundedPage, quoteIdentifier } from "../../lib/db/sql";
import { parseTargetRegistry, resolveTarget } from "../../lib/config/targets";

describe("database boundary validation", () => {
  it("accepts only bounded pagination", () => {
    expect(boundedPage({})).toEqual({ limit: 50, offset: 0 });
    expect(boundedPage({ limit: 250, offset: 1_000_000 })).toEqual({
      limit: 250,
      offset: 1_000_000,
    });
    expect(() => boundedPage({ limit: 251 })).toThrow();
    expect(() => boundedPage({ offset: -1 })).toThrow();
  });

  it("quotes discovered identifiers without allowing NUL or overlength names", () => {
    expect(quoteIdentifier('schema"name')).toBe('"schema""name"');
    expect(() => quoteIdentifier("bad\0name")).toThrow();
    expect(() => quoteIdentifier("x".repeat(64))).toThrow();
  });

  it("builds a compiled registry and never derives a binding from a requested key", () => {
    const registry = parseTargetRegistry({
      INDEX_ANALYZER_TARGETS: "primary:Primary DB:TARGET_PRIMARY",
      TARGET_PRIMARY: { connectionString: "postgres://example.test/db" },
      EVIL: { connectionString: "postgres://wrong.test/db" },
    });
    expect(resolveTarget(registry, "primary").binding).toBe("TARGET_PRIMARY");
    expect(() => resolveTarget(registry, "EVIL")).toThrow(
      "Unknown database target",
    );
  });

  it.each([
    "../bad:Bad:TARGET",
    "valid:Label:target_lower",
    "valid:Label:TARGET:EXTRA",
    "same:One:TARGET,same:Two:TARGET",
  ])("rejects invalid registry specification: %s", (specification) => {
    expect(() =>
      parseTargetRegistry({
        INDEX_ANALYZER_TARGETS: specification,
        TARGET: "postgres://example.test/db",
      }),
    ).toThrow();
  });
});
