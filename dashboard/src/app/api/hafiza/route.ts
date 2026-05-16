import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

const DEMO_PHONE = '+971501234567';

export async function GET() {
  try {
    const user = await db.user.findUnique({
      where: { phone: DEMO_PHONE },
      include: {
        hafizaMembers: {
          include: {
            circle: {
              include: {
                members: {
                  include: { user: true },
                  orderBy: { turnOrder: 'asc' },
                },
              },
            },
          },
        },
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Enrich circles with current turn member info
    const circles = user.hafizaMembers.map((membership) => {
      const circle = membership.circle;
      const currentTurnMember = circle.members.find(
        (m) => m.turnOrder === circle.currentTurn
      );

      return {
        ...circle,
        myMembership: {
          turnOrder: membership.turnOrder,
          trustScore: membership.trustScore,
          hasPaid: membership.hasPaid,
        },
        currentTurnMember: currentTurnMember
          ? {
              userId: currentTurnMember.userId,
              fullName: currentTurnMember.user.fullName,
              hasPaid: currentTurnMember.hasPaid,
            }
          : null,
        membersCount: circle.members.length,
      };
    });

    return NextResponse.json({ circles });
  } catch (error) {
    console.error('Hafiza GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, description, monthlyAmount } = body;

    if (!name || !monthlyAmount || monthlyAmount <= 0) {
      return NextResponse.json(
        { error: 'Name and valid monthly amount are required' },
        { status: 400 }
      );
    }

    const user = await db.user.findUnique({
      where: { phone: DEMO_PHONE },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const circle = await db.hafizaCircle.create({
      data: {
        name,
        description: description || null,
        monthlyAmount,
        totalMembers: 1,
        currentTurn: 0,
        status: 'ACTIVE',
        members: {
          create: {
            userId: user.id,
            turnOrder: 0,
            trustScore: 50,
            hasPaid: false,
          },
        },
      },
      include: {
        members: { include: { user: true } },
      },
    });

    return NextResponse.json({ message: 'Hafiza circle created', circle }, { status: 201 });
  } catch (error) {
    console.error('Hafiza POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
