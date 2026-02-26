export default function Loading() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="animate-pulse space-y-4 w-full max-w-2xl px-8">
        <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-2/3" />
        <div className="space-y-3 mt-6">
          <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded" />
          <div className="grid grid-cols-3 gap-4">
            <div className="h-24 bg-gray-200 dark:bg-gray-700 rounded" />
            <div className="h-24 bg-gray-200 dark:bg-gray-700 rounded" />
            <div className="h-24 bg-gray-200 dark:bg-gray-700 rounded" />
          </div>
        </div>
      </div>
    </div>
  );
}
