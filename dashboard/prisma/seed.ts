import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const now = Date.now();

  // Clean existing data (reverse dependency order)
  await prisma.offerClick.deleteMany();
  await prisma.offer.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.loanRepayment.deleteMany();
  await prisma.loan.deleteMany();
  await prisma.savingsContribution.deleteMany();
  await prisma.savingsGoal.deleteMany();
  await prisma.referral.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.aMLAlert.deleteMany();
  await prisma.loyaltyPoints.deleteMany();
  await prisma.creditScore.deleteMany();
  await prisma.hafizaMember.deleteMany();
  await prisma.hafizaCircle.deleteMany();
  await prisma.p2PTransfer.deleteMany();
  await prisma.card.deleteMany();
  await prisma.beneficiary.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.balance.deleteMany();
  await prisma.wallet.deleteMany();
  await prisma.employee.deleteMany();
  await prisma.company.deleteMany();
  await prisma.user.deleteMany();

  // ==================== USERS ====================
  const users = await Promise.all([
    prisma.user.create({
      data: {
        phone: '+971501234567',
        fullName: 'Rajesh Kumar',
        email: 'rajesh@flexpay.ae',
        role: 'EMPLOYEE',
        kycLevel: 2,
        nymcardCustId: 'NYM-001',
      },
    }),
    prisma.user.create({
      data: {
        phone: '+971502345678',
        fullName: 'Maria Santos',
        email: 'maria@flexpay.ae',
        role: 'EMPLOYEE',
        kycLevel: 2,
        nymcardCustId: 'NYM-002',
      },
    }),
    prisma.user.create({
      data: {
        phone: '+971503456789',
        fullName: 'Ahmed Hassan',
        email: 'ahmed@flexpay.ae',
        role: 'EMPLOYEE',
        kycLevel: 1,
      },
    }),
    prisma.user.create({
      data: {
        phone: '+971504567890',
        fullName: 'Priya Sharma',
        email: 'priya@flexpay.ae',
        role: 'EMPLOYEE',
        kycLevel: 2,
        nymcardCustId: 'NYM-003',
      },
    }),
    prisma.user.create({
      data: {
        phone: '+971505678901',
        fullName: 'Al Fardan Group',
        email: 'hr@alfardan.ae',
        role: 'COMPANY',
        kycLevel: 2,
      },
    }),
  ]);

  // ==================== COMPANY ====================
  await prisma.company.create({
    data: {
      userId: users[4].id,
      tradeLicense: 'TL-2024-00891',
      companyName: 'Al Fardan Group',
      companyType: 'MAINLAND',
      industry: 'CONSTRUCTION',
      address: 'Sheikh Zayed Road, Dubai',
      city: 'Dubai',
      employeeCount: 150,
      isVerified: true,
      verifiedAt: new Date(now - 86400000 * 90),
      subscriptionPlan: 'ENTERPRISE',
      subscriptionExpiry: new Date(now + 86400000 * 180),
    },
  });

  // ==================== EMPLOYEES ====================
  await prisma.employee.createMany({
    data: [
      { userId: users[0].id, companyUserId: users[4].id, employeeId: 'EMP-0042', department: 'ENGINEERING', position: 'Site Engineer', baseSalary: 8500, salaryCurrency: 'AED', employmentStatus: 'ACTIVE', startDate: new Date(now - 86400000 * 365 * 2), bankAccountIban: 'AE07****4521', bankAccountName: 'Rajesh Kumar', emiratesId: '784-1990-XXXXXXX-1', passportNumber: 'P1234567', visaExpiryDate: new Date(now + 86400000 * 365) },
      { userId: users[1].id, companyUserId: users[4].id, employeeId: 'EMP-0108', department: 'OPERATIONS', position: 'Operations Coordinator', baseSalary: 6500, salaryCurrency: 'AED', employmentStatus: 'ACTIVE', startDate: new Date(now - 86400000 * 365), bankAccountIban: 'AE07****7890', bankAccountName: 'Maria Santos', emiratesId: '784-1992-XXXXXXX-2' },
      { userId: users[2].id, companyUserId: users[4].id, employeeId: 'EMP-0156', department: 'LOGISTICS', position: 'Logistics Assistant', baseSalary: 4500, salaryCurrency: 'AED', employmentStatus: 'PROBATION', startDate: new Date(now - 86400000 * 90), bankAccountIban: 'AE07****2345', bankAccountName: 'Ahmed Hassan' },
      { userId: users[3].id, companyUserId: users[4].id, employeeId: 'EMP-0201', department: 'FINANCE', position: 'Finance Analyst', baseSalary: 12000, salaryCurrency: 'AED', employmentStatus: 'ACTIVE', startDate: new Date(now - 86400000 * 365 * 2.5), bankAccountIban: 'AE07****6789', bankAccountName: 'Priya Sharma', emiratesId: '784-1988-XXXXXXX-3', passportNumber: 'P7654321' },
    ],
  });

  // ==================== WALLETS & BALANCES ====================
  const walletData = [
    { userId: users[0].id, balances: [{ currency: 'AED', amount: 12500.00 }, { currency: 'INR', amount: 52000.00 }, { currency: 'PHP', amount: 15000.00 }] },
    { userId: users[1].id, balances: [{ currency: 'AED', amount: 8750.50 }, { currency: 'PHP', amount: 125000.00 }] },
    { userId: users[2].id, balances: [{ currency: 'AED', amount: 3200.00 }, { currency: 'PKR', amount: 85000.00 }] },
    { userId: users[3].id, balances: [{ currency: 'AED', amount: 15800.00 }, { currency: 'INR', amount: 320000.00 }] },
    { userId: users[4].id, balances: [{ currency: 'AED', amount: 2500000.00 }] },
  ];

  for (const wd of walletData) {
    await prisma.wallet.create({
      data: {
        userId: wd.userId,
        balances: {
          create: wd.balances,
        },
      },
    });
  }

  // ==================== TRANSACTIONS ====================
  const transactionTypes = ['SALARY_CREDIT', 'SPEND', 'TOP_UP', 'REMITTANCE', 'P2P_SEND', 'P2P_RECEIVE', 'WITHDRAW'];
  const descriptions: Record<string, string[]> = {
    SALARY_CREDIT: ['Monthly salary - Al Fardan Group', 'Bonus payment', 'Overtime payment'],
    SPEND: ['Carrefour Supermarket', 'Etisalat Bill Payment', 'DEWA Electricity', 'Talabat Food Order', 'Careem Ride', 'ADNOC Fuel'],
    TOP_UP: ['Bank transfer top-up', 'Cash deposit via Exchange House'],
    REMITTANCE: ['Remittance to India - Wise', 'Remittance to Philippines', 'Remittance to Pakistan'],
    P2P_SEND: ['Transfer to Maria Santos', 'Transfer to Ahmed Hassan', 'Rent payment'],
    P2P_RECEIVE: ['Received from Rajesh Kumar', 'Received from Priya Sharma'],
    WITHDRAW: ['ATM Withdrawal - Emirates NBD', 'Cash withdrawal'],
  };

  const transactions = [];
  for (let i = 0; i < 60; i++) {
    const type = transactionTypes[Math.floor(Math.random() * transactionTypes.length)];
    const user = users[Math.floor(Math.random() * 4)]; // Only employees get transactions
    const descList = descriptions[type] || ['Transaction'];
    const desc = descList[Math.floor(Math.random() * descList.length)];
    const amount = type === 'SALARY_CREDIT' ? Math.floor(Math.random() * 5000 + 3000) :
                   type === 'REMITTANCE' ? Math.floor(Math.random() * 2000 + 200) :
                   Math.floor(Math.random() * 500 + 10);
    const status = i < 50 ? 'COMPLETED' : (Math.random() > 0.5 ? 'PENDING' : 'COMPLETED');

    transactions.push({
      userId: user.id,
      type,
      status,
      amount: parseFloat(amount.toFixed(2)),
      currency: 'AED',
      fee: type === 'REMITTANCE' ? parseFloat((amount * 0.0075).toFixed(2)) : type === 'SPEND' ? parseFloat((amount * 0.005 + 0.5).toFixed(2)) : 0,
      description: desc,
      reference: `FP${Date.now()}${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
      createdAt: new Date(now - i * 3600000 * Math.random() * 72),
    });
  }

  for (const t of transactions) {
    await prisma.transaction.create({ data: t });
  }

  // ==================== P2P TRANSFERS ====================
  await prisma.p2PTransfer.createMany({
    data: [
      { senderId: users[0].id, receiverId: users[1].id, amount: 500, currency: 'AED', note: 'Dinner split', status: 'COMPLETED', createdAt: new Date(now - 86400000) },
      { senderId: users[3].id, receiverId: users[0].id, amount: 1200, currency: 'AED', note: 'Rent share', status: 'COMPLETED', createdAt: new Date(now - 172800000) },
      { senderId: users[0].id, receiverId: users[2].id, amount: 200, currency: 'AED', status: 'PENDING', createdAt: new Date(now - 3600000) },
    ],
  });

  // ==================== BENEFICIARIES ====================
  await prisma.beneficiary.createMany({
    data: [
      { userId: users[0].id, fullName: 'Suresh Kumar', country: 'IN', bankName: 'State Bank of India', accountNumber: '****4521', ifscCode: 'SBIN0001234', isVerified: true },
      { userId: users[0].id, fullName: 'Meena Devi', country: 'IN', bankName: 'HDFC Bank', accountNumber: '****7890', ifscCode: 'HDFC0005678', isVerified: true },
      { userId: users[1].id, fullName: 'Juan Santos', country: 'PH', bankName: 'BDO Unibank', accountNumber: '****3456', isVerified: true },
      { userId: users[1].id, fullName: 'Rosa Santos', country: 'PH', bankName: 'GCash', accountNumber: '0917-***-7890', isVerified: false },
      { userId: users[2].id, fullName: 'Fatima Hassan', country: 'PK', bankName: 'HBL Pakistan', accountNumber: '****2345', isVerified: true },
      { userId: users[3].id, fullName: 'Ravi Sharma', country: 'IN', bankName: 'ICICI Bank', accountNumber: '****6789', ifscCode: 'ICIC0009012', isVerified: true },
    ],
  });

  // ==================== CARDS ====================
  await prisma.card.createMany({
    data: [
      { userId: users[0].id, type: 'VIRTUAL', status: 'ACTIVE', last4Digits: '4521', expiryMonth: 12, expiryYear: 2027, cardholderName: 'RAJESH KUMAR', dailyLimit: 5000, monthlyLimit: 50000, spentToday: 350.50, spentMonth: 4200, isApplePay: true, isGooglePay: false },
      { userId: users[0].id, type: 'PHYSICAL', status: 'ACTIVE', last4Digits: '8834', expiryMonth: 6, expiryYear: 2028, cardholderName: 'RAJESH KUMAR', dailyLimit: 10000, monthlyLimit: 100000, spentToday: 0, spentMonth: 8750, isApplePay: true, isGooglePay: true },
      { userId: users[1].id, type: 'VIRTUAL', status: 'ACTIVE', last4Digits: '1290', expiryMonth: 3, expiryYear: 2027, cardholderName: 'MARIA SANTOS', dailyLimit: 5000, monthlyLimit: 50000, spentToday: 125, spentMonth: 3100, isApplePay: false, isGooglePay: true },
      { userId: users[3].id, type: 'VIRTUAL', status: 'FROZEN', last4Digits: '5567', expiryMonth: 9, expiryYear: 2026, cardholderName: 'PRIYA SHARMA', dailyLimit: 3000, monthlyLimit: 30000, spentToday: 0, spentMonth: 0, isApplePay: true, isGooglePay: true },
    ],
  });

  // ==================== HAFIZA CIRCLES ====================
  const hafizaCircles = await Promise.all([
    prisma.hafizaCircle.create({
      data: {
        name: 'Dubai Workers Savings Group',
        description: 'Monthly AED 500 savings circle for construction workers in Dubai Marina area',
        monthlyAmount: 500,
        totalMembers: 5,
        currentTurn: 2,
        status: 'ACTIVE',
      },
    }),
    prisma.hafizaCircle.create({
      data: {
        name: 'Filipino Community Fund',
        description: 'Shared savings for Filipino workers in Abu Dhabi',
        monthlyAmount: 1000,
        totalMembers: 4,
        currentTurn: 1,
        status: 'ACTIVE',
      },
    }),
  ]);

  // Hafiza Members
  await prisma.hafizaMember.createMany({
    data: [
      { circleId: hafizaCircles[0].id, userId: users[0].id, turnOrder: 1, trustScore: 95, hasPaid: true },
      { circleId: hafizaCircles[0].id, userId: users[1].id, turnOrder: 2, trustScore: 88, hasPaid: false },
      { circleId: hafizaCircles[0].id, userId: users[2].id, turnOrder: 3, trustScore: 72, hasPaid: false },
      { circleId: hafizaCircles[1].id, userId: users[1].id, turnOrder: 1, trustScore: 88, hasPaid: true },
      { circleId: hafizaCircles[1].id, userId: users[3].id, turnOrder: 2, trustScore: 90, hasPaid: false },
    ],
  });

  // ==================== CREDIT SCORES ====================
  await prisma.creditScore.createMany({
    data: [
      { userId: users[0].id, score: 78, factors: JSON.stringify({ transactionFreq: 'high', repaymentHistory: 'excellent', telecomVerification: true, accountAge: '24months' }), lastEvaluated: new Date(now - 86400000) },
      { userId: users[1].id, score: 65, factors: JSON.stringify({ transactionFreq: 'medium', repaymentHistory: 'good', telecomVerification: true, accountAge: '12months' }), lastEvaluated: new Date(now - 172800000) },
      { userId: users[2].id, score: 52, factors: JSON.stringify({ transactionFreq: 'low', repaymentHistory: 'fair', telecomVerification: false, accountAge: '6months' }), lastEvaluated: new Date(now - 259200000) },
      { userId: users[3].id, score: 85, factors: JSON.stringify({ transactionFreq: 'high', repaymentHistory: 'excellent', telecomVerification: true, accountAge: '30months' }), lastEvaluated: new Date(now - 43200000) },
    ],
  });

  // ==================== LOYALTY POINTS ====================
  await prisma.loyaltyPoints.createMany({
    data: [
      { userId: users[0].id, points: 1250, tier: 'GOLD', badges: JSON.stringify(['first_transfer', 'five_remittances', 'kyc_complete', 'invite_3_friends']) },
      { userId: users[1].id, points: 680, tier: 'SILVER', badges: JSON.stringify(['first_transfer', 'kyc_complete']) },
      { userId: users[2].id, points: 150, tier: 'BRONZE', badges: JSON.stringify(['kyc_complete']) },
      { userId: users[3].id, points: 2100, tier: 'PLATINUM', badges: JSON.stringify(['first_transfer', 'ten_remittances', 'kyc_complete', 'invite_5_friends', 'early_adopter']) },
    ],
  });

  // ==================== SAVINGS GOALS ====================
  const savingsGoals = await Promise.all([
    prisma.savingsGoal.create({
      data: {
        userId: users[0].id,
        name: 'Emergency Fund',
        targetAmount: 10000,
        currentAmount: 3200,
        currency: 'AED',
        category: 'EMERGENCY',
        status: 'ACTIVE',
        autoContributeAmount: 500,
        autoContributeFrequency: 'MONTHLY',
        targetDate: new Date(now + 86400000 * 180),
      },
    }),
    prisma.savingsGoal.create({
      data: {
        userId: users[0].id,
        name: 'Education Fund',
        targetAmount: 5000,
        currentAmount: 4250,
        currency: 'AED',
        category: 'EDUCATION',
        status: 'ACTIVE',
        autoContributeAmount: 750,
        autoContributeFrequency: 'MONTHLY',
        targetDate: new Date(now + 86400000 * 30),
      },
    }),
    prisma.savingsGoal.create({
      data: {
        userId: users[0].id,
        name: 'Vacation Fund',
        targetAmount: 3000,
        currentAmount: 1000,
        currency: 'AED',
        category: 'TRAVEL',
        status: 'ACTIVE',
        targetDate: new Date(now + 86400000 * 270),
      },
    }),
    prisma.savingsGoal.create({
      data: {
        userId: users[1].id,
        name: 'Family Fund',
        targetAmount: 15000,
        currentAmount: 5200,
        currency: 'AED',
        category: 'CUSTOM',
        status: 'ACTIVE',
        autoContributeAmount: 1000,
        autoContributeFrequency: 'MONTHLY',
      },
    }),
  ]);

  // Savings Contributions
  await prisma.savingsContribution.createMany({
    data: [
      { savingsGoalId: savingsGoals[0].id, userId: users[0].id, amount: 500, currency: 'AED', source: 'AUTO', createdAt: new Date(now - 86400000 * 30) },
      { savingsGoalId: savingsGoals[0].id, userId: users[0].id, amount: 500, currency: 'AED', source: 'AUTO', createdAt: new Date(now - 86400000 * 60) },
      { savingsGoalId: savingsGoals[0].id, userId: users[0].id, amount: 250, currency: 'AED', source: 'MANUAL', createdAt: new Date(now - 86400000 * 15) },
      { savingsGoalId: savingsGoals[1].id, userId: users[0].id, amount: 750, currency: 'AED', source: 'AUTO', createdAt: new Date(now - 86400000 * 30) },
      { savingsGoalId: savingsGoals[1].id, userId: users[0].id, amount: 750, currency: 'AED', source: 'AUTO', createdAt: new Date(now - 86400000 * 60) },
      { savingsGoalId: savingsGoals[2].id, userId: users[0].id, amount: 500, currency: 'AED', source: 'MANUAL', createdAt: new Date(now - 86400000 * 45) },
      { savingsGoalId: savingsGoals[2].id, userId: users[0].id, amount: 500, currency: 'AED', source: 'MANUAL', createdAt: new Date(now - 86400000 * 20) },
    ],
  });

  // ==================== LOANS ====================
  const loans = await Promise.all([
    prisma.loan.create({
      data: {
        userId: users[0].id,
        amount: 3000,
        currency: 'AED',
        interestRate: 12,
        termMonths: 6,
        monthlyPayment: 520,
        outstandingBalance: 2400,
        status: 'REPAYING',
        purpose: 'RENT',
        appliedAt: new Date(now - 86400000 * 90),
        approvedAt: new Date(now - 86400000 * 88),
        disbursedAt: new Date(now - 86400000 * 87),
        dueDate: new Date(now + 86400000 * 90),
        nextPaymentDate: new Date(now + 86400000 * 15),
        missedPayments: 0,
      },
    }),
    prisma.loan.create({
      data: {
        userId: users[0].id,
        amount: 1500,
        currency: 'AED',
        interestRate: 0,
        termMonths: 3,
        monthlyPayment: 500,
        outstandingBalance: 1000,
        status: 'REPAYING',
        purpose: 'MEDICAL',
        appliedAt: new Date(now - 86400000 * 45),
        approvedAt: new Date(now - 86400000 * 43),
        disbursedAt: new Date(now - 86400000 * 42),
        dueDate: new Date(now + 86400000 * 45),
        nextPaymentDate: new Date(now + 86400000 * 10),
        missedPayments: 0,
      },
    }),
    prisma.loan.create({
      data: {
        userId: users[1].id,
        amount: 5000,
        currency: 'AED',
        interestRate: 15,
        termMonths: 12,
        monthlyPayment: 450,
        outstandingBalance: 3500,
        status: 'REPAYING',
        purpose: 'EDUCATION',
        appliedAt: new Date(now - 86400000 * 120),
        approvedAt: new Date(now - 86400000 * 118),
        disbursedAt: new Date(now - 86400000 * 117),
        nextPaymentDate: new Date(now + 86400000 * 20),
        missedPayments: 1,
      },
    }),
  ]);

  // Loan Repayments
  await prisma.loanRepayment.createMany({
    data: [
      { loanId: loans[0].id, userId: users[0].id, amount: 520, currency: 'AED', principalAmount: 490, interestAmount: 30, status: 'COMPLETED', paymentDate: new Date(now - 86400000 * 60) },
      { loanId: loans[0].id, userId: users[0].id, amount: 520, currency: 'AED', principalAmount: 495, interestAmount: 25, status: 'COMPLETED', paymentDate: new Date(now - 86400000 * 30) },
      { loanId: loans[1].id, userId: users[0].id, amount: 500, currency: 'AED', principalAmount: 500, interestAmount: 0, status: 'COMPLETED', paymentDate: new Date(now - 86400000 * 30) },
      { loanId: loans[2].id, userId: users[1].id, amount: 450, currency: 'AED', principalAmount: 420, interestAmount: 30, status: 'COMPLETED', paymentDate: new Date(now - 86400000 * 60) },
      { loanId: loans[2].id, userId: users[1].id, amount: 450, currency: 'AED', principalAmount: 425, interestAmount: 25, status: 'FAILED', paymentDate: new Date(now - 86400000 * 30) },
    ],
  });

  // ==================== REFERRALS ====================
  await prisma.referral.createMany({
    data: [
      { referrerUserId: users[0].id, referredUserId: users[1].id, referralCode: 'RAJESH-A1', status: 'COMPLETED', rewardType: 'CASHBACK', rewardAmount: 50, rewardedAt: new Date(now - 86400000 * 30), expiresAt: new Date(now + 86400000 * 30) },
      { referrerUserId: users[0].id, referredUserId: users[2].id, referralCode: 'RAJESH-A2', status: 'PENDING', rewardType: 'CASHBACK', rewardAmount: 50, expiresAt: new Date(now + 86400000 * 20) },
      { referrerUserId: users[3].id, referredUserId: users[0].id, referralCode: 'PRIYA-S1', status: 'REWARDED', rewardType: 'POINTS', rewardAmount: 50, rewardedAt: new Date(now - 86400000 * 200), expiresAt: new Date(now - 86400000 * 170) },
    ],
  });

  // ==================== OFFERS ====================
  const offers = await Promise.all([
    prisma.offer.create({
      data: {
        title: 'Ramadan Special',
        description: '2x cashback on all remittances during Ramadan',
        offerType: 'REMITTANCE_FEE_WAIVER',
        discountValue: 100,
        discountType: 'PERCENTAGE',
        minTransactionAmount: 100,
        maxDiscountAmount: 50,
        validFrom: new Date(now - 86400000 * 30),
        validUntil: new Date(now + 86400000 * 30),
        maxRedemptions: 500,
        totalRedemptions: 234,
        isActive: true,
        terms: 'Valid for remittances to India, Philippines, and Pakistan only',
        imageUrl: '/offers/ramadan-special.png',
      },
    }),
    prisma.offer.create({
      data: {
        title: 'First Card Free',
        description: 'Get your first virtual card with zero issuance fee',
        offerType: 'SIGNUP_BONUS',
        discountValue: 30,
        discountType: 'FIXED',
        validFrom: new Date(now - 86400000 * 90),
        validUntil: new Date(now + 86400000 * 365),
        isActive: true,
        terms: 'Applicable for new users only. One-time use per user.',
      },
    }),
    prisma.offer.create({
      data: {
        title: 'Refer & Earn AED 50',
        description: 'Earn AED 50 for every friend who signs up and completes KYC',
        offerType: 'REFER_BONUS',
        discountValue: 50,
        discountType: 'FIXED',
        validFrom: new Date(now - 86400000 * 60),
        validUntil: new Date(now + 86400000 * 60),
        isActive: true,
        terms: 'Referred friend must complete KYC Level 1. Max 20 referrals per month.',
      },
    }),
    prisma.offer.create({
      data: {
        title: 'First EWA Free',
        description: '0% fee on your first Earned Wage Access withdrawal',
        offerType: 'CASHBACK',
        discountValue: 5,
        discountType: 'FIXED',
        validFrom: new Date(now - 86400000 * 15),
        validUntil: new Date(now + 86400000 * 15),
        maxRedemptions: 200,
        totalRedemptions: 89,
        isActive: true,
        terms: 'Applicable for first EWA transaction only. Max AED 2,000.',
      },
    }),
  ]);

  // Offer Clicks
  await prisma.offerClick.createMany({
    data: [
      { offerId: offers[0].id, userId: users[0].id, action: 'VIEWED', createdAt: new Date(now - 86400000 * 5) },
      { offerId: offers[0].id, userId: users[0].id, action: 'REDEEMED', createdAt: new Date(now - 86400000 * 3) },
      { offerId: offers[1].id, userId: users[2].id, action: 'VIEWED', createdAt: new Date(now - 86400000 * 10) },
      { offerId: offers[2].id, userId: users[0].id, action: 'VIEWED', createdAt: new Date(now - 86400000 * 7) },
      { offerId: offers[2].id, userId: users[1].id, action: 'CLICKED', createdAt: new Date(now - 86400000 * 2) },
      { offerId: offers[3].id, userId: users[0].id, action: 'REDEEMED', createdAt: new Date(now - 86400000 * 1) },
    ],
  });

  // ==================== NOTIFICATIONS ====================
  await prisma.notification.createMany({
    data: [
      { userId: users[0].id, type: 'TRANSACTION', title: 'AED 500 received', body: 'You received AED 500.00 from Ahmed Hassan via P2P transfer', channel: 'PUSH', priority: 'HIGH', isRead: false, createdAt: new Date(now - 120000) },
      { userId: users[0].id, type: 'TRANSACTION', title: 'AED 1,200 sent', body: 'You sent AED 1,200.00 to Priya Sharma via P2P transfer', channel: 'PUSH', priority: 'MEDIUM', isRead: false, createdAt: new Date(now - 3600000) },
      { userId: users[0].id, type: 'SECURITY', title: 'New login detected', body: 'Your account was accessed from a new iPhone 15 device in Dubai, UAE', channel: 'IN_APP', priority: 'HIGH', isRead: false, createdAt: new Date(now - 10800000) },
      { userId: users[0].id, type: 'PAYROLL', title: 'Salary credited', body: 'Your June salary of AED 8,500.00 has been credited to your wallet', channel: 'PUSH', priority: 'URGENT', isRead: false, createdAt: new Date(now - 86400000) },
      { userId: users[0].id, type: 'SECURITY', title: 'Password changed', body: 'Your account password was changed successfully', channel: 'IN_APP', priority: 'MEDIUM', isRead: true, readAt: new Date(now - 86400000), createdAt: new Date(now - 86400000) },
      { userId: users[0].id, type: 'PROMOTION', title: '2x Cashback this week!', body: 'Get double cashback on all remittances during the Ramadan special offer', channel: 'PUSH', priority: 'LOW', isRead: true, readAt: new Date(now - 172800000), createdAt: new Date(now - 172800000) },
      { userId: users[0].id, type: 'LOAN', title: 'Loan payment due', body: 'Your personal loan payment of AED 520.00 is due in 5 days', channel: 'PUSH', priority: 'HIGH', isRead: true, readAt: new Date(now - 259200000), createdAt: new Date(now - 259200000) },
      { userId: users[0].id, type: 'SYSTEM', title: 'Scheduled maintenance', body: 'FlexPay will undergo scheduled maintenance on June 20, 2025 from 2:00 AM to 4:00 AM GST', channel: 'PUSH', priority: 'LOW', isRead: true, readAt: new Date(now - 432000000), createdAt: new Date(now - 432000000) },
      { userId: users[0].id, type: 'SAVINGS', title: 'Goal milestone!', body: 'Your Emergency Fund goal is 32% complete. Keep saving!', channel: 'IN_APP', priority: 'MEDIUM', isRead: true, readAt: new Date(now - 345600000), createdAt: new Date(now - 345600000) },
      { userId: users[1].id, type: 'TRANSACTION', title: 'Remittance completed', body: 'Your remittance of AED 2,000 to Philippines has been successfully processed', channel: 'PUSH', priority: 'MEDIUM', isRead: true, readAt: new Date(now - 86400000 * 3), createdAt: new Date(now - 86400000 * 3) },
      { userId: users[1].id, type: 'LOAN', title: 'Payment overdue', body: 'Your education loan payment of AED 450.00 is overdue. Please pay immediately to avoid penalties.', channel: 'PUSH', priority: 'URGENT', isRead: false, createdAt: new Date(now - 86400000 * 2) },
      { userId: users[2].id, type: 'SYSTEM', title: 'Welcome to FlexPay!', body: 'Complete your KYC verification to unlock all features including remittances and loans', channel: 'IN_APP', priority: 'MEDIUM', isRead: false, createdAt: new Date(now - 86400000 * 5) },
    ],
  });

  // ==================== AML ALERTS ====================
  await prisma.aMLAlert.createMany({
    data: [
      { userId: users[0].id, type: 'LATE_NIGHT', severity: 'LOW', description: 'Multiple transactions between 1:00 AM - 3:00 AM detected. 3 transactions totaling AED 450.', createdAt: new Date(now - 86400000 * 3) },
      { userId: users[2].id, type: 'VELOCITY', severity: 'MEDIUM', description: '15 transactions in 2 hours exceeding normal pattern. Total AED 2,800.', createdAt: new Date(now - 86400000 * 2) },
      { userId: users[0].id, type: 'STRUCTURED', severity: 'HIGH', description: '3 deposits of AED 4,900 each within 24 hours. Possible structuring to avoid AED 15,000 threshold.', createdAt: new Date(now - 86400000), isResolved: false },
      { type: 'MULTI_BENEFICIARY', severity: 'MEDIUM', description: 'New user added 5 beneficiaries in first 48 hours. Phone: +97150***890.', createdAt: new Date(now - 3600000 * 6) },
      { type: 'RAPID_MOVEMENT', severity: 'CRITICAL', description: 'AED 12,000 received and immediately sent as remittance within 10 minutes. Possible layering.', createdAt: new Date(now - 3600000 * 2), isResolved: false },
      { userId: users[3].id, type: 'HIGH_RISK_COUNTRY', severity: 'LOW', description: 'First remittance to high-risk jurisdiction. Amount: AED 800.', createdAt: new Date(now - 86400000 * 5), isResolved: true, resolvedBy: 'system', resolvedAt: new Date(now - 86400000 * 4) },
    ],
  });

  // ==================== AUDIT LOGS ====================
  await prisma.auditLog.createMany({
    data: [
      { userId: users[0].id, action: 'LOGIN', resource: 'auth', details: JSON.stringify({ method: 'otp', device: 'iPhone 15' }), ipAddress: '192.168.1.***' },
      { userId: users[0].id, action: 'TRANSFER', resource: 'p2p', details: JSON.stringify({ to: users[1].id, amount: 500 }), ipAddress: '192.168.1.***' },
      { userId: users[0].id, action: 'REMITTANCE', resource: 'remittance', details: JSON.stringify({ to: 'IN', amount: 2000, corridor: 'wise' }), ipAddress: '192.168.1.***' },
      { userId: users[1].id, action: 'KYC_UPLOAD', resource: 'kyc', details: JSON.stringify({ level: 2, documentType: 'passport' }) },
      { userId: users[0].id, action: 'CARD_FREEZE', resource: 'card', details: JSON.stringify({ cardId: 'card-001', reason: 'suspected_fraud' }) },
      { action: 'SYSTEM', resource: 'aml', details: JSON.stringify({ alertType: 'STRUCTURED', autoAction: 'flag_for_review' }) },
      { action: 'SALARY_DISBURSE', resource: 'payroll', details: JSON.stringify({ companyId: users[4].id, employeeCount: 50, totalAmount: 245000 }) },
      { userId: users[0].id, action: 'LOAN_APPLY', resource: 'loan', details: JSON.stringify({ amount: 3000, purpose: 'RENT', term: 6 }) },
      { userId: users[0].id, action: 'SAVINGS_CREATE', resource: 'savings', details: JSON.stringify({ goalName: 'Emergency Fund', targetAmount: 10000 }) },
      { userId: users[0].id, action: 'REFERRAL_SHARE', resource: 'referral', details: JSON.stringify({ referralCode: 'RAJESH25', channel: 'whatsapp' }) },
    ],
  });

  console.log('Seed data created successfully!');
  console.log(`  Users: ${users.length}`);
  console.log(`  Company: 1`);
  console.log(`  Employees: 4`);
  console.log(`  Wallets: ${walletData.length}`);
  console.log(`  Transactions: ${transactions.length}`);
  console.log(`  Savings Goals: ${savingsGoals.length}`);
  console.log(`  Loans: ${loans.length}`);
  console.log(`  Referrals: 3`);
  console.log(`  Offers: ${offers.length}`);
  console.log(`  Notifications: 12`);
  console.log(`  AML Alerts: 6`);
  console.log(`  Hafiza Circles: 2`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
