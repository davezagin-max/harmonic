"use client";

interface IntroProps {
  /** Tracks in the sample crate and the opening set length, for the "what you are seeing" line. */
  crateSize: number;
  setLength: string;
  /** Label and state of the one primary action. */
  actionLabel: string;
  actionBusy: boolean;
  onAction: () => void;
  /** What is happening right now, in plain words. */
  narration: string;
  /** A short honesty note shown after the narration (where the AI part came from). */
  narrationNote: string | null;
}

const STEPS = [
  "Code scores how well each pair of tracks blends",
  "a search picks and orders the set",
  "Claude drafts the plan from a sentence and writes mixing tips",
];

/**
 * The first thing on the page: what Harmonic is in one sentence, how it works
 * in three short steps, and the one button that shows it working.
 */
export function Intro({
  crateSize,
  setLength,
  actionLabel,
  actionBusy,
  onAction,
  narration,
  narrationNote,
}: IntroProps) {
  return (
    <section
      aria-labelledby="intro-title"
      className="flex flex-col gap-4 px-1 pt-1 lg:flex-row lg:items-center lg:justify-between lg:gap-10"
    >
      <div className="min-w-0 max-w-[56rem]">
        <p id="intro-title" className="text-lg font-semibold leading-snug sm:text-xl">
          Harmonic orders a DJ&apos;s tracks so each song blends smoothly into the next and the
          energy builds the way you plan.
        </p>
        <p className="mt-1 text-sm text-muted">
          Below: {crateSize} made-up sample tracks, already planned into a {setLength} set. The
          planning runs in your browser, no key needed.
        </p>
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <span className="sr-only">How it works:</span>
          {STEPS.map((step, index) => (
            <span key={step} className="inline-flex items-center gap-2">
              {index > 0 && (
                <span aria-hidden className="text-accent">
                  →
                </span>
              )}
              <span>{step}</span>
            </span>
          ))}
        </p>
      </div>

      <div className="flex shrink-0 flex-col items-start gap-2 lg:w-[20rem] lg:items-end">
        <button
          type="button"
          onClick={onAction}
          disabled={actionBusy}
          className="inline-flex items-center gap-2 rounded-md bg-accent px-5 py-2.5 text-[15px] font-semibold text-accent-fg shadow-sm hover:opacity-90 disabled:cursor-progress disabled:opacity-70"
        >
          <svg aria-hidden viewBox="0 0 16 16" className="size-3.5 fill-current">
            <path d="M4 2.5v11l9-5.5z" />
          </svg>
          {actionLabel}
        </button>
        <p aria-live="polite" className="min-h-[3.1rem] text-xs leading-snug lg:text-right">
          <span className="text-fg/90">{narration}</span>
          {narrationNote && <span className="block text-muted">{narrationNote}</span>}
        </p>
      </div>
    </section>
  );
}
