import { NextRequest, NextResponse } from 'next/server';
import { validatePhone, generateOTP, storeOTP, checkRateLimit, createAuditLog } from '@/lib/auth';
import { db } from '@/lib/db';

type OTPPurpose = 'LOGIN' | 'REGISTER' | 'RESET';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { phone, purpose } = body as { phone?: string; purpose?: OTPPurpose };

    // Validate phone format: must start with + and be 10-15 chars
    if (!phone || !validatePhone(phone)) {
      return NextResponse.json(
        { success: false, error: 'Invalid phone number. Must start with + and be 10-15 characters.' },
        { status: 400 },
      );
    }

    // Validate purpose
    const validPurposes: OTPPurpose[] = ['LOGIN', 'REGISTER', 'RESET'];
    if (!purpose || !validPurposes.includes(purpose)) {
      return NextResponse.json(
        { success: false, error: 'Invalid purpose. Must be LOGIN, REGISTER, or RESET.' },
        { status: 400 },
      );
    }

    // Rate limit: max 3 requests per phone per hour
    const rateCheck = checkRateLimit(phone);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: 'Too many OTP requests. Please try again later.',
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(rateCheck.retryAfter),
          },
        },
      );
    }

    // For REGISTER purpose, check if phone already exists
    if (purpose === 'REGISTER') {
      const existingUser = await db.user.findUnique({ where: { phone } });
      if (existingUser) {
        return NextResponse.json(
          { success: false, error: 'Phone number already registered. Please login instead.' },
          { status: 409 },
        );
      }
    }

    // For LOGIN purpose, check if phone exists
    if (purpose === 'LOGIN') {
      const existingUser = await db.user.findUnique({ where: { phone } });
      if (!existingUser) {
        return NextResponse.json(
          { success: false, error: 'Phone number not registered. Please register first.' },
          { status: 404 },
        );
      }
    }

    // Generate 6-digit OTP and store with 5-min TTL
    const otp = generateOTP();
    storeOTP(phone, otp, purpose);

    // Create AuditLog entry
    const existingUser = await db.user.findUnique({ where: { phone } });
    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || undefined;
    await createAuditLog(
      existingUser?.id || 'anonymous',
      'OTP_REQUEST',
      'auth',
      { phone: phone.slice(0, -4) + '****', purpose },
      ipAddress,
    );

    // In production, would send OTP via Twilio/SMS gateway
    return NextResponse.json({
      success: true,
      message: 'OTP sent',
      expiresIn: 300,
      devOtp: otp, // Included for testing in development
    });
  } catch (error) {
    console.error('Request OTP error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}
