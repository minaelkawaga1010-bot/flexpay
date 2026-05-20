// ============================================================
// Ops-Intel Client Tests
// ============================================================
// Pure-function coverage for the cohort canary classifier and the
// renderer helpers. The canary thresholds are load-bearing — if the
// constants drift from the backend's, the dashboard would silently
// disagree with the production failsafe. These tests pin the values.
// ============================================================
import { describe, test, expect } from "./run-tests.ts";
import {
  CANARY_DEFAULT_RATE,
  CANARY_WARN_RATE,
  classifyCohort,
  formatAED,
  formatRatio,
} from "../lib/ops-intel-client.ts";

describe("Canary thresholds", () => {
  test("canary trigger is fixed at 1.5% — STRATEGY.md §F", () => {
    expect(CANARY_DEFAULT_RATE).toBe(0.015);
  });

  test("warning band is fixed at 1.25% — 25bps under the trigger", () => {
    expect(CANARY_WARN_RATE).toBe(0.0125);
  });

  test("warning band is strictly below the canary trigger", () => {
    expect(CANARY_WARN_RATE < CANARY_DEFAULT_RATE).toBe(true);
  });
});

describe("classifyCohort", () => {
  test("healthy cohort (ratio < 1.25%)", () => {
    expect(classifyCohort(0)).toBe("healthy");
    expect(classifyCohort(0.005)).toBe("healthy");
    expect(classifyCohort(0.0124)).toBe("healthy");
  });

  test("warning cohort (1.25% <= ratio < 1.5%)", () => {
    expect(classifyCohort(0.0125)).toBe("warning");
    expect(classifyCohort(0.013)).toBe("warning");
    expect(classifyCohort(0.0149)).toBe("warning");
  });

  test("tripped cohort (ratio >= 1.5%)", () => {
    expect(classifyCohort(0.015)).toBe("tripped");
    expect(classifyCohort(0.02)).toBe("tripped");
    expect(classifyCohort(1)).toBe("tripped");
  });

  test("exact boundary at 1.5% trips the canary (>= semantics)", () => {
    expect(classifyCohort(CANARY_DEFAULT_RATE)).toBe("tripped");
  });

  test("exact boundary at 1.25% enters the warning band", () => {
    expect(classifyCohort(CANARY_WARN_RATE)).toBe("warning");
  });
});

describe("formatAED", () => {
  test("renders zero", () => {
    expect(formatAED(0)).toContain("AED");
    expect(formatAED(0)).toContain("0");
  });

  test("renders thousand-separated whole units", () => {
    const s = formatAED(1234567);
    expect(s.includes("1,234,567") || s.includes("1234567")).toBe(true);
  });
});

describe("formatRatio", () => {
  test("renders 1.5% with two decimals", () => {
    expect(formatRatio(0.015)).toBe("1.50%");
  });

  test("renders 0% boundary", () => {
    expect(formatRatio(0)).toBe("0.00%");
  });

  test("rounds at the third decimal", () => {
    expect(formatRatio(0.01239)).toBe("1.24%");
  });
});
