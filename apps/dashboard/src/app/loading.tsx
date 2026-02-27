export default function Loading() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="animate-pulse space-y-4 w-full max-w-2xl px-8">
        <div className="h-8 bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded w-1/3" />
        <div className="h-4 bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded w-2/3" />
        <div className="space-y-3 mt-6">
          <div className="h-32 bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded" />
          <div className="grid grid-cols-3 gap-4">
            <div className="h-24 bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded" />
            <div className="h-24 bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded" />
            <div className="h-24 bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded" />
          </div>
        </div>
      </div>
    </div>
  );
}
