import { NextRequest, NextResponse } from 'next/server';
import {
  verifyToken,
  generateAccessToken,
  generateRefreshToken,
  getRefreshToken,
  rotateRefreshToken,
  createAuditLog,
} from '@/lib/auth';
import { db } from '@/lib/db';

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

    // Verify refresh token
    const payload = verifyToken(refreshToken);
    if (!payload) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired refresh token.' },
        { status: 401 },
      );
    }

    // Ensure it's a refresh token, not an access token
    if (payload.type !== 'refresh') {
      return NextResponse.json(
        { success: false, error: 'Invalid token type.' },
        { status: 401 },
      );
    }

    // Check refreshStore (not revoked)
    const storedToken = getRefreshToken(refreshToken);
    if (!storedToken) {
      return NextResponse.json(
        { success: false, error: 'Refresh token has been revoked.' },
        { status: 401 },
      );
    }

    // Verify user still exists and is active
    const user = await db.user.findUnique({
      where: { id: payload.userId },
    });

    if (!user || !user.isActive) {
      // Remove the refresh token since user is invalid
      rotateRefreshToken(refreshToken, '');
      return NextResponse.json(
        { success: false, error: 'User not found or account is inactive.' },
        { status: 401 },
      );
    }

    // Generate new access + refresh tokens (rotation)
    const newAccessToken = await generateAccessToken({
      userId: user.id,
      phone: user.phone,
      role: user.role,
    });

    const newRefreshToken = await generateRefreshToken({ userId: user.id });

    // Rotate: invalidate old, store new
    rotateRefreshToken(refreshToken, newRefreshToken);

    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || undefined;

    // Create AuditLog
    await createAuditLog(
      user.id,
      'TOKEN_REFRESH',
      'auth',
      { userId: user.id },
      ipAddress,
    );

    return NextResponse.json({
      success: true,
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    });
  } catch (error) {
    console.error('Refresh token error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}
