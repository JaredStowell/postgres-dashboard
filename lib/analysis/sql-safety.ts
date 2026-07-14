export type SqlStatementClass =
  | "select"
  | "values"
  | "show"
  | "table"
  | "insert"
  | "update"
  | "delete"
  | "merge"
  | "ddl"
  | "transaction"
  | "explain"
  | "unknown";

export interface SqlClassification {
  statementClass: SqlStatementClass;
  readOnly: boolean;
  singleStatement: boolean;
  containsVolatileFunction: boolean;
  normalizedSql: string;
  reason: string | null;
}

export interface ConservativeAnalyzeRelation {
  schema?: string;
  relation: string;
}

interface SqlToken {
  value: string;
  depth: number;
}

const writeKeywords = new Set([
  "INSERT",
  "UPDATE",
  "DELETE",
  "MERGE",
  "COPY",
  "CALL",
  "DO",
]);
const ddlKeywords = new Set([
  "ALTER",
  "CREATE",
  "DROP",
  "TRUNCATE",
  "GRANT",
  "REVOKE",
  "COMMENT",
  "CLUSTER",
  "REINDEX",
  "VACUUM",
  "ANALYZE",
  "REFRESH",
]);
const transactionKeywords = new Set([
  "BEGIN",
  "START",
  "COMMIT",
  "ROLLBACK",
  "SAVEPOINT",
  "SET",
]);
const functionLikeSqlKeywords = new Set([
  "ARRAY",
  "AS",
  "EXISTS",
  "FILTER",
  "FROM",
  "GROUPING",
  "IN",
  "OVER",
  "ROW",
  "SELECT",
  "TABLE",
  "VALUES",
  "WHERE",
  "WITH",
]);

function dollarTagAt(sql: string, index: number): string | null {
  const match = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(index));
  return match?.[0] ?? null;
}

function scanSql(sql: string): {
  tokens: SqlToken[];
  semicolons: number[];
  unterminated: boolean;
} {
  const tokens: SqlToken[] = [];
  const semicolons: number[] = [];
  let depth = 0;
  let i = 0;
  let unterminated = false;

  while (i < sql.length) {
    const char = sql[i] ?? "";
    const next = sql[i + 1] ?? "";
    if (/\s/.test(char)) {
      i += 1;
      continue;
    }
    if (char === "-" && next === "-") {
      const end = sql.indexOf("\n", i + 2);
      i = end < 0 ? sql.length : end + 1;
      continue;
    }
    if (char === "/" && next === "*") {
      let nesting = 1;
      i += 2;
      while (i < sql.length && nesting > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") {
          nesting += 1;
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          nesting -= 1;
          i += 2;
        } else {
          i += 1;
        }
      }
      unterminated ||= nesting > 0;
      continue;
    }
    if (char === "'" || char === '"') {
      const quote = char;
      i += 1;
      let closed = false;
      while (i < sql.length) {
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
            i += 2;
            continue;
          }
          i += 1;
          closed = true;
          break;
        }
        if (sql[i] === "\\" && quote === "'") i += 2;
        else i += 1;
      }
      unterminated ||= !closed;
      continue;
    }
    if (char === "$" && dollarTagAt(sql, i)) {
      const tag = dollarTagAt(sql, i)!;
      const end = sql.indexOf(tag, i + tag.length);
      if (end < 0) {
        unterminated = true;
        i = sql.length;
      } else {
        i = end + tag.length;
      }
      continue;
    }
    if (char === "(") {
      tokens.push({ value: char, depth });
      depth += 1;
      i += 1;
      continue;
    }
    if (char === ")") {
      depth = Math.max(0, depth - 1);
      tokens.push({ value: char, depth });
      i += 1;
      continue;
    }
    if (char === ";") {
      semicolons.push(i);
      i += 1;
      continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(sql.slice(i));
    if (word) {
      tokens.push({ value: word[0]!.toUpperCase(), depth });
      i += word[0]!.length;
      continue;
    }
    i += 1;
  }
  return { tokens, semicolons, unterminated };
}

