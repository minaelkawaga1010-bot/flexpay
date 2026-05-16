import { NextRequest, NextResponse } from 'next/server';
import { extractBearerToken, verifyToken } from '@/lib/auth';
import { db } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const token = extractBearerToken(authHeader);

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Authorization header is required.' },
        { status: 401 },
      );
    }

    // Verify access token
    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired access token.' },
        { status: 401 },
      );
    }

    // Ensure it's an access token
    if (payload.type !== 'access') {
      return NextResponse.json(
        { success: false, error: 'Invalid token type.' },
        { status: 401 },
      );
    }

    // Find User in DB
    const user = await db.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        phone: true,
        fullName: true,
        email: true,
        role: true,
        kycLevel: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user || !user.isActive) {
      return NextResponse.json(
        { success: false, error: 'User not found or account is inactive.' },
        { status: 404 },
      );
    }

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        phone: user.phone,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        kycLevel: user.kycLevel,
        isActive: user.isActive,
      },
    });
  } catch (error) {
    console.error('Get current user error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}
