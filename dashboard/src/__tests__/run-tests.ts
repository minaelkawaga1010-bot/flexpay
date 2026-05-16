// ============================================================
// FlexPay Minimal Test Runner
// ============================================================
// A lightweight, zero-dependency test runner for pure-function
// unit tests. Run with:  bun run src/__tests__/run-tests.ts
//
// Features:
//   - describe / test (alias: it) for grouping
//   - beforeEach / afterEach hooks
//   - expect() with toBe, toBeGreaterThan, toBeLessThan,
//     toEqual, toThrow, toBeNull, toBeTruthy, toBeFalsy,
//     toContain, toBeCloseTo
//   - Color-coded output (green pass, red fail)
//   - Summary: X passed, Y failed, Z total
//   - Exit code 0 on all-pass, 1 on any failure
// ============================================================

// ------------------------------------------------------------------
// ANSI color helpers
// ------------------------------------------------------------------

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";

// ------------------------------------------------------------------
// Internal state
// ------------------------------------------------------------------

interface TestCase {
  name: string;
  fn: () => void | Promise<void>;
  async: boolean;
}

interface Suite {
  name: string;
  tests: TestCase[];
  beforeEachFn?: () => void | Promise<void>;
  afterEachFn?: () => void | Promise<void>;
}

const rootSuites: Suite[] = [];
let currentSuite: Suite | null = null;

let totalPassed = 0;
let totalFailed = 0;
let totalTests = 0;

// ------------------------------------------------------------------
// Public API: describe / test / hooks
// ------------------------------------------------------------------

/**
 * Register a test suite (describe block).
 */
export function describe(name: string, fn: () => void): void {
  const suite: Suite = { name, tests: [] };
  rootSuites.push(suite);
  const prev = currentSuite;
  currentSuite = suite;
  fn();
  currentSuite = prev;
}

/**
 * Register a test case. Aliased as `it`.
 */
export function test(name: string, fn: () => void | Promise<void>): void {
  if (!currentSuite) {
    throw new Error(`test("${name}") must be called inside a describe() block`);
  }
  const isAsync = fn.constructor.name === "AsyncFunction";
  currentSuite.tests.push({ name, fn, async: isAsync });
}

/** Alias for test(). */
export const it = test;

/** Run a function before each test in the current describe block. */
export function beforeEach(fn: () => void | Promise<void>): void {
  if (!currentSuite) throw new Error("beforeEach must be inside describe()");
  currentSuite.beforeEachFn = fn;
}

/** Run a function after each test in the current describe block. */
export function afterEach(fn: () => void | Promise<void>): void {
  if (!currentSuite) throw new Error("afterEach must be inside describe()");
  currentSuite.afterEachFn = fn;
}

// ------------------------------------------------------------------
// Expectation class
// ------------------------------------------------------------------

class Expectation<T> {
  constructor(private actual: T) {}

  private pass(msg: string) {
    totalPassed++;
    console.log(`  ${GREEN}✓${RESET} ${msg}`);
  }

  private fail(msg: string, expected: string, received: string) {
    totalFailed++;
    console.log(`  ${RED}✗${RESET} ${msg}`);
    console.log(`    ${DIM}Expected: ${expected}${RESET}`);
    console.log(`    ${DIM}Received: ${received}${RESET}`);
  }

  /** Strict equality (===) */
  toBe(expected: T, hint = "") {
    const label = hint || `toBe(${JSON.stringify(expected)})`;
    if (this.actual === expected) {
      this.pass(label);
    } else {
      this.fail(label, JSON.stringify(expected), JSON.stringify(this.actual));
    }
  }

  /** Deep equality */
  toEqual(expected: T, hint = "") {
    const label = hint || "toEqual(...)";
    const actualStr = JSON.stringify(this.actual);
    const expectedStr = JSON.stringify(expected);
    if (actualStr === expectedStr) {
      this.pass(label);
    } else {
      this.fail(label, expectedStr, actualStr);
    }
  }

  /** actual > expected */
  toBeGreaterThan(expected: number, hint = "") {
    const label = hint || `toBeGreaterThan(${expected})`;
    if (Number(this.actual) > expected) {
      this.pass(label);
    } else {
      this.fail(label, `> ${expected}`, String(this.actual));
    }
  }

  /** actual < expected */
  toBeLessThan(expected: number, hint = "") {
    const label = hint || `toBeLessThan(${expected})`;
    if (Number(this.actual) < expected) {
      this.pass(label);
    } else {
      this.fail(label, `< ${expected}`, String(this.actual));
    }
  }

