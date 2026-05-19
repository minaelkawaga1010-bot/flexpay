import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

const DEMO_PHONE = '+971501234567';

const EXCHANGE_TO_AED: Record<string, number> = {
  AED: 1,
  INR: 1 / 22.85,
  PHP: 1 / 15.42,
  PKR: 1 / 76.50,
  USD: 1 / 0.2722,
};

export async function GET() {
  try {
    const user = await db.user.findUnique({
      where: { phone: DEMO_PHONE },
      include: {
        wallet: { include: { balances: true } },
      },
    });

    if (!user || !user.wallet) {
      return NextResponse.json({ error: 'User or wallet not found' }, { status: 404 });
    }

    const totalAED = user.wallet.balances.reduce((sum, b) => {
      return sum + b.amount * (EXCHANGE_TO_AED[b.currency] || 1);
    }, 0);

    return NextResponse.json({
      wallet: {
        id: user.wallet.id,
        isActive: user.wallet.isActive,
        balances: user.wallet.balances,
      },
      totalBalanceAED: Math.round(totalAED * 100) / 100,
    });
  } catch (error) {
    console.error('Wallet GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { amount, currency } = body;

    if (!amount || amount <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
    }

    const validCurrencies = ['AED', 'INR', 'PHP', 'PKR', 'USD'];
    const targetCurrency = currency || 'AED';

    if (!validCurrencies.includes(targetCurrency)) {
      return NextResponse.json({ error: 'Invalid currency' }, { status: 400 });
    }

    const user = await db.user.findUnique({
      where: { phone: DEMO_PHONE },
      include: { wallet: { include: { balances: true } } },
    });

    if (!user || !user.wallet) {
      return NextResponse.json({ error: 'User or wallet not found' }, { status: 404 });
    }

    // Use prisma.$transaction for atomic top-up
    const result = await db.$transaction(async (tx) => {
      // Find or create balance for the currency
      const existingBalance = await tx.balance.findUnique({
        where: {
          walletId_currency: {
            walletId: user.wallet!.id,
            currency: targetCurrency,
          },
        },
      });

      let newBalance;
      if (existingBalance) {
        newBalance = await tx.balance.update({
          where: { id: existingBalance.id },
          data: { amount: { increment: amount } },
        });
      } else {
        newBalance = await tx.balance.create({
          data: {
            walletId: user.wallet!.id,
            currency: targetCurrency,
            amount,
          },
        });
      }

      // Create transaction record
      const transaction = await tx.transaction.create({
        data: {
          userId: user.id,
          type: 'TOP_UP',
          status: 'COMPLETED',
          amount,
          currency: targetCurrency,
          fee: 0,
          description: `Top up ${targetCurrency} ${amount.toFixed(2)}`,
          reference: `TOP${Date.now()}${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
        },
      });

      return { balance: newBalance, transaction };
    });

    return NextResponse.json({
      message: 'Top-up successful',
      balance: result.balance,
      transaction: result.transaction,
    });
  } catch (error) {
    console.error('Wallet POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
