import { Skeleton } from "@/components/ui/skeleton";

/**
 * Mobile-first loading skeleton for the Dashboard. Mirrors the real layout
 * (hero, breakdown grid, monthly bar chart) so the UI doesn't jump as data
 * and tax-engine outputs settle.
 */
export default function DashboardSkeleton() {
  return (
    <div className="space-y-6 max-w-3xl mx-auto" aria-busy="true" aria-live="polite">
      {/* Header */}
      <header className="px-1 pb-1 space-y-2">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-3 w-40" />
      </header>

      {/* Hero — Total Annual Income */}
      <section className="relative overflow-hidden rounded-2xl bg-success/10 px-5 py-6 sm:px-6 sm:py-7 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <Skeleton className="h-3 w-32 bg-success/20" />
              <Skeleton className="h-6 w-24 rounded-lg bg-success/20" />
            </div>
            <Skeleton className="h-10 sm:h-12 w-44 sm:w-56 bg-success/20" />
            <Skeleton className="h-3 w-56 bg-success/20" />
          </div>
          <Skeleton className="hidden sm:block h-12 w-12 rounded-full bg-success/20" />
        </div>
      </section>

      {/* Tax progress / quarterly tracker placeholder */}
      <section className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-6 w-28" />
            </div>
          ))}
        </div>
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-3/4" />
      </section>

      {/* 2x2 income breakdown */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl bg-card border border-border/60 shadow-sm p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Skeleton className="h-7 w-7 rounded-full" />
              <Skeleton className="h-3 w-20" />
            </div>
            <Skeleton className="h-7 w-24" />
          </div>
        ))}
      </div>

      {/* Monthly income bar chart */}
      <section className="rounded-2xl bg-card border border-border/60 shadow-sm p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-44" />
          </div>
          <Skeleton className="h-3 w-20" />
        </div>
        <div className="mt-4 flex items-end gap-1 sm:gap-2 h-32">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex flex-1 flex-col items-center justify-end gap-1.5">
              <Skeleton
                className="w-6 sm:w-7 rounded-t-md"
                style={{ height: `${40 + ((i * 37) % 55)}%` }}
              />
            </div>
          ))}
          <div className="hidden sm:flex flex-1 gap-2">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="flex flex-1 flex-col items-center justify-end gap-1.5">
                <Skeleton
                  className="w-7 rounded-t-md"
                  style={{ height: `${30 + ((i * 23) % 60)}%` }}
                />
              </div>
            ))}
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border/60 pt-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      </section>

      {/* Financial score placeholder */}
      <section className="rounded-2xl bg-card border border-border/60 shadow-sm p-4 sm:p-5 space-y-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-2.5 w-full rounded-full" />
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-24" />
        </div>
      </section>
    </div>
  );
}
