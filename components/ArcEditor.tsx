"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { PlannedSet } from "@/lib/crate/set";
import {
  DEFAULT_ARC,
  energyAt,
  ENERGY_MAX,
  ENERGY_MIN,
  MAX_ARC_POINTS,
  toLevel,
  type ArcPoint,
} from "@/lib/music/energy";
import { keyColor } from "@/lib/ui/colors";

interface ArcEditorProps {
  arc: ArcPoint[];
  /** Fires continuously while a point is dragged. */
  onChange: (arc: ArcPoint[]) => void;
  /** Fires when an edit is finished and the set should be re-planned. */
  onCommit: (arc: ArcPoint[]) => void;
  set: PlannedSet;
  targetSec: number;
  activeId: string | null;
  onHover: (id: string | null) => void;
}

/** Plot height and margins in CSS pixels. The plot's width is whatever the panel gives it. */
const PLOT_HEIGHT = 160;
const MARGIN = { left: 26, right: 9, top: 10, bottom: 26 };

const pct = (fraction: number) => `${(fraction * 100).toFixed(2)}%`;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round3 = (value: number) => Math.round(value * 1000) / 1000;

function axisTime(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

/**
 * The energy arc: a draggable target curve, with the planned set's real energy
 * drawn over it as one bar per track in that track's key colour.
 */
export function ArcEditor({
  arc,
  onChange,
  onCommit,
  set,
  targetSec,
  activeId,
  onHover,
}: ArcEditorProps) {
  const plotRef = useRef<HTMLDivElement>(null);
  const handleRefs = useRef<(SVGGElement | null)[]>([]);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The point last touched. Nothing is marked until the visitor picks one.
  const [selected, setSelected] = useState<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const current = selected === null ? null : Math.min(selected, arc.length - 1);

  useEffect(
    () => () => {
      if (commitTimer.current) clearTimeout(commitTimer.current);
    },
    [],
  );

  function pointFromEvent(event: PointerEvent, index: number): ArcPoint {
    const rect = plotRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return arc[index];
    const isEnd = index === 0 || index === arc.length - 1;
    const t = isEnd
      ? arc[index].t
      : clamp(
          (event.clientX - rect.left) / rect.width,
          arc[index - 1].t + 0.01,
          arc[index + 1].t - 0.01,
        );
    const e = clamp(1 - (event.clientY - rect.top) / rect.height, 0, 1);
    return { t: round3(t), e: round3(e) };
  }

  function replace(index: number, point: ArcPoint): ArcPoint[] {
    return arc.map((existing, i) => (i === index ? point : existing));
  }

  function handleKey(event: KeyboardEvent, index: number) {
    const step = (event.shiftKey ? 1 : 0.5) / (ENERGY_MAX - ENERGY_MIN);
    let next: ArcPoint[] | null = null;
    if (event.key === "ArrowUp")
      next = replace(index, { ...arc[index], e: round3(clamp(arc[index].e + step, 0, 1)) });
    else if (event.key === "ArrowDown")
      next = replace(index, { ...arc[index], e: round3(clamp(arc[index].e - step, 0, 1)) });
    else if (
      event.key === "ArrowLeft" ||
      event.key === "ArrowRight" ||
      event.key === "Home" ||
      event.key === "End"
    ) {
      const target =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? arc.length - 1
            : clamp(index + (event.key === "ArrowLeft" ? -1 : 1), 0, arc.length - 1);
      setSelected(target);
      handleRefs.current[target]?.focus();
      event.preventDefault();
      return;
    } else return;
    event.preventDefault();
    onChange(next);
    // Re-plan once the key presses stop, not on every one.
    if (commitTimer.current) clearTimeout(commitTimer.current);
    const settled = next;
    commitTimer.current = setTimeout(() => onCommit(settled), 350);
  }

  function addPoint() {
    if (arc.length >= MAX_ARC_POINTS) return;
    let widest = 0;
    for (let i = 1; i < arc.length - 1; i++) {
      if (arc[i + 1].t - arc[i].t > arc[widest + 1].t - arc[widest].t) widest = i;
    }
    const t = round3((arc[widest].t + arc[widest + 1].t) / 2);
    const next = [
      ...arc.slice(0, widest + 1),
      { t, e: round3(energyAt(arc, t)) },
      ...arc.slice(widest + 1),
    ];
    setSelected(widest + 1);
    onChange(next);
    onCommit(next);
  }

  function removePoint() {
    if (current === null || arc.length <= 2 || current === 0 || current === arc.length - 1) return;
    const next = arc.filter((_, i) => i !== current);
    setSelected(Math.max(0, current - 1));
    onChange(next);
    onCommit(next);
  }

  // The curve is drawn in a 1 x 1 box stretched over the plot; strokes keep their pixel width.
  const line = arc.map((point) => `${point.t},${1 - point.e}`).join(" ");
  const canRemove = current !== null && arc.length > 2 && current > 0 && current < arc.length - 1;
  const isDefault = JSON.stringify(arc) === JSON.stringify(DEFAULT_ARC);
  const levelY = (level: number) => 1 - (level - ENERGY_MIN) / (ENERGY_MAX - ENERGY_MIN);
  // A curve with many points gets smaller handles so they do not hide the tracks behind them.
  const handleRadius = arc.length <= 10 ? 6.5 : arc.length <= 16 ? 5 : 4;

  return (
    <div className="flex flex-col gap-2">
      <div
        role="group"
        aria-label="Energy arc editor. The curve is the target energy over the set; the bars are the planned tracks."
        className="relative select-none"
        style={{
          height: PLOT_HEIGHT + MARGIN.top + MARGIN.bottom,
          paddingLeft: MARGIN.left,
          paddingRight: MARGIN.right,
          paddingTop: MARGIN.top,
        }}
        onPointerLeave={() => onHover(null)}
      >
        <div ref={plotRef} className="relative" style={{ height: PLOT_HEIGHT }}>
          {/* Axis labels: energy levels up the side, clock time along the bottom */}
          {[2, 4, 6, 8, 10].map((level) => (
            <span
              key={level}
              aria-hidden
              className="absolute -translate-y-1/2 font-mono text-[11px] text-muted"
              style={{ top: pct(levelY(level)), right: "100%", paddingRight: 10 }}
            >
              {level}
            </span>
          ))}
          {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
            <span
              key={fraction}
              aria-hidden
              className="absolute font-mono text-[11px] text-muted"
              style={{
                top: "100%",
                marginTop: 7,
                left: pct(fraction),
                transform: `translateX(${fraction === 0 ? "0" : fraction === 1 ? "-100%" : "-50%"})`,
              }}
            >
              {axisTime(targetSec * fraction)}
            </span>
          ))}

          {/* Target curve, stretched to the plot */}
          <svg
            aria-hidden
            viewBox="0 0 1 1"
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full overflow-visible"
          >
            {[2, 4, 6, 8, 10].map((level) => (
              <line
                key={level}
                x1={0}
                x2={1}
                y1={levelY(level)}
                y2={levelY(level)}
                stroke="var(--border)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <line
              x1={0}
              x2={1}
              y1={1}
              y2={1}
              stroke="var(--border)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <polygon points={`0,1 ${line} 1,1`} fill="var(--accent)" opacity={0.1} />
            <polyline
              points={line}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={2.5}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {/* Tracks and points, placed by percentage so nothing is scaled or squashed */}
          <svg className="absolute inset-0 h-full w-full overflow-visible">
            {/* The planned set: one bar per track, at its energy, in its key colour */}
            {set.entries.map((entry) => {
              const start = clamp(entry.startSec / targetSec, 0, 1);
              const end = clamp((entry.startSec + entry.playSec) / targetSec, 0, 1);
              if (end - start < 0.004) return null;
              const y = levelY(entry.track.energy);
              const isActive = entry.track.id === activeId;
              const thickness = isActive ? 9 : 6;
              return (
                <g key={entry.track.id} onPointerEnter={() => onHover(entry.track.id)}>
                  <rect
                    x={pct(start + 0.002)}
                    y={pct(y)}
                    width={pct(Math.max(0.004, end - start - 0.004))}
                    height={thickness}
                    rx={thickness / 2}
                    transform={`translate(0 ${-thickness / 2})`}
                    fill={keyColor(entry.track.key)}
                    opacity={activeId && !isActive ? 0.45 : 1}
                  />
                  {/* Taller invisible target so the thin bar is easy to point at. */}
                  <rect
                    x={pct(start)}
                    y={pct(y)}
                    width={pct(end - start)}
                    height={22}
                    transform="translate(0 -11)"
                    fill="transparent"
                  />
                </g>
              );
            })}

            {/* Draggable points */}
            {arc.map((point, index) => {
              const isCurrent = index === current;
              return (
                <g
                  key={index}
                  ref={(element) => {
                    handleRefs.current[index] = element;
                  }}
                  role="slider"
                  tabIndex={index === (current ?? 0) ? 0 : -1}
                  aria-label={`Arc point ${index + 1} of ${arc.length}, at ${axisTime(point.t * targetSec)}`}
                  aria-valuemin={ENERGY_MIN}
                  aria-valuemax={ENERGY_MAX}
                  aria-valuenow={Math.round(toLevel(point.e) * 10) / 10}
                  aria-valuetext={`Energy ${toLevel(point.e).toFixed(1)} of 10`}
                  aria-orientation="vertical"
                  className="arc-handle cursor-grab active:cursor-grabbing"
                  style={{ touchAction: "none" }}
                  onFocus={() => setSelected(index)}
                  onKeyDown={(event) => handleKey(event, index)}
                  onPointerDown={(event) => {
                    event.currentTarget.setPointerCapture(event.pointerId);
                    setSelected(index);
                    setDragging(index);
                  }}
                  onPointerMove={(event) => {
                    if (dragging === index) onChange(replace(index, pointFromEvent(event, index)));
                  }}
                  onPointerUp={(event) => {
                    if (dragging !== index) return;
                    setDragging(null);
                    onCommit(replace(index, pointFromEvent(event, index)));
                  }}
                  onPointerCancel={() => {
                    if (dragging !== index) return;
                    setDragging(null);
                    onCommit(arc);
                  }}
                >
                  <circle
                    cx={pct(point.t)}
                    cy={pct(1 - point.e)}
                    r={arc.length <= 10 ? 16 : 11}
                    fill="transparent"
                  />
                  <circle
                    cx={pct(point.t)}
                    cy={pct(1 - point.e)}
                    r={isCurrent ? handleRadius + 1.5 : handleRadius}
                    fill={isCurrent ? "var(--accent)" : "var(--surface)"}
                    stroke="var(--accent)"
                    strokeWidth={arc.length <= 10 ? 2.5 : 2}
                  />
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-muted">
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-0.5 w-5 rounded bg-accent" />
            Plan (drag the points)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="h-1.5 w-5 rounded-full"
              style={{
                background:
                  "linear-gradient(90deg, oklch(var(--key-l) var(--key-c) 330), oklch(var(--key-l) var(--key-c) 210))",
              }}
            />
            Tracks in the set, coloured by key
          </span>
        </p>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={addPoint}
            disabled={arc.length >= MAX_ARC_POINTS}
            className="rounded-md border border-border px-2 py-1 hover:bg-raised disabled:opacity-40"
          >
            Add point
          </button>
          <button
            type="button"
            onClick={removePoint}
            disabled={!canRemove}
            className="rounded-md border border-border px-2 py-1 hover:bg-raised disabled:opacity-40"
          >
            Remove point
          </button>
          <button
            type="button"
            onClick={() => {
              setSelected(null);
              onChange(DEFAULT_ARC);
              onCommit(DEFAULT_ARC);
            }}
            disabled={isDefault}
            className="rounded-md border border-border px-2 py-1 hover:bg-raised disabled:opacity-40"
          >
            Reset arc
          </button>
        </div>
      </div>
    </div>
  );
}
