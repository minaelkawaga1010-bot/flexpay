import { NextRequest, NextResponse } from 'next/server';
import { removeRefreshToken, verifyToken, createAuditLog } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { refreshToken } = body as { refreshToken?: string };

    if (!refreshToken) {
      return NextResponse.json(
        { success: false, error: 'Refresh token is required.' },
        { status: 400 },
      );
    }

    // Verify the token to get user info for audit logging
    const payload = verifyToken(refreshToken);
    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || undefined;

    if (payload && payload.type === 'refresh') {
      // Create AuditLog before removing
      await createAuditLog(
        payload.userId,
        'LOGOUT',
        'auth',
        { userId: payload.userId },
        ipAddress,
      );
    }

    // Remove from refreshStore
    removeRefreshToken(refreshToken);

    return NextResponse.json({
      success: true,
      message: 'Logged out',
    });
  } catch (error) {
    console.error('Logout error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}
