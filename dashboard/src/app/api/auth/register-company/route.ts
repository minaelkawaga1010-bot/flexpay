import { NextRequest, NextResponse } from 'next/server';
import {
  verifyOTP as verifyOTPEntry,
  generateAccessToken,
  generateRefreshToken,
  storeRefreshToken,
  hashPassword,
  createAuditLog,
  validatePhone,
} from '@/lib/auth';
import { db } from '@/lib/db';

type CompanyType = 'FREEZONE' | 'MAINLAND' | 'OFFSHORE';

const VALID_COMPANY_TYPES: CompanyType[] = ['FREEZONE', 'MAINLAND', 'OFFSHORE'];
const VALID_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      phone,
      otp,
      fullName,
      email,
      companyName,
      tradeLicense,
      password,
      companyType,
    } = body as {
      phone?: string;
      otp?: string;
      fullName?: string;
      email?: string;
      companyName?: string;
      tradeLicense?: string;
      password?: string;
      companyType?: CompanyType;
    };

    // Verify OTP first
    if (!phone || !validatePhone(phone)) {
      return NextResponse.json(
        { success: false, error: 'Invalid phone number. Must start with + and be 10-15 characters.' },
        { status: 400 },
      );
    }

    if (!otp || otp.length !== 6 || !/^\d{6}$/.test(otp)) {
      return NextResponse.json(
        { success: false, error: 'Invalid OTP. Must be 6 digits.' },
        { status: 400 },
      );
    }

    const otpResult = verifyOTPEntry(phone, otp, 'REGISTER');
    if (!otpResult.valid) {
      return NextResponse.json(
        { success: false, error: otpResult.reason },
        { status: 401 },
      );
    }

    // Validate: full name
    if (!fullName || fullName.trim().length < 2) {
      return NextResponse.json(
        { success: false, error: 'Full name must be at least 2 characters.' },
        { status: 400 },
      );
    }

    // Validate: email format
    if (!email || !VALID_EMAIL_REGEX.test(email)) {
      return NextResponse.json(
        { success: false, error: 'Invalid email address.' },
        { status: 400 },
      );
    }

    // Validate: company name
    if (!companyName || companyName.trim().length < 2) {
      return NextResponse.json(
        { success: false, error: 'Company name must be at least 2 characters.' },
        { status: 400 },
      );
    }

    // Validate: trade license
    if (!tradeLicense || tradeLicense.trim().length < 3) {
      return NextResponse.json(
        { success: false, error: 'Trade license number is required.' },
        { status: 400 },
      );
    }

    // Validate: password min 8 chars
    if (!password || password.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { success: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` },
        { status: 400 },
      );
    }

    // Validate: company type
    if (!companyType || !VALID_COMPANY_TYPES.includes(companyType)) {
      return NextResponse.json(
        { success: false, error: 'Invalid company type. Must be FREEZONE, MAINLAND, or OFFSHORE.' },
        { status: 400 },
      );
    }

    // Check if phone already registered
    const existingUser = await db.user.findUnique({ where: { phone } });
    if (existingUser) {
      return NextResponse.json(
        { success: false, error: 'Phone number already registered.' },
        { status: 409 },
      );
    }

    // Check if email already registered
    const existingEmail = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (existingEmail) {
      return NextResponse.json(
        { success: false, error: 'Email address already registered.' },
        { status: 409 },
      );
    }

    // Check if trade license already used
    const existingLicense = await db.company.findUnique({ where: { tradeLicense: tradeLicense.trim() } });
    if (existingLicense) {
      return NextResponse.json(
        { success: false, error: 'Trade license number already registered.' },
        { status: 409 },
      );
    }

    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || undefined;

    // Hash password with PBKDF2
    const hashedPassword = await hashPassword(password);

    // Create User (role=COMPANY), Company record, Wallet in a transaction
    const result = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          phone,
          fullName: fullName.trim(),
          email: email.trim().toLowerCase(),
          role: 'COMPANY',
          kycLevel: 0,
        },
      });

      const company = await tx.company.create({
        data: {
          userId: user.id,
          companyName: companyName.trim(),
          tradeLicense: tradeLicense.trim(),
          companyType,
          industry: 'GENERAL',
          subscriptionPlan: 'STARTER',
          subscriptionExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30-day trial
        },
      });

      const wallet = await tx.wallet.create({
        data: {
          userId: user.id,
          isActive: true,
          balances: {
            create: {
              currency: 'AED',
              amount: 0,
            },
          },
        },
      });

      return { user, company, wallet };
    });

    // Generate tokens
    const accessToken = await generateAccessToken({
      userId: result.user.id,
      phone: result.user.phone,
      role: result.user.role,
    });

    const refreshToken = await generateRefreshToken({ userId: result.user.id });

    // Store refresh token
    storeRefreshToken(refreshToken, result.user.id);

    // Create AuditLog
    await createAuditLog(
      result.user.id,
      'COMPANY_REGISTER',
      'auth',
      {
        phone: phone.slice(0, -4) + '****',
        companyName: result.company.companyName,
        companyType,
        tradeLicense: tradeLicense.slice(0, 2) + '****',
      },
      ipAddress,
    );

    return NextResponse.json(
      { success: true, accessToken, refreshToken, user: {
        id: result.user.id,
        phone: result.user.phone,
        fullName: result.user.fullName,
        email: result.user.email,
        role: result.user.role,
        kycLevel: result.user.kycLevel,
        avatarUrl: result.user.avatarUrl,
        isActive: result.user.isActive,
        createdAt: result.user.createdAt,
        updatedAt: result.user.updatedAt,
      }, company: {
        id: result.company.id,
        companyName: result.company.companyName,
        tradeLicense: result.company.tradeLicense,
        companyType: result.company.companyType,
        industry: result.company.industry,
        isVerified: result.company.isVerified,
        subscriptionPlan: result.company.subscriptionPlan,
      }},
      { status: 201 },
    );
  } catch (error) {
    console.error('Register company error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}
