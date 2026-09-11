export default function Loading() {
  return (
    <div className="animate-[fade-in_0.2s_ease-out]">
      <header className="border-b border-border-base bg-surface px-4 pt-5 pb-6 sm:px-6">
        <div className="skeleton h-6 w-64" />
        <div className="skeleton mt-3 h-4 w-96" />
      </header>

      <div className="space-y-5 px-4 py-5 sm:px-6">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card p-4">
              <div className="skeleton h-3.5 w-24" />
              <div className="skeleton mt-3 h-7 w-16" />
              <div className="skeleton mt-3 h-3 w-32" />
            </div>
          ))}
        </div>

        <div className="grid gap-5 lg:grid-cols-3">
          <div className="card p-5 lg:col-span-2">
            <div className="skeleton h-4 w-40" />
            <div className="skeleton mt-4 h-56 w-full" />
          </div>
          <div className="card p-5">
            <div className="skeleton h-4 w-32" />
            <div className="mt-4 space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="skeleton h-10 w-full" />
              ))}
            </div>
          </div>
        </div>
      </div>

      <span className="sr-only" role="status">
        Loading
      </span>
    </div>
  );
}