function hasMultipleStatements(sql: string, semicolons: number[]): boolean {
  if (semicolons.length === 0) return false;
  const withoutTrailing = sql.replace(
    /(?:\s|;|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*$/g,
    "",
  );
  return semicolons.some((position) => position < withoutTrailing.length);
}

function mainKeyword(tokens: SqlToken[]): string {
  const first = tokens[0]?.value ?? "";
  if (first !== "WITH") return first;
  const candidate = tokens.find(
    (token, index) =>
      index > 0 &&
      token.depth === 0 &&
      (writeKeywords.has(token.value) ||
        ["SELECT", "VALUES", "TABLE", "MERGE"].includes(token.value)),
  );
  return candidate?.value ?? "WITH";
}

function classForKeyword(keyword: string): SqlStatementClass {
  const direct: Record<string, SqlStatementClass> = {
    SELECT: "select",
    VALUES: "values",
    SHOW: "show",
    TABLE: "table",
    INSERT: "insert",
    UPDATE: "update",
    DELETE: "delete",
    MERGE: "merge",
    EXPLAIN: "explain",
  };
  if (direct[keyword]) return direct[keyword];
  if (ddlKeywords.has(keyword)) return "ddl";
  if (transactionKeywords.has(keyword)) return "transaction";
  return "unknown";
}

export function normalizeSql(sql: string): string {
  return sql.trim().replace(/;\s*$/, "").replace(/\s+/g, " ");
}

const analyzeIdentifier = `(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)`;
const analyzeValue = `(?:\\$\\d+|'(?:''|[^'])*'|[-+]?\\d+(?:\\.\\d+)?)`;
const analyzePredicate = `${analyzeIdentifier}\\s*(?:(?:=|<>|!=|<=|>=|<|>)\\s*${analyzeValue}|IS\\s+(?:NOT\\s+)?NULL)`;
const analyzeOrder = `${analyzeIdentifier}(?:\\s+(?:ASC|DESC))?(?:\\s*,\\s*${analyzeIdentifier}(?:\\s+(?:ASC|DESC))?)*`;
const conservativeAnalyzePattern = new RegExp(
  `^SELECT\\s+\\*\\s+FROM\\s+(${analyzeIdentifier})(?:\\s*\\.\\s*(${analyzeIdentifier}))?` +
    `(?:\\s+WHERE\\s+${analyzePredicate}(?:\\s+AND\\s+${analyzePredicate})*)?` +
    `(?:\\s+ORDER\\s+BY\\s+${analyzeOrder})?(?:\\s+LIMIT\\s+\\d+)?$`,
  "i",
);

function unquoteAnalyzeIdentifier(identifier: string): string {
  return identifier.startsWith('"')
    ? identifier.slice(1, -1).replaceAll('""', '"')
    : identifier;
}

export function conservativeAnalyzeRelation(
  sql: string,
): ConservativeAnalyzeRelation | null {
  const match = conservativeAnalyzePattern.exec(normalizeSql(sql));
  if (!match?.[1]) return null;
  return match[2]
    ? {
        schema: unquoteAnalyzeIdentifier(match[1]),
        relation: unquoteAnalyzeIdentifier(match[2]),
      }
    : { relation: unquoteAnalyzeIdentifier(match[1]) };
}

export function redactSql(sql: string): string {
  let output = "";
  let i = 0;
  while (i < sql.length) {
    const char = sql[i] ?? "";
    const next = sql[i + 1] ?? "";
    if (char === "-" && next === "-") {
      const end = sql.indexOf("\n", i + 2);
      output += end < 0 ? "" : "\n";
      i = end < 0 ? sql.length : end + 1;
      continue;
    }
    if (char === "/" && next === "*") {
      let nesting = 1;
      i += 2;
      while (i < sql.length && nesting > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") {
          nesting += 1;
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          nesting -= 1;
          i += 2;
        } else i += 1;
      }
      output += " ";
      continue;
    }
    if (char === "'") {
      i += 1;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") i += 2;
        else if (sql[i] === "'") {
          i += 1;
          break;
        } else if (sql[i] === "\\") i += 2;
        else i += 1;
      }
      output += "'?" + "'";
      continue;
    }
    const tag = char === "$" ? dollarTagAt(sql, i) : null;
    if (tag) {
      const end = sql.indexOf(tag, i + tag.length);
      i = end < 0 ? sql.length : end + tag.length;
      output += `${tag}?${tag}`;
      continue;
    }
    const number = /^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(
      sql.slice(i),
    );
    if (number && (i === 0 || !/[A-Za-z0-9_$]/.test(sql[i - 1] ?? ""))) {
      output += "?";
      i += number[0].length;
      continue;
    }
    output += char;
    i += 1;
  }
  return normalizeSql(output);
}

