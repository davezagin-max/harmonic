import type { PlannedSet } from "@/lib/crate/set";
import type { OptimizeResult } from "@/lib/optimizer/optimize";

interface StatsCardProps {
  result: OptimizeResult;
  set: PlannedSet;
  /** Milliseconds the last run took in the worker, or null for the set computed at build time. */
  ms: number | null;
}

const W = 320;
const H = 120;
const PAD = { left: 6, right: 6, top: 8, bottom: 8 };

function TraceChart({ result }: { result: OptimizeResult }) {
  const { trace, baseline } = result;
  const top = Math.max(baseline.max, ...trace.current) * 1.04 || 1;
  const count = Math.max(1, trace.best.length - 1);
  const x = (index: number) => PAD.left + (index / count) * (W - PAD.left - PAD.right);
  const y = (cost: number) => PAD.top + (1 - cost / top) * (H - PAD.top - PAD.bottom);
  const points = (values: number[]) =>
    values.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  const meanY = y(baseline.mean);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="block h-auto w-full"
      role="img"
      aria-label={`Search progress. Cost falls from ${trace.best[0].toFixed(1)} to ${result.cost.total.toFixed(1)}; random orders average ${baseline.mean.toFixed(1)}.`}
    >
      {/* Range of the random orders, lowest to highest cost */}
      <rect
        x={PAD.left}
        y={y(baseline.max)}
        width={W - PAD.left - PAD.right}
        height={Math.max(1, y(baseline.min) - y(baseline.max))}
        fill="var(--danger)"
        opacity={0.1}
      />
      <line
        x1={PAD.left}
        x2={W - PAD.right}
        y1={meanY}
        y2={meanY}
        stroke="var(--danger)"
        strokeWidth={1.5}
        strokeDasharray="5 4"
      />
      <text x={W - PAD.right - 2} y={meanY - 5} textAnchor="end" fontSize={10} fill="var(--danger)">
        random order, average
      </text>
      <line
        x1={PAD.left}
        x2={W - PAD.right}
        y1={H - PAD.bottom}
        y2={H - PAD.bottom}
        stroke="var(--border)"
      />
      <polyline
        points={points(trace.current)}
        fill="none"
        stroke="var(--muted)"
        strokeWidth={1}
        opacity={0.7}
      />
      <polyline
        points={points(trace.best)}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={2.2}
        strokeLinejoin="round"
      />
      <circle cx={x(count)} cy={y(trace.best[count])} r={3.5} fill="var(--accent)" />
      <text
        x={W - PAD.right - 2}
        y={y(trace.best[count]) - 7}
        textAnchor="end"
        fontSize={10}
        fill="var(--accent)"
      >
        optimized
      </text>
    </svg>
  );
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted">{label}</dt>
      <dd className="font-mono text-sm">
        {value}
        {hint && <span className="ml-1 text-xs text-muted">{hint}</span>}
      </dd>
    </div>
  );
}

const PARTS = [
  { key: "key", label: "key", color: "var(--accent)" },
  { key: "tempo", label: "tempo", color: "var(--warn)" },
  { key: "energy", label: "energy arc", color: "var(--success)" },
  { key: "fill", label: "length", color: "var(--muted)" },
] as const;

/** How much better the optimized set is than a random order, as a number and a chart. */
export function StatsCard({ result, set, ms }: StatsCardProps) {
  const { baseline, cost } = result;
  const { stats } = set;
  const steps = new Intl.NumberFormat("en-US").format(result.iterations);

  return (
    <section
      aria-labelledby="stats-title"
      className="rounded-lg border border-border bg-surface p-4"
    >
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <h2 id="stats-title" className="text-sm font-semibold">
          Against a random order
        </h2>
        <p className="font-mono text-[11px] text-muted">
          seed {result.seed} · {steps} steps
          {ms !== null ? ` · ${Math.max(1, Math.round(ms))} ms` : ""}
        </p>
      </div>

      <div className="mt-3 grid grid-cols-1 items-center gap-4 min-[420px]:grid-cols-[auto_minmax(0,1fr)]">
        <div>
          <p className="font-mono text-4xl font-bold leading-none tracking-tight text-accent">
            {result.improvementPct.toFixed(0)}%
          </p>
          <p className="mt-1.5 max-w-[11rem] text-xs leading-snug text-muted">
            lower cost than the average of {baseline.shuffles} random orders of the same crate
          </p>
          <p className="mt-2 font-mono text-xs">
            {cost.total.toFixed(1)} <span className="text-muted">vs</span>{" "}
            {baseline.mean.toFixed(1)}
            <span className="text-muted"> (best random {baseline.min.toFixed(1)})</span>
          </p>
        </div>
        <TraceChart result={result} />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-3 sm:grid-cols-4">
        <Fact
          label="Clean mixes"
          value={`${stats.cleanMixes} of ${stats.mixes}`}
          hint={`random ${(baseline.cleanShare * 100).toFixed(0)}%`}
        />
        <Fact label="Key clashes" value={String(stats.keyClashes)} />
        <Fact label="Avg tempo move" value={`${stats.avgTempoPct.toFixed(1)}%`} />
        <Fact label="Avg arc miss" value={`${stats.avgEnergyMiss.toFixed(1)}`} hint="levels" />
      </dl>

      <div className="mt-3">
        <p className="mb-1 text-[11px] uppercase tracking-wide text-muted">
          What is left of the cost
        </p>
        <div className="flex h-2 overflow-hidden rounded-sm bg-raised" aria-hidden>
          {PARTS.map((part) => (
            <span
              key={part.key}
              style={{
                width: `${cost.total > 0 ? (cost[part.key] / cost.total) * 100 : 0}%`,
                background: part.color,
              }}
            />
          ))}
        </div>
        <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] text-muted">
          {PARTS.map((part) => (
            <span key={part.key} className="inline-flex items-center gap-1">
              <span
                aria-hidden
                className="size-2 rounded-[2px]"
                style={{ background: part.color }}
              />
              {part.label} {cost[part.key].toFixed(2)}
            </span>
          ))}
        </p>
      </div>
    </section>
  );
}
