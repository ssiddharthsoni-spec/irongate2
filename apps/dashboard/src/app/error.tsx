'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const isAuthError =
    error.message.includes('Session expired') ||
    error.message.includes('sign in') ||
    error.message.includes('Authentication failed');

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center p-8 max-w-md">
        <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
          <svg className="h-6 w-6 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">
          {isAuthError ? 'Session Expired' : 'Something went wrong'}
        </h2>
        <p className="text-[#6e6e73] dark:text-[#86868b] mb-6">
          {isAuthError
            ? 'Your session has expired. Please sign in again to continue.'
            : 'An unexpected error occurred. Please try again.'}
        </p>
        {isAuthError ? (
          <a
            href="/sign-in"
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Sign In
          </a>
        ) : (
          <button
            onClick={reset}
            className="inline-flex items-center px-4 py-2 bg-[#1d1d1f] dark:bg-white text-white dark:text-[#1d1d1f] rounded-lg hover:bg-[#424245] dark:hover:bg-[#d2d2d7] transition-colors"
          >
            Try Again
          </button>
        )}
      </div>
    </div>
  );
}
