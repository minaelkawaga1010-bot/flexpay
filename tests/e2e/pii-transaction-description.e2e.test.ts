import { randomBytes } from 'crypto';
import request from 'supertest';
import { app } from '@/app';
import { prisma } from '@config/prisma';
import redisService from '@config/redis';
import { closeAllQueues } from '@config/bull';
import { generateAccessToken } from '@shared/utils/jwt';
import { walletService } from '@modules/wallet/wallet.service';
import { remittanceService } from '@modules/remittance/remittance.service';
import { moneyHashService } from '@modules/remittance/moneyhash.service';

/**
 * TASK-018.0 — NEW financial transaction descriptions persist no PII, the
 * history API masks the counterparty phone, and financial behaviour
 * (amounts, references, idempotency, concurrency, history) is unchanged.
 * Real app + PostgreSQL + Redis. Also the pre-fix detector: on the old code
 * the persisted descriptions contain the counterparty phone / beneficiary
 * name.
 */

const PREFIX = '/api/v1';
const ids: string[] = [];
const uid = () => randomBytes(5).toString('hex');
const phone = () => `+97151${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;

async function employee(balance = 1000): Promise<{ id: string; phone: string; token: string; fullName: string }> {
  const p = phone();
  const fullName = `Name_${uid()}`;
  const e = await prisma.employee.create({ data: { phone: p, fullName, plan: 'BASIC', status: 'ACTIVE', walletBalance: balance } });
  ids.push(e.id);
  return { id: e.id, phone: p, fullName, token: generateAccessToken({ userId: e.id, role: 'employee' }) };
}
const txns = (employeeId: string) =>
  prisma.employeeTransaction.findMany({ where: { employeeId }, orderBy: { createdAt: 'asc' } });

describe('no PII in transaction descriptions — real app + PostgreSQL (TASK-018.0)', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await redisService.connect();
  });
  afterAll(async () => {
    await prisma.employeeTransaction.deleteMany({ where: { employeeId: { in: ids } } });
    await prisma.employee.deleteMany({ where: { id: { in: ids } } });
    await closeAllQueues();
    await redisService.disconnect();
    await prisma.$disconnect();
  });

  it('a P2P transfer persists neutral descriptions (no phone / name) but keeps amounts + counterparty id', async () => {
    const a = await employee(1000);
    const b = await employee(0);

    const res = await walletService.transfer({ senderId: a.id, recipientPhone: b.phone, amount: 100 });
    expect(res.success).toBe(true);

    const [senderRow] = await txns(a.id);
    const [recipientRow] = await txns(b.id);
    for (const row of [senderRow, recipientRow]) {
      expect(row.description).not.toContain(a.phone);
      expect(row.description).not.toContain(b.phone);
      expect(row.description).not.toContain(a.fullName);
      expect(row.description).not.toContain(b.fullName);
    }
    expect(senderRow.description).toBe('P2P transfer sent');
    expect(recipientRow.description).toBe('P2P transfer received');
    // Financial values + structured references unchanged.
    expect(senderRow.amount).toBe(-100);
    expect(recipientRow.amount).toBe(100);
    expect(senderRow.counterpartyId).toBe(b.id);
    expect(recipientRow.counterpartyId).toBe(a.id);
  });

  it('the history API masks the counterparty phone (no other customer’s full number)', async () => {
    const a = await employee(1000);
    const b = await employee(0);
    await walletService.transfer({ senderId: a.id, recipientPhone: b.phone, amount: 50 });

    // B (the receiver) views their own history — must not see A's full phone.
    const res = await request(app).get(`${PREFIX}/wallet/transactions`).set('Authorization', `Bearer ${b.token}`);
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(a.phone);
    const receive = res.body.transactions.find((t: { type: string }) => t.type === 'RECEIVE');
    expect(receive.counterpartyPhone).toMatch(/^••••\d{4}$/);
    expect(receive.description).toBe('P2P transfer received');
  });

  it('a retried transfer (same key) applies one financial effect — unchanged idempotency', async () => {
    const a = await employee(1000);
    const b = await employee(0);
    const key = `wallet:transfer:${a.id}:dup-${uid()}`;
    // Sequential retry (service-level idempotency replays the prior outcome).
    const first = await walletService.transfer({ senderId: a.id, recipientPhone: b.phone, amount: 100, idempotencyKey: key });
    const retry = await walletService.transfer({ senderId: a.id, recipientPhone: b.phone, amount: 100, idempotencyKey: key });
    expect(first.success).toBe(true);
    expect((retry as { replay?: boolean }).replay).toBe(true);
    // Exactly one TRANSFER booked; recipient credited once (invariant unchanged).
    expect(await prisma.employeeTransaction.count({ where: { employeeId: a.id, type: 'TRANSFER' } })).toBe(1);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: b.id } })).walletBalance).toBe(100);
  });

  it('a remittance persists a neutral description, yet the provider still receives the beneficiary name', async () => {
    const a = await employee(1000);
    const beneficiaryName = `Beneficiary_${uid()}`;
    let sentToProvider: string | undefined;
    const spy = jest.spyOn(moneyHashService, 'createTransfer').mockImplementation(async (req) => {
      sentToProvider = req.beneficiary.name; // capture before restore
      return `mh-${uid()}`;
    });
    try {
      await remittanceService.send(a.id, 300, 'EGP', { name: beneficiaryName, bankAccount: '00012345', swiftCode: 'ABCDAEAA' });
    } finally {
      spy.mockRestore();
    }
    const remittance = (await txns(a.id)).find((t) => t.type === 'REMITTANCE')!;
    // Beneficiary name is NOT persisted in the internal description…
    expect(remittance.description).toBe('Remittance (EGP)');
    expect(remittance.description).not.toContain(beneficiaryName);
    // …but it WAS sent to MoneyHash in the transfer request (req 7 preserved).
    expect(sentToProvider).toBe(beneficiaryName);
  });

  it('existing historical rows are never rewritten', async () => {
    const a = await employee(1000);
    const legacy = await prisma.employeeTransaction.create({
      data: { employeeId: a.id, type: 'TRANSFER', amount: -10, totalAmount: -10, status: 'COMPLETED', description: `P2P to ${a.phone}` },
    });
    const b = await employee(0);
    await walletService.transfer({ senderId: a.id, recipientPhone: b.phone, amount: 20 });

    const after = await prisma.employeeTransaction.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(after.description).toBe(`P2P to ${a.phone}`); // untouched (no backfill / rewrite)
  });
});
