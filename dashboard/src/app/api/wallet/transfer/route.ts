import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { db } from '@/lib/db';

const DEMO_PHONE = '+971501234567';

/**
 * Thrown inside the transfer transaction when the atomic, guarded debit
 * fails to affect exactly one row — i.e. the sender's balance dropped
 * below the requested amount between the pre-flight check and the write
 * (a concurrent transfer won the race). Throwing rolls the whole
 * transaction back; the outer handler maps it to a clean 400 rather
 * than a 500.
 */
class InsufficientBalanceError extends Error {
  constructor() {
    super('Insufficient balance');
    this.name = 'InsufficientBalanceError';
  }
}

/**
 * Universal receipt hash — a deterministic, tamper-evident fingerprint
 * of a completed transfer. SHA-256 over the canonical, ordered field
 * set so the same transfer always yields the same hash and any change
 * to amount / parties / currency changes it. Returned to the client so
 * the success UI can stream a verifiable receipt id.
 */
function universalReceiptHash(input: {
  transferId: string;
  senderId: string;
  receiverId: string;
  amount: number;
  currency: string;
  createdAt: Date;
}): string {
  const canonical = [
    input.transferId,
    input.senderId,
    input.receiverId,
    input.amount.toFixed(2),
    input.currency,
    input.createdAt.toISOString(),
  ].join('|');
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { receiverPhone, amount, currency, note } = body;

    // Validate input
    if (!receiverPhone || !amount || amount <= 0) {
      return NextResponse.json(
        { error: 'Receiver phone and valid amount are required' },
        { status: 400 }
      );
    }

    const targetCurrency = currency || 'AED';
    const validCurrencies = ['AED', 'INR', 'PHP', 'PKR', 'USD'];
    if (!validCurrencies.includes(targetCurrency)) {
      return NextResponse.json({ error: 'Invalid currency' }, { status: 400 });
    }

    // Find sender (demo user)
    const sender = await db.user.findUnique({
      where: { phone: DEMO_PHONE },
      include: { wallet: { include: { balances: true } } },
    });

    if (!sender || !sender.wallet) {
      return NextResponse.json({ error: 'Sender wallet not found' }, { status: 404 });
    }

    // Find receiver
    const receiver = await db.user.findUnique({
      where: { phone: receiverPhone },
      include: { wallet: { include: { balances: true } } },
    });

    if (!receiver) {
      return NextResponse.json({ error: 'Receiver not found' }, { status: 404 });
    }

    if (sender.id === receiver.id) {
      return NextResponse.json({ error: 'Cannot transfer to yourself' }, { status: 400 });
    }

    // Check sender balance
    const senderBalance = sender.wallet.balances.find(
      (b) => b.currency === targetCurrency
    );

    if (!senderBalance || senderBalance.amount < amount) {
      return NextResponse.json(
        { error: 'Insufficient balance' },
        { status: 400 }
      );
    }

    // Atomic transaction: create transfer, update balances, create transaction records
    const result = await db.$transaction(async (tx) => {
      // Create P2PTransfer record
      const transfer = await tx.p2PTransfer.create({
        data: {
          senderId: sender.id,
          receiverId: receiver.id,
          amount,
          currency: targetCurrency,
          note: note || null,
          status: 'COMPLETED',
        },
      });

      // Atomic guarded debit. The `amount: { gte: amount }` predicate is
      // evaluated by the database as part of the same UPDATE that
      // decrements, so two concurrent transfers for the same sender
      // cannot both pass — only one UPDATE will match the row while it
      // still holds sufficient balance. `updateMany` (not `update`) is
      // required because Prisma's `update.where` accepts only unique
      // selectors, whereas this needs the non-unique `gte` guard.
      // count !== 1 ⇒ the balance was insufficient at write time; throw
      // to roll the whole transaction back.
      const debit = await tx.balance.updateMany({
        where: {
          walletId: sender.wallet!.id,
          currency: targetCurrency,
          amount: { gte: amount },
        },
        data: { amount: { decrement: amount } },
      });
      if (debit.count !== 1) {
        throw new InsufficientBalanceError();
      }

      // Add to receiver balance (find or create)
      const receiverBal = await tx.balance.findUnique({
        where: {
          walletId_currency: {
            walletId: receiver.wallet!.id,
            currency: targetCurrency,
          },
        },
      });

      if (receiverBal) {
        await tx.balance.update({
          where: { id: receiverBal.id },
          data: { amount: { increment: amount } },
        });
      } else {
        await tx.balance.create({
          data: {
            walletId: receiver.wallet!.id,
            currency: targetCurrency,
            amount,
          },
        });
      }

      // Create sender's transaction (P2P_SEND)
      const senderTx = await tx.transaction.create({
        data: {
          userId: sender.id,
          type: 'P2P_SEND',
          status: 'COMPLETED',
          amount,
          currency: targetCurrency,
          fee: 0,
          description: `Transfer to ${receiver.fullName}`,
          reference: `P2S${Date.now()}${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
          metadata: JSON.stringify({ transferId: transfer.id, receiverPhone, receiverName: receiver.fullName }),
        },
      });

      // Create receiver's transaction (P2P_RECEIVE)
      const receiverTx = await tx.transaction.create({
        data: {
          userId: receiver.id,
          type: 'P2P_RECEIVE',
          status: 'COMPLETED',
          amount,
          currency: targetCurrency,
          fee: 0,
          description: `Received from ${sender.fullName}`,
          reference: `P2R${Date.now()}${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
          metadata: JSON.stringify({ transferId: transfer.id, senderPhone: DEMO_PHONE, senderName: sender.fullName }),
        },
      });

      return { transfer, senderTx, receiverTx };
    });

    const receiptHash = universalReceiptHash({
      transferId: result.transfer.id,
      senderId: sender.id,
      receiverId: receiver.id,
      amount,
      currency: targetCurrency,
      createdAt: result.transfer.createdAt,
    });

    return NextResponse.json({
      message: 'Transfer successful',
      transfer: result.transfer,
      senderTransaction: result.senderTx,
      receiverTransaction: result.receiverTx,
      universalReceiptHash: receiptHash,
    });
  } catch (error) {
    // A lost balance race is a client-actionable 400, not a server error.
    if (error instanceof InsufficientBalanceError) {
      return NextResponse.json({ error: 'Insufficient balance' }, { status: 400 });
    }
    console.error('P2P Transfer error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
