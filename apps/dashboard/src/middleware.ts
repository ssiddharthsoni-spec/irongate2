import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const isPublicRoute = createRouteMatcher(['/', '/demo', '/install', '/privacy', '/terms', '/sign-in(.*)', '/sign-up(.*)', '/onboarding', '/uninstall-survey', '/api/download-extension']);
const isAdminRoute = createRouteMatcher(['/admin(.*)']);

export default clerkMiddleware(async (auth, request) => {
  // Signed-in users hitting the marketing homepage → redirect to dashboard
  if (request.nextUrl.pathname === '/') {
    try {
      const { userId } = await auth();
      if (userId) {
        return NextResponse.redirect(new URL('/dashboard', request.url));
      }
    } catch {
      // Auth not available (e.g., dev mode without Clerk keys) — show homepage
    }
  }

  // SKIP_AUTH is dev-only — never honor it in production
  if (process.env.NODE_ENV === 'development' && process.env.SKIP_AUTH === 'true') return;
  if (process.env.NODE_ENV === 'production' && process.env.SKIP_AUTH) {
    throw new Error('FATAL: SKIP_AUTH must not be set in production');
  }

  if (!isPublicRoute(request)) {
    await auth.protect();
  }

  // Admin routes require admin role
  if (isAdminRoute(request)) {
    try {
      const { sessionClaims } = await auth();
      const role = (sessionClaims?.metadata as Record<string, unknown>)?.role;
      if (role !== 'admin' && role !== 'superadmin') {
        return NextResponse.redirect(new URL('/dashboard', request.url));
      }
    } catch {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
  }
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
