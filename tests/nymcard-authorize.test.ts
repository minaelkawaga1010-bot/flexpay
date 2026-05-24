/**
 * A.8 NymCard synchronous authorization — unit tests.
 *
 * Covers:
 *   • HeuristicFraudScorer risk surface (safe / velocity / MCC / geo)
 *   • /authorize decision pipeline: APPROVE, DECLINE(FRAUD_RISK),
 *     DECLINE(INSUFFICIENT_FUNDS), DECLINE(BALANCE_UNAVAILABLE),
 *     invalid signature → 401, malformed body → DECLINE
 *   • Latency: a happy-path decision stays well under the 50ms budget
 */

jest.mock('@config/prisma', () => ({
  prisma: {
    card: { findUnique: jest.fn() },
  },
}));

jest.mock('@config/redis', () => ({
  __esModule: true,
  default: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('@modules/cards/nymcard.service', () => ({
  nymcardService: { verifyWebhookSignature: jest.fn() },
}));

import { prisma } from '@config/prisma';
import { nymcardService } from '@modules/cards/nymcard.service';
import { nymCardAuthorizeWebhook } from '../src/webhooks/nymcard-authorize.webhook';
import {
  HeuristicFraudScorer,
  FRAUD_DECLINE_THRESHOLD,
} from '../src/modules/cards/fraud-scorer.service';

const mocked = prisma as unknown as { card: { findUnique: jest.Mock } };

function buildReq(body: unknown, headers: Record<string, string> = {}): any {
  return {
    body: Buffer.from(JSON.stringify(body)),
    header: (name: string) => headers[name.toLowerCase()],
  };
}

function buildRes(): any {
  const res: any = {};
  res.status = jest.fn((c: number) => {
    res.statusCode = c;
    return res;
  });
  res.json = jest.fn((b: unknown) => {
    res.body = b;
    return res;
  });
  return res;
}

async function invoke(req: any, res: any): Promise<void> {
  const layer: any = nymCardAuthorizeWebhook.router.stack.find(
    (l: any) => l.route?.path === '/authorize',
  );
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const next = (err?: unknown) => {
      if (settled) return;
      settled = true;
      if (err) reject(err as Error);
      else resolve();
    };
    handler(req, res, next);
    setImmediate(() => next());
  });
}

const validBody = {
  card_id: 'nym-1',
  amount: 250,
  currency: 'AED',
  merchant_mcc: '5411', // grocery — low risk
  merchant_country: 'AE',
  device_fingerprint: 'dev-abc',
};

beforeEach(() => {
  jest.clearAllMocks();
  (nymcardService.verifyWebhookSignature as jest.Mock).mockReturnValue(true);
});

// ───────────────────────────────────────────────────────────────────
// HeuristicFraudScorer
// ───────────────────────────────────────────────────────────────────

describe('HeuristicFraudScorer', () => {
  const scorer = new HeuristicFraudScorer();
  const base = {
    cardId: 'c1',
    amount: 100,
    merchantMcc: '5411',
    merchantCountry: 'AE',
    deviceFingerprint: 'd1',
    recentTxCount60s: 0,
    recentTxAmount60s: 0,
    homeCountry: 'AE',
  };

  it('scores a normal domestic grocery purchase as low risk', async () => {
    const s = await scorer.score(base);
    expect(s).toBeLessThan(FRAUD_DECLINE_THRESHOLD);
  });

  it('flags a high-risk MCC + sanctioned geography above threshold', async () => {
    const s = await scorer.score({
      ...base,
      merchantMcc: '7995', // gambling
      merchantCountry: 'IR', // sanctioned
    });
    expect(s).toBeGreaterThan(FRAUD_DECLINE_THRESHOLD);
  });

  it('flags a velocity burst (card testing)', async () => {
    const s = await scorer.score({
      ...base,
      recentTxCount60s: 5,
      recentTxAmount60s: 6000,
    });
    expect(s).toBeGreaterThan(FRAUD_DECLINE_THRESHOLD);
  });

  it('clamps the score to [0,1] even with stacked risk', async () => {
    const s = await scorer.score({
      ...base,
      merchantMcc: '7995',
      merchantCountry: 'KP',
      recentTxCount60s: 9,
      recentTxAmount60s: 99999,
      amount: 9999,
      deviceFingerprint: undefined,
    });
    expect(s).toBeLessThanOrEqual(1);
    expect(s).toBeGreaterThanOrEqual(0);
  });
});

// ───────────────────────────────────────────────────────────────────
// /authorize pipeline
// ───────────────────────────────────────────────────────────────────

describe('NymCardAuthorizeWebhook /authorize', () => {
  it('APPROVEs a clean transaction with sufficient balance', async () => {
    mocked.card.findUnique.mockResolvedValue({ employee: { walletBalance: 5000 } });
    const req = buildReq(validBody);
    const res = buildRes();
    await invoke(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ decision: 'APPROVE' });
  });

  it('DECLINEs on insufficient funds', async () => {
    mocked.card.findUnique.mockResolvedValue({ employee: { walletBalance: 10 } });
    const req = buildReq(validBody);
    const res = buildRes();
    await invoke(req, res);
    expect(res.body).toEqual({ decision: 'DECLINE', reason: 'INSUFFICIENT_FUNDS' });
  });

  it('DECLINEs on fraud risk before checking balance', async () => {
    const req = buildReq({ ...validBody, merchant_mcc: '7995', merchant_country: 'IR' });
    const res = buildRes();
    await invoke(req, res);
    expect(res.body).toEqual({ decision: 'DECLINE', reason: 'FRAUD_RISK' });
    // Balance lookup must NOT run when fraud already declined.
    expect(mocked.card.findUnique).not.toHaveBeenCalled();
  });

  it('DECLINEs with BALANCE_UNAVAILABLE when the card is unknown', async () => {
    mocked.card.findUnique.mockResolvedValue(null);
    const req = buildReq(validBody);
    const res = buildRes();
    await invoke(req, res);
    expect(res.body).toEqual({ decision: 'DECLINE', reason: 'BALANCE_UNAVAILABLE' });
  });

  it('returns 401 on an invalid HMAC signature', async () => {
    (nymcardService.verifyWebhookSignature as jest.Mock).mockReturnValue(false);
    const req = buildReq(validBody);
    const res = buildRes();
    await invoke(req, res);
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'invalid_signature' });
  });

  it('DECLINEs a malformed body (fail safe)', async () => {
    const req = { body: Buffer.from('not json'), header: () => undefined } as any;
    (nymcardService.verifyWebhookSignature as jest.Mock).mockReturnValue(true);
    const res = buildRes();
    await invoke(req, res);
    expect(res.body).toEqual({ decision: 'DECLINE', reason: 'MALFORMED_REQUEST' });
  });

  it('decides a happy-path authorization well within the 50ms budget', async () => {
    mocked.card.findUnique.mockResolvedValue({ employee: { walletBalance: 5000 } });
    const req = buildReq(validBody);
    const res = buildRes();
    const t0 = Date.now();
    await invoke(req, res);
    const elapsed = Date.now() - t0;
    expect(res.body).toEqual({ decision: 'APPROVE' });
    // Generous CI ceiling; the pipeline itself is sub-millisecond with
    // mocked I/O. The real budget guard is exercised in the timeout path.
    expect(elapsed).toBeLessThan(50);
  });
});
