"use client";

import { useRef, useState } from "react";
import type { ImportReport } from "@/lib/crate/import";
import { MAX_TARGET_MIN, MIN_TARGET_MIN } from "@/lib/defaults";
import type { Weights } from "@/lib/optimizer/optimize";

interface ToolbarProps {
  crateName: string;
  trackCount: number;
  isSample: boolean;
  report: ImportReport | null;
  importError: string | null;
  onImport: (file: File) => void;
  onUseSample: () => void;
  onDownloadSample: () => void;
  targetMin: number;
  onTargetMin: (minutes: number) => void;
  weights: Weights;
  onWeights: (weights: Weights) => void;
  seed: number;
  busy: boolean;
  onOptimize: () => void;
  canReset: boolean;
  onReset: () => void;
}

const WEIGHT_LABELS: { key: keyof Weights; label: string; hint: string }[] = [
  { key: "key", label: "Harmony", hint: "How much a key clash costs" },
  { key: "tempo", label: "Tempo", hint: "How much a tempo jump costs" },
  { key: "energy", label: "Energy arc", hint: "How much straying from the arc costs" },
];

const small = "rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-raised";

function importSummary(report: ImportReport): string {
  const parts = [`${report.imported} tracks`, `${report.layout} layout`];
  if (report.skippedCount > 0) {
    const first = report.skipped[0];
    parts.push(
      `${report.skippedCount} row${report.skippedCount === 1 ? "" : "s"} skipped (row ${first.row}: ${first.reason})`,
    );
  }
  if (report.energyDerived > 0) {
    parts.push(
      `energy missing for ${report.energyDerived}, so a stand-in was derived from tempo (shown as ~)`,
    );
  }
  if (report.durationAssumed > 0)
    parts.push(`length assumed as 6:00 for ${report.durationAssumed}`);
  if (report.truncated) parts.push("file cut at the 500-track limit");
  return parts.join(" · ");
}

/** Crate, set length, priorities, and the button that re-runs the search. */
export function Toolbar(props: ToolbarProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [showWeights, setShowWeights] = useState(false);
  const [lengthText, setLengthText] = useState<string | null>(null);
  const { targetMin, weights } = props;

  const setLength = (minutes: number) => {
    const clamped = Math.min(MAX_TARGET_MIN, Math.max(MIN_TARGET_MIN, Math.round(minutes)));
    setLengthText(null);
    if (clamped !== targetMin) props.onTargetMin(clamped);
  };

  return (
    <section aria-label="Set controls" className="rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <p className="min-w-0 truncate text-sm">
            <span className="mr-2 text-[11px] uppercase tracking-wide text-muted">Crate</span>
            <span className="font-semibold">{props.crateName}</span>
            <span className="text-muted"> · {props.trackCount} tracks</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values"
              className="sr-only"
              aria-label="Import a track list (CSV or tab-separated)"
              tabIndex={-1}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) props.onImport(file);
              }}
            />
            <button type="button" className={small} onClick={() => fileRef.current?.click()}>
              Import CSV
            </button>
            {props.isSample ? (
              <button type="button" className={small} onClick={props.onDownloadSample}>
                Sample CSV
              </button>
            ) : (
              <button type="button" className={small} onClick={props.onUseSample}>
                Back to sample crate
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="set-length" className="text-[11px] uppercase tracking-wide text-muted">
            Set length
          </label>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className={small}
              aria-label="15 minutes shorter"
              disabled={targetMin <= MIN_TARGET_MIN}
              onClick={() => setLength(targetMin - 15)}
            >
              −15
            </button>
            <input
              id="set-length"
              type="number"
              inputMode="numeric"
              min={MIN_TARGET_MIN}
              max={MAX_TARGET_MIN}
              step={5}
              value={lengthText ?? String(targetMin)}
              onChange={(event) => {
                setLengthText(event.target.value);
                const value = Number(event.target.value);
                if (
                  Number.isFinite(value) &&
                  value >= MIN_TARGET_MIN &&
                  value <= MAX_TARGET_MIN &&
                  Math.round(value) !== targetMin
                ) {
                  props.onTargetMin(Math.round(value));
                }
              }}
              onBlur={() => setLengthText(null)}
              aria-describedby="set-length-unit"
              className="w-16 rounded-md border border-border bg-bg px-2 py-1.5 text-center font-mono text-sm"
            />
            <button
              type="button"
              className={small}
              aria-label="15 minutes longer"
              disabled={targetMin >= MAX_TARGET_MIN}
              onClick={() => setLength(targetMin + 15)}
            >
              +15
            </button>
            <span id="set-length-unit" className="text-xs text-muted">
              min
            </span>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={small}
            aria-expanded={showWeights}
            aria-controls="priorities"
            onClick={() => setShowWeights((open) => !open)}
          >
            Priorities
          </button>
          {props.canReset && (
            <button type="button" className={small} onClick={props.onReset}>
              Reset
            </button>
          )}
          <button
            type="button"
            onClick={props.onOptimize}
            disabled={props.trackCount < 2}
            title={`Runs the search again from a new random start (seed ${props.seed + 1})`}
            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-fg hover:opacity-90 disabled:opacity-50"
          >
            {props.busy ? "Optimizing…" : "Optimize again"}
          </button>
        </div>
      </div>

      {showWeights && (
        <div
          id="priorities"
          className="mt-3 grid gap-x-6 gap-y-3 border-t border-border pt-3 sm:grid-cols-3"
        >
          {WEIGHT_LABELS.map(({ key, label, hint }) => (
            <label key={key} className="flex flex-col gap-1 text-xs" title={hint}>
              <span className="flex justify-between">
                <span className="font-medium">{label}</span>
                <span className="font-mono text-muted">×{weights[key].toFixed(2)}</span>
              </span>
              <input
                type="range"
                min={0}
                max={2}
                step={0.25}
                value={weights[key]}
                onChange={(event) =>
                  props.onWeights({ ...weights, [key]: Number(event.target.value) })
                }
              />
              <span className="text-muted">{hint}</span>
            </label>
          ))}
        </div>
      )}

      {props.report && (
        <p className="mt-3 border-t border-border pt-2.5 text-xs text-muted">
          Imported in your browser, nothing uploaded: {importSummary(props.report)}.
        </p>
      )}
      {props.importError && (
        <p role="alert" className="mt-3 border-t border-border pt-2.5 text-sm text-danger">
          {props.importError}
        </p>
      )}
    </section>
  );
}
