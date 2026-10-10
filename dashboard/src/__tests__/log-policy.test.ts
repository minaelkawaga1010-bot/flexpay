// ============================================================
// Prisma Log Policy Tests — C-1 (TASK-005)
// Proves PII cannot leak via Prisma query logging in ANY env.
// ============================================================
import { describe, test, expect } from "./run-tests.ts";
import { resolveQueryLogLevels } from "../lib/log-policy.ts";

describe("resolveQueryLogLevels — no PII via query logs", () => {
  test("development: warn+error, and NEVER query", () => {
    const levels = resolveQueryLogLevels("development");
    expect(levels.includes("warn")).toBe(true);
    expect(levels.includes("error")).toBe(true);
    // The leak vector: query logging includes bound SQL parameters.
    expect(levels.includes("query" as never)).toBe(false);
    expect(levels.includes("info" as never)).toBe(false);
  });

  test("production: error only, never query", () => {
    const levels = resolveQueryLogLevels("production");
    expect(levels).toEqual(["error"]);
    expect(levels.includes("query" as never)).toBe(false);
  });

  test("test env: error only, never query", () => {
    const levels = resolveQueryLogLevels("test");
    expect(levels).toEqual(["error"]);
    expect(levels.includes("query" as never)).toBe(false);
  });

  test("unknown / undefined env: fails safe to error only, never query", () => {
    expect(resolveQueryLogLevels(undefined)).toEqual(["error"]);
    expect(resolveQueryLogLevels("staging")).toEqual(["error"]);
    expect(resolveQueryLogLevels("staging").includes("query" as never)).toBe(false);
  });

  test("error-level observability is preserved in every environment", () => {
    for (const env of ["development", "production", "test", "staging", undefined]) {
      expect(resolveQueryLogLevels(env).includes("error")).toBe(true);
    }
  });
});
