/**
 * Arc from words: a DJ describes the night, Claude returns the target energy
 * curve as structured output, and `validateArc` checks it before the app uses
 * it. The curve is the model's judgement; everything downstream of it (which
 * tracks, what order, how well they fit) is computed by code.
 *
 * This file is the shared, dependency-free half: the result type and the
 * validator, used by the route, the browser, and the fixture tests. The model
 * call lives in `arc-live.ts`.
 */
import { normalizeArc, type ArcPoint } from "../music/energy";

export const ARC_DESCRIPTION_MAX = 400;
export const SUMMARY_MAX = 160;
/** A curve needs at least this many points to be worth planning a set around. */
const MIN_POINTS = 3;

export interface ArcPlan {
  /** One line describing the shape of the curve. */
  summary: string;
  /** Set length the description stated, in minutes, or null when it gave none. */
  durationMinutes: number | null;
  points: ArcPoint[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Checks and cleans a curve, whether it came from the model (`energy` per
 * point) or from a stored result (`e` per point). Returns null when there is no
 * usable curve in it.
 */
export function validateArc(raw: unknown): ArcPlan | null {
  if (!isRecord(raw) || !Array.isArray(raw.points)) return null;
  const points = normalizeArc(
    raw.points.filter(isRecord).map((point) => ({ t: point.t, e: point.energy ?? point.e })),
  );
  if (!points || points.length < MIN_POINTS) return null;
  const summary =
    typeof raw.summary === "string"
      ? raw.summary.replace(/\s+/g, " ").trim().slice(0, SUMMARY_MAX)
      : "";
  const minutes = raw.durationMinutes;
  return {
    summary: summary || "Energy arc",
    durationMinutes:
      typeof minutes === "number" && Number.isFinite(minutes) && minutes >= 15 && minutes <= 600
        ? Math.round(minutes)
        : null,
    points,
  };
}