  /** actual >= expected */
  toBeGreaterThanOrEqual(expected: number, hint = "") {
    const label = hint || `toBeGreaterThanOrEqual(${expected})`;
    if (Number(this.actual) >= expected) {
      this.pass(label);
    } else {
      this.fail(label, `>= ${expected}`, String(this.actual));
    }
  }

  /** actual <= expected */
  toBeLessThanOrEqual(expected: number, hint = "") {
    const label = hint || `toBeLessThanOrEqual(${expected})`;
    if (Number(this.actual) <= expected) {
      this.pass(label);
    } else {
      this.fail(label, `<= ${expected}`, String(this.actual));
    }
  }

  /** Truthy check */
  toBeTruthy(hint = "") {
    const label = hint || "toBeTruthy()";
    if (this.actual) {
      this.pass(label);
    } else {
      this.fail(label, "truthy", `falsy (${JSON.stringify(this.actual)})`);
    }
  }

  /** Falsy check */
  toBeFalsy(hint = "") {
    const label = hint || "toBeFalsy()";
    if (!this.actual) {
      this.pass(label);
    } else {
      this.fail(label, "falsy", `truthy (${JSON.stringify(this.actual)})`);
    }
  }

  /** Null check */
  toBeNull(hint = "") {
    const label = hint || "toBeNull()";
    if (this.actual === null) {
      this.pass(label);
    } else {
      this.fail(label, "null", JSON.stringify(this.actual));
    }
  }

  /** Check that actual is not null */
  toBeNotNull(hint = "") {
    const label = hint || "toBeNotNull()";
    if (this.actual !== null) {
      this.pass(label);
    } else {
      this.fail(label, "not null", "null");
    }
  }

  /** Check that a string contains a substring */
  toContain(expected: string, hint = "") {
    const label = hint || `toContain("${expected}")`;
    if (String(this.actual).includes(expected)) {
      this.pass(label);
    } else {
      this.fail(label, `toContain "${expected}"`, String(this.actual));
    }
  }

  /** Check that a function throws */
  toThrow(expectedMsg?: string, hint = "") {
    const label = hint || "toThrow()";
    try {
      (this.actual as unknown as () => void)();
      this.fail(label, expectedMsg ? `throw "${expectedMsg}"` : "throw", "did not throw");
    } catch (err) {
      if (expectedMsg && !(err instanceof Error && err.message.includes(expectedMsg))) {
        this.fail(
          label,
          `throw message containing "${expectedMsg}"`,
          (err instanceof Error ? err.message : String(err)),
        );
      } else {
        this.pass(label);
      }
    }
  }

  /** Approximate numeric equality */
  toBeCloseTo(expected: number, precision = 2, hint = "") {
    const label = hint || `toBeCloseTo(${expected}, ${precision})`;
    const factor = Math.pow(10, precision);
    const diff = Math.abs(Number(this.actual) * factor - expected * factor);
    if (diff < 1) {
      this.pass(label);
    } else {
      this.fail(
        label,
        `≈ ${expected} (±${Math.pow(10, -precision)})`,
        String(this.actual),
      );
    }
  }
}

// ------------------------------------------------------------------
// expect() entry point
// ------------------------------------------------------------------

export function expect<T>(actual: T): Expectation<T> {
  return new Expectation(actual);
}

// ------------------------------------------------------------------
// Runner
// ------------------------------------------------------------------

async function runSuite(suite: Suite): Promise<void> {
  console.log(`\n${BOLD}${CYAN}${suite.name}${RESET}`);
  console.log("─".repeat(60));

  for (const tc of suite.tests) {
    totalTests++;
    try {
      if (suite.beforeEachFn) await suite.beforeEachFn();
      await tc.fn();
      if (suite.afterEachFn) await suite.afterEachFn();
    } catch (err) {
      totalFailed++;
      totalPassed--; // increment was done inside Expectation or we need manual
      console.log(
        `  ${RED}✗${RESET} ${tc.name} ${DIM}— unexpected error: ${err}${RESET}`,
      );
    }
  }
}

async function main(): Promise<void> {
  // Dynamically import the two test files
  // Both files register their describe/test blocks via the global API above.
  await import("./credit-score.test.ts");
  await import("./transfer.test.ts");

  for (const suite of rootSuites) {
    await runSuite(suite);
  }

  // Summary
  console.log("\n" + "═".repeat(60));
  console.log(
    `${BOLD}Results:${RESET}  ${GREEN}${totalPassed} passed${RESET}, ${totalFailed > 0 ? RED : DIM}${totalFailed} failed${RESET}, ${totalTests} total`,
  );
  console.log("═".repeat(60) + "\n");

  if (totalFailed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Test runner crashed: ${err}`);
  process.exit(1);
});