export function classifySql(sql: string): SqlClassification {
  const normalizedSql = normalizeSql(sql);
  const scanned = scanSql(sql);
  const singleStatement = !hasMultipleStatements(sql, scanned.semicolons);
  const keyword = mainKeyword(scanned.tokens);
  const statementClass = classForKeyword(keyword);
  const hasWriteAnywhere = scanned.tokens.some(
    (token) => writeKeywords.has(token.value) || ddlKeywords.has(token.value),
  );
  const functionCalls = scanned.tokens
    .filter(
      (token, index) =>
        scanned.tokens[index + 1]?.value === "(" &&
        !functionLikeSqlKeywords.has(token.value),
    )
    .map((token) => token.value);
  const redacted = redactSql(sql);
  const qualifiedCalls = Array.from(
    redacted.matchAll(
      /(?:"([^"]+(?:""[^"]+)*)"|([A-Za-z_][A-Za-z0-9_$]*))\s*\.\s*(?:"([^"]+(?:""[^"]+)*)"|([A-Za-z_][A-Za-z0-9_$]*))\s*\(/g,
    ),
  );
  const unsafeQualifiedCall = qualifiedCalls.length > 0;
  const quotedCall = /"(?:[^"]|"")+"\s*\(/.test(redacted);
  const containsVolatileFunction =
    unsafeQualifiedCall ||
    quotedCall ||
    functionCalls.length > 0 ||
    /::|\bOPERATOR\s*\(/i.test(redacted);
  const nominallyReadOnly = ["select", "values", "show", "table"].includes(
    statementClass,
  );
  const readOnly =
    nominallyReadOnly &&
    singleStatement &&
    !scanned.unterminated &&
    !hasWriteAnywhere;
  let reason: string | null = null;
  if (!normalizedSql) reason = "SQL is empty.";
  else if (scanned.unterminated)
    reason = "SQL contains an unterminated quote or comment.";
  else if (!singleStatement) reason = "Only one SQL statement is allowed.";
  else if (hasWriteAnywhere)
    reason = "Write and DDL statements are not allowed.";
  else if (!nominallyReadOnly)
    reason = "Only SELECT, VALUES, SHOW, or TABLE statements are allowed.";

  return {
    statementClass,
    readOnly,
    singleStatement,
    containsVolatileFunction,
    normalizedSql,
    reason,
  };
}

export function validateExplainSql(
  sql: string,
  analyze = false,
): SqlClassification {
  const classification = classifySql(sql);
  if (!classification.readOnly) return classification;
  if (analyze && classification.containsVolatileFunction) {
    return {
      ...classification,
      readOnly: false,
      reason:
        "EXPLAIN ANALYZE rejects function calls, explicit casts, and custom operator syntax because rollback cannot reverse external side effects.",
    };
  }
  if (analyze && !conservativeAnalyzeRelation(sql)) {
    return {
      ...classification,
      readOnly: false,
      reason:
        "EXPLAIN ANALYZE conservative mode accepts SELECT * from one base table with optional simple predicates, ordering, and LIMIT. Use plain EXPLAIN for complex SQL.",
    };
  }
  return classification;
}

export function quoteIdentifier(identifier: string): string {
  if (identifier.includes("\0"))
    throw new Error("Identifiers cannot contain NUL bytes.");
  return `"${identifier.replaceAll('"', '""')}"`;
}

function encodeBase64Url(value: Uint8Array | string): string {
  const bytes =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hmac(value: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
  );
}

export async function createExplainConfirmationToken(
  sql: string,
  secret: string,
  issuedAt = Date.now(),
  context: {
    source?: string;
    schema?: string;
    parameters?: readonly unknown[];
  } = {},
): Promise<string> {
  if (secret.length < 16)
    throw new Error(
      "Confirmation token secret must be at least 16 characters.",
    );
  const sqlDigest = encodeBase64Url(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(normalizeSql(sql)),
      ),
    ),
  );
  const payload = encodeBase64Url(
    JSON.stringify({
      sqlDigest,
      parametersDigest: encodeBase64Url(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(JSON.stringify(context.parameters ?? [])),
          ),
        ),
      ),
      source: context.source ?? "",
      schema: context.schema ?? "",
      issuedAt: Math.floor(issuedAt),
    }),
  );
  const signature = encodeBase64Url(await hmac(payload, secret));
  return `${payload}.${signature}`;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let mismatch = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |=
      (left[index % left.length] ?? 0) ^ (right[index % right.length] ?? 0);
  }
  return mismatch === 0;
}

export async function verifyExplainConfirmationToken(
  token: string,
  sql: string,
  secret: string,
  options: { now?: number; maxAgeMs?: number } = {},
  context: {
    source?: string;
    schema?: string;
    parameters?: readonly unknown[];
  } = {},
): Promise<boolean> {
  try {
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra) return false;
    const expected = await hmac(payload, secret);
    if (!constantTimeEqual(decodeBase64Url(signature), expected)) return false;
    const decoded = JSON.parse(
      new TextDecoder().decode(decodeBase64Url(payload)),
    ) as {
      sqlDigest?: unknown;
      parametersDigest?: unknown;
      source?: unknown;
      schema?: unknown;
      issuedAt?: unknown;
    };
    const now = options.now ?? Date.now();
    const maxAgeMs = options.maxAgeMs ?? 60_000;
    const sqlDigest = encodeBase64Url(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(normalizeSql(sql)),
        ),
      ),
    );
    const parametersDigest = encodeBase64Url(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(JSON.stringify(context.parameters ?? [])),
        ),
      ),
    );
    return (
      decoded.sqlDigest === sqlDigest &&
      decoded.parametersDigest === parametersDigest &&
      decoded.source === (context.source ?? "") &&
      decoded.schema === (context.schema ?? "") &&
      typeof decoded.issuedAt === "number" &&
      decoded.issuedAt <= now + 1_000 &&
      now - decoded.issuedAt <= maxAgeMs
    );
  } catch {
    return false;
  }
}

export const classifyStatement = classifySql;
export const redactQuery = redactSql;
