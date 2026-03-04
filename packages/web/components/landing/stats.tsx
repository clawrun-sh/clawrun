const STATS = [
  { value: "1min", label: "To deploy" },
  { value: "100%", label: "Open source" },
  { value: "24/7", label: "Availability" },
  { value: "\u221E", label: "Agents" },
];

export function Stats() {
  return (
    <div className="mx-auto max-w-5xl">
      <div className="grid grid-cols-2 divide-x divide-border border-x border-t border-border font-mono sm:grid-cols-4">
        {STATS.map((s) => (
          <div
            key={s.label}
            className="flex flex-col items-center justify-center px-4 py-5 md:py-8"
          >
            <span className="text-3xl font-bold text-primary md:text-5xl" aria-hidden="true">
              {s.value}
            </span>
            <span className="sr-only">
              {s.value} {s.label}
            </span>
            <span
              className="mt-1 text-[11px] uppercase tracking-[0.2em] text-dim md:text-xs"
              aria-hidden="true"
            >
              {s.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
