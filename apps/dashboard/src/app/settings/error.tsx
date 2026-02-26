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
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          Settings error
        </h2>
        <p className="text-gray-600 dark:text-gray-400 mb-4 text-sm">
          {error.message || 'Failed to load settings. Please try again.'}
        </p>
        <button
          onClick={reset}
          className="px-4 py-2 text-sm bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-lg hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors"
        >
          Try Again
        </button>
      </div>
    </div>
  );
}
