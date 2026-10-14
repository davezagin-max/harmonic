/**
 * Geometry for the Camelot wheel: where each key's segment sits and where each
 * track's node goes inside it. Pure functions, so the layout can be tested
 * without a browser.
 *
 * The wheel is drawn like a clock: 12 at the top, numbers rising clockwise.
 * Major keys (ring B) are the outer ring, minor keys (ring A) the inner ring.
 */
import type { Track } from "../crate/types";
import { keyFromIndex, keyIndex, type CamelotKey } from "../music/camelot";

export const WHEEL = {
  size: 600,
  center: 300,
  /** Radius of the centre disc that carries the headline numbers. */
  hub: 102,
  innerEdge: 116,
  /** Boundary between the minor (inner) and major (outer) rings. */
  split: 212,
  outerEdge: 290,
  innerLabel: 129,
  outerLabel: 277,
} as const;

/** Width a node takes along its row: a numbered set node or a small crate dot. */
const SET_WIDTH = 24;
const DOT_WIDTH = 9.5;
/** Each segment spans 30 degrees; nodes keep clear of the edges. */
const USABLE_ANGLE = (25 * Math.PI) / 180;

/**
 * Row radii to try, fewest rows first. The inner ring is where most house
 * tracks live (minor keys) and its segments are narrow, so it may use three rows.
 */
const ROWS: Record<"A" | "B", number[][]> = {
  A: [[178], [193, 166], [197, 172, 147]],
  B: [[241], [254, 230]],
};

export interface Point {
  x: number;
  y: number;
}

export interface WheelNode extends Point {
  id: string;
  /** 1-based position in the set, or null for a crate track that is not in it. */
  position: number | null;
}

export interface WheelLayout {
  nodes: Map<string, WheelNode>;
  /** Crate tracks that did not fit in their segment, per key index (0-23). */
  overflow: Map<number, number>;
}

/** Angle of the middle of a wheel position, in radians, measured clockwise from 3 o'clock. */
export function positionAngle(n: number): number {
  return (((n % 12) * 30 - 90) * Math.PI) / 180;
}

/**
 * Rounded to hundredths: Math.cos and Math.sin may differ in the last digit between
 * the server and the browser, and the wheel is rendered on both, so unrounded
 * coordinates would not match when the page hydrates.
 */
const hundredths = (value: number) => Math.round(value * 100) / 100;

export function polar(radius: number, angle: number): Point {
  return {
    x: hundredths(WHEEL.center + radius * Math.cos(angle)),
    y: hundredths(WHEEL.center + radius * Math.sin(angle)),
  };
}

const f = (value: number) => value.toFixed(2);

/** SVG path of one key's segment (an annular sector). */
export function segmentPath(key: CamelotKey): string {
  const middle = positionAngle(key.n);
  const start = middle - Math.PI / 12;
  const end = middle + Math.PI / 12;
  const inner = key.ring === "A" ? WHEEL.innerEdge : WHEEL.split;
  const outer = key.ring === "A" ? WHEEL.split : WHEEL.outerEdge;
  const a = polar(outer, start);
  const b = polar(outer, end);
  const c = polar(inner, end);
  const d = polar(inner, start);
  return `M${f(a.x)} ${f(a.y)}A${outer} ${outer} 0 0 1 ${f(b.x)} ${f(b.y)}L${f(c.x)} ${f(c.y)}A${inner} ${inner} 0 0 0 ${f(d.x)} ${f(d.y)}Z`;
}

export function labelPoint(key: CamelotKey): Point {
  return polar(key.ring === "A" ? WHEEL.innerLabel : WHEEL.outerLabel, positionAngle(key.n));
}

/**
 * Places every track inside its key's segment. Set tracks are placed first and
 * always shown; crate dots fill the room that is left, and any that do not fit
 * are counted in `overflow` instead of being drawn on top of each other.
 */
export function layoutWheel(tracks: readonly Track[], setIds: readonly string[]): WheelLayout {
  const positionOf = new Map(setIds.map((id, index) => [id, index + 1]));
  const cells = new Map<number, Track[]>();
  for (const track of tracks) {
    const index = keyIndex(track.key);
    const cell = cells.get(index);
    if (cell) cell.push(track);
    else cells.set(index, [track]);
  }

  const nodes = new Map<string, WheelNode>();
  const overflow = new Map<number, number>();

  for (const [index, cell] of cells) {
    const key = keyFromIndex(index);
    const inSet = cell
      .filter((track) => positionOf.has(track.id))
      .sort((a, b) => (positionOf.get(a.id) ?? 0) - (positionOf.get(b.id) ?? 0));
    const others = cell.filter((track) => !positionOf.has(track.id));
    const items = [...inSet, ...others].map((track) => ({
      track,
      position: positionOf.get(track.id) ?? null,
      width: positionOf.has(track.id) ? SET_WIDTH : DOT_WIDTH,
    }));

    // Try one row, then two, then three (inner ring only): the first arrangement that holds
    // everything wins. If none does, the last one is used and the leftover dots are counted.
    const pack = (radii: number[]) => {
      const rows = radii.map((radius) => ({
        radius,
        room: radius * USABLE_ANGLE,
        items: [] as typeof items,
      }));
      let dropped = 0;
      let squeezed = 0;
      for (const item of items) {
        const row = rows.reduce((best, candidate) =>
          candidate.room > best.room ? candidate : best,
        );
        if (row.room >= item.width) {
          row.items.push(item);
          row.room -= item.width;
        } else if (item.position !== null) {
          // A set track is always drawn, even if it has to crowd its neighbours.
          row.items.push(item);
          row.room -= item.width;
          squeezed++;
        } else {
          dropped++;
        }
      }
      return { rows, dropped, squeezed };
    };
    let packed = pack(ROWS[key.ring][0]);
    for (const radii of ROWS[key.ring].slice(1)) {
      if (packed.dropped === 0 && packed.squeezed === 0) break;
      packed = pack(radii);
    }
    const { rows } = packed;
    if (packed.dropped > 0) overflow.set(index, packed.dropped);

    const middle = positionAngle(key.n);
    for (const row of rows) {
      const used = row.items.reduce((sum, item) => sum + item.width, 0);
      let along = -used / 2;
      for (const item of row.items) {
        const angle = middle + (along + item.width / 2) / row.radius;
        along += item.width;
        nodes.set(item.track.id, {
          id: item.track.id,
          position: item.position,
          ...polar(row.radius, angle),
        });
      }
    }
  }
  return { nodes, overflow };
}

/**
 * A curved link between two nodes. Long links bend toward the centre of the
 * wheel, like chords; links between neighbours bow sideways so they stay visible.
 */
export function linkPath(from: Point, to: Point): string {
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  let controlX: number;
  let controlY: number;
  if (distance < 44) {
    const bow = 12;
    controlX = midX + (-dy / (distance || 1)) * bow;
    controlY = midY + (dx / (distance || 1)) * bow;
  } else {
    const pull = Math.min(0.5, 0.16 + distance / 1000);
    controlX = midX + (WHEEL.center - midX) * pull;
    controlY = midY + (WHEEL.center - midY) * pull;
  }
  return `M${f(from.x)} ${f(from.y)}Q${f(controlX)} ${f(controlY)} ${f(to.x)} ${f(to.y)}`;
}
