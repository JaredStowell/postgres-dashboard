import {
  classifySql,
  createExplainConfirmationToken,
  quoteIdentifier,
  redactSql,
  validateExplainSql,
  verifyExplainConfirmationToken,
} from "@/lib/analysis/sql-safety";
import { describe, expect, it } from "vitest";

describe("SQL classification", () => {
  it.each([
    ["select * from widgets", "select"],
    ["VALUES (1)", "values"],
    ["SHOW work_mem", "show"],
    ["TABLE public.widgets", "table"],
    ["WITH x AS (SELECT 1) SELECT * FROM x", "select"],
  ])("accepts read-only SQL: %s", (sql, statementClass) => {
    expect(classifySql(sql)).toMatchObject({ readOnly: true, statementClass });
  });

  it.each([
    "UPDATE widgets SET name = 'x'",
    "DELETE FROM widgets",
    "CREATE TABLE x(id int)",
    "WITH removed AS (DELETE FROM widgets RETURNING *) SELECT * FROM removed",
    "SELECT 1; SELECT 2",
    "DO $$ BEGIN RAISE NOTICE 'x'; END $$",
  ])("rejects unsafe SQL: %s", (sql) => {
    expect(classifySql(sql).readOnly).toBe(false);
  });

  it("ignores statement delimiters and write words inside strings and comments", () => {
    const result = classifySql("/* DELETE; */ SELECT 'UPDATE; ok' -- DROP\n");
    expect(result).toMatchObject({ readOnly: true, singleStatement: true });
  });

  it("uses a function-free conservative subset for ANALYZE", () => {
    expect(
      validateExplainSql("SELECT nextval('widgets_id_seq')", true),
    ).toMatchObject({
      readOnly: false,
      containsVolatileFunction: true,
    });
    expect(
      validateExplainSql("SELECT nextval('widgets_id_seq')", false).readOnly,
    ).toBe(true);
    expect(validateExplainSql("SELECT * FROM widgets", true).readOnly).toBe(
      true,
    );
    expect(
      validateExplainSql("SELECT count(*) FROM widgets", true).readOnly,
    ).toBe(false);
    for (const sql of [
      "SELECT pg_terminate_backend(42)",
      "SELECT custom_security_definer()",
      "SELECT evil.count(*) FROM widgets",
      'SELECT "custom_function"()',
      "SELECT id::text FROM widgets",
      "SELECT * FROM widgets WHERE value OPERATOR(public.=) 1",
      "SELECT * FROM widgets WHERE value ## 1",
    ]) {
      expect(validateExplainSql(sql, true)).toMatchObject({ readOnly: false });
    }
  });

  it("rejects unterminated SQL", () => {
    expect(classifySql("SELECT 'oops").reason).toContain("unterminated");
  });
});

describe("SQL redaction", () => {
  it("redacts strings, dollar strings, numbers, and comments while retaining bind parameters", () => {
    const redacted = redactSql(
      "-- customer\nSELECT * FROM x WHERE email='a@b.com' AND n=42 AND p=$1 AND note=$tag$secret$tag$",
    );
    expect(redacted).not.toContain("a@b.com");
    expect(redacted).not.toContain("secret");
    expect(redacted).not.toContain("customer");
    expect(redacted).toContain("email='?' AND n=? AND p=$1");
  });

  it("handles escaped quotes", () => {
    expect(redactSql("SELECT 'it''s secret'")).toBe("SELECT '?'");
  });

  it("quotes PostgreSQL identifiers safely", () => {
    expect(quoteIdentifier('odd"name')).toBe('"odd""name"');
    expect(() => quoteIdentifier("bad\0name")).toThrow(/NUL/);
  });
});

describe("EXPLAIN confirmation tokens", () => {
  const secret = "a-secret-long-enough-for-hmac";
  const now = Date.parse("2026-01-01T00:00:00Z");

  it("binds a short-lived token to exact SQL, target, and schema", async () => {
    const token = await createExplainConfirmationToken(
      "SELECT * FROM x WHERE id=42",
      secret,
      now,
      { source: "local", schema: "sales", parameters: [42] },
    );
    await expect(
      verifyExplainConfirmationToken(
        token,
        "SELECT * FROM x WHERE id=42",
        secret,
        { now: now + 500 },
        { source: "local", schema: "sales", parameters: [42] },
      ),
    ).resolves.toBe(true);
    await expect(
      verifyExplainConfirmationToken(
        token,
        "SELECT * FROM x WHERE id=99",
        secret,
        { now: now + 500 },
        { source: "local", schema: "sales", parameters: [42] },
      ),
    ).resolves.toBe(false);
    await expect(
      verifyExplainConfirmationToken(
        token,
        "SELECT * FROM x WHERE id=42",
        secret,
        { now: now + 500 },
        { source: "local", schema: "support", parameters: [42] },
      ),
    ).resolves.toBe(false);
    await expect(
      verifyExplainConfirmationToken(
        token,
        "SELECT * FROM x WHERE id=42",
        secret,
        { now: now + 500 },
        { source: "local", schema: "sales", parameters: [99] },
      ),
    ).resolves.toBe(false);
  });

  it("rejects expired, future, malformed, and tampered tokens", async () => {
    const token = await createExplainConfirmationToken("SELECT 1", secret, now);
    await expect(
      verifyExplainConfirmationToken(token, "SELECT 1", secret, {
        now: now + 61_000,
      }),
    ).resolves.toBe(false);
    await expect(
      verifyExplainConfirmationToken(token, "SELECT 1", secret, {
        now: now - 2_000,
      }),
    ).resolves.toBe(false);
    await expect(
      verifyExplainConfirmationToken(`${token}x`, "SELECT 1", secret, { now }),
    ).resolves.toBe(false);
    await expect(
      verifyExplainConfirmationToken("garbage", "SELECT 1", secret, { now }),
    ).resolves.toBe(false);
  });

  it("requires a non-trivial secret", async () => {
    await expect(
      createExplainConfirmationToken("SELECT 1", "short", now),
    ).rejects.toThrow(/16/);
  });
});
