/**
 * Ops-intel unit tests.
 *
 * Coverage strategy:
 *   • $queryRaw responses are mocked at the Prisma boundary — the SQL
 *     itself is exercised end-to-end in the docker-compose smoke tests
 *     (deferred). Here we verify the *aggregation logic + invariants*
 *     of the services that wrap the raw SQL.
 *   • Canary trigger: explicit boundary check against the 1.5%
 *     STRATEGY.md §F threshold. This test is the canary on the canary —
 *     if someone moves the constant or drops the breach detection, the
 *     test fails loudly.
 */

jest.mock('@config/prisma', () => ({
  prisma: {
    $queryRaw: jest.fn(),
  },
}));

import { prisma } from '@config/prisma';
import {
  liquidityForecasterService,
} from '@modules/ops-intel/liquidity-forecaster.service';
import { fraudMonitorService } from '@modules/ops-intel/fraud-monitor.service';
import {
  metricsService,
  CANARY_DEFAULT_RATE,
  CARD_INTERCHANGE_BPS,
  FX_MARGIN_BPS,
} from '@modules/ops-intel/metrics.service';

const $queryRaw = prisma.$queryRaw as unknown as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

// ───────────────────────────────────────────────────────────────────
// Liquidity forecaster
// ───────────────────────────────────────────────────────────────────

describe('liquidityForecasterService.forecast', () => {
  it('joins outstanding + corporate inbounds into a per-horizon net curve', async () => {
    // Three $queryRaw calls in order: totals, outstanding-by-bucket,
    // corporate-inbounds-by-bucket. They run via Promise.all so order
    // of arrival isn't guaranteed at runtime, but the mock is keyed on
    // call sequence inside our test. We use mockImplementationOnce to
    // pin the responses to the order of resolution.
    $queryRaw
      // outstanding totals
      .mockResolvedValueOnce([
        { outstandingAED: 10_000, outstandingFeesAED: 100, outstandingCount: 25 },
      ])
      // outstanding by bucket
      .mockResolvedValueOnce([
        { horizonDays: 7, inboundAED: 4_000, inboundFeesAED: 40, advanceCount: BigInt(10) },
        { horizonDays: 15, inboundAED: 7_000, inboundFeesAED: 70, advanceCount: BigInt(18) },
        { horizonDays: 30, inboundAED: 10_000, inboundFeesAED: 100, advanceCount: BigInt(25) },
      ])
      // corporate inbounds by bucket
      .mockResolvedValueOnce([
        { horizonDays: 7, amountAED: 6_000, cycleCount: BigInt(2) },
        { horizonDays: 15, amountAED: 12_000, cycleCount: BigInt(4) },
        { horizonDays: 30, amountAED: 20_000, cycleCount: BigInt(7) },
      ]);

    const forecast = await liquidityForecasterService.forecast();

    expect(forecast.outstandingAED).toBe(10_000);
    expect(forecast.outstandingCount).toBe(25);
    expect(forecast.buckets).toHaveLength(3);
    expect(forecast.corporateInboundsAED).toHaveLength(3);

    // net = corporate inbound − outstanding-due in that horizon
    expect(forecast.netByHorizonAED).toEqual([
      { horizonDays: 7, netAED: 6_000 - 4_000 },
      { horizonDays: 15, netAED: 12_000 - 7_000 },
      { horizonDays: 30, netAED: 20_000 - 10_000 },
    ]);
  });

  it('survives an entirely empty platform (zero rows everywhere)', async () => {
    $queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { horizonDays: 7, inboundAED: 0, inboundFeesAED: 0, advanceCount: BigInt(0) },
        { horizonDays: 15, inboundAED: 0, inboundFeesAED: 0, advanceCount: BigInt(0) },
        { horizonDays: 30, inboundAED: 0, inboundFeesAED: 0, advanceCount: BigInt(0) },
      ])
      .mockResolvedValueOnce([
        { horizonDays: 7, amountAED: 0, cycleCount: BigInt(0) },
        { horizonDays: 15, amountAED: 0, cycleCount: BigInt(0) },
        { horizonDays: 30, amountAED: 0, cycleCount: BigInt(0) },
      ]);

    const forecast = await liquidityForecasterService.forecast();
    expect(forecast.outstandingAED).toBe(0);
    expect(forecast.netByHorizonAED.every((n) => n.netAED === 0)).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────
// Fraud monitor
// ───────────────────────────────────────────────────────────────────

describe('fraudMonitorService.scan', () => {
  it('returns the multiple correctly when both window and baseline are non-zero', async () => {
    $queryRaw
      // velocity rows
      .mockResolvedValueOnce([
        {
          employeeId: 'emp-A',
          windowCount: BigInt(12),
          baselineMean: 1.5,
          totalAEDInWindow: 4_200,
        },
      ])
      // attendance drop rows
      .mockResolvedValueOnce([]);

    const result = await fraudMonitorService.scan();
    expect(result.velocityAlerts).toHaveLength(1);
    expect(result.velocityAlerts[0]).toMatchObject({
      employeeId: 'emp-A',
      windowCount: 12,
      baselineMean: 1.5,
      multiple: 8,
      totalAEDInWindow: 4_200,
    });
  });

  it('reports multiple=Infinity when a worker has zero historical baseline (first-time burst)', async () => {
    $queryRaw
      .mockResolvedValueOnce([
        {
          employeeId: 'emp-B',
          windowCount: BigInt(5),
          baselineMean: 0,
          totalAEDInWindow: 2_000,
        },
      ])
      .mockResolvedValueOnce([]);

    const result = await fraudMonitorService.scan();
    expect(result.velocityAlerts[0].multiple).toBe(Infinity);
  });

  it('computes the dropFraction for attendance anomalies', async () => {
    $queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          companyId: 'co-1',
          companyName: 'Acme Construction',
          todayAccruedAED: 1_300,
          baselineMeanAED: 4_000,
          affectedIntentCount: BigInt(80),
        },
      ]);

    const result = await fraudMonitorService.scan();
    expect(result.attendanceDropAlerts[0]).toMatchObject({
      companyId: 'co-1',
      companyName: 'Acme Construction',
    });
    // (4000 − 1300) / 4000 = 0.675
    expect(result.attendanceDropAlerts[0].dropFraction).toBeCloseTo(0.675, 3);
  });
});

