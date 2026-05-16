import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

const DEMO_PHONE = '+971501234567';

const TIER_THRESHOLDS: Record<string, { min: number; max: number }> = {
  BRONZE: { min: 0, max: 499 },
  SILVER: { min: 500, max: 999 },
  GOLD: { min: 1000, max: 3999 },
  PLATINUM: { min: 4000, max: Infinity },
};

const ALL_BADGES = [
  { id: 'FIRST_TRANSFER', name: 'First Transfer', description: 'Completed your first transfer', icon: '✈️' },
  { id: 'FIVE_REMITTANCES', name: 'Remittance Pro', description: 'Sent 5 remittances', icon: '🌍' },
  { id: 'TEN_REMITTANCES', name: 'Global Connector', description: 'Sent 10 remittances', icon: '🌏' },
  { id: 'KYC_COMPLETE', name: 'Verified', description: 'Completed KYC verification', icon: '✅' },
  { id: 'INVITE_3_FRIENDS', name: 'Social Butterfly', description: 'Invited 3 friends', icon: '👥' },
  { id: 'INVITE_5_FRIENDS', name: 'Community Leader', description: 'Invited 5 friends', icon: '🤝' },
  { id: 'EARLY_ADOPTER', name: 'Early Adopter', description: 'Joined during beta', icon: '⭐' },
  { id: 'CARD_HOLDER', name: 'Card Holder', description: 'Activated a virtual card', icon: '💳' },
];

export async function GET() {
  try {
    const user = await db.user.findUnique({
      where: { phone: DEMO_PHONE },
      include: { loyaltyPoints: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    let loyalty = user.loyaltyPoints[0];

    if (!loyalty) {
      loyalty = await db.loyaltyPoints.create({
        data: {
          userId: user.id,
          points: 0,
          tier: 'BRONZE',
          badges: JSON.stringify([]),
        },
      });
    }

    const earnedBadges: string[] = JSON.parse(loyalty.badges || '[]');
    const earnedBadgesNormalized = earnedBadges.map((b) => b.toUpperCase());
    const badgeDetails = ALL_BADGES.map((badge) => ({
      ...badge,
      earned: earnedBadgesNormalized.includes(badge.id),
    }));

    const tierInfo = TIER_THRESHOLDS[loyalty.tier] || TIER_THRESHOLDS.BRONZE;
    const nextTierEntry = getNextTier(loyalty.tier);
    const pointsNeeded = nextTierEntry ? nextTierEntry.min - loyalty.points : 0;
    const progress = nextTierEntry
      ? ((loyalty.points - tierInfo.min) / (nextTierEntry.min - tierInfo.min)) * 100
      : 100;

    return NextResponse.json({
      loyalty: {
        id: loyalty.id,
        userId: loyalty.userId,
        points: loyalty.points,
        tier: loyalty.tier,
        badges: JSON.stringify(earnedBadges),
        createdAt: loyalty.createdAt,
        updatedAt: loyalty.updatedAt,
      },
      allBadges: badgeDetails,
      tierProgress: {
        currentTier: loyalty.tier,
        nextTier: nextTierEntry ? nextTierEntry.name : null,
        pointsNeeded,
        currentPoints: loyalty.points,
        progress: Math.round(progress * 10) / 10,
      },
    });
  } catch (error) {
    console.error('Loyalty API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

function getNextTier(currentTier: string): { name: string; min: number } | null {
  const tiers = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM'];
  const currentIndex = tiers.indexOf(currentTier);
  if (currentIndex >= tiers.length - 1) return null;
  const nextName = tiers[currentIndex + 1];
  return { name: nextName, min: TIER_THRESHOLDS[nextName].min };
}
