/**
 * A.9 SIF Anomaly Interceptor — unit tests for Stages 2-6.
 *
 * The pipeline is pure given injected models, so we test it directly
 * without Prisma. We bind deterministic test doubles for the MOHRE
 * validator (controls labour-card-active + registered) and exercise
 * the real StatisticalTemporalModel / StatisticalRowOutlierModel and
 * the pure ghost-employee sweep.
 */

import {
  runSifAnomalyPipeline,
  sweepGhostEmployees,
  setMohreValidator,
  StatisticalTemporalModel,
  StatisticalRowOutlierModel,
  type MohreValidationResult,
  type MohreValidator,
} from '../src/modules/payroll-ingestion/sif-anomaly.service';
import type { ParsedSif, SifSalaryRow } from '../src/modules/payroll-ingestion/wps-parser.service';

// ───────────────────────────────────────────────────────────────────
// Builders
// ───────────────────────────────────────────────────────────────────

let serial = 0;
function row(overrides: Partial<SifSalaryRow> = {}): SifSalaryRow {
  serial += 1;
  return {
    rowNumber: serial,
    nationalId: String(784199900000000 + serial).padStart(15, '0'),
    labourCardNumber: `LC-${serial}`,
    routingCode: 'AEBL',
    accountNumber: `AE07${String(serial).padStart(20, '0')}`,
    salaryFrequency: 'M',
    numberOfWorkingDays: 30,
    fixedSalary: 3000,
    variableSalary: 0,
    totalSalary: 3000,
    lineHash: `hash-${serial}`,
    ...overrides,
  };
}

function parsed(rows: SifSalaryRow[]): ParsedSif {
  return {
    header: {
      employerId: '12345678901234',
      fileCreationDate: new Date('2026-04-30T00:00:00Z'),
      fileCreationTime: '0930',
      bankSponsorCode: 'NYMCARD',
      salaryYearMonth: '202604',
      currency: 'AED',
    },
    rows,
    trailer: { recordCount: rows.length, totalSalary: rows.reduce((s, r) => s + r.totalSalary, 0) },
    fileFingerprint: 'fp-test',
    byteLength: 1000,
  };
}

function mohreAll(rows: SifSalaryRow[], opts: { active: boolean; registered: boolean }): MohreValidator {
  return {
    async validateBatch(): Promise<MohreValidationResult> {
      const result: MohreValidationResult = {};
      for (const r of rows) {
        result[r.nationalId] = { laborCardActive: opts.active, registered: opts.registered };
      }
      return result;
    },
  };
}

beforeEach(() => {
  serial = 0;
});

afterEach(() => {
  // Reset to default optimistic validator so leaking bindings don't
  // affect other suites.
  setMohreValidator({
    async validateBatch({ nationalIds }) {
      const r: MohreValidationResult = {};
      for (const id of nationalIds) r[id] = { laborCardActive: true, registered: true };
      return r;
    },
  });
});

// ───────────────────────────────────────────────────────────────────
// Ghost-employee sweep (Stage 5, pure rules)
// ───────────────────────────────────────────────────────────────────

describe('sweepGhostEmployees', () => {
  it('flags a high-salary worker with unknown IBAN + inactive labour card', () => {
    const normal = [row({ totalSalary: 2500 }), row({ totalSalary: 2800 }), row({ totalSalary: 3000 })];
    const ghost = row({ totalSalary: 50000, accountNumber: 'AE07-FRESH-IBAN' });
    const rows = [...normal, ghost];

    const mohre: MohreValidationResult = {};
    for (const r of normal) mohre[r.nationalId] = { laborCardActive: true, registered: true };
    mohre[ghost.nationalId] = { laborCardActive: false, registered: true };

    const ghosts = sweepGhostEmployees(rows, mohre, { knownIbans: new Set() });
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0].nationalId).toBe(ghost.nationalId);
    expect(ghosts[0].reason).toBe('GHOST_EMPLOYEE_CANDIDATE');
  });

  it('does NOT flag a high earner whose labour card is active', () => {
    const rows = [row({ totalSalary: 3000 }), row({ totalSalary: 3000 }), row({ totalSalary: 50000 })];
    const mohre: MohreValidationResult = {};
    for (const r of rows) mohre[r.nationalId] = { laborCardActive: true, registered: true };
    const ghosts = sweepGhostEmployees(rows, mohre, { knownIbans: new Set() });
    expect(ghosts).toHaveLength(0);
  });

  it('does NOT flag an inactive worker whose IBAN is already known', () => {
    const rows = [row({ totalSalary: 3000 }), row({ totalSalary: 3000 }), row({ totalSalary: 50000 })];
    const mohre: MohreValidationResult = {};
    for (const r of rows) mohre[r.nationalId] = { laborCardActive: false, registered: true };
    const known = new Set(rows.map((r) => r.accountNumber));
    const ghosts = sweepGhostEmployees(rows, mohre, { knownIbans: known });
    expect(ghosts).toHaveLength(0);
  });
});

// ───────────────────────────────────────────────────────────────────
// Temporal model (Stage 3)
// ───────────────────────────────────────────────────────────────────

