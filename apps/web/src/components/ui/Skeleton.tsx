function SkeletonBlock({ className }: { className: string }) {
  return <div className={`bg-gray-200 rounded animate-pulse ${className}`} />;
}

export function TripListSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="bg-white rounded-lg border border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <SkeletonBlock className="h-4 w-48" />
              <SkeletonBlock className="h-3 w-32" />
            </div>
            <SkeletonBlock className="h-5 w-20 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ClientListSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="bg-white rounded-lg border border-gray-200 px-6 py-4 flex items-center justify-between">
          <div className="space-y-2">
            <SkeletonBlock className="h-4 w-36" />
            <SkeletonBlock className="h-3 w-48" />
          </div>
          <SkeletonBlock className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

export function TripPageSkeleton() {
  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-pulse">
      {/* Header card */}
      <div className="bg-white rounded-lg border border-gray-200 px-6 py-5">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <SkeletonBlock className="h-7 w-64" />
            <SkeletonBlock className="h-4 w-40" />
          </div>
          <SkeletonBlock className="h-5 w-20 rounded-full" />
        </div>
        <div className="mt-4 flex gap-6">
          <div className="space-y-1"><SkeletonBlock className="h-3 w-12" /><SkeletonBlock className="h-4 w-36" /></div>
          <div className="space-y-1"><SkeletonBlock className="h-3 w-16" /><SkeletonBlock className="h-4 w-24" /></div>
        </div>
      </div>
      {/* Content cards */}
      {[0, 1].map((i) => (
        <div key={i} className="bg-white rounded-lg border border-gray-200 px-6 py-5 space-y-3">
          <SkeletonBlock className="h-4 w-32" />
          <div className="grid grid-cols-3 gap-4">
            {[0, 1, 2].map((j) => <SkeletonBlock key={j} className="h-10" />)}
          </div>
        </div>
      ))}
    </div>
  );
}
