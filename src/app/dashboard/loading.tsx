'use client';

// Immediate loading state for dashboard - shows before component mounts
// This prevents the black screen flash

export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#050510] via-[#0a0a18] to-[#050510] flex flex-col">
      {/* Skeleton Header */}
      <div className="flex items-center justify-between p-4">
        <div className="h-6 w-32 bg-white/10 rounded animate-pulse" />
        <div className="h-8 w-8 bg-white/10 rounded-full animate-pulse" />
      </div>

      {/* Skeleton Video */}
      <div className="flex-1 relative mx-4 mb-4">
        <div className="w-full h-full min-h-[60vh] bg-gradient-to-br from-white/5 to-white/10 rounded-2xl animate-pulse flex items-center justify-center border border-white/10">
          <div className="w-16 h-16 rounded-full bg-white/10 animate-pulse" />
        </div>

        {/* Skeleton Right Controls */}
        <div className="absolute right-3 bottom-32 flex flex-col gap-4">
          <div className="w-12 h-12 bg-white/10 rounded-full animate-pulse" />
          <div className="w-12 h-12 bg-white/10 rounded-full animate-pulse" />
          <div className="w-12 h-12 bg-white/10 rounded-full animate-pulse" />
        </div>

        {/* Skeleton Creator Info */}
        <div className="absolute bottom-4 left-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-white/10 rounded-full animate-pulse" />
          <div className="space-y-2">
            <div className="h-4 w-24 bg-white/10 rounded animate-pulse" />
            <div className="h-3 w-16 bg-white/10 rounded animate-pulse" />
          </div>
        </div>
      </div>

      {/* Skeleton Bottom Nav */}
      <div className="h-16 border-t border-white/10 flex items-center justify-around px-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="flex flex-col items-center gap-1">
            <div className="w-6 h-6 bg-white/10 rounded animate-pulse" />
            <div className="w-10 h-2 bg-white/10 rounded animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}

