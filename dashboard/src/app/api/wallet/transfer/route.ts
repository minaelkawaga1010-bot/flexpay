import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

const DEMO_PHONE = '+971501234567';

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

      // Deduct from sender balance
      await tx.balance.update({
        where: {
          walletId_currency: {
            walletId: sender.wallet!.id,
            currency: targetCurrency,
          },
        },
        data: { amount: { decrement: amount } },
      });

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

    return NextResponse.json({
      message: 'Transfer successful',
      transfer: result.transfer,
      senderTransaction: result.senderTx,
      receiverTransaction: result.receiverTx,
    });
  } catch (error) {
    console.error('P2P Transfer error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
