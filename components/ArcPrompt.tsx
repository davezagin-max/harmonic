"use client";

import { useState } from "react";
import { CostMeter } from "@/components/kit/CostMeter";
import { ARC_DESCRIPTION_MAX } from "@/lib/ai/arc";
import type { ApiMeta, ErrorKind } from "@/lib/api";
import { formatLength } from "@/lib/crate/set";
import { ARC_PRESETS } from "@/lib/defaults";
import { presetHint, sourceLabel } from "@/lib/ui/labels";

export interface AppliedArc {
  description: string;
  summary: string;
  durationMinutes: number | null;
  meta: ApiMeta;
}

interface ArcPromptProps {
  isLive: boolean;
  /** True while the preset fixtures are hand-written samples. */
  placeholder: boolean;
  busy: boolean;
  error: { kind: ErrorKind; message: string } | null;
  applied: AppliedArc | null;
  onRun: (body: { demoId?: string; description: string }) => void;
  onCancel: () => void;
  onAddKey: () => void;
}

/** "Arc from words": describe the night, get a target curve back. */
export function ArcPrompt({
  isLive,
  placeholder,
  busy,
  error,
  applied,
  onRun,
  onCancel,
  onAddKey,
}: ArcPromptProps) {
  const [text, setText] = useState("");
  const trimmed = text.trim();

  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold">Or describe the night</h3>
        <p className="text-xs text-muted">{presetHint(isLive, placeholder)}</p>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-2">
        {ARC_PRESETS.map((preset) => (
          <button
            key={preset.demoId}
            type="button"
            disabled={busy}
            title={preset.description}
            onClick={() => {
              // Show the words that are being sent, then send them.
              setText(preset.description);
              onRun({ demoId: preset.demoId, description: preset.description });
            }}
            className="rounded-md border border-border bg-raised px-3 py-1.5 text-sm font-medium hover:border-accent disabled:opacity-50"
          >
            {preset.label}
          </button>
        ))}
      </div>

      <form
        className="mt-2.5 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (isLive && trimmed.length >= 3 && !busy) onRun({ description: trimmed });
        }}
      >
        <label htmlFor="arc-description" className="sr-only">
          Describe your set
        </label>
        <input
          id="arc-description"
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={ARC_DESCRIPTION_MAX}
          disabled={!isLive}
          placeholder={
            isLive
              ? "e.g. 2-hour wedding after-party, slow start, two peaks"
              : "Your own words need a key"
          }
          className="min-w-0 flex-1 rounded-md border border-border bg-bg px-3 py-2 text-sm placeholder:text-muted disabled:cursor-not-allowed disabled:text-muted"
        />
        {isLive ? (
          <button
            type="submit"
            disabled={busy || trimmed.length < 3}
            className="shrink-0 rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-fg disabled:opacity-50"
          >
            Plan arc
          </button>
        ) : (
          <button
            type="button"
            onClick={onAddKey}
            className="shrink-0 rounded-md border border-border px-3 py-2 text-sm hover:bg-raised"
          >
            Add key
          </button>
        )}
      </form>

      <div aria-live="polite" className="mt-2.5 min-h-5 text-sm">
        {busy && (
          <p className="flex flex-wrap items-center gap-3 text-muted">
            <span>Planning the arc…</span>
            <button type="button" onClick={onCancel} className="underline underline-offset-2">
              Cancel
            </button>
          </p>
        )}
        {!busy && error && (
          <p role="alert" className="text-danger">
            {error.kind === "refusal" ? "Declined: " : ""}
            {error.message}
          </p>
        )}
        {!busy && !error && applied && (
          <div className="flex flex-col gap-1">
            <p>
              <span className="font-medium">{applied.summary}</span>
              {applied.durationMinutes !== null && (
                <span className="text-muted">
                  {" "}
                  Set length taken from the description:{" "}
                  {formatLength(applied.durationMinutes * 60)}.
                </span>
              )}
            </p>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
              <span className="rounded-sm border border-border px-1.5 py-0.5">
                {sourceLabel(applied.meta)}
              </span>
              <CostMeter meta={applied.meta} />
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
