import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// Demo user - Rajesh Kumar
const DEMO_PHONE = '+971501234567';

// Exchange rates to AED
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
        beneficiaries: true,
        transactions: { orderBy: { createdAt: 'desc' }, take: 10 },
        sentTransfers: { where: { status: 'COMPLETED' } },
        receivedTransfers: { where: { status: 'COMPLETED' } },
      },
    });

    if (!user || !user.wallet) {
      return NextResponse.json({ error: 'User or wallet not found' }, { status: 404 });
    }

    // Total balance in AED
    const totalAED = user.wallet.balances.reduce((sum, b) => {
      return sum + b.amount * (EXCHANGE_TO_AED[b.currency] || 1);
    }, 0);

    // Current month bounds
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Total sent this month (P2P_SEND + REMITTANCE)
    const sentThisMonth = await db.transaction.aggregate({
      where: {
        userId: user.id,
        type: { in: ['P2P_SEND', 'REMITTANCE'] },
        status: 'COMPLETED',
        createdAt: { gte: monthStart },
      },
      _sum: { amount: true },
    });

    // Total received this month (P2P_RECEIVE + SALARY_CREDIT)
    const receivedThisMonth = await db.transaction.aggregate({
      where: {
        userId: user.id,
        type: { in: ['P2P_RECEIVE', 'SALARY_CREDIT'] },
        status: 'COMPLETED',
        createdAt: { gte: monthStart },
      },
      _sum: { amount: true },
    });

    // Monthly transaction volume for last 6 months (for chart)
    const monthlyVolume: Array<{ month: string; volume: number; count: number }> = [];
    for (let i = 5; i >= 0; i--) {
      const mStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);

      const monthTxns = await db.transaction.aggregate({
        where: {
          userId: user.id,
          status: 'COMPLETED',
          createdAt: { gte: mStart, lt: mEnd },
        },
        _sum: { amount: true },
        _count: true,
      });

      const monthLabel = mStart.toLocaleString('en-US', { month: 'short' });

      monthlyVolume.push({
        month: monthLabel,
        volume: monthTxns._sum.amount || 0,
        count: monthTxns._count || 0,
      });
    }

    return NextResponse.json({
      user: {
        id: user.id,
        fullName: user.fullName,
        phone: user.phone,
        email: user.email,
        role: user.role,
        kycLevel: user.kycLevel,
        avatarUrl: user.avatarUrl,
      },
      wallet: {
        id: user.wallet.id,
        isActive: user.wallet.isActive,
        balances: user.wallet.balances,
      },
      totalBalanceAED: Math.round(totalAED * 100) / 100,
      recentTransactions: user.transactions,
      quickStats: {
        totalSentThisMonth: sentThisMonth._sum.amount || 0,
        totalReceivedThisMonth: receivedThisMonth._sum.amount || 0,
        beneficiaryCount: user.beneficiaries.length,
        pendingTransfers: user.sentTransfers.filter((t) => t.status === 'PENDING').length,
      },
      monthlyVolume,
    });
  } catch (error) {
    console.error('Dashboard API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
