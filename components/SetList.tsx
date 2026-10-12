"use client";

import type { ReactNode } from "react";
import type { MixNote } from "@/lib/ai/notes";
import { formatClock, type PlannedSet, type SetEntry } from "@/lib/crate/set";
import { formatPct } from "@/lib/music/bpm";
import { keyCode, keyName } from "@/lib/music/camelot";
import { formatEnergyChange, type TransitionFacts } from "@/lib/music/transition";
import { keyColor, keySoft } from "@/lib/ui/colors";

interface SetListProps {
  set: PlannedSet;
  /** Transition notes by mix index, when there are any for this exact set. */
  notes: ReadonlyMap<number, MixNote>;
  activeId: string | null;
  selectedId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}

type Tone = "good" | "warn" | "bad" | "plain";

const TONE: Record<Tone, string> = {
  good: "border-success/40 text-success",
  warn: "border-warn/50 text-warn",
  bad: "border-danger/50 text-danger",
  plain: "border-border text-muted",
};

function Badge({ tone, title, children }: { tone: Tone; title: string; children: ReactNode }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center whitespace-nowrap rounded-sm border px-1.5 py-0.5 font-mono text-[11px] leading-none ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}

function MixRow({ facts, note }: { facts: TransitionFacts; note: MixNote | undefined }) {
  const keyTone: Tone =
    facts.key.relation === "clash" ? "bad" : facts.key.relation === "boost" ? "warn" : "good";
  const tempoLabel =
    facts.tempo.match === "straight"
      ? formatPct(facts.tempo.pct)
      : `${formatPct(facts.tempo.pct)} ${facts.tempo.match}-time`;
  const energy = formatEnergyChange(facts.energyChange);
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 py-1.5 pl-9 pr-2 @md:pl-[4.25rem]">
      <span aria-hidden className="text-xs text-muted">
        ↓
      </span>
      <Badge tone={keyTone} title="Key relation between the two tracks">
        {facts.key.label}
      </Badge>
      <Badge
        tone={facts.tempo.inRange ? "plain" : "bad"}
        title={
          facts.tempo.inRange
            ? "Tempo change, inside the ±6% pitch range"
            : "Tempo change, outside the ±6% pitch range"
        }
      >
        {tempoLabel}
        {facts.tempo.inRange ? "" : " out of range"}
      </Badge>
      <Badge tone="plain" title="Energy change, in levels on the 1-10 scale">
        energy {energy}
      </Badge>
      {note && (
        <p className="basis-full text-[13px] leading-snug text-fg/90">
          {note.note}
          {note.source === "rule" && (
            <span
              title="Written by the app's own rules: the model's note for this mix was missing or stated a figure that did not match the computed facts."
              className="ml-1.5 rounded-sm border border-border px-1 py-px font-mono text-[10px] uppercase tracking-wide text-muted"
            >
              rule
            </span>
          )}
        </p>
      )}
    </div>
  );
}

function TrackRow({
  entry,
  active,
  selected,
  onHover,
  onSelect,
}: {
  entry: SetEntry;
  active: boolean;
  selected: boolean;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}) {
  const { track } = entry;
  const miss = Math.abs(track.energy - entry.targetLevel);
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(track.id)}
      onPointerEnter={() => onHover(track.id)}
      onPointerLeave={() => onHover(null)}
      onFocus={() => onHover(track.id)}
      onBlur={() => onHover(null)}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left @md:gap-3 ${active ? "bg-raised" : "hover:bg-raised"}`}
    >
      <span className="w-5 shrink-0 text-right font-mono text-xs text-muted">{entry.position}</span>
      <span className="hidden w-12 shrink-0 font-mono text-xs text-muted @md:block">
        {formatClock(entry.startSec)}
      </span>
      <span
        className="inline-flex w-[2.9rem] shrink-0 items-center justify-center rounded-sm px-1 py-1 font-mono text-xs font-bold leading-none"
        style={{
          background: keySoft(track.key),
          color: "var(--fg)",
          boxShadow: `inset 3px 0 0 ${keyColor(track.key)}`,
        }}
        title={`${keyCode(track.key)} is ${keyName(track.key)}`}
      >
        {keyCode(track.key)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{track.title}</span>
        <span className="block truncate text-xs text-muted">
          {track.artist || "Unknown artist"}
          {track.genre ? ` · ${track.genre}` : ""}
        </span>
      </span>
      <span
        className="shrink-0 text-right font-mono text-xs leading-tight"
        title={`${track.bpm} BPM. Energy ${track.energy}${track.energyDerived ? " (stand-in derived from tempo)" : ""}; the arc asks for ${entry.targetLevel.toFixed(1)} here. Starts at ${formatClock(entry.startSec)}.`}
      >
        <span className="block">
          {track.bpm}
          <span className="text-[10px] text-muted"> bpm</span>
        </span>
        <span className={`block ${miss >= 2 ? "text-warn" : "text-muted"}`}>
          <span className="text-[10px]">energy </span>
          {track.energyDerived ? "~" : ""}
          {track.energy}
        </span>
      </span>
    </button>
  );
}

/** The planned set as a list: each track, then the facts of the mix into the next one. */
export function SetList({ set, notes, activeId, selectedId, onHover, onSelect }: SetListProps) {
  if (set.entries.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
        No tracks fit this set length. Make the set longer or import a crate with more tracks.
      </p>
    );
  }
  return (
    <ol className="@container flex flex-col">
      {set.entries.map((entry, index) => (
        <li key={entry.track.id}>
          <TrackRow
            entry={entry}
            active={entry.track.id === activeId}
            selected={entry.track.id === selectedId}
            onHover={onHover}
            onSelect={onSelect}
          />
          {entry.next && <MixRow facts={entry.next} note={notes.get(index)} />}
        </li>
      ))}
    </ol>
  );
}
