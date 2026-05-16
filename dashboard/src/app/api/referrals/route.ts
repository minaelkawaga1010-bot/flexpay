import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

const DEMO_PHONE = '+971501234567';

function generateReferralCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export async function GET() {
  try {
    const user = await db.user.findUnique({
      where: { phone: DEMO_PHONE },
      include: {
        referralCode: {
          include: {
            referred: {
              select: {
                id: true,
                fullName: true,
                phone: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const referrals = user.referralCode;
    const totalReferrals = referrals.length;
    const successfulReferrals = referrals.filter(
      (r) => r.status === 'COMPLETED' || r.status === 'REWARDED'
    ).length;
    const totalRewardAmount = referrals
      .filter((r) => r.status === 'REWARDED')
      .reduce((sum, r) => sum + r.rewardAmount, 0);

    // Use the most recent referral code, or generate a mock one for display
    let referralCode = 'RAJESH25';
    if (referrals.length > 0) {
      referralCode = referrals[referrals.length - 1].referralCode;
    }

    const referralHistory = referrals.map((r) => ({
      id: r.id,
      referralCode: r.referralCode,
      referredUser: r.referred
        ? {
            id: r.referred.id,
            fullName: r.referred.fullName,
            phone: r.referred.phone,
            avatarUrl: r.referred.avatarUrl,
          }
        : null,
      status: r.status,
      rewardType: r.rewardType,
      rewardAmount: r.rewardAmount,
      createdAt: r.createdAt,
      rewardedAt: r.rewardedAt,
    }));

    return NextResponse.json({
      referralCode,
      stats: {
        totalReferrals,
        successfulReferrals,
        totalRewardAmount: Math.round(totalRewardAmount * 100) / 100,
      },
      referrals: referralHistory,
    });
  } catch (error) {
    console.error('Referrals GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST() {
  try {
    const user = await db.user.findUnique({
      where: { phone: DEMO_PHONE },
      include: {
        referralCode: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Check if user already has a referral code
    if (user.referralCode.length > 0) {
      return NextResponse.json({
        message: 'Referral code already exists',
        referralCode: user.referralCode[user.referralCode.length - 1].referralCode,
      });
    }

    // Generate a new unique referral code
    let code = generateReferralCode();
    let isUnique = false;
    let attempts = 0;

    while (!isUnique && attempts < 10) {
      const existing = await db.referral.findUnique({
        where: { referralCode: code },
      });
      if (!existing) {
        isUnique = true;
      } else {
        code = generateReferralCode();
        attempts++;
      }
    }

    if (!isUnique) {
      return NextResponse.json({ error: 'Failed to generate unique referral code' }, { status: 500 });
    }

    const referral = await db.referral.create({
      data: {
        referrerUserId: user.id,
        referredUserId: user.id, // Self-reference as template; updated when someone uses the code
        referralCode: code,
        status: 'PENDING',
        rewardType: 'POINTS',
        rewardAmount: 50,
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days from now
      },
    });

    return NextResponse.json(
      { message: 'Referral code generated', referralCode: referral.referralCode },
      { status: 201 }
    );
  } catch (error) {
    console.error('Referrals POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
