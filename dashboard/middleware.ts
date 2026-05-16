import { NextRequest, NextResponse } from 'next/server';

// Rate limiter store — sliding window per IP
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

// Clean up expired entries every 60 seconds to prevent memory leaks
let lastCleanup = Date.now();
function cleanupStore() {
  const now = Date.now();
  if (now - lastCleanup > 60_000) {
    for (const [key, entry] of rateLimitStore) {
      if (entry.resetAt <= now) {
        rateLimitStore.delete(key);
      }
    }
    lastCleanup = now;
  }
}

/**
 * Sliding window rate limiter.
 * On each request we check whether the current window has expired.
 * If expired → start a fresh window with count = 1.
 * If still active → increment count and deny if it exceeds maxRequests.
 */
function checkRateLimit(
  ip: string,
  maxRequests: number,
  windowMs: number,
): { allowed: boolean; retryAfter?: number } {
  cleanupStore();

  const now = Date.now();
  const entry = rateLimitStore.get(ip);

  if (!entry || entry.resetAt <= now) {
    // No entry or window expired — start a new window
    rateLimitStore.set(ip, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }

  // Window is still active
  if (entry.count >= maxRequests) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return { allowed: false, retryAfter };
  }

  entry.count += 1;
  return { allowed: true };
}

/**
 * Allowed origins for CORS in production.
 */
const PROD_ALLOWED_ORIGINS = [
  'https://flexpay.ae',
  'https://app.flexpay.ae',
];

export function middleware(request: NextRequest) {
  const { method, headers, nextUrl } = request;
  const response = NextResponse.next();
  const isProduction = process.env.NODE_ENV === 'production';
  const pathname = nextUrl.pathname;

  // -------------------------------------------------------------------
  // 1. Security Headers (Helmet-style)
  // -------------------------------------------------------------------

  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(self), geolocation=()',
  );

  // HSTS — only in production
  if (isProduction) {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload',
    );
  }

  // Content-Security-Policy — only for non-API routes (e.g. /health)
  if (!pathname.startsWith('/api')) {
    response.headers.set(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "connect-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; '),
    );
  }

  // -------------------------------------------------------------------
  // 2. CORS
  // -------------------------------------------------------------------

  const origin = headers.get('origin') ?? '';

  const isAllowedOrigin =
    !isProduction ||
    PROD_ALLOWED_ORIGINS.includes(origin) ||
    origin === '';

  if (isAllowedOrigin) {
    response.headers.set('Access-Control-Allow-Origin', origin || '*');
  }

  response.headers.set(
    'Access-Control-Allow-Methods',
    'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  );
  response.headers.set(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Requested-With, Accept',
  );
  response.headers.set('Access-Control-Max-Age', '86400'); // 24 hours

  // Handle OPTIONS preflight — short-circuit with 204
  if (method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: response.headers,
    });
  }

  // -------------------------------------------------------------------
  // 3. Rate Limiting (API routes only)
  // -------------------------------------------------------------------

  if (pathname.startsWith('/api')) {
    // Determine rate limit — stricter for auth endpoints
    const isAuthEndpoint = pathname.startsWith('/api/auth');
    const maxRequests = isAuthEndpoint ? 10 : 100;
    const windowMs = 60_000; // 1 minute

    // Derive client IP — try standard headers then fall back to remote addr
    const forwarded = headers.get('x-forwarded-for');
    const realIp = headers.get('x-real-ip');
    const ip = forwarded?.split(',')[0]?.trim() ?? realIp ?? 'unknown';

    const { allowed, retryAfter } = checkRateLimit(ip, maxRequests, windowMs);

    if (!allowed) {
      return NextResponse.json(
        {
          error: 'Too Many Requests',
          message: `Rate limit exceeded. Please try again after ${retryAfter} second${retryAfter !== 1 ? 's' : ''}.`,
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(retryAfter),
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': isAllowedOrigin ? (origin || '*') : '',
          },
        },
      );
    }
  }

  return response;
}

export const config = {
  matcher: ['/api/:path*', '/health', '/health/:path*', '/metrics'],
};
