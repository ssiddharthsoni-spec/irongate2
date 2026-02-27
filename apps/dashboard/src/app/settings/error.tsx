'use client';

export default function SettingsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex items-center justify-center min-h-[40vh]">
      <div className="text-center p-6 max-w-md">
        <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">
          Settings error
        </h2>
        <p className="text-[#6e6e73] dark:text-[#86868b] mb-4 text-sm">
          {error.message || 'Failed to load settings. Please try again.'}
        </p>
        <button
          onClick={reset}
          className="px-4 py-2 text-sm bg-[#1d1d1f] dark:bg-[#f5f5f7] text-white dark:text-[#1d1d1f] rounded-lg hover:bg-[#424245] dark:hover:bg-[#d2d2d7] transition-colors"
        >
          Try Again
        </button>
      </div>
    </div>
  );
}
