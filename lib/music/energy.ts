/**
 * The energy arc: a target energy curve over the length of the set.
 *
 * A curve is a list of points with both axes normalised to 0-1: `t` is the
 * position in the set (0 = first track, 1 = the end) and `e` is the energy
 * (0 = level 1, 1 = level 10 on the 1-10 scale DJ tools use). Between points
 * the curve is a straight line.
 */

export interface ArcPoint {
  t: number;
  e: number;
}

export const ENERGY_MIN = 1;
export const ENERGY_MAX = 10;
export const MAX_ARC_POINTS = 32;

/** Normalised 0-1 energy to the 1-10 level scale. */
export function toLevel(e: number): number {
  return ENERGY_MIN + (ENERGY_MAX - ENERGY_MIN) * e;
}

/** A 1-10 level to normalised 0-1 energy. */
export function fromLevel(level: number): number {
  return (level - ENERGY_MIN) / (ENERGY_MAX - ENERGY_MIN);
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Target energy (0-1) at position `t`. Flat before the first point and after the last. */
export function energyAt(points: readonly ArcPoint[], t: number): number {
  if (points.length === 0) return 0.5;
  if (t <= points[0].t) return points[0].e;
  const last = points[points.length - 1];
  if (t >= last.t) return last.e;
  for (let i = 1; i < points.length; i++) {
    const right = points[i];
    if (t <= right.t) {
      const left = points[i - 1];
      const span = right.t - left.t;
      if (span <= 0) return right.e;
      return left.e + ((t - left.t) / span) * (right.e - left.e);
    }
  }
  return last.e;
}

/**
 * Cleans a list of raw points into a valid curve, or returns null when there is
 * no usable curve in it. Used for hand-drawn curves and, more importantly, for
 * whatever the model returns: values are clamped to 0-1, non-numbers dropped,
 * points sorted, duplicates merged, the curve extended flat to t=0 and t=1, and
 * long lists thinned to `MAX_ARC_POINTS`.
 */
export function normalizeArc(raw: readonly { t: unknown; e: unknown }[]): ArcPoint[] | null {
  const points: ArcPoint[] = [];
  for (const point of raw) {
    if (typeof point.t !== "number" || typeof point.e !== "number") continue;
    if (!Number.isFinite(point.t) || !Number.isFinite(point.e)) continue;
    points.push({ t: clamp01(point.t), e: clamp01(point.e) });
  }
  points.sort((a, b) => a.t - b.t);

  const merged: ArcPoint[] = [];
  for (const point of points) {
    const previous = merged[merged.length - 1];
    if (previous && point.t - previous.t < 0.004) previous.e = point.e;
    else merged.push({ ...point });
  }
  if (merged.length < 2) return null;

  // Pin the ends: snap a point that is nearly there, otherwise extend the curve flat.
  let curve = merged;
  const first = curve[0];
  if (first.t < 0.02) first.t = 0;
  else curve = [{ t: 0, e: first.e }, ...curve];
  const last = curve[curve.length - 1];
  if (last.t > 0.98) last.t = 1;
  else curve = [...curve, { t: 1, e: last.e }];

  if (curve.length > MAX_ARC_POINTS) {
    const all = curve;
    curve = Array.from(
      { length: MAX_ARC_POINTS },
      (_, i) => all[Math.round((i * (all.length - 1)) / (MAX_ARC_POINTS - 1))],
    );
  }
  return curve.map((point) => ({ t: round3(point.t), e: round3(point.e) }));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** The arc the app opens with: warm up, build, peak two thirds in, ease out. */
export const DEFAULT_ARC: ArcPoint[] = [
  { t: 0, e: 0.3 },
  { t: 0.15, e: 0.38 },
  { t: 0.32, e: 0.52 },
  { t: 0.5, e: 0.7 },
  { t: 0.66, e: 0.88 },
  { t: 0.8, e: 0.9 },
  { t: 0.92, e: 0.68 },
  { t: 1, e: 0.5 },
];