describe('StatisticalTemporalModel', () => {
  const model = new StatisticalTemporalModel();

  it('returns false with <2 cycles of history (no baseline)', () => {
    expect(
      model.isAnomalous({ history: { cycleTotals: [100000], cycleHeadcounts: [30] }, currentTotal: 999999, currentHeadcount: 30 }),
    ).toBe(false);
  });

  it('flags a >40% headcount jump', () => {
    expect(
      model.isAnomalous({
        history: { cycleTotals: [100000, 100000, 100000], cycleHeadcounts: [30, 30, 30] },
        currentTotal: 100000,
        currentHeadcount: 60, // +100%
      }),
    ).toBe(true);
  });

  it('does not flag a stable cycle', () => {
    expect(
      model.isAnomalous({
        history: { cycleTotals: [100000, 101000, 99000], cycleHeadcounts: [30, 30, 31] },
        currentTotal: 100500,
        currentHeadcount: 30,
      }),
    ).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────
// Row outlier model (Stage 4)
// ───────────────────────────────────────────────────────────────────

describe('StatisticalRowOutlierModel', () => {
  const model = new StatisticalRowOutlierModel();

  it('scores a salary outlier below the flag threshold', () => {
    const rows = [
      row({ totalSalary: 3000 }),
      row({ totalSalary: 3100 }),
      row({ totalSalary: 2900 }),
      row({ totalSalary: 3050 }),
      row({ totalSalary: 80000 }), // extreme outlier
    ];
    const scores = model.scoreRows(rows);
    const outlierScore = scores[scores.length - 1];
    expect(outlierScore).toBeLessThan(model.flagThreshold);
  });

  it('returns neutral scores for too-few rows', () => {
    const scores = model.scoreRows([row(), row()]);
    expect(scores.every((s) => s === 0)).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────
// Full ensemble pipeline (Stage 6)
// ───────────────────────────────────────────────────────────────────

describe('runSifAnomalyPipeline — ensemble decision', () => {
  const history = { cycleTotals: [90000, 91000, 89000], cycleHeadcounts: [30, 30, 30] };

  it('APPROVES a clean, in-baseline batch with all workers registered + active', async () => {
    const rows = Array.from({ length: 5 }, () => row({ totalSalary: 3000 }));
    setMohreValidator(mohreAll(rows, { active: true, registered: true }));
    const report = await runSifAnomalyPipeline({
      parsed: parsed(rows),
      establishmentId: '12345678901234',
      history,
    });
    expect(report.decision).toBe('APPROVED');
    expect(report.wpsReady).toBe(true);
    expect(report.flags).toHaveLength(0);
  });

  it('HARD_BLOCKs when a ghost-employee candidate is present', async () => {
    const normal = Array.from({ length: 4 }, () => row({ totalSalary: 3000 }));
    const ghost = row({ totalSalary: 60000, accountNumber: 'AE07-GHOST' });
    const rows = [...normal, ghost];
    // Ghost is registered (passes Stage 2) but labour card inactive.
    setMohreValidator({
      async validateBatch(): Promise<MohreValidationResult> {
        const r: MohreValidationResult = {};
        for (const n of normal) r[n.nationalId] = { laborCardActive: true, registered: true };
        r[ghost.nationalId] = { laborCardActive: false, registered: true };
        return r;
      },
    });
    const report = await runSifAnomalyPipeline({
      parsed: parsed(rows),
      establishmentId: '12345678901234',
      history,
    });
    expect(report.decision).toBe('BLOCKED');
    expect(report.wpsReady).toBe(false);
    expect(report.ghostCandidates.length).toBeGreaterThanOrEqual(1);
  });

  it('FLAGS (not blocks) when only a MOHRE-unregistered worker is present', async () => {
    const rows = Array.from({ length: 5 }, () => row({ totalSalary: 3000 }));
    setMohreValidator({
      async validateBatch(): Promise<MohreValidationResult> {
        const r: MohreValidationResult = {};
        rows.forEach((n, i) => {
          // last worker unregistered, but active labour card (not a ghost)
          r[n.nationalId] = { laborCardActive: true, registered: i !== rows.length - 1 };
        });
        return r;
      },
    });
    const report = await runSifAnomalyPipeline({
      parsed: parsed(rows),
      establishmentId: '12345678901234',
      history,
    });
    expect(report.decision).toBe('FLAGGED');
    expect(report.wpsReady).toBe(true);
    expect(report.requiresReview).toBe(true);
    expect(report.flags.some((f) => f.reason === 'MOHRE_NOT_REGISTERED')).toBe(true);
  });

  it('records per-stage timings', async () => {
    const rows = Array.from({ length: 3 }, () => row());
    setMohreValidator(mohreAll(rows, { active: true, registered: true }));
    const report = await runSifAnomalyPipeline({
      parsed: parsed(rows),
      establishmentId: '12345678901234',
      history,
    });
    expect(report.stageTimingsMs).toHaveProperty('mohreValidation');
    expect(report.stageTimingsMs).toHaveProperty('temporalAnomaly');
    expect(report.stageTimingsMs).toHaveProperty('rowOutlierScan');
    expect(report.stageTimingsMs).toHaveProperty('ghostSweep');
  });
});
