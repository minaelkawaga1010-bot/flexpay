import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

const DEMO_PHONE = '+971501234567';

export async function GET() {
  try {
    const user = await db.user.findUnique({
      where: { phone: DEMO_PHONE },
      include: { creditScores: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    let creditScore = user.creditScores[0];

    if (!creditScore) {
      // Create a default credit score with numeric factors
      creditScore = await db.creditScore.create({
        data: {
          userId: user.id,
          score: 50,
          factors: JSON.stringify({
            frequency: 40,
            repayment: 50,
            age: 20,
            telecom: 45,
          }),
        },
      });
    }

    const rawFactors = JSON.parse(creditScore.factors || '{}');
    // Normalize factors to numeric format (handle old string-based seed data)
    const factors = normalizeFactors(rawFactors);
    const scoreBand = getScoreBand(creditScore.score);
    const recommendation = getRecommendation(creditScore.score);
    const scoreHistory = generateScoreHistory(creditScore.score);

    return NextResponse.json({
      creditScore: {
        id: creditScore.id,
        userId: creditScore.userId,
        score: creditScore.score,
        factors: JSON.stringify(factors),
        lastEvaluated: creditScore.lastEvaluated,
        createdAt: creditScore.createdAt,
        updatedAt: creditScore.updatedAt,
      },
      scoreBand,
      recommendation,
      scoreHistory,
    });
  } catch (error) {
    console.error('Credit Score API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

function normalizeFactors(raw: Record<string, unknown>): { frequency: number; repayment: number; age: number; telecom: number } {
  // If already in numeric format, return as-is
  if (typeof raw.frequency === 'number') {
    return {
      frequency: raw.frequency as number,
      repayment: (raw.repayment as number) ?? 0,
      age: (raw.age as number) ?? 0,
      telecom: (raw.telecom as number) ?? 0,
    };
  }
  // Convert old string-based format to numeric
  const stringToScore: Record<string, number> = {
    high: 85, excellent: 92, verified: 95, good: 75, medium: 60,
    low: 35, poor: 25, '24months': 70, true: 95, false: 0,
  };
  const toNum = (val: unknown): number => {
    if (typeof val === 'number') return val;
    if (typeof val === 'boolean') return val ? 95 : 0;
    if (typeof val === 'string') return stringToScore[val.toLowerCase()] ?? 50;
    return 50;
  };
  return {
    frequency: toNum(raw.transactionFreq ?? raw.frequency ?? 50),
    repayment: toNum(raw.repaymentHistory ?? raw.repayment ?? 50),
    age: toNum(raw.accountAge ?? raw.age ?? 50),
    telecom: toNum(raw.telecomVerification ?? raw.telecom ?? 50),
  };
}

function getScoreBand(score: number): string {
  if (score >= 80) return 'EXCELLENT';
  if (score >= 65) return 'GOOD';
  if (score >= 50) return 'FAIR';
  if (score >= 35) return 'POOR';
  return 'VERY_POOR';
}

function getRecommendation(score: number): string {
  if (score >= 80) return 'You have an excellent credit profile. You qualify for premium financial products.';
  if (score >= 65) return 'Good credit score. Keep making timely payments to maintain your standing.';
  if (score >= 50) return 'Fair score. Consider increasing transaction frequency and maintaining consistent activity.';
  if (score >= 35) return 'Your score needs improvement. Focus on regular transactions and verify your telecom details.';
  return 'Low score. Please complete KYC and start using your wallet regularly to build credit history.';
}

function generateScoreHistory(currentScore: number): Array<{ month: string; score: number }> {
  const months = [];
  let score = Math.max(0, currentScore - 15 - Math.random() * 10);
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    if (i === 0) {
      score = currentScore;
    } else {
      score = Math.min(100, score + Math.random() * 8 + 2);
    }
    months.push({
      month: d.toLocaleString('en-US', { month: 'short' }),
      score: Math.round(score),
    });
  }
  return months;
}
