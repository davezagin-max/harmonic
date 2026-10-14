"use client";

import { useKey } from "./KeyProvider";

interface DemoBannerProps {
  /**
   * True while the fixtures are hand-written samples rather than recorded
   * model runs. The banner says so plainly instead of implying a real run.
   */
  placeholder?: boolean;
}

/** The banner's wording without a key. Exported so the honesty of each case can be tested. */
export function demoMessage(placeholder: boolean): string {
  return placeholder
    ? "Demo: the AI responses here are pre-written examples. Add your Anthropic API key to run it live."
    : "Demo: the AI responses here replay recorded Claude Opus 5.5 runs. Add your Anthropic API key to run it live.";
}

/** One calm line at the top of the page: what is real, what is an example, and how to go live. */
export function DemoBanner({ placeholder = false }: DemoBannerProps) {
  const { isLive, openKeyModal } = useKey();

  if (isLive) {
    return (
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-border bg-surface px-4 py-1.5 text-xs sm:text-sm">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className="size-2 rounded-full bg-success" />
          Live: calling Claude Opus 5.5 with your key.
        </span>
        <button type="button" onClick={openKeyModal} className="underline underline-offset-2">
          Change key
        </button>
      </div>
    );
  }

  return (
    <div
      role="status"
      className="border-b border-border bg-surface px-4 py-1.5 text-center text-xs text-muted sm:text-[13px]"
    >
      {demoMessage(placeholder)}{" "}
      <button
        type="button"
        onClick={openKeyModal}
        className="font-medium text-fg underline underline-offset-2 hover:text-accent"
      >
        Add key
      </button>
    </div>
  );
}
