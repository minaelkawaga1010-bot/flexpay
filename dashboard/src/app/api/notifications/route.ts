import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

const DEMO_PHONE = '+971501234567';

const VALID_TYPES = ['TRANSACTION', 'PAYROLL', 'SECURITY', 'PROMOTION', 'SYSTEM', 'REMINDER', 'LOAN', 'SAVINGS'];

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const typeFilter = searchParams.get('type');
    const unreadOnly = searchParams.get('unread') === 'true';

    const user = await db.user.findUnique({
      where: { phone: DEMO_PHONE },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Build the where clause
    const where: Record<string, unknown> = { userId: user.id };

    if (typeFilter && VALID_TYPES.includes(typeFilter)) {
      where.type = typeFilter;
    }

    if (unreadOnly) {
      where.isRead = false;
    }

    // Fetch notifications and unread count
    const [notifications, unreadCount] = await Promise.all([
      db.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      db.notification.count({
        where: { userId: user.id, isRead: false },
      }),
    ]);

    return NextResponse.json({
      notifications,
      unreadCount,
    });
  } catch (error) {
    console.error('Notifications GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await db.user.findUnique({
      where: { phone: DEMO_PHONE },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const body = await request.json();
    const { id, markAll } = body;

    if (markAll) {
      // Mark all notifications as read
      const result = await db.notification.updateMany({
        where: { userId: user.id, isRead: false },
        data: { isRead: true, readAt: new Date() },
      });

      return NextResponse.json({
        message: `${result.count} notifications marked as read`,
        count: result.count,
      });
    }

    if (!id) {
      return NextResponse.json({ error: 'Notification ID is required' }, { status: 400 });
    }

    // Mark a specific notification as read
    const notification = await db.notification.findUnique({
      where: { id },
    });

    if (!notification) {
      return NextResponse.json({ error: 'Notification not found' }, { status: 404 });
    }

    if (notification.userId !== user.id) {
      return NextResponse.json({ error: 'Notification does not belong to this user' }, { status: 400 });
    }

    if (notification.isRead) {
      return NextResponse.json({ message: 'Notification already read' });
    }

    const updated = await db.notification.update({
      where: { id },
      data: { isRead: true, readAt: new Date() },
    });

    return NextResponse.json({
      message: 'Notification marked as read',
      notification: updated,
    });
  } catch (error) {
    console.error('Notifications PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
