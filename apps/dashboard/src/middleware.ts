import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isPublicRoute = createRouteMatcher(['/', '/demo', '/install', '/privacy', '/terms', '/sign-in(.*)', '/sign-up(.*)', '/onboarding', '/uninstall-survey', '/api/download-extension']);

export default clerkMiddleware(async (auth, request) => {
  // Skip auth in development for easy local testing without Clerk keys
  if (process.env.NODE_ENV === 'development') return;

  if (!isPublicRoute(request)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
