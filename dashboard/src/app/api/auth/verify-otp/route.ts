import { NextRequest, NextResponse } from 'next/server';
import {
  verifyOTP as verifyOTPEntry,
  generateAccessToken,
  generateRefreshToken,
  storeRefreshToken,
  createAuditLog,
  validatePhone,
} from '@/lib/auth';
import { db } from '@/lib/db';

type OTPPurpose = 'LOGIN' | 'REGISTER' | 'RESET';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { phone, otp, purpose } = body as { phone?: string; otp?: string; purpose?: OTPPurpose };

    // Validate inputs
    if (!phone || !validatePhone(phone)) {
      return NextResponse.json(
        { success: false, error: 'Invalid phone number.' },
        { status: 400 },
      );
    }

    if (!otp || otp.length !== 6 || !/^\d{6}$/.test(otp)) {
      return NextResponse.json(
        { success: false, error: 'Invalid OTP. Must be 6 digits.' },
        { status: 400 },
      );
    }

    const validPurposes: OTPPurpose[] = ['LOGIN', 'REGISTER', 'RESET'];
    if (!purpose || !validPurposes.includes(purpose)) {
      return NextResponse.json(
        { success: false, error: 'Invalid purpose.' },
        { status: 400 },
      );
    }

    // Verify OTP — max 3 attempts, else delete
    const otpResult = verifyOTPEntry(phone, otp, purpose);
    if (!otpResult.valid) {
      return NextResponse.json(
        { success: false, error: otpResult.reason },
        { status: 401 },
      );
    }

    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || undefined;
    let user: {
      id: string;
      phone: string;
      fullName: string;
      email: string | null;
      role: string;
      kycLevel: number;
      avatarUrl: string | null;
      isActive: boolean;
      createdAt: Date;
      updatedAt: Date;
    };
    let isNewUser = false;

    if (purpose === 'REGISTER') {
      // Create new user with EMPLOYEE role
      user = await db.user.create({
        data: {
          phone,
          fullName: 'New User',
          role: 'EMPLOYEE',
          kycLevel: 0,
        },
      });

      // Create wallet with AED balance 0
      await db.wallet.create({
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

      isNewUser = true;
    } else if (purpose === 'LOGIN') {
      // Find existing user
      const found = await db.user.findUnique({
        where: { phone },
      });

      if (!found || !found.isActive) {
        return NextResponse.json(
          { success: false, error: 'User not found or account is inactive.' },
          { status: 404 },
        );
      }

      user = found;
    } else {
      // RESET — find user
      const found = await db.user.findUnique({
        where: { phone },
      });

      if (!found) {
        return NextResponse.json(
          { success: false, error: 'User not found.' },
          { status: 404 },
        );
      }

      user = found;
    }

    // Generate accessToken (15 min) + refreshToken (7 day)
    const accessToken = await generateAccessToken({
      userId: user.id,
      phone: user.phone,
      role: user.role,
    });

    const refreshToken = await generateRefreshToken({ userId: user.id });

    // Store refreshToken in refreshStore
    storeRefreshToken(refreshToken, user.id);

    // Create AuditLog
    await createAuditLog(
      user.id,
      'OTP_VERIFY',
      'auth',
      { phone: phone.slice(0, -4) + '****', purpose, isNewUser },
      ipAddress,
    );

    return NextResponse.json({
      success: true,
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        phone: user.phone,
        fullName: user.fullName,
        role: user.role,
        kycLevel: user.kycLevel,
      },
      isNewUser,
    });
  } catch (error) {
    console.error('Verify OTP error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}
