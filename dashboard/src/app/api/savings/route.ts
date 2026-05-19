import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

const DEMO_PHONE = '+971501234567';

const VALID_CATEGORIES = ['EMERGENCY', 'EDUCATION', 'HEALTH', 'TRAVEL', 'INVESTMENT', 'CUSTOM'];
const VALID_FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY'];
const VALID_SOURCES = ['MANUAL', 'AUTO', 'ROUND_UP'];

export async function GET() {
  try {
    const user = await db.user.findUnique({
      where: { phone: DEMO_PHONE },
      include: {
        savingsGoals: {
          include: {
            _count: { select: { contributions: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const goals = user.savingsGoals;

    const totalSaved = goals.reduce((sum, g) => sum + g.currentAmount, 0);
    const activeGoals = goals.filter((g) => g.status === 'ACTIVE').length;
    const monthlyAutoSave = goals
      .filter((g) => g.status === 'ACTIVE' && g.autoContributeFrequency === 'MONTHLY')
      .reduce((sum, g) => sum + (g.autoContributeAmount || 0), 0);

    const goalsWithStats = goals.map((goal) => ({
      ...goal,
      contributionCount: goal._count.contributions,
      progress: goal.targetAmount > 0
        ? Math.round((goal.currentAmount / goal.targetAmount) * 1000) / 10
        : 0,
      _count: undefined,
    }));

    return NextResponse.json({
      goals: goalsWithStats,
      summary: {
        totalSaved: Math.round(totalSaved * 100) / 100,
        activeGoals,
        monthlyAutoSave: Math.round(monthlyAutoSave * 100) / 100,
      },
    });
  } catch (error) {
    console.error('Savings GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    // POST ?action=contribute — add funds to a goal
    if (action === 'contribute') {
      return handleContribute(request);
    }

    // POST — create a new savings goal
    return handleCreateGoal(request);
  } catch (error) {
    console.error('Savings POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function handleCreateGoal(request: NextRequest) {
  const body = await request.json();
  const { name, targetAmount, category, autoContributeAmount, autoContributeFrequency, targetDate } = body;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return NextResponse.json({ error: 'Goal name is required' }, { status: 400 });
  }

  if (!targetAmount || typeof targetAmount !== 'number' || targetAmount <= 0) {
    return NextResponse.json({ error: 'Valid target amount is required' }, { status: 400 });
  }

  if (!category || !VALID_CATEGORIES.includes(category)) {
    return NextResponse.json({ error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}` }, { status: 400 });
  }

  if (autoContributeAmount !== undefined && (typeof autoContributeAmount !== 'number' || autoContributeAmount <= 0)) {
    return NextResponse.json({ error: 'Invalid auto-contribute amount' }, { status: 400 });
  }

  if (autoContributeFrequency && !VALID_FREQUENCIES.includes(autoContributeFrequency)) {
    return NextResponse.json({ error: `Invalid frequency. Must be one of: ${VALID_FREQUENCIES.join(', ')}` }, { status: 400 });
  }

  if (autoContributeFrequency && !autoContributeAmount) {
    return NextResponse.json({ error: 'Auto-contribute amount is required when frequency is set' }, { status: 400 });
  }

  const user = await db.user.findUnique({
    where: { phone: DEMO_PHONE },
  });

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const goal = await db.savingsGoal.create({
    data: {
      userId: user.id,
      name: name.trim(),
      targetAmount,
      category,
      autoContributeAmount: autoContributeAmount || null,
      autoContributeFrequency: autoContributeFrequency || null,
      targetDate: targetDate ? new Date(targetDate) : null,
    },
  });

  return NextResponse.json({ message: 'Savings goal created', goal }, { status: 201 });
}

async function handleContribute(request: NextRequest) {
  const body = await request.json();
  const { goalId, amount, source } = body;

  if (!goalId || typeof goalId !== 'string') {
    return NextResponse.json({ error: 'Goal ID is required' }, { status: 400 });
  }

  if (!amount || typeof amount !== 'number' || amount <= 0) {
    return NextResponse.json({ error: 'Valid amount is required' }, { status: 400 });
  }

  if (!source || !VALID_SOURCES.includes(source)) {
    return NextResponse.json({ error: `Invalid source. Must be one of: ${VALID_SOURCES.join(', ')}` }, { status: 400 });
  }

  const user = await db.user.findUnique({
    where: { phone: DEMO_PHONE },
  });

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const goal = await db.savingsGoal.findUnique({
    where: { id: goalId },
  });

  if (!goal) {
    return NextResponse.json({ error: 'Savings goal not found' }, { status: 404 });
  }

  if (goal.userId !== user.id) {
    return NextResponse.json({ error: 'Goal does not belong to this user' }, { status: 400 });
  }

  if (goal.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'Goal is not active' }, { status: 400 });
  }

  const updatedGoal = await db.$transaction(async (tx) => {
    // Create contribution record
    await tx.savingsContribution.create({
      data: {
        savingsGoalId: goal.id,
        userId: user.id,
        amount,
        source,
      },
    });

    // Update goal's current amount
    const newCurrentAmount = goal.currentAmount + amount;
    const isCompleted = newCurrentAmount >= goal.targetAmount;

    const updated = await tx.savingsGoal.update({
      where: { id: goal.id },
      data: {
        currentAmount: newCurrentAmount,
        ...(isCompleted
          ? { status: 'COMPLETED', completedAt: new Date() }
          : {}),
      },
    });

    return updated;
  });

  return NextResponse.json({
    message: updatedGoal.status === 'COMPLETED' ? 'Goal completed! Congratulations!' : 'Contribution added successfully',
    goal: {
      ...updatedGoal,
      progress: updatedGoal.targetAmount > 0
        ? Math.round((updatedGoal.currentAmount / updatedGoal.targetAmount) * 1000) / 10
        : 100,
    },
  });
}
