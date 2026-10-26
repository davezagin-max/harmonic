"use client";

import { useMemo, useState } from "react";
import type { PlannedSet } from "@/lib/crate/set";
import type { Track } from "@/lib/crate/types";
import {
  compatibleKeys,
  keyCode,
  keyFromIndex,
  keyIndex,
  keyName,
  type CamelotKey,
  type Relation,
} from "@/lib/music/camelot";
import { transitionFacts } from "@/lib/music/transition";
import { keyColor, keyLit, keySoft, keyText } from "@/lib/ui/colors";
import { labelPoint, layoutWheel, linkPath, segmentPath, WHEEL } from "@/lib/ui/wheel-layout";

interface CamelotWheelProps {
  tracks: readonly Track[];
  set: PlannedSet;
  /** Track highlighted from anywhere in the app (hovered or selected). */
  activeId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  /** Lines shown in the centre when nothing is highlighted: a context line, a big figure, and what it means. */
  headline: { top: string; middle: string; bottom: readonly [string, string] };
  /** Changes when the set changes, which replays the path animation. */
  setSignature: string;
}

const ALL_KEYS = Array.from({ length: 24 }, (_, index) => keyFromIndex(index));
const MAX_FAN_LINKS = 70;

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function linkColor(clean: boolean, relation: Relation): string {
  if (!clean) return "var(--danger)";
  return relation === "boost" ? "var(--warn)" : "var(--fg)";
}

/**
 * The hero: every track in the crate sits in its key's segment, the chosen set
 * is a numbered path through them, and pointing at a track lights the keys it
 * can move to and fans out links to every track it would mix into cleanly.
 */
