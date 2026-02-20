import { NextResponse } from 'next/server';
import type { NextRequest, NextFetchEvent } from 'next/server';

export default async function middleware(request: NextRequest, event: NextFetchEvent) {
  // Skip Clerk middleware entirely if publishable key isn't configured
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return NextResponse.next();
  }

  // Dynamically import Clerk only when the key is present
  const { clerkMiddleware, createRouteMatcher } = await import('@clerk/nextjs/server');

  const isPublicRoute = createRouteMatcher(['/sign-in(.*)', '/sign-up(.*)']);

  const handler = clerkMiddleware(async (auth, req) => {
    if (!isPublicRoute(req)) {
      await auth.protect();
    }
  });

  return handler(request, event);
}

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
