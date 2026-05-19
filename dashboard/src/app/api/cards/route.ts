import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

const DEMO_PHONE = '+971501234567';

export async function GET() {
  try {
    const user = await db.user.findUnique({
      where: { phone: DEMO_PHONE },
      include: { cards: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({ cards: user.cards });
  } catch (error) {
    console.error('Cards GET error:', error);
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

    // Generate random last 4 digits
    const last4 = Math.floor(1000 + Math.random() * 9000).toString();
    const now = new Date();
    const expiryYear = now.getFullYear() + 3;

    const card = await db.card.create({
      data: {
        userId: user.id,
        type: 'VIRTUAL',
        status: 'ACTIVE',
        last4Digits: last4,
        expiryMonth: now.getMonth() + 1,
        expiryYear,
        cardholderName: user.fullName.toUpperCase(),
        dailyLimit: 5000,
        monthlyLimit: 50000,
      },
    });

    return NextResponse.json({ message: 'Card created successfully', card }, { status: 201 });
  } catch (error) {
    console.error('Cards POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { cardId, status } = body;

    if (!cardId) {
      return NextResponse.json({ error: 'Card ID is required' }, { status: 400 });
    }

    const validStatuses = ['ACTIVE', 'FROZEN', 'BLOCKED', 'EXPIRED'];
    if (!status || !validStatuses.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
        { status: 400 }
      );
    }

    const user = await db.user.findUnique({
      where: { phone: DEMO_PHONE },
      include: { cards: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const card = user.cards.find((c) => c.id === cardId);
    if (!card) {
      return NextResponse.json({ error: 'Card not found' }, { status: 404 });
    }

    const updatedCard = await db.card.update({
      where: { id: cardId },
      data: { status },
    });

    return NextResponse.json({ message: 'Card status updated', card: updatedCard });
  } catch (error) {
    console.error('Cards PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