export function CamelotWheel({
  tracks,
  set,
  activeId,
  onHover,
  onSelect,
  headline,
  setSignature,
}: CamelotWheelProps) {
  const [hoverKey, setHoverKey] = useState<number | null>(null);
  const setIds = useMemo(() => set.entries.map((entry) => entry.track.id), [set]);
  const layout = useMemo(() => layoutWheel(tracks, setIds), [tracks, setIds]);
  const byId = useMemo(() => new Map(tracks.map((track) => [track.id, track])), [tracks]);

  const activeTrack = activeId ? (byId.get(activeId) ?? null) : null;
  const focusKey: CamelotKey | null =
    activeTrack?.key ?? (hoverKey !== null ? keyFromIndex(hoverKey) : null);
  const lit = new Map<number, Relation>();
  if (focusKey) {
    for (const entry of compatibleKeys(focusKey)) lit.set(keyIndex(entry.key), entry.relation);
  }

  // Links from the highlighted track to every crate track it would mix into cleanly.
  const fan: { id: string; d: string; relation: Relation }[] = [];
  const fanFrom = activeTrack ? layout.nodes.get(activeTrack.id) : undefined;
  if (activeTrack && fanFrom) {
    for (const other of tracks) {
      if (other.id === activeTrack.id || fan.length >= MAX_FAN_LINKS) continue;
      const to = layout.nodes.get(other.id);
      if (!to) continue;
      const facts = transitionFacts(activeTrack, other);
      if (facts.clean) {
        fan.push({ id: other.id, d: linkPath(fanFrom, to), relation: facts.key.relation });
      }
    }
  }
  const fanIds = new Set(fan.map((link) => link.id));

  // The path draws in play order; a long set draws faster so the whole thing takes under a second.
  const stagger = Math.min(45, 700 / Math.max(1, set.entries.length));
  const dimmed = focusKey !== null;
  const activeEntry = activeTrack
    ? (set.entries.find((entry) => entry.track.id === activeTrack.id) ?? null)
    : null;

  return (
    <svg
      viewBox={`0 0 ${WHEEL.size} ${WHEEL.size}`}
      role="img"
      aria-label={`Camelot wheel. ${set.entries.length} of ${tracks.length} tracks are in the set, drawn as a numbered path through their keys. The set list below gives the same information as text.`}
      className="block h-auto w-full select-none"
      onPointerLeave={() => {
        setHoverKey(null);
        onHover(null);
      }}
    >
      {/* Key segments */}
      {ALL_KEYS.map((key) => {
        const index = keyIndex(key);
        const isLit = lit.has(index);
        return (
          <path
            key={index}
            d={segmentPath(key)}
            fill={isLit ? keyLit(key) : keySoft(key)}
            stroke="var(--bg)"
            strokeWidth={2.5}
            opacity={dimmed && !isLit ? 0.45 : 1}
            onPointerEnter={() => setHoverKey(index)}
            style={{ transition: "fill 120ms, opacity 120ms" }}
          />
        );
      })}

      {/* Key labels */}
      {ALL_KEYS.map((key) => {
        const index = keyIndex(key);
        const point = labelPoint(key);
        const extra = layout.overflow.get(index);
        return (
          <text
            key={index}
            x={point.x}
            y={point.y}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={key.ring === "B" ? 15 : 13.5}
            fontWeight={700}
            fill={lit.has(index) ? "var(--fg)" : keyText(key)}
            opacity={dimmed && !lit.has(index) ? 0.4 : 1}
            pointerEvents="none"
            className="font-mono"
          >
            {keyCode(key)}
            {extra ? (
              <tspan fontSize={9} fontWeight={500} fill="var(--muted)">
                {` +${extra}`}
              </tspan>
            ) : null}
          </text>
        );
      })}

      {/* Links from the highlighted track to everything it mixes into cleanly */}
      <g pointerEvents="none" fill="none">
        {fan.map((link) => (
          <path
            key={link.id}
            d={link.d}
            stroke={link.relation === "boost" ? "var(--warn)" : "var(--success)"}
            strokeWidth={1}
            opacity={0.55}
          />
        ))}
      </g>

      {/* The set, as a path */}
      <g key={setSignature} pointerEvents="none" fill="none">
        {set.entries.map((entry, index) => {
          const next = set.entries[index + 1];
          if (!entry.next || !next) return null;
          const from = layout.nodes.get(entry.track.id);
          const to = layout.nodes.get(next.track.id);
          if (!from || !to) return null;
          const touchesActive =
            activeTrack !== null &&
            (entry.track.id === activeTrack.id || next.track.id === activeTrack.id);
          return (
            <path
              key={entry.track.id}
              className="set-path"
              pathLength={1}
              d={linkPath(from, to)}
              stroke={linkColor(entry.next.clean, entry.next.key.relation)}
              strokeWidth={touchesActive ? 3.5 : 2.2}
              opacity={activeTrack && !touchesActive ? 0.25 : 0.9}
              style={{ animationDelay: `${index * stagger}ms` }}
            />
          );
        })}
      </g>

      {/* Crate tracks that are not in the set */}
      {tracks.map((track) => {
        const node = layout.nodes.get(track.id);
        if (!node || node.position !== null) return null;
        const isActive = track.id === activeId;
        const reachable = fanIds.has(track.id);
        return (
          <circle
            key={track.id}
            cx={node.x}
            cy={node.y}
            r={isActive ? 6 : reachable ? 4.5 : 3.6}
            fill={keyColor(track.key)}
            stroke={isActive ? "var(--fg)" : "none"}
            strokeWidth={1.5}
            opacity={isActive || reachable ? 1 : activeTrack ? 0.25 : 0.6}
            onPointerEnter={() => onHover(track.id)}
            onPointerLeave={() => onHover(null)}
            onClick={() => onSelect(track.id)}
            className="cursor-pointer"
          />
        );
      })}

      {/* Set tracks, numbered in play order */}
      <g key={`nodes-${setSignature}`}>
        {set.entries.map((entry, index) => {
          const node = layout.nodes.get(entry.track.id);
          if (!node) return null;
          const isActive = entry.track.id === activeId;
          const faded = activeTrack !== null && !isActive && !fanIds.has(entry.track.id);
          return (
            <g
              key={entry.track.id}
              className="set-node cursor-pointer"
              style={{ animationDelay: `${index * stagger}ms` }}
              opacity={faded ? 0.4 : 1}
              onPointerEnter={() => onHover(entry.track.id)}
              onPointerLeave={() => onHover(null)}
              onClick={() => onSelect(entry.track.id)}
            >
              <circle
                cx={node.x}
                cy={node.y}
                r={isActive ? 13 : 11}
                fill={keyColor(entry.track.key)}
                stroke={isActive ? "var(--fg)" : "var(--bg)"}
                strokeWidth={isActive ? 2.5 : 2}
              />
              <text
                x={node.x}
                y={node.y}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={entry.position > 9 ? 10.5 : 12}
                fontWeight={700}
                fill="var(--key-ink)"
                pointerEvents="none"
              >
                {entry.position}
              </text>
            </g>
          );
        })}
      </g>

      {/* Centre disc: headline numbers, or the highlighted track */}
      <g pointerEvents="none">
        <circle
          cx={WHEEL.center}
          cy={WHEEL.center}
          r={WHEEL.hub}
          fill="var(--surface)"
          stroke="var(--border)"
          strokeWidth={1.5}
        />
        {activeTrack ? (
          <>
            <text
              x={WHEEL.center}
              y={WHEEL.center - 38}
              textAnchor="middle"
              fontSize={12}
              fill="var(--muted)"
              className="font-mono"
            >
              {activeEntry
                ? `Track ${activeEntry.position} of ${set.entries.length}`
                : "In the crate"}
            </text>
            <text
              x={WHEEL.center}
              y={WHEEL.center - 12}
              textAnchor="middle"
              fontSize={16}
              fontWeight={600}
              fill="var(--fg)"
            >
              {clip(activeTrack.title, 21)}
            </text>
            <text
              x={WHEEL.center}
              y={WHEEL.center + 9}
              textAnchor="middle"
              fontSize={12.5}
              fill="var(--muted)"
            >
              {clip(activeTrack.artist || "Unknown artist", 26)}
            </text>
            <text
              x={WHEEL.center}
              y={WHEEL.center + 38}
              textAnchor="middle"
              fontSize={14}
              fontWeight={700}
              fill={keyText(activeTrack.key)}
              className="font-mono"
            >
              {keyCode(activeTrack.key)} · {keyName(activeTrack.key)} · {activeTrack.bpm} · E
              {activeTrack.energy}
            </text>
            <text
              x={WHEEL.center}
              y={WHEEL.center + 60}
              textAnchor="middle"
              fontSize={11}
              fill="var(--muted)"
            >
              {fan.length} clean {fan.length === 1 ? "mix" : "mixes"} from here
            </text>
          </>
        ) : focusKey ? (
          <>
            <text
              x={WHEEL.center}
              y={WHEEL.center - 14}
              textAnchor="middle"
              fontSize={30}
              fontWeight={700}
              fill={keyText(focusKey)}
              className="font-mono"
            >
              {keyCode(focusKey)}
            </text>
            <text
              x={WHEEL.center}
              y={WHEEL.center + 12}
              textAnchor="middle"
              fontSize={14}
              fill="var(--fg)"
            >
              {keyName(focusKey)}
            </text>
            <text
              x={WHEEL.center}
              y={WHEEL.center + 38}
              textAnchor="middle"
              fontSize={11}
              fill="var(--muted)"
            >
              mixes into the lit keys
            </text>
          </>
        ) : (
          <>
            <text
              x={WHEEL.center}
              y={WHEEL.center - 40}
              textAnchor="middle"
              fontSize={13}
              fill="var(--muted)"
            >
              {headline.top}
            </text>
            <text
              x={WHEEL.center}
              y={WHEEL.center + 2}
              textAnchor="middle"
              fontSize={38}
              fontWeight={700}
              fill="var(--fg)"
              className="font-mono"
            >
              {headline.middle}
            </text>
            <text
              x={WHEEL.center}
              y={WHEEL.center + 28}
              textAnchor="middle"
              fontSize={13.5}
              fontWeight={600}
              fill="var(--fg)"
            >
              {headline.bottom[0]}
            </text>
            <text
              x={WHEEL.center}
              y={WHEEL.center + 46}
              textAnchor="middle"
              fontSize={12.5}
              fill="var(--muted)"
            >
              {headline.bottom[1]}
            </text>
          </>
        )}
      </g>
    </svg>
  );
}