// ───────────────────────────────────────────────────────────────────
// Metrics service — canary boundary
// ───────────────────────────────────────────────────────────────────

describe('metricsService.compile — canary boundary', () => {
  /**
   * Helper to feed the four sequential $queryRaw responses the
   * MetricsService runs in parallel: getGmv, getMau,
   * getCompanyDefaultRatios, getOutstandingAdvanceTotal.
   */
  function pinResponses(opts: {
    gmv: { advanceAED: number; advanceFeesAED: number; remittanceAED: number; cardSpendAED: number; p2pAED: number };
    mau: number;
    cohorts: { companyId: string; companyName: string; disbursedAED: number; uncollectibleAED: number }[];
    outstanding: number;
  }) {
    $queryRaw
      .mockResolvedValueOnce([opts.gmv])
      .mockResolvedValueOnce([{ mau: BigInt(opts.mau) }])
      .mockResolvedValueOnce(opts.cohorts)
      .mockResolvedValueOnce([{ outstandingAED: opts.outstanding }]);
  }

  it('canary stays clear when every cohort is below 1.5%', async () => {
    pinResponses({
      gmv: { advanceAED: 100_000, advanceFeesAED: 1_000, remittanceAED: 50_000, cardSpendAED: 25_000, p2pAED: 0 },
      mau: 5_000,
      cohorts: [
        { companyId: 'c1', companyName: 'Acme', disbursedAED: 100_000, uncollectibleAED: 100 }, // 0.10%
        { companyId: 'c2', companyName: 'Globex', disbursedAED: 80_000, uncollectibleAED: 1_000 }, // 1.25%
      ],
      outstanding: 30_000,
    });

    const m = await metricsService.compile(30);
    expect(m.canaryTripped).toBe(false);
    expect(m.canaryCompanyIds).toEqual([]);
    // platform = (100 + 1000) / (100k + 80k) = 0.00611
    expect(m.defaultRatio).toBeCloseTo(1_100 / 180_000, 4);
  });

  it('canary fires for ANY cohort >= 1.5%, even when platform-level ratio is below threshold', async () => {
    pinResponses({
      gmv: { advanceAED: 200_000, advanceFeesAED: 2_000, remittanceAED: 0, cardSpendAED: 0, p2pAED: 0 },
      mau: 1_000,
      cohorts: [
        { companyId: 'c1', companyName: 'Healthy Cohort', disbursedAED: 190_000, uncollectibleAED: 100 }, // 0.05%
        { companyId: 'c2', companyName: 'Toxic Cohort', disbursedAED: 10_000, uncollectibleAED: 200 }, // 2.0%
      ],
      outstanding: 0,
    });

    const m = await metricsService.compile(30);
    expect(m.canaryTripped).toBe(true);
    expect(m.canaryCompanyIds).toEqual(['c2']);
    // Platform-level is well under 1.5%, proving the trigger is cohort-scoped.
    expect(m.defaultRatio).toBeLessThan(CANARY_DEFAULT_RATE);
  });

  it('canary fires exactly at the boundary of 1.5%', async () => {
    pinResponses({
      gmv: { advanceAED: 100_000, advanceFeesAED: 1_000, remittanceAED: 0, cardSpendAED: 0, p2pAED: 0 },
      mau: 100,
      cohorts: [
        { companyId: 'c1', companyName: 'Boundary Cohort', disbursedAED: 100_000, uncollectibleAED: 1_500 }, // exactly 1.5%
      ],
      outstanding: 0,
    });

    const m = await metricsService.compile(30);
    expect(m.canaryTripped).toBe(true);
    expect(m.canaryCompanyIds).toEqual(['c1']);
  });

  it('rolls modelled FX margin (50 bps) + card interchange (110 bps) into net marginal revenue', async () => {
    pinResponses({
      gmv: {
        advanceAED: 0,
        advanceFeesAED: 500,
        remittanceAED: 200_000,
        cardSpendAED: 100_000,
        p2pAED: 0,
      },
      mau: 0,
      cohorts: [],
      outstanding: 0,
    });

    const m = await metricsService.compile(30);
    const expectedRemMargin = 200_000 * (FX_MARGIN_BPS / 10_000);
    const expectedInterchange = 100_000 * (CARD_INTERCHANGE_BPS / 10_000);
    expect(m.revenueBreakdown.remittanceMarginAED).toBeCloseTo(expectedRemMargin, 2);
    expect(m.revenueBreakdown.cardInterchangeAED).toBeCloseTo(expectedInterchange, 2);
    expect(m.netMarginalRevenueAED).toBeCloseTo(500 + expectedRemMargin + expectedInterchange, 2);
  });
});
