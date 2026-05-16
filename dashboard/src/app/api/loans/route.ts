import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

const DEMO_PHONE = '+971501234567';

const VALID_PURPOSES = ['RENT', 'EDUCATION', 'MEDICAL', 'EMERGENCY', 'DEBT_CONSOLIDATION', 'OTHER'];
const VALID_TERMS = [3, 6, 12, 24];

const INTEREST_RATE = 5.0; // Annual interest rate %

export async function GET() {
  try {
    const user = await db.user.findUnique({
      where: { phone: DEMO_PHONE },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const [loans, employees] = await Promise.all([
      db.loan.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
      }),
      db.employee.findMany({
        where: { userId: user.id },
        take: 1,
      }),
    ]);

    const activeLoans = loans.filter(
      (l) => l.status === 'APPROVED' || l.status === 'DISBURSED' || l.status === 'REPAYING'
    ).length;
    const totalOutstanding = loans
      .filter((l) => l.outstandingBalance > 0)
      .reduce((sum, l) => sum + l.outstandingBalance, 0);

    // EWA: 25% of monthly salary if employee
    let ewaAvailable = 0;
    if (employees.length > 0) {
      const employee = employees[0];
      ewaAvailable = Math.round(employee.baseSalary * 0.25 * 100) / 100;
    }

    return NextResponse.json({
      loans,
      summary: {
        activeLoans,
        totalOutstanding: Math.round(totalOutstanding * 100) / 100,
        ewaAvailable,
      },
      creditScore: 78,
    });
  } catch (error) {
    console.error('Loans GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    // POST ?action=repay — make a loan repayment
    if (action === 'repay') {
      return handleRepayment(request);
    }

    // POST — apply for a new loan
    return handleApply(request);
  } catch (error) {
    console.error('Loans POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function handleApply(request: NextRequest) {
  const body = await request.json();
  const { amount, purpose, termMonths } = body;

  // Validate amount
  if (!amount || typeof amount !== 'number' || amount < 500 || amount > 10000) {
    return NextResponse.json({ error: 'Amount must be between AED 500 and AED 10,000' }, { status: 400 });
  }

  // Validate purpose
  if (!purpose || !VALID_PURPOSES.includes(purpose)) {
    return NextResponse.json({ error: `Invalid purpose. Must be one of: ${VALID_PURPOSES.join(', ')}` }, { status: 400 });
  }

  // Validate term
  if (!termMonths || !VALID_TERMS.includes(termMonths)) {
    return NextResponse.json({ error: `Invalid term. Must be one of: ${VALID_TERMS.join(', ')} months` }, { status: 400 });
  }

  const user = await db.user.findUnique({
    where: { phone: DEMO_PHONE },
  });

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Calculate monthly payment using simple amortization
  const monthlyRate = INTEREST_RATE / 100 / 12;
  const monthlyPayment = Math.round(
    (amount * monthlyRate * Math.pow(1 + monthlyRate, termMonths)) /
      (Math.pow(1 + monthlyRate, termMonths) - 1)
  ) * 100 / 100;

  const loan = await db.loan.create({
    data: {
      userId: user.id,
      amount,
      interestRate: INTEREST_RATE,
      termMonths,
      monthlyPayment,
      outstandingBalance: amount,
      status: 'PENDING',
      purpose,
    },
  });

  return NextResponse.json({ message: 'Loan application submitted', loan }, { status: 201 });
}

async function handleRepayment(request: NextRequest) {
  const body = await request.json();
  const { loanId, amount } = body;

  if (!loanId || typeof loanId !== 'string') {
    return NextResponse.json({ error: 'Loan ID is required' }, { status: 400 });
  }

  if (!amount || typeof amount !== 'number' || amount <= 0) {
    return NextResponse.json({ error: 'Valid amount is required' }, { status: 400 });
  }

  const user = await db.user.findUnique({
    where: { phone: DEMO_PHONE },
  });

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const loan = await db.loan.findUnique({
    where: { id: loanId },
  });

  if (!loan) {
    return NextResponse.json({ error: 'Loan not found' }, { status: 404 });
  }

  if (loan.userId !== user.id) {
    return NextResponse.json({ error: 'Loan does not belong to this user' }, { status: 400 });
  }

  if (loan.status !== 'REPAYING') {
    return NextResponse.json({ error: 'Loan is not in repayment status' }, { status: 400 });
  }

  if (amount > loan.outstandingBalance) {
    return NextResponse.json({ error: 'Amount exceeds outstanding balance' }, { status: 400 });
  }

  const updatedLoan = await db.$transaction(async (tx) => {
    // Calculate principal/interest split
    const monthlyRate = loan.interestRate / 100 / 12;
    const interestPortion = Math.round(loan.outstandingBalance * monthlyRate * 100) / 100;
    const principalPortion = Math.round((amount - interestPortion) * 100) / 100;

    // Create repayment record
    await tx.loanRepayment.create({
      data: {
        loanId: loan.id,
        userId: user.id,
        amount,
        principalAmount: Math.max(principalPortion, 0),
        interestAmount: Math.min(interestPortion, amount),
      },
    });

    // Update outstanding balance
    const newBalance = Math.round((loan.outstandingBalance - amount) * 100) / 100;
    const isFullyRepaid = newBalance <= 0.01; // Account for rounding

    const updated = await tx.loan.update({
      where: { id: loan.id },
      data: {
        outstandingBalance: Math.max(newBalance, 0),
        ...(isFullyRepaid
          ? { status: 'COMPLETED', completedAt: new Date() }
          : {}),
      },
    });

    return updated;
  });

  return NextResponse.json({
    message: updatedLoan.status === 'COMPLETED' ? 'Loan fully repaid!' : 'Repayment recorded successfully',
    loan: updatedLoan,
  });
}