/** What the marks on the wheel mean, in plain words. */
export function WheelLegend({ className = "" }: { className?: string }) {
  return (
    <ul
      aria-label="Wheel legend"
      className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted ${className}`}
    >
      <li className="inline-flex items-center gap-1.5">
        <svg aria-hidden width={16} height={10} viewBox="0 0 16 10">
          <circle cx={4} cy={5} r={2.6} fill="oklch(var(--key-l) var(--key-c) 210)" />
          <circle cx={11.5} cy={5} r={2.6} fill="oklch(var(--key-l) var(--key-c) 330)" />
        </svg>
        Each dot is a song, placed by its musical key
      </li>
      <li className="inline-flex items-center gap-1.5">
        <svg aria-hidden width={18} height={18} viewBox="0 0 18 18">
          <circle cx={9} cy={9} r={8} fill="oklch(var(--key-l) var(--key-c) 300)" />
          <text
            x={9}
            y={9}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={10}
            fontWeight={700}
            fill="var(--key-ink)"
          >
            1
          </text>
        </svg>
        The numbered path is the set order it chose
      </li>
    </ul>
  );
}

/** What the colours of the set path mean. */
export function PathLegend({ className = "" }: { className?: string }) {
  const items = [
    { color: "var(--fg)", label: "smooth blend" },
    { color: "var(--warn)", label: "deliberate key lift" },
    { color: "var(--danger)", label: "clash" },
  ];
  return (
    <p className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted ${className}`}>
      <span>Path colours:</span>
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-4 rounded" style={{ background: item.color }} />
          {item.label}
        </span>
      ))}
    </p>
  );
}
