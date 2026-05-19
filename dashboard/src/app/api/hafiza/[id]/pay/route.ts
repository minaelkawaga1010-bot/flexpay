import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

const DEMO_PHONE = '+971501234567';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: circleId } = await params;

    const user = await db.user.findUnique({
      where: { phone: DEMO_PHONE },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Find the circle with members
    const circle = await db.hafizaCircle.findUnique({
      where: { id: circleId },
      include: {
        members: {
          include: { user: true },
          orderBy: { turnOrder: 'asc' },
        },
      },
    });

    if (!circle) {
      return NextResponse.json({ error: 'Circle not found' }, { status: 404 });
    }

    if (circle.status !== 'ACTIVE') {
      return NextResponse.json({ error: 'Circle is not active' }, { status: 400 });
    }

    // Find current turn member
    const currentMember = circle.members.find(
      (m) => m.turnOrder === circle.currentTurn
    );

    if (!currentMember) {
      return NextResponse.json({ error: 'No member found for current turn' }, { status: 400 });
    }

    if (currentMember.hasPaid) {
      return NextResponse.json(
        { error: 'Current turn member has already paid' },
        { status: 400 }
      );
    }

    // Atomic transaction: mark paid, advance turn
    const result = await db.$transaction(async (tx) => {
      // Mark current member as paid
      await tx.hafizaMember.update({
        where: { id: currentMember.id },
        data: { hasPaid: true },
      });

      // Calculate next turn
      const nextTurn = (circle.currentTurn + 1) % circle.members.length;

      // If we've gone through all members, reset hasPaid for next cycle
      if (nextTurn === 0) {
        // Completed a full cycle - reset all payments
        await tx.hafizaMember.updateMany({
          where: { circleId },
          data: { hasPaid: false },
        });
      }

      // Advance the turn
      const updatedCircle = await tx.hafizaCircle.update({
        where: { id: circleId },
        data: { currentTurn: nextTurn },
      });

      // Create a transaction record for the paying user
      const transaction = await tx.transaction.create({
        data: {
          userId: currentMember.userId,
          type: 'SPEND',
          status: 'COMPLETED',
          amount: circle.monthlyAmount,
          currency: 'AED',
          fee: 0,
          description: `Hafiza contribution - ${circle.name}`,
          reference: `HFZ${Date.now()}${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
          metadata: JSON.stringify({
            circleId,
            circleName: circle.name,
            turnOrder: currentMember.turnOrder,
          }),
        },
      });

      return { circle: updatedCircle, transaction };
    });

    // Get next turn member name
    const nextMember = circle.members.find(
      (m) => m.turnOrder === result.circle.currentTurn
    );

    return NextResponse.json({
      message: 'Payment recorded successfully',
      circle: result.circle,
      transaction: result.transaction,
      nextTurnMember: nextMember
        ? { fullName: nextMember.user.fullName, turnOrder: nextMember.turnOrder }
        : null,
    });
  } catch (error) {
    console.error('Hafiza pay error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
