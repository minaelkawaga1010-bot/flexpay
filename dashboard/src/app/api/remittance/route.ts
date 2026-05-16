import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

const DEMO_PHONE = '+971501234567';

// Exchange rates: 1 AED = X
const EXCHANGE_RATES: Record<string, { rate: number; currency: string }> = {
  INR: { rate: 22.85, currency: 'INR' },
  PHP: { rate: 15.42, currency: 'PHP' },
  PKR: { rate: 76.50, currency: 'PKR' },
  USD: { rate: 0.2722, currency: 'USD' },
};

const REMITTANCE_FEE_RATE = 0.0075; // 0.75%

export async function GET() {
  try {
    const user = await db.user.findUnique({
      where: { phone: DEMO_PHONE },
      include: {
        wallet: { include: { balances: true } },
        beneficiaries: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const aedBalance = user.wallet?.balances.find((b) => b.currency === 'AED');

    return NextResponse.json({
      beneficiaries: user.beneficiaries,
      exchangeRates: EXCHANGE_RATES,
      feeRate: REMITTANCE_FEE_RATE,
      aedBalance: aedBalance?.amount || 0,
    });
  } catch (error) {
    console.error('Remittance GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { beneficiaryId, amount, currency } = body;

    if (!beneficiaryId || !amount || amount <= 0) {
      return NextResponse.json(
        { error: 'Beneficiary ID and valid amount are required' },
        { status: 400 }
      );
    }

    if (!EXCHANGE_RATES[currency]) {
      return NextResponse.json({ error: 'Unsupported destination currency' }, { status: 400 });
    }

    const user = await db.user.findUnique({
      where: { phone: DEMO_PHONE },
      include: {
        wallet: { include: { balances: true } },
        beneficiaries: true,
      },
    });

    if (!user || !user.wallet) {
      return NextResponse.json({ error: 'User or wallet not found' }, { status: 404 });
    }

    // Validate beneficiary belongs to user
    const beneficiary = user.beneficiaries.find((b) => b.id === beneficiaryId);
    if (!beneficiary) {
      return NextResponse.json({ error: 'Beneficiary not found' }, { status: 404 });
    }

    // Check AED balance
    const aedBalance = user.wallet.balances.find((b) => b.currency === 'AED');
    const fee = Math.round(amount * REMITTANCE_FEE_RATE * 100) / 100;
    const totalDebit = amount + fee;

    if (!aedBalance || aedBalance.amount < totalDebit) {
      return NextResponse.json({ error: 'Insufficient AED balance' }, { status: 400 });
    }

    // Calculate destination amount
    const rate = EXCHANGE_RATES[currency].rate;
    const receivedAmount = Math.round(amount * rate * 100) / 100;

    // Atomic transaction
    const result = await db.$transaction(async (tx) => {
      // Deduct from AED balance
      await tx.balance.update({
        where: {
          walletId_currency: {
            walletId: user.wallet!.id,
            currency: 'AED',
          },
        },
        data: { amount: { decrement: totalDebit } },
      });

      // Create transaction record
      const transaction = await tx.transaction.create({
        data: {
          userId: user.id,
          type: 'REMITTANCE',
          status: 'COMPLETED',
          amount,
          currency: 'AED',
          fee,
          description: `Remittance to ${beneficiary.fullName} (${beneficiary.country})`,
          reference: `REM${Date.now()}${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
          metadata: JSON.stringify({
            beneficiaryId,
            beneficiaryName: beneficiary.fullName,
            destinationCurrency: currency,
            exchangeRate: rate,
            receivedAmount,
          }),
        },
      });

      return transaction;
    });

    return NextResponse.json({
      message: 'Remittance created successfully',
      transaction: result,
      summary: {
        sentAED: amount,
        feeAED: fee,
        totalDebitAED: totalDebit,
        destinationCurrency: currency,
        exchangeRate: rate,
        receivedAmount,
        beneficiary: beneficiary.fullName,
        country: beneficiary.country,
      },
    });
  } catch (error) {
    console.error('Remittance POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
