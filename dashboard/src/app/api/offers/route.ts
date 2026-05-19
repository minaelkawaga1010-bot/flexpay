import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

const DEMO_PHONE = '+971501234567';

const VALID_ACTIONS = ['VIEWED', 'CLICKED', 'REDEEMED'];

export async function GET(request: NextRequest) {
  try {
    const user = await db.user.findUnique({
      where: { phone: DEMO_PHONE },
      include: {
        offerClicks: {
          select: { offerId: true, action: true, createdAt: true },
        },
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const now = new Date();

    // Get active offers (active and not expired)
    const offers = await db.offer.findMany({
      where: {
        isActive: true,
        validUntil: { gte: now },
      },
      include: {
        clicks: {
          where: { userId: user.id },
          select: { action: true, createdAt: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Calculate cashback stats from redeemed offer clicks
    const redeemedClicks = user.offerClicks.filter((c) => c.action === 'REDEEMED');
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const thisMonthRedemptions = redeemedClicks.filter(
      (c) => c.createdAt >= currentMonthStart
    ).length;

    // Mock cashback values based on redemption count
    const avgCashbackPerRedemption = 85;
    const thisMonthCashback = Math.round(thisMonthRedemptions * avgCashbackPerRedemption * 100) / 100;
    const allTimeCashback = Math.round(redeemedClicks.length * avgCashbackPerRedemption * 100) / 100;

    // Default cashback if no redemptions
    const cashback = {
      thisMonth: thisMonthCashback || 45.20,
      allTime: allTimeCashback || 340.50,
    };

    const offersWithUserAction = offers.map((offer) => ({
      ...offer,
      clicks: undefined,
      userClicks: offer.clicks,
      userRedeemed: offer.clicks.some((c) => c.action === 'REDEEMED'),
    }));

    return NextResponse.json({
      offers: offersWithUserAction,
      cashback,
      stats: {
        activeOffers: offers.length,
      },
    });
  } catch (error) {
    console.error('Offers GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await db.user.findUnique({
      where: { phone: DEMO_PHONE },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const body = await request.json();
    const { offerId, action } = body;

    if (!offerId || typeof offerId !== 'string') {
      return NextResponse.json({ error: 'Offer ID is required' }, { status: 400 });
    }

    if (!action || !VALID_ACTIONS.includes(action)) {
      return NextResponse.json({ error: `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}` }, { status: 400 });
    }

    // Verify the offer exists and is active
    const offer = await db.offer.findUnique({
      where: { id: offerId },
    });

    if (!offer) {
      return NextResponse.json({ error: 'Offer not found' }, { status: 404 });
    }

    if (!offer.isActive) {
      return NextResponse.json({ error: 'Offer is no longer active' }, { status: 400 });
    }

    // Track the offer click
    const click = await db.offerClick.create({
      data: {
        offerId,
        userId: user.id,
        action,
      },
    });

    // If redeemed, increment the offer's total redemptions
    if (action === 'REDEEMED') {
      await db.offer.update({
        where: { id: offerId },
        data: { totalRedemptions: { increment: 1 } },
      });
    }

    return NextResponse.json(
      {
        message: action === 'REDEEMED' ? 'Offer redeemed successfully' : 'Offer action recorded',
        click,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Offers POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
